// Worker tests with a fake upstream. Run: node test.mjs
import worker, { toAnthropic, fromAnthropic, toOpenAI, fromOpenAI, validate } from "./src/index.js";
let fails = 0;
const check = (name, cond, extra = "") => { console.log((cond ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!cond) fails++; };
const req = { tier: "quick", system: "sys", tools: [{ name: "run_scenario", description: "d", input_schema: { type: "object" } }],
  messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "", tool_calls: [{ id: "t1", name: "run_scenario", input: { lines: [] } }] },
             { role: "tool", results: [{ id: "t1", output: "{\"x\":1}" }] }] };

const a = toAnthropic(req, "claude-haiku-5-5");
check("anthropic: tool_use block", a.messages[1].content[0].type === "tool_use" && a.messages[1].content[0].id === "t1");
check("anthropic: tool_result as user turn", a.messages[2].role === "user" && a.messages[2].content[0].type === "tool_result" && a.messages[2].content[0].tool_use_id === "t1");
check("anthropic: input_schema kept, max_tokens capped", a.tools[0].input_schema.type === "object" && a.max_tokens === 1024);
const fa = fromAnthropic({ content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "t2", name: "find_codes", input: { query: "viet" } }], usage: { input_tokens: 5, output_tokens: 2 } });
check("anthropic: response normalised", fa.text === "ok" && fa.tool_calls[0].name === "find_codes" && fa.usage.input_tokens === 5);

const o = toOpenAI(req, "m");
check("openai: system first, tool role", o.messages[0].role === "system" && o.messages[3].role === "tool" && o.messages[3].tool_call_id === "t1");
check("openai: function tools", o.tools[0].type === "function" && o.tools[0].function.parameters.type === "object");
const fo = fromOpenAI({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", function: { name: "run_scenario", arguments: "{\"lines\":[]}" } }] } }], usage: { prompt_tokens: 9, completion_tokens: 3 } });
check("openai: response normalised", fo.tool_calls[0].input.lines.length === 0 && fo.usage.output_tokens === 3);

check("validate: rejects unknown tool", validate({ ...req, tools: [{ name: "rm_rf" }] }) !== null);
check("validate: rejects assistant-first", validate({ ...req, messages: [{ role: "assistant", content: "x" }] }) !== null);
check("validate: accepts good request", validate(req) === null);

const env = { ANTHROPIC_API_KEY: "test-key", ALLOWED_ORIGINS: "https://shozmoz1401.github.io",
  RL_IP: { calls: 0, async limit() { this.calls++; return { success: this.calls <= 2 }; } } };
let seen = null;
const fakeFetch = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ model: "claude-haiku-5-5", content: [{ type: "text", text: "answer" }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }); };
const mk = (origin, body) => new Request("https://tes-ai.example.workers.dev/v1/agent", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" }, body: JSON.stringify(body) });

let r = await worker.fetch(mk("https://shozmoz1401.github.io", req), env, {}, fakeFetch);
let j = await r.json();
check("worker: forwards and normalises", r.status === 200 && j.text === "answer");
check("worker: key sent upstream in header only", seen.init.headers["x-api-key"] === "test-key" && !seen.init.body.includes("test-key"));
check("worker: key never in response", !JSON.stringify(j).includes("test-key"));
check("worker: quick tier -> Haiku", JSON.parse(seen.init.body).model === "claude-haiku-5-5");
r = await worker.fetch(mk("https://evil.example", req), env, {}, fakeFetch);
check("worker: other origins refused", r.status === 403);
r = await worker.fetch(mk("https://shozmoz1401.github.io", req), env, {}, fakeFetch);
r = await worker.fetch(mk("https://shozmoz1401.github.io", req), env, {}, fakeFetch);
check("worker: per-IP rate limit returns 429", r.status === 429);
const env2 = { ...env, RL_IP: undefined };
r = await worker.fetch(mk("https://shozmoz1401.github.io", { ...req, tools: [{ name: "delete_everything" }] }), env2, {}, fakeFetch);
check("worker: disallowed tool -> 400", r.status === 400);
r = await worker.fetch(mk("https://shozmoz1401.github.io", req), env2, {}, async () => new Response("{}", { status: 500 }));
j = await r.json();
check("worker: upstream error hidden as 502", r.status === 502 && j.error === "AI provider error");
const env3 = { ...env2, PROVIDER: "openai", OPENAI_COMPAT_URL: "https://free.example/v1/chat/completions", OPENAI_COMPAT_KEY: "k2" };
r = await worker.fetch(mk("https://shozmoz1401.github.io", req), env3, {}, async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ choices: [{ message: { content: "free answer" } }] }), { status: 200 }); });
j = await r.json();
check("worker: provider swap to OpenAI-compatible", seen.url.startsWith("https://free.example") && j.text === "free answer");
console.log(fails ? `\n${fails} FAILED` : "\nall worker tests passed");
process.exit(fails ? 1 : 0);

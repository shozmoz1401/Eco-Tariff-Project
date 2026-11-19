// Tariff Exposure Simulator — AI proxy (Cloudflare Worker).
// Holds the API key as a secret and forwards ONE model call per request. The system prompts and tool
// definitions live HERE (spec.generated.js, built from site/js/ai.js); the page cannot supply its own,
// so the Worker cannot be used as a general-purpose AI proxy. Tools run in the browser.
//
// POST /v1/agent  body (nothing else is accepted):
//   {task: "reader"|"analyst", question, scenario?: {lines, mode}, history?: [{role, content}], turns: [...]}
//   turns alternate {role:"assistant", text, tool_calls:[{id,name,input}]} and {role:"tool", results:[{id, output}]}
// -> {text, tool_calls:[{id,name,input}], usage:{input_tokens, output_tokens}, model}
import { SPEC } from "./spec.generated.js";

export const ALLOWED_TOOLS = SPEC.tools.analyst.map((t) => t.name);
const LIMITS = { bodyBytes: 120_000, question: 1_500, historyItems: 6, historyChars: 2_000, turns: 12, toolOutput: 12_000,
                 toolInput: 4_000, lines: 10, codes: 60, maxTokens: 1024 };
const KEYS = { reader: ["task", "question", "turns"], analyst: ["task", "question", "scenario", "history", "turns"] };

function cors(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    ok,
    headers: {
      "access-control-allow-origin": ok ? (origin || "*") : "null",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "vary": "origin",
    },
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const isStr = (x, max) => typeof x === "string" && x.length > 0 && x.length <= max;
const ISO3 = /^[A-Z]{3}$/, HS2 = /^\d{2}$/;
function codeList(x, re) { return x === "ALL" || (Array.isArray(x) && x.length > 0 && x.length <= LIMITS.codes && x.every((c) => c === "ALL" || (typeof c === "string" && re.test(c)))); }

function validScenario(sc) {
  if (!sc || typeof sc !== "object" || Array.isArray(sc)) return "scenario must be an object";
  if (Object.keys(sc).some((k) => !["lines", "mode"].includes(k))) return "unexpected scenario field";
  if (sc.mode !== undefined && !["replace", "add"].includes(sc.mode)) return "bad mode";
  if (!Array.isArray(sc.lines) || sc.lines.length > LIMITS.lines) return "bad scenario lines";
  for (const L of sc.lines) {
    if (!L || typeof L !== "object") return "bad line";
    if (Object.keys(L).some((k) => !["targets", "products", "rate", "exclude_targets", "exclude_products"].includes(k))) return "unexpected line field";
    if (!codeList(L.targets, ISO3) || !codeList(L.products, HS2)) return "bad line codes";
    if (typeof L.rate !== "number" || !isFinite(L.rate) || L.rate < 0 || L.rate > 1000) return "bad rate";
    if (L.exclude_targets && !codeList(L.exclude_targets, ISO3)) return "bad exclude_targets";
    if (L.exclude_products && !codeList(L.exclude_products, HS2)) return "bad exclude_products";
  }
  return null;
}

// Accept only the exact request shapes the simulator sends.
export function validate(req) {
  if (!req || typeof req !== "object" || Array.isArray(req)) return "body must be a JSON object";
  if (!KEYS[req.task]) return "unknown task";
  if (Object.keys(req).some((k) => !KEYS[req.task].includes(k))) return "unexpected field";
  if (!isStr(req.question, LIMITS.question)) return "question missing or too long";
  if (req.task === "analyst") {
    const bad = validScenario(req.scenario); if (bad) return bad;
    const h = req.history || [];
    if (!Array.isArray(h) || h.length > LIMITS.historyItems) return "bad history";
    for (let i = 0; i < h.length; i++) {
      if (!h[i] || Object.keys(h[i]).some((k) => !["role", "content"].includes(k))) return "bad history item";
      if (h[i].role !== (i % 2 === 0 ? "user" : "assistant") || !isStr(h[i].content, LIMITS.historyChars)) return "bad history item";
    }
  }
  const tools = SPEC.tools[req.task].map((t) => t.name), turns = req.turns || [];
  if (!Array.isArray(turns) || turns.length > LIMITS.turns) return "bad turns";
  let pending = null;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (!t || typeof t !== "object") return "bad turn";
    if (i % 2 === 0) {
      if (t.role !== "assistant" || Object.keys(t).some((k) => !["role", "text", "tool_calls"].includes(k))) return "bad assistant turn";
      if (t.text !== undefined && (typeof t.text !== "string" || t.text.length > LIMITS.historyChars)) return "bad assistant text";
      if (!Array.isArray(t.tool_calls) || !t.tool_calls.length || t.tool_calls.length > 6) return "bad tool calls";
      for (const c of t.tool_calls) {
        if (!c || !isStr(c.id, 100) || !tools.includes(c.name) || typeof c.input !== "object" || c.input === null || Array.isArray(c.input)) return "tool call not allowed";
        if (JSON.stringify(c.input).length > LIMITS.toolInput) return "tool input too large";
      }
      pending = t.tool_calls.map((c) => c.id);
    } else {
      if (t.role !== "tool" || Object.keys(t).some((k) => !["role", "results"].includes(k)) || !Array.isArray(t.results)) return "bad tool turn";
      const ids = t.results.map((r) => r && r.id);
      if (ids.length !== pending.length || ids.some((id, j) => id !== pending[j])) return "tool results do not match the calls";
      if (t.results.some((r) => typeof r.output !== "string" || r.output.length > LIMITS.toolOutput || Object.keys(r).length !== 2)) return "bad tool result";
      pending = null;
    }
  }
  if (pending) return "turns must end with tool results";
  return null;
}

function scenarioLine(lines, mode) {   // must match scenarioLine() in site/js/ai.js (tested)
  return "The user's current scenario (" + (mode === "add" ? "add" : "replace") + " mode): " + JSON.stringify(lines || []) + ". Use it when they say 'this scenario'.";
}

// Build the normalised model request from the validated simulator request.
export function buildRequest(req) {
  const system = req.task === "reader" ? SPEC.reader_system : SPEC.analyst_base + "\n" + scenarioLine(req.scenario.lines, req.scenario.mode);
  const messages = (req.task === "analyst" ? req.history || [] : []).map((h) => ({ role: h.role, content: h.content }));
  messages.push({ role: "user", content: req.question });
  for (const t of req.turns || []) {
    if (t.role === "assistant") messages.push({ role: "assistant", content: t.text || "", tool_calls: t.tool_calls });
    else messages.push({ role: "tool", results: t.results });
  }
  return { tier: req.task === "reader" ? "quick" : "default", system, messages, tools: SPEC.tools[req.task] };
}

// ---------------------------------------------------------------- provider translation
export function toAnthropic(req, model) {
  const messages = req.messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "assistant") {
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const c of m.tool_calls || []) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input || {} });
      return { role: "assistant", content };
    }
    return { role: "user", content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: String(r.output) })) };
  });
  return { model, max_tokens: LIMITS.maxTokens, system: req.system, messages,
           tools: (req.tools || []).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })) };
}

export function fromAnthropic(j) {
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const tool_calls = (j.content || []).filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
  return { text, tool_calls, usage: j.usage || null, model: j.model };
}

export function toOpenAI(req, model) {
  const messages = [{ role: "system", content: req.system }];
  for (const m of req.messages) {
    if (m.role === "user") messages.push({ role: "user", content: m.content });
    else if (m.role === "assistant") messages.push({ role: "assistant", content: m.content || null,
      tool_calls: (m.tool_calls || []).map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input || {}) } })) });
    else for (const r of m.results) messages.push({ role: "tool", tool_call_id: r.id, content: String(r.output) });
  }
  return { model, max_tokens: LIMITS.maxTokens, messages,
           tools: (req.tools || []).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })) };
}

export function fromOpenAI(j) {
  const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
  const tool_calls = (msg.tool_calls || []).map((c) => {
    let input = {};
    try { input = JSON.parse(c.function.arguments || "{}"); } catch (e) { input = {}; }
    return { id: c.id, name: c.function.name, input };
  });
  const u = j.usage || {};
  return { text: msg.content || "", tool_calls, usage: { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens }, model: j.model };
}

// The one place that knows which provider is used. Set PROVIDER = "anthropic" (default) or "openai".
export async function callUpstream(env, req, fetchImpl = fetch) {
  const model = req.tier === "quick" ? (env.MODEL_QUICK || "claude-haiku-5-5") : (env.MODEL_DEFAULT || "claude-haiku-5-5");
  if ((env.PROVIDER || "anthropic") === "openai") {
    const r = await fetchImpl(env.OPENAI_COMPAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + env.OPENAI_COMPAT_KEY },
      body: JSON.stringify(toOpenAI(req, env.OPENAI_COMPAT_MODEL || model)),
    });
    if (!r.ok) throw Object.assign(new Error("upstream " + r.status), { status: r.status });
    return fromOpenAI(await r.json());
  }
  const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(toAnthropic(req, model)),
  });
  if (!r.ok) throw Object.assign(new Error("upstream " + r.status), { status: r.status });
  return fromAnthropic(await r.json());
}

export default {
  async fetch(request, env, ctx, fetchImpl = fetch) {
    const origin = request.headers.get("origin") || "";
    const c = cors(env, origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: c.headers });
    const url = new URL(request.url);
    if (url.pathname !== "/v1/agent" || request.method !== "POST") return json({ error: "not found" }, 404, c.headers);
    if (!c.ok) return json({ error: "origin not allowed" }, 403, c.headers);

    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (env.RL_IP) { const { success } = await env.RL_IP.limit({ key: ip }); if (!success) return json({ error: "rate limited" }, 429, c.headers); }
    if (env.RL_GLOBAL) { const { success } = await env.RL_GLOBAL.limit({ key: "all" }); if (!success) return json({ error: "busy, try again in a minute" }, 429, c.headers); }

    const raw = await request.text();
    if (raw.length > LIMITS.bodyBytes) return json({ error: "request too large" }, 413, c.headers);
    let req;
    try { req = JSON.parse(raw); } catch (e) { return json({ error: "body must be JSON" }, 400, c.headers); }
    const bad = validate(req);
    if (bad) return json({ error: bad }, 400, c.headers);

    try {
      return json(await callUpstream(env, buildRequest(req), fetchImpl), 200, c.headers);
    } catch (e) {
      return json({ error: "AI provider error" }, e.status === 429 ? 429 : 502, c.headers);
    }
  },
};

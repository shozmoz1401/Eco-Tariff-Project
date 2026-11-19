// Tariff Exposure Simulator — AI proxy (Cloudflare Worker).
// Holds the API key as a secret and forwards ONE model call per request. Tools run in the browser,
// so this Worker never sees or computes engine numbers. Provider is swappable in callUpstream().
//
// POST /v1/agent  body: {tier, system, messages, tools}
//   messages: {role:"user", content} | {role:"assistant", content, tool_calls:[{id,name,input}]} | {role:"tool", results:[{id, output}]}
//   tools:    [{name, description, input_schema}]
// -> {text, tool_calls:[{id,name,input}], usage:{input_tokens, output_tokens}, model}

export const ALLOWED_TOOLS = ["run_scenario", "country_detail", "compare_scenarios", "find_codes", "current_rate"];
const LIMITS = { bodyBytes: 200_000, messages: 40, systemChars: 20_000, maxTokens: 1024 };

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

export function validate(req) {
  if (!req || typeof req !== "object") return "body must be JSON";
  if (typeof req.system !== "string" || req.system.length > LIMITS.systemChars) return "system missing or too long";
  if (!Array.isArray(req.messages) || !req.messages.length || req.messages.length > LIMITS.messages) return "messages missing or too many";
  for (const m of req.messages) {
    if (!["user", "assistant", "tool"].includes(m.role)) return "bad message role";
    if (m.role === "tool" && !Array.isArray(m.results)) return "tool message needs results";
  }
  if (req.messages[0].role !== "user") return "first message must be from the user";
  const tools = req.tools || [];
  if (!Array.isArray(tools)) return "tools must be a list";
  for (const t of tools) if (!ALLOWED_TOOLS.includes(t.name)) return "tool not allowed: " + t.name;
  if (req.tier && !["quick", "default"].includes(req.tier)) return "bad tier";
  return null;
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
      return json(await callUpstream(env, req, fetchImpl), 200, c.headers);
    } catch (e) {
      return json({ error: "AI provider error" }, e.status === 429 ? 429 : 502, c.headers);
    }
  },
};

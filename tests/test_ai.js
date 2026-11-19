// AI layer tests (no network, no key): number check, tools, analyst loop with a scripted fake model,
// AI parser validation, artifact provider, rate gate, rule-parser eval.  Run: node tests/test_ai.js
const fs = require("fs"), path = require("path");
process.chdir(path.join(__dirname, ".."));
const E = require("../site/js/engine.js"); global.TES_ENGINE = E;
const AI = require("../site/js/ai.js"), P = require("../site/js/parser.js");
const L = (f) => JSON.parse(fs.readFileSync(f));
const data = { 2024: L("site/data/usa_2024.json"), 2025: L("site/data/usa_2025.json") }, gdp = L("site/data/gdp.json"), current = L("site/data/current_us.json"), meta = L("site/data/meta.json");
const ctx = { data: (y) => data[y], gdp: (y) => gdp[String(y)], current, years: [2024, 2025], defaultYear: 2025,
  name: (iso) => data[2025].names[iso] || iso, chName: (c) => (meta.chapters[c] || {}).short || c, elasticity: () => 0.76 };
let fails = 0;
const check = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!c) fails++; };

(async () => {
  // ---- number check
  const allowed = "exports_hit $443.1bn duties_today $386.6bn avg_rate_today 34.2% rate_change -6.3 pts year 2025 $144m chapter 87";
  const cases = [["$443.1bn of exports are hit", true], ["roughly $443bn", true], ["$443.2bn", false], ["34.2% today", true], ["34% today", true],
    ["33.0%", false], ["down 6.3 points", true], ["in 2025", true], ["in 2031", false], ["$0.14bn", true], ["$1bn", false], ["top 5", true], ["the 87 chapter", true]];
  for (const [t, exp] of cases) check(`guard: "${t}" ${exp ? "allowed" : "blocked"}`, AI.checkNumbers(t, allowed).ok === exp);

  // ---- tools equal the engine
  const T = AI.makeTools(ctx), tool = (n) => T.defs.find((d) => d.name === n);
  const lines = [{ targets: ["IND"], products: "ALL", rate: 10 }, { targets: "ALL", products: ["87"], rate: 25 }];
  const s = tool("run_scenario").run({ lines });
  const eng = E.compute(data[2025], gdp["2025"], current.lines, { mode: "replace", lines }, 0.76);
  check("tool run_scenario: totals match engine", s.totals.exports_hit === AI.money(eng.totals.hit) && s.totals.duties_today === AI.money(eng.totals.cur_bill), s.totals.exports_hit);
  check("tool run_scenario: rejects bad code", !!tool("run_scenario").run({ lines: [{ targets: ["XXX"], products: "ALL", rate: 5 }] }).error);
  check("tool run_scenario: rejects negative rate", !!tool("run_scenario").run({ lines: [{ targets: ["CHN"], products: "ALL", rate: -5 }] }).error);
  const cd = tool("country_detail").run({ code: "CHN" });
  check("tool country_detail: China today matches engine", cd.avg_rate_today === AI.pct(E.compute(data[2025], gdp["2025"], current.lines, { lines: [] }, 0.76).byCountry.CHN.cur_bill / eng.byCountry.CHN.imports), cd.avg_rate_today);
  const cmp = tool("compare_scenarios").run({ a: { lines: [] }, b: { lines: [{ targets: ["CHN"], products: "ALL", rate: 25 }] }, codes: ["CHN"] });
  check("tool compare_scenarios: difference computed by engine", cmp.countries[0].duties_difference.startsWith("-"), cmp.countries[0].duties_difference);
  const depths = T.defs.map((d) => [d.name, AI.schemaDepth(d.inputSchema)]);
  check("tool schemas nest at most 5 levels (platform rejects > 6)", depths.every(([, n]) => n <= 5), JSON.stringify(depths));
  check("tool run_scenario: [\"ALL\"] means all", tool("run_scenario").run({ lines: [{ targets: ["ALL"], products: ["87"], rate: 25 }] }).totals.countries_hit > 100);
  const th = tool("country_detail").run({ code: "THA", lines });
  check("tool country_detail: who-gains rank for any country (Thailand)", th.who_gains.diversion_potential === AI.money(eng.gains.THA.total) && th.who_gains.rank > 0, JSON.stringify(th.who_gains).slice(0, 90));
  check("tool find_codes", tool("find_codes").run({ query: "viet" }).matches.some((m) => m.code === "VNM"));
  const cr = tool("current_rate").run({ targets: ["CHN"], products: ["87"] });
  check("tool current_rate: China vehicles", cr.avg_rate_today_number > 40, cr.avg_rate_today);

  // ---- fake model behind the HTTP provider (exercises the real tool loop)
  function fakeModel(script) {
    let call = 0;
    return async (url, init) => {
      const body = JSON.parse(init.body), step = script[call++] || script[script.length - 1];
      const out = step(body);
      return { ok: true, status: 200, json: async () => out };
    };
  }
  const lastTool = (body) => JSON.parse(body.messages[body.messages.length - 1].results[0].output);
  const honest = [() => ({ text: "", tool_calls: [{ id: "a", name: "run_scenario", input: { lines } }] }),
                  (b) => ({ text: `The engine shows ${lastTool(b).totals.exports_hit} of exports hit; Mexico is most exposed at ${lastTool(b).most_exposed[0].share_of_gdp} of GDP.` })];
  let prov = AI.httpProvider("https://proxy/v1/agent", fakeModel(honest));
  let r = await AI.analyst(prov, ctx, "Who is most exposed?", [], lines, "replace");
  check("analyst: honest answer passes the check", r.ok && !r.retried && r.toolLog.length === 1, r.text);

  const liar = [() => ({ text: "", tool_calls: [{ id: "a", name: "run_scenario", input: { lines } }] }), () => ({ text: "Exports hit are $999.9bn, a 42.4% jump." })];
  prov = AI.httpProvider("https://proxy/v1/agent", fakeModel(liar));
  r = await AI.analyst(prov, ctx, "How big?", [], lines, "replace");
  check("analyst: invented numbers are withheld after one retry", !r.ok && r.retried && r.text === "" && r.bad.includes("$999.9bn"), JSON.stringify(r.bad));

  const fixer = [() => ({ text: "", tool_calls: [{ id: "a", name: "run_scenario", input: { lines } }] }), () => ({ text: "About $1.2tn is hit." }),
                 () => ({ text: "", tool_calls: [{ id: "b", name: "run_scenario", input: { lines } }] }), (b) => ({ text: `The engine shows ${lastTool(b).totals.exports_hit}.` })];
  prov = AI.httpProvider("https://proxy/v1/agent", fakeModel(fixer));
  r = await AI.analyst(prov, ctx, "How big?", [], lines, "replace");
  check("analyst: corrected on retry is shown", r.ok && r.retried, r.text);

  const arith = [() => ({ text: "", tool_calls: [{ id: "a", name: "compare_scenarios", input: { a_lines: [], b_lines: [{ targets: ["CHN"], products: ["ALL"], rate: 25 }], codes: ["CHN"] } }] }),
                 (b) => ({ text: `China's duties change by ${lastTool(b).countries[0].duties_difference}.` })];
  prov = AI.httpProvider("https://proxy/v1/agent", fakeModel(arith));
  r = await AI.analyst(prov, ctx, "Compare", [], lines, "replace");
  check("analyst: differences from compare_scenarios pass", r.ok, r.text);

  // ---- artifact provider with a fake sample() that calls a tool
  let seenMsgs = null;
  const fakeSample = async (msgs, opts) => { seenMsgs = msgs; const t = opts.tools.find((x) => x.name === "run_scenario"); const out = t.execute({ lines }); return { text: `The engine shows ${out.totals.exports_hit}.` }; };
  r = await AI.analyst(AI.artifactProvider(fakeSample), ctx, "Total?", [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], lines, "replace");
  check("artifact provider: tools logged, answer passes", r.ok && r.toolLog.length === 1, r.text);
  check("artifact provider: instructions ride on first user turn", seenMsgs[0].role === "user" && seenMsgs[0].content.startsWith("You are the analyst") && seenMsgs[2].content === "Total?");

  // ---- AI parser validation
  const parseScript = (json, toolFirst) => fakeModel(toolFirst ? [() => ({ text: "", tool_calls: [{ id: "p", name: "current_rate", input: { targets: ["CHN"], products: ["87"] } }] }), () => ({ text: JSON.stringify(json) })] : [() => ({ text: JSON.stringify(json) })]);
  let pr = await AI.aiParse(AI.httpProvider("x", parseScript({ lines: [{ targets: ["IND"], products: "ALL", rate: 10 }], notes: [], unsupported: [] })), ctx, "10% on India");
  check("ai parse: rate from the text accepted", pr.lines.length === 1 && pr.lines[0].rate === 10);
  pr = await AI.aiParse(AI.httpProvider("x", parseScript({ lines: [{ targets: ["IND"], products: "ALL", rate: 17 }] })), ctx, "tariffs on India");
  check("ai parse: invented rate dropped", pr.lines.length === 0 && pr.warnings.length === 1);
  const doubled = +(2 * cr.avg_rate_today_number).toFixed(1);
  pr = await AI.aiParse(AI.httpProvider("x", parseScript({ lines: [{ targets: ["CHN"], products: ["87"], rate: doubled, derived_from: cr.avg_rate_today_number }] }, true)), ctx, "double tariffs on Chinese cars");
  check("ai parse: 'double' derived from current_rate accepted and flagged", pr.lines.length === 1 && pr.warnings.some((w) => /derived/.test(w)), `${pr.lines[0] && pr.lines[0].rate}%`);
  let threw = false;
  try { await AI.aiParse(AI.httpProvider("x", parseScript({ lines: [{ targets: ["ZZZ"], products: "ALL", rate: 10 }] })), ctx, "10% on Zed"); } catch (e) { threw = true; }
  check("ai parse: unknown country code rejected (falls back to rules)", threw);

  // ---- rate gate
  const store = { v: null, getItem() { return this.v; }, setItem(k, v) { this.v = v; } };
  const g = AI.rateGate(3, 3600e3, store);
  check("rate gate: 3 allowed then blocked", g.take(1).ok && g.take(2).ok && g.take(3).ok && !g.take(4).ok && g.take(3600e3 + 2).ok);

  // ---- rule-based parser eval (the always-on fallback)
  const ev = L("tests/parser_eval.json");
  const norm = (x) => JSON.stringify((x || []).map((l) => ({ t: l.targets === "ALL" ? "ALL" : [...l.targets].sort(), p: l.products === "ALL" ? "ALL" : [...l.products].sort(), r: l.rate, xt: (l.exclude_targets || []).sort(), xp: (l.exclude_products || []).sort() })));
  let ok = 0;
  for (const c of ev) { const got = P.parse(c.text, data[2025].names).lines; const pass = norm(got) === norm(c.expect); ok += pass; if (!pass) console.log("   rule parser miss:", c.text, "->", norm(got)); }
  console.log(`INFO rule-based parser: ${ok}/${ev.length} eval cases`);
  fs.writeFileSync("site/data/parser_eval.json", JSON.stringify(ev));

  console.log(fails ? `\n${fails} FAILED` : "\nall AI tests passed");
  process.exit(fails ? 1 : 0);
})();

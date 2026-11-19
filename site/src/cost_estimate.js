// Running-cost estimate for the API route, from the real prompt and tool-result sizes.
// Tokens are estimated as characters / 4 (a rule of thumb; the Worker returns exact usage once deployed).
const fs = require("fs"), path = require("path"); process.chdir(path.join(__dirname, ".."));
global.TES_ENGINE = require("../site/js/engine.js"); const AI = require("../site/js/ai.js");
const L = (f) => JSON.parse(fs.readFileSync(f));
const data = { 2024: L("site/data/usa_2024.json"), 2025: L("site/data/usa_2025.json") }, gdp = L("site/data/gdp.json"), current = L("site/data/current_us.json"), meta = L("site/data/meta.json");
const ctx = { data: (y) => data[y], gdp: (y) => gdp[String(y)], current, years: [2024, 2025], defaultYear: 2025, name: (i) => data[2025].names[i] || i, chName: (c) => meta.chapters[c].short, elasticity: () => 0.76 };
const T = AI.makeTools(ctx), tok = (s) => Math.ceil(String(s).length / 4);
const defs = (names) => JSON.stringify(T.defs.filter((d) => names.includes(d.name)).map((d) => ({ name: d.name, description: d.description, input_schema: d.inputSchema })));
const lines = [{ targets: ["IND"], products: "ALL", rate: 10 }, { targets: "ALL", products: ["87"], rate: 25 }];
const runOut = JSON.stringify(T.defs.find((d) => d.name === "run_scenario").run({ lines }));
const cdOut = JSON.stringify(T.defs.find((d) => d.name === "country_detail").run({ code: "VNM", lines }));
// parser: one call, ~150 output tokens
const pIn = tok(AI.parserSystem(ctx)) + tok(defs(["find_codes", "current_rate"])) + 40, pOut = 150;
// analyst: 3 model calls (tool, tool, answer); each re-sends system + tools + growing history
const sysT = tok(AI.analystSystem(ctx, lines, "replace")) + tok(defs(T.defs.map((d) => d.name))) + 30;
const aIn = sysT + (sysT + tok(runOut) + 60) + (sysT + tok(runOut) + tok(cdOut) + 120), aOut = 60 + 60 + 250;
const price = { "Haiku 5.5": [0.10, 0.50], "Sonnet 5.5": [2, 10] };
const cost = (i, o, [pi, po]) => (i * pi + o * po) / 1e6;
const out = { tokens: { parser_in: pIn, parser_out: pOut, analyst_in: aIn, analyst_out: aOut, run_scenario_result: tok(runOut) }, per_call: {}, monthly: {} };
for (const [m, p] of Object.entries(price)) out.per_call[m] = { parse: +cost(pIn, pOut, p).toFixed(5), question: +cost(aIn, aOut, p).toFixed(5) };
const usage = [["light: 300 parses + 100 questions", 300, 100], ["busy: 3,000 parses + 1,000 questions", 3000, 1000]];
for (const [label, np, nq] of usage) out.monthly[label] = Object.fromEntries(Object.entries(price).map(([m, p]) => [m, +(np * cost(pIn, pOut, p) + nq * cost(aIn, aOut, p)).toFixed(2)]));
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync("tests/cost_estimate.json", JSON.stringify(out, null, 1));

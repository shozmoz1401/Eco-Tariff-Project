// Tariff Exposure Simulator — AI layer (stage 2).
// The AI never produces a number itself: it calls engine tools, and every figure in its text must
// appear in what the engine returned (checkNumbers). Text that fails is not displayed.
// Providers are swappable behind one interface: provider.run({system, user, history, tools, tier}).
(function (root) {
  "use strict";
  var E = root.TES_ENGINE || (typeof require !== "undefined" ? require("./engine.js") : null);

  // ------------------------------------------------------------------ formatting (mirrors app.js)
  function money(x) {
    if (x === null || x === undefined || isNaN(x)) return "n/a";
    var a = Math.abs(x), s = x < 0 ? "-" : "";
    if (a >= 1e12) return s + "$" + (a / 1e12).toFixed(2) + "tn";
    if (a >= 1e10) return s + "$" + (a / 1e9).toFixed(1) + "bn";
    if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "bn";
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(0) + "m";
    if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(0) + "k";
    return s + "$" + a.toFixed(0);
  }
  function pct(x, d) { if (x === null || x === undefined || isNaN(x)) return "n/a"; return (x * 100).toFixed(d === undefined ? 1 : d) + "%"; }
  function pts(x) { return (x >= 0 ? "+" : "-") + Math.abs(x * 100).toFixed(1) + " pts"; }

  // ------------------------------------------------------------------ number check
  var NUM_RE = /(US\$|\$)?\s?([-−–]\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s*(trillion|billion|million|thousand|tn|bn|mn|m|k|b)(?![a-z]))?\s*(%|percent|per cent|percentage points|pts|points|pp|x(?![a-z])|×|times)?/gi;
  var SCALE = { tn: 1e12, trillion: 1e12, bn: 1e9, b: 1e9, billion: 1e9, mn: 1e6, m: 1e6, million: 1e6, k: 1e3, thousand: 1e3 };

  function extractNumbers(text) {
    var out = [], m;
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(String(text)))) {
      var intPart = m[3].replace(/,/g, ""), dec = m[4] || "";
      var v = parseFloat(intPart + (dec ? "." + dec : ""));
      var unit = (m[5] || "").toLowerCase(), pc = (m[6] || "").toLowerCase();
      // "m" or "b" glued to a word (e.g. "5 more") is not a unit: \b above handles most; also require $ for bare m/b
      if ((unit === "m" || unit === "b") && !m[1]) unit = "";
      var scale = unit ? SCALE[unit] : 1;
      var mult = pc === "x" || pc === "×" || pc === "times";
      out.push({ raw: m[0].trim(), value: v * scale, num: v, decimals: dec.length, scale: scale,
                 kind: mult ? "plain" : pc ? "pct" : (m[1] || unit ? "money" : "plain") });
    }
    return out;
  }

  // allowedText: everything the engine returned (tool results), plus the user's words and our own prompt.
  function checkNumbers(text, allowedText, opts) {
    opts = opts || {};
    var smallInt = opts.smallInt === undefined ? 10 : opts.smallInt;
    var allowed = extractNumbers(allowedText).map(function (a) { return a.value; });
    var bad = [];
    extractNumbers(text).forEach(function (n) {
      var tol = 0.5 * Math.pow(10, -n.decimals);
      var ok = false;
      if (n.kind === "plain" && n.decimals === 0 && n.num <= smallInt) ok = true; // counts like "top 3"
      for (var i = 0; i < allowed.length && !ok; i++) {
        var a = Math.abs(allowed[i]);
        if (n.kind === "money") ok = Math.abs(a - n.value) <= tol * n.scale;
        else if (n.kind === "pct") ok = Math.abs(a - n.num) <= tol || Math.abs(a * 100 - n.num) <= tol;
        else ok = Math.abs(a - n.num) <= tol;
      }
      if (!ok) bad.push(n.raw);
    });
    return { ok: bad.length === 0, bad: bad };
  }

  // ------------------------------------------------------------------ engine tools
  // ctx: {data(year), gdp(year), current, years, defaultYear, name(iso), chName(c), elasticity()}
  function makeTools(ctx) {
    function D(y) { return ctx.data(y || ctx.defaultYear); }
    function validLines(lines, y) {
      var d = D(y), errs = [];
      if (!Array.isArray(lines)) return { errs: ["lines must be a list"] };
      var clean = lines.map(function (L, i) {
        var isAll = function (x) { return !x || x === "ALL" || (Array.isArray(x) && (x.length === 0 || (x.length === 1 && String(x[0]).toUpperCase() === "ALL"))); };
        var o = { targets: isAll(L.targets) ? "ALL" : [].concat(L.targets).map(String).map(function (s) { return s.toUpperCase(); }),
                  products: isAll(L.products) ? "ALL" : [].concat(L.products).map(function (c) { c = String(c); return c.length === 1 ? "0" + c : c; }),
                  rate: Number(L.rate) };
        if (o.targets !== "ALL") o.targets.forEach(function (t) { if (!d.imports[t]) errs.push("line " + (i + 1) + ": unknown country code " + t); });
        if (o.products !== "ALL") o.products.forEach(function (c) { if (d.chapters.indexOf(c) < 0) errs.push("line " + (i + 1) + ": unknown HS chapter " + c); });
        if (!isFinite(o.rate) || o.rate < 0) errs.push("line " + (i + 1) + ": rate must be 0% or higher");
        if (L.exclude_targets) o.exclude_targets = [].concat(L.exclude_targets).map(function (s) { return String(s).toUpperCase(); });
        if (L.exclude_products) o.exclude_products = [].concat(L.exclude_products).map(String);
        return o;
      });
      return { lines: clean, errs: errs };
    }
    function run(lines, mode, y) {
      return E.compute(D(y), ctx.gdp(y || ctx.defaultYear), ctx.current.lines, { mode: mode || "replace", lines: lines }, ctx.elasticity());
    }
    function countryRow(iso, r) {
      return { country: ctx.name(iso), code: iso, exports_hit: money(r.hit), share_of_gdp: r.share_gdp === null ? "no GDP figure" : pct(r.share_gdp, 2),
               tariff_bill: money(r.bill), us_imports: money(r.imports), duties_today: money(r.cur_bill), duties_with_scenario: money(r.sim_bill),
               change_in_duties: money(r.sim_bill - r.cur_bill), avg_rate_today: pct(r.cur_bill / r.imports), avg_rate_scenario: pct(r.sim_bill / r.imports),
               rate_change: pts((r.sim_bill - r.cur_bill) / r.imports), trade_lost: money(r.lost) };
    }
    function summary(res, y) {
      var bc = res.byCountry, t = res.totals;
      var hit = Object.keys(bc).filter(function (k) { return bc[k].hit > 0; }).sort(function (a, b) { return bc[b].hit - bc[a].hit; });
      var cuts = Object.keys(bc).filter(function (k) { return bc[k].imports > 0 && (bc[k].cur_bill - bc[k].sim_bill) / bc[k].imports > 0.0005; })
        .sort(function (a, b) { return (bc[b].cur_bill - bc[b].sim_bill) - (bc[a].cur_bill - bc[a].sim_bill); });
      var chs = Object.keys(res.byChapter).filter(function (c) { return res.byChapter[c].hit > 0; }).sort(function (a, b) { return res.byChapter[b].hit - res.byChapter[a].hit; });
      var g = res.gains, gk = Object.keys(g).sort(function (a, b) { return g[b].total - g[a].total; });
      return {
        year: y || ctx.defaultYear, mode: res.mode,
        totals: { exports_hit: money(t.hit), share_of_us_imports_hit: pct(t.hit / t.imports), tariff_bill: money(t.bill),
                  duties_today: money(t.cur_bill), duties_with_scenario: money(t.sim_bill), change_in_duties: money(t.sim_bill - t.cur_bill),
                  trade_lost: money(t.lost), sensitivity_used: ctx.elasticity(), countries_hit: hit.length },
        most_exposed: hit.slice(0, 10).map(function (k) { return countryRow(k, bc[k]); }),
        sectors_hit: chs.slice(0, 8).map(function (c) { return { chapter: c, name: ctx.chName(c), exports_hit: money(res.byChapter[c].hit), tariff_bill: money(res.byChapter[c].bill) }; }),
        who_gains: gk.slice(0, 15).map(function (k) {
          var parts = Object.keys(g[k].chapters).sort(function (a, b) { return g[k].chapters[b] - g[k].chapters[a]; }).slice(0, 3);
          return { country: ctx.name(k), code: k, diversion_potential: money(g[k].total), share_of_its_us_exports: pct(g[k].share_of_us_exports),
                   top_products: parts.map(function (c) { return { chapter: c, name: ctx.chName(c), amount: money(g[k].chapters[c]) }; }) };
        }),
        tariff_cuts: cuts.slice(0, 5).map(function (k) { return { country: ctx.name(k), code: k, avg_rate_today: pct(bc[k].cur_bill / bc[k].imports), avg_rate_scenario: pct(bc[k].sim_bill / bc[k].imports) }; })
      };
    }
    function findCodes(q) {
      var d = D(), ql = String(q || "").toLowerCase(), out = [];
      Object.keys(d.imports).forEach(function (iso) { var n = ctx.name(iso); if (n.toLowerCase().indexOf(ql) >= 0 || iso.toLowerCase() === ql) out.push({ code: iso, country: n }); });
      d.chapters.forEach(function (c) { var n = ctx.chName(c); if (n.toLowerCase().indexOf(ql) >= 0) out.push({ chapter: c, name: n }); });
      return out.slice(0, 15);
    }
    var LINE_SCHEMA = {
      type: "object",
      properties: {
        targets: { type: "array", items: { type: "string" }, description: 'ISO3 country codes, e.g. ["CHN","VNM"]; ["ALL"] for every country' },
        products: { type: "array", items: { type: "string" }, description: '2-digit HS chapters, e.g. ["87"]; ["ALL"] for all products' },
        rate: { type: "number", minimum: 0, description: "additional tariff in percent" },
        exclude_targets: { type: "array", items: { type: "string" } },
        exclude_products: { type: "array", items: { type: "string" } }
      },
      required: ["targets", "products", "rate"]
    };
    var SCEN = { properties: { lines: { type: "array", items: LINE_SCHEMA, description: "scenario lines" }, mode: { type: "string", enum: ["replace", "add"] } } };
    var defs = [
      { name: "run_scenario", description: "Run a US tariff scenario through the engine. Returns totals, most exposed countries, sectors hit, who gains, and any countries for which it is a tariff cut. Mode 'replace' (default) or 'add'.",
        inputSchema: { type: "object", properties: { lines: SCEN.properties.lines, mode: SCEN.properties.mode, year: { type: "integer", enum: ctx.years } }, required: ["lines"] },
        run: function (inp) { var v = validLines(inp.lines, inp.year); if (v.errs.length) return { error: v.errs.join("; ") }; return summary(run(v.lines, inp.mode, inp.year), inp.year); } },
      { name: "country_detail", description: "One country under a scenario (or today's tariffs if lines is empty): imports, duties today and with the scenario, its who-gains diversion potential and rank, top product chapters, GDP, and which of today's tariff measures apply. Use it for any country not in run_scenario's lists.",
        inputSchema: { type: "object", properties: { code: { type: "string", description: "ISO3 code" }, lines: SCEN.properties.lines, mode: SCEN.properties.mode, year: { type: "integer", enum: ctx.years } }, required: ["code"] },
        run: function (inp) {
          var iso = String(inp.code || "").toUpperCase(), v = validLines(inp.lines || [], inp.year);
          if (!D(inp.year).imports[iso]) return { error: "unknown country code " + iso };
          if (v.errs.length) return { error: v.errs.join("; ") };
          var res = run(v.lines, inp.mode, inp.year), r = res.byCountry[iso];
          var chs = Object.keys(r.chapters).sort(function (a, b) { return r.chapters[b].imports - r.chapters[a].imports; }).slice(0, 10);
          var measures = ctx.current.lines.filter(function (L) { return D(inp.year).chapters.some(function (c) { return E.covers(L, iso, c); }); })
            .map(function (L) { return { measure: L.label, rate: L.rate + "%", legal_basis: L.basis }; });
          var row = countryRow(iso, r); row.gdp = r.gdp ? money(r.gdp) + " (" + r.gdp_year + ")" : "no GDP figure";
          var gk = Object.keys(res.gains).sort(function (a, b) { return res.gains[b].total - res.gains[a].total; }), gi = gk.indexOf(iso);
          row.who_gains = gi < 0 ? "not an untaxed supplier of any hit product in this scenario" : {
            diversion_potential: money(res.gains[iso].total), share_of_its_us_exports: pct(res.gains[iso].share_of_us_exports), rank: gi + 1, of_suppliers: gk.length,
            top_products: Object.keys(res.gains[iso].chapters).sort(function (a, b) { return res.gains[iso].chapters[b] - res.gains[iso].chapters[a]; }).slice(0, 3)
              .map(function (c) { return { chapter: c, name: ctx.chName(c), amount: money(res.gains[iso].chapters[c]) }; }) };
          row.top_chapters = chs.map(function (c) { var x = r.chapters[c]; return { chapter: c, name: ctx.chName(c), us_imports: money(x.imports), duties_today: money(x.cur_bill), duties_with_scenario: money(x.sim_bill), avg_rate_today: pct(x.cur_bill / x.imports) }; });
          row.tariffs_in_force = measures; row.year = inp.year || ctx.defaultYear;
          return row;
        } },
      { name: "compare_scenarios", description: "Run two scenarios and return the differences (B minus A) overall and for the listed countries. Use this instead of doing arithmetic yourself.",
        inputSchema: { type: "object", properties: { a_lines: SCEN.properties.lines, a_mode: SCEN.properties.mode, b_lines: SCEN.properties.lines, b_mode: SCEN.properties.mode,
                       codes: { type: "array", items: { type: "string" } }, year: { type: "integer", enum: ctx.years } }, required: ["a_lines", "b_lines"] },
        run: function (inp) {
          var aL = inp.a_lines || (inp.a && inp.a.lines) || [], bL = inp.b_lines || (inp.b && inp.b.lines) || [];
          var aM = inp.a_mode || (inp.a && inp.a.mode), bM = inp.b_mode || (inp.b && inp.b.mode);
          var va = validLines(aL, inp.year), vb = validLines(bL, inp.year);
          if (va.errs.length || vb.errs.length) return { error: va.errs.concat(vb.errs).join("; ") };
          var ra = run(va.lines, aM, inp.year), rb = run(vb.lines, bM, inp.year);
          var codes = (inp.codes || []).map(function (s) { return String(s).toUpperCase(); }).filter(function (k) { return ra.byCountry[k]; });
          function d(x, y) { return money(y - x); }
          return { year: inp.year || ctx.defaultYear,
            overall: { exports_hit_a: money(ra.totals.hit), exports_hit_b: money(rb.totals.hit), exports_hit_difference: d(ra.totals.hit, rb.totals.hit),
                       duties_a: money(ra.totals.sim_bill), duties_b: money(rb.totals.sim_bill), duties_difference: d(ra.totals.sim_bill, rb.totals.sim_bill) },
            countries: codes.map(function (k) {
              var A = ra.byCountry[k], B = rb.byCountry[k], ga = ra.gains[k] ? ra.gains[k].total : 0, gb = rb.gains[k] ? rb.gains[k].total : 0;
              return { country: ctx.name(k), code: k, exports_hit_a: money(A.hit), exports_hit_b: money(B.hit), exports_hit_difference: d(A.hit, B.hit),
                       duties_a: money(A.sim_bill), duties_b: money(B.sim_bill), duties_difference: d(A.sim_bill, B.sim_bill),
                       diversion_potential_a: money(ga), diversion_potential_b: money(gb), diversion_difference: d(ga, gb) };
            }) };
        } },
      { name: "find_codes", description: "Look up ISO3 country codes and HS chapter codes by name, e.g. 'viet' or 'vehicle'.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        run: function (inp) { return { matches: findCodes(inp.query) }; } },
      { name: "current_rate", description: "Today's modelled average additional US tariff on the given countries and chapters (from the hand-built tariff table).",
        inputSchema: { type: "object", properties: { targets: LINE_SCHEMA.properties.targets, products: LINE_SCHEMA.properties.products, year: { type: "integer", enum: ctx.years } }, required: ["targets", "products"] },
        run: function (inp) {
          var v = validLines([{ targets: inp.targets, products: inp.products, rate: 0 }], inp.year);
          if (v.errs.length) return { error: v.errs.join("; ") };
          var L = v.lines[0], d = D(inp.year), res = run([], "replace", inp.year), imp = 0, bill = 0;
          Object.keys(res.byCountry).forEach(function (k) { d.chapters.forEach(function (c, i) {
            if (!E.covers(L, k, c)) return; var x = res.byCountry[k].chapters[c]; var vv = d.imports[k][i] || 0; imp += vv; if (x) bill += x.cur_bill; }); });
          return { imports: money(imp), duties_today: money(bill), avg_rate_today: imp > 0 ? pct(bill / imp) : "n/a", avg_rate_today_number: imp > 0 ? +(bill / imp * 100).toFixed(1) : null };
        } }
    ];
    return { defs: defs, validLines: validLines, summary: summary, run: run };
  }

  // ------------------------------------------------------------------ prompts
  function chapterList(ctx) { return ctx.data(ctx.defaultYear).chapters.map(function (c) { return c + " " + ctx.chName(c); }).join("; "); }

  function parserSystem(ctx) {
    return [
      "You convert a plain-English US tariff scenario into structured lines for a trade-exposure engine.",
      "Only the United States can be the imposer in this version. If part of the text has another country imposing tariffs (e.g. retaliation), list it under unsupported and do not turn it into a line.",
      "Each line: targets (\"ALL\" or a list of ISO3 codes), products (\"ALL\" or a list of 2-digit HS chapters), rate (percent, 0 or higher), optional exclude_targets / exclude_products.",
      "Use find_codes to look up codes you are unsure of. EU means all 27 member states. Narrow products map to their chapter (smartphones -> 85, almonds -> 08, EVs -> 87); say so in notes.",
      "Rates must come from the user's text. For relative changes (\"double\", \"halve\", \"raise by 10 points\") call current_rate and set derived_from to that tool's avg_rate_today_number and factor/add accordingly.",
      "Never invent a rate. If no rate can be determined, leave the line out and explain in unsupported.",
      "Reply with JSON only, no prose: {\"lines\":[{\"targets\":...,\"products\":...,\"rate\":...,\"exclude_targets\":[],\"exclude_products\":[],\"derived_from\":null}],\"notes\":[],\"unsupported\":[]}",
      "HS chapters: " + chapterList(ctx)
    ].join("\n");
  }

  function analystSystem(ctx, scenarioLines, mode) {
    return [
      "You are the analyst panel of a Tariff Exposure Simulator built from UN Comtrade trade data and World Bank GDP. The US is the only imposer in this version.",
      "RULES:",
      "1. Every number you write must come from a tool result in this conversation. Copy figures as the tool formatted them. Never do arithmetic yourself: if you need a difference or comparison, call compare_scenarios. Answers containing other numbers are blocked automatically.",
      "2. The engine measures exposure (the trade a tariff applies to), not damage, and does not forecast prices, GDP or stock markets. Never predict those.",
      "3. 'Who gains' is a frictionless benchmark: untaxed suppliers' current market share times the value hit. Real switching is slower; non-tariff barriers such as quality standards, certification and trade finance limit it (the ECO 359 survey behind this project found India's 2018-20 gains fell short of such benchmarks for that reason).",
      "4. Today's tariffs come from a dated hand-built table and stack in layers (Section 232 product tariffs; country-wide Section 301 duties). In replace mode, a country-wide line replaces the country-wide layers and keeps Section 232; a line naming products replaces everything on them.",
      "5. Share of GDP overstates the hit, because exports are gross sales and GDP is value added.",
      "6. Plain English, at most 150 words, no tables, no markdown headings. Name the tool results you relied on in passing (e.g. 'the engine shows').",
      "The user's current scenario (" + (mode || "replace") + " mode): " + JSON.stringify(scenarioLines || []) + ". Use it when they say 'this scenario'.",
      "Data years available: " + ctx.years.join(", ") + " (default " + ctx.defaultYear + ").",
      "HS chapters: " + chapterList(ctx)
    ].join("\n");
  }

  // ------------------------------------------------------------------ providers
  // Each provider: {name, label, run({system, user, history, tools, tier}) -> {text, toolLog}}
  // tools: [{name, description, inputSchema, run(input)}]; history: [{role, content}] of earlier plain-text turns.
  function wrapTools(tools, log) {
    return tools.map(function (t) {
      return { name: t.name, description: t.description, inputSchema: t.inputSchema,
        execute: function (input) { var out; try { out = t.run(input || {}); } catch (e) { out = { error: String(e.message || e) }; } log.push({ name: t.name, input: input, output: out }); return out; } };
    });
  }

  function artifactProvider(sample) {
    return {
      name: "artifact", label: "Claude, via this page (no API key)",
      run: function (o) {
        var log = [];
        // sample() is memoryless and has no system slot: instructions ride on the first user turn.
        var msgs = (o.history || []).map(function (h) { return { role: h.role, content: h.content }; });
        msgs.push({ role: "user", content: o.user });
        msgs[0] = { role: msgs[0].role, content: o.system + "\n\n---\n\n" + msgs[0].content };
        return sample(msgs, { tools: wrapTools(o.tools || [], log), modelTier: o.tier || "default", cache: false })
          .then(function (r) { return { text: r.text || "", toolLog: log, truncated: !!r.truncated }; });
      }
    };
  }

  // HTTP provider: talks to the Cloudflare Worker in /worker (normalized protocol), runs tools locally.
  function httpProvider(endpoint, fetchImpl) {
    var F = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
    return {
      name: "http", label: "Claude API via the project's proxy",
      run: function (o) {
        var log = [], tools = o.tools || [];
        var messages = (o.history || []).map(function (h) { return { role: h.role, content: h.content }; });
        messages.push({ role: "user", content: o.user });
        var defs = tools.map(function (t) { return { name: t.name, description: t.description, input_schema: t.inputSchema }; });
        function step(round) {
          if (round > 6) return Promise.resolve({ text: "", toolLog: log, error: "too_many_tool_rounds" });
          return F(endpoint, { method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ tier: o.tier || "default", system: o.system, messages: messages, tools: defs }) })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || ("HTTP " + r.status)); e.code = r.status === 429 ? "rate_limited" : "upstream"; throw e; } return j; }); })
            .then(function (j) {
              if (!j.tool_calls || !j.tool_calls.length) return { text: j.text || "", toolLog: log, usage: j.usage };
              messages.push({ role: "assistant", content: j.text || "", tool_calls: j.tool_calls });
              var results = j.tool_calls.map(function (c) {
                var t = tools.filter(function (x) { return x.name === c.name; })[0], out;
                try { out = t ? t.run(c.input || {}) : { error: "unknown tool " + c.name }; } catch (e) { out = { error: String(e.message || e) }; }
                log.push({ name: c.name, input: c.input, output: out });
                return { id: c.id, output: JSON.stringify(out) };
              });
              messages.push({ role: "tool", results: results });
              return step(round + 1);
            });
        }
        return step(1);
      }
    };
  }

  // ------------------------------------------------------------------ high-level tasks
  function toolContext(log) { return log.map(function (l) { return JSON.stringify(l.output); }).join("\n"); }

  function parseJSON(text) {
    var s = String(text || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("no JSON in reply");
    return JSON.parse(s.slice(a, b + 1));
  }

  // AI parser. Returns {lines, notes, unsupported, warnings}. Throws if unusable (caller falls back).
  function aiParse(provider, ctx, text) {
    var T = makeTools(ctx), tools = T.defs.filter(function (d) { return d.name === "find_codes" || d.name === "current_rate"; });
    return provider.run({ system: parserSystem(ctx), user: text, tools: tools, tier: "quick" }).then(function (r) {
      var j = parseJSON(r.text), warnings = [], userNums = extractNumbers(text).map(function (n) { return n.num; });
      var toolNums = extractNumbers(toolContext(r.toolLog)).map(function (n) { return n.num; });
      var lines = (j.lines || []).filter(function (L) {
        var rate = Number(L.rate);
        if (!isFinite(rate) || rate < 0) { warnings.push("Dropped a line with an invalid rate."); return false; }
        var fromUser = userNums.some(function (n) { return Math.abs(n - rate) < 1e-9; }) || rate === 0;
        var derived = L.derived_from !== null && L.derived_from !== undefined && toolNums.some(function (n) { return Math.abs(n - Number(L.derived_from)) < 0.051; });
        if (!fromUser && !derived) { warnings.push("Dropped a line whose rate (" + rate + "%) was not in your text or derived from today's rate."); return false; }
        if (derived && !fromUser) warnings.push("Rate " + rate + "% was derived from today's modelled " + L.derived_from + "% average. Check it.");
        return true;
      });
      var v = T.validLines(lines);
      if (v.errs.length) throw new Error("AI output failed validation: " + v.errs.join("; "));
      return { lines: v.lines, notes: j.notes || [], unsupported: j.unsupported || [], warnings: warnings, toolLog: r.toolLog };
    });
  }

  // Analyst. Returns {text, ok, bad, toolLog, retried}. Text failing the number check is withheld.
  function analyst(provider, ctx, question, history, scenarioLines, mode) {
    var T = makeTools(ctx), system = analystSystem(ctx, scenarioLines, mode);
    var allowedExtra = system + "\n" + question + "\n" + (history || []).map(function (h) { return h.role === "user" ? h.content : ""; }).join("\n");
    return provider.run({ system: system, user: question, history: history, tools: T.defs, tier: "default" }).then(function (r) {
      var allowed = allowedExtra + "\n" + toolContext(r.toolLog), c = checkNumbers(r.text, allowed);
      if (c.ok) return { text: r.text, ok: true, bad: [], toolLog: r.toolLog, retried: false };
      var fix = question + "\n\n[Your previous draft was blocked because it contained numbers the engine did not return: " + c.bad.join(", ") +
        ". Call the tools again as needed and answer using only numbers they return, copied exactly.]";
      return provider.run({ system: system, user: fix, history: history, tools: T.defs, tier: "default" }).then(function (r2) {
        var log = r.toolLog.concat(r2.toolLog), c2 = checkNumbers(r2.text, allowedExtra + "\n" + toolContext(log));
        return { text: c2.ok ? r2.text : "", ok: c2.ok, bad: c2.bad, toolLog: log, retried: true };
      });
    });
  }

  // ------------------------------------------------------------------ per-browser rate limit
  function rateGate(limit, windowMs, store) {
    var key = "tes_ai_calls", mem = [];
    function read() { try { return JSON.parse(store.getItem(key) || "[]"); } catch (e) { return mem; } }
    function write(a) { try { store.setItem(key, JSON.stringify(a)); } catch (e) { mem = a; } }
    return {
      take: function (now) {
        now = now || Date.now();
        var a = read().filter(function (t) { return now - t < windowMs; });
        if (a.length >= limit) { write(a); return { ok: false, retryInMin: Math.ceil((windowMs - (now - a[0])) / 60000) }; }
        a.push(now); write(a); return { ok: true, left: limit - a.length };
      }
    };
  }

  // ------------------------------------------------------------------ detection
  // Order: artifact "sample" capability (claude.ai page) -> HTTP proxy (TES_AI_ENDPOINT) -> off.
  function detect(cfg) {
    cfg = cfg || {};
    var w = root;
    var p = Promise.resolve(null);
    if (w.claude && typeof w.claude.use === "function") {
      p = Promise.race([w.claude.use("sample"), new Promise(function (res) { setTimeout(function () { res(null); }, cfg.timeoutMs || 11000); })])
        .catch(function () { return null; });
    }
    return p.then(function (sample) {
      if (sample) return artifactProvider(sample);
      if (cfg.endpoint) return httpProvider(cfg.endpoint);
      return null;
    });
  }

  // nesting depth of a JSON schema, counted the way the platform does: each nested schema adds one level
  function schemaDepth(x) {
    if (!x || typeof x !== "object") return 0;
    var kids = [];
    if (x.properties) Object.keys(x.properties).forEach(function (k) { kids.push(x.properties[k]); });
    if (x.items) kids.push(x.items);
    ["anyOf", "oneOf", "allOf"].forEach(function (k) { if (x[k]) kids = kids.concat(x[k]); });
    return 1 + kids.reduce(function (m, k) { return Math.max(m, schemaDepth(k)); }, 0);
  }
  var api = { schemaDepth: schemaDepth, extractNumbers: extractNumbers, checkNumbers: checkNumbers, makeTools: makeTools, artifactProvider: artifactProvider,
              httpProvider: httpProvider, aiParse: aiParse, analyst: analyst, rateGate: rateGate, detect: detect,
              parserSystem: parserSystem, analystSystem: analystSystem, parseJSON: parseJSON, money: money, pct: pct };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TES_AI = api;
})(typeof window !== "undefined" ? window : this);

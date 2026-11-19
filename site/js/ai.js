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
  // A figure in AI text is shown only if it matches a figure the engine returned for this question
  // (or the user's own words): same kind (money / percent / plain), same magnitude at the stated
  // precision, a compatible sign or direction, and, where the engine tied it to a country, that
  // country (not another one) in the same clause. Number words and multiples are blocked.
  var NUM_RE = /(?<![\w.])([-−–+]\s?)?(US\$|\$)?\s?([-−–+]\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s*(trillion|billion|million|thousand|tn|bn|mn|m|k|b)(?![a-z]))?\s*(%|percent|per cent|percentage points|pts|points|pp|x(?![a-z])|×|times|-?fold)?/gi;
  var SCALE = { tn: 1e12, trillion: 1e12, bn: 1e9, b: 1e9, billion: 1e9, mn: 1e6, m: 1e6, million: 1e6, k: 1e3, thousand: 1e3 };
  var WORDNUM = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred";
  var WORD_FIGURE = new RegExp("\\b(?:" + WORDNUM + ")(?:[\\s-]+(?:" + WORDNUM + "))*\\s+(?:percent|per cent|percentage points|points|billion|million|trillion|thousand|times|fold)\\b", "gi");
  var MULT_WORD = /\b(twice|thrice|doubl(?:e|es|ed|ing)|tripl(?:e|es|ed|ing)|quadrupl(?:e|es|ed|ing)|halv(?:e|es|ed|ing)|half|(?:a|one)[\s-](?:third|quarter|fifth)|two[\s-]thirds|three[\s-]quarters|\w+fold)\b/gi;
  var UP_W = "rise|rises|rising|rose|risen|increase|increases|increased|increasing|up|gain|gains|gained|gaining|grow|grows|grew|growing|jump|jumps|jumped|climb|climbs|climbed|higher|add|adds|added|plus|boost|boosts|hike|hikes";
  var DOWN_W = "fall|falls|fell|fallen|falling|drop|drops|dropped|decline|declines|declined|decrease|decreases|decreased|cut|cuts|lower|down|lose|loses|lost|losing|shrink|shrinks|shrank|reduce|reduces|reduced|minus|negative|saves|saving|savings";
  var DIR_BEFORE = new RegExp("\\b(" + UP_W + "|" + DOWN_W + ")\\s+(?:by\\s+|of\\s+)?(?:about|around|roughly|nearly|almost|some|just|over|under|only)?\\s*$", "i");
  var DIR_AFTER = new RegExp("^\\s*(?:\\w+\\s+)?(increase|rise|jump|gain|hike|boost|surge|cut|drop|fall|decline|reduction|decrease|loss|saving)\\b", "i");
  var DOWN_SET = new RegExp("^(" + DOWN_W + "|reduction|loss|saving)$", "i");
  var RATIO_WORD = /\b(?:one|a|an|\d+)\s+(?:in|out of)\s+(?:every\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|hundred|\d+)\b/gi;
  var VAGUE_SIZE = /\b(?:tens|hundreds|dozens|thousands|millions|billions|trillions)\s+of\b|\b(?:several|a few|many)\s+(?:billion|million|trillion|percent|points)\b/gi;
  var FORECAST = /\b(stock markets?|stocks?|share prices?|equit(?:y|ies)(?: markets?)?|gdp growth|economic growth|growth rates?|inflation|consumer prices?|prices (?:will|would|could|may|might) (?:rise|fall|go up|go down|increase|decrease|climb|drop)|price (?:rises?|increases?|hikes?)|jobs?|employment|unemployment|wages?)\b/i;
  var NEGATION = /\b(not|no|never|cannot|can't|doesn't|does not|isn't|is not|won't|don't|without)\b|n't\b/i;
  var PRONOUN = /\b(it|its|they|their|them|this country|that country|the country)\b/i;
  var COUNT_BEFORE = /\b(top|rank|ranks|ranked|number|no\.|#|first|all)\s*$/i;
  var COUNT_AFTER = /^\s*(countries|country|economies|economy|sectors|sector|chapters|chapter|products|product|lines|line|suppliers|supplier|partners|calls|tools|layers|largest|biggest|most|of the|of them|th\b|st\b|nd\b|rd\b)/i;

  function extractNumbers(text) {
    var out = [], m, s = String(text).normalize("NFKC");
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(s))) {
      var intPart = m[4].replace(/,/g, ""), dec = m[5] || "";
      var v = parseFloat(intPart + (dec ? "." + dec : ""));
      var unit = (m[6] || "").toLowerCase(), pc = (m[7] || "").toLowerCase();
      if ((unit === "m" || unit === "b") && !m[2]) unit = "";
      var scale = unit ? SCALE[unit] : 1;
      var sg = (m[1] || m[3] || "").trim(), sign = sg === "+" ? 1 : sg ? -1 : 0;
      var mult = /^(x|×|times|-?fold)$/.test(pc);
      out.push({ raw: m[0].trim(), value: v * scale, num: v, decimals: dec.length, scale: scale, sign: sign,
                 kind: mult ? "mult" : pc ? "pct" : (m[2] || unit ? "money" : "plain"), index: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  // Allowed figures: every number inside tool outputs (with where it came from) plus the user's own words.
  function buildAllowed(toolLog, userText) {
    var entries = [];
    function leaf(str, path, label, key) {
      var inv = /lost|loss/i.test(key || "") ? -1 : 1;   // a positive "trade_lost" is a fall
      extractNumbers(str).forEach(function (n) {
        var signed = (n.sign < 0 ? -1 : 1) * n.value * inv;
        entries.push({ kind: n.kind, value: n.value, num: n.num, signed: signed, label: label || null, path: path });
      });
    }
    function walk(x, path, label, key) {
      if (x === null || x === undefined) return;
      if (typeof x === "string") return leaf(x, path, label, key);
      if (typeof x === "number") return entries.push({ kind: "plain", value: Math.abs(x), num: Math.abs(x), signed: x, label: label || null, path: path });
      if (Array.isArray(x)) return x.forEach(function (y, i) { walk(y, path, label, key); });
      if (typeof x === "object") {
        var lab = x.country || label;
        Object.keys(x).forEach(function (k) { walk(x[k], path + " › " + (x.country && k !== "country" ? x.country + " › " : "") + k, lab, k); });
      }
    }
    (toolLog || []).forEach(function (l) { walk(l.output, l.name, null, ""); });
    if (userText) leaf(userText, "your words", null, "");
    return entries;
  }

  function clauseAround(text, i) {
    var parts = /[.!?](?=\s|$)|[;:\n]|,\s|\s(?:and|but|while|whereas|against|versus|vs\.?|compared with|than)\s/gi, start = 0, end = text.length, m;
    parts.lastIndex = 0;
    while ((m = parts.exec(text))) { if (m.index < i) start = m.index + m[0].length; else { end = m.index; break; } }
    return { text: text.slice(start, end), start: start };
  }
  function esc(c) { return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  // the last country named before position `pos` (for "It gains $2bn" after "Thailand is the big winner.")
  function lastCountryBefore(text, pos, countries) {
    var best = null, bestAt = -1;
    countries.forEach(function (c) { var re = new RegExp("\\b" + esc(c) + "\\b", "g"), m; while ((m = re.exec(text)) && m.index < pos) if (m.index > bestAt) { bestAt = m.index; best = c; } });
    return best;
  }

  // entries: from buildAllowed() (or a plain string, treated as one allowed text). opts: {userText, countryNames, smallInt}
  function checkNumbers(text, entries, opts) {
    opts = opts || {};
    if (typeof entries === "string") entries = buildAllowed([], entries);
    text = String(text || "").normalize("NFKC");
    var user = String(opts.userText || "").normalize("NFKC"), smallInt = opts.smallInt === undefined ? 10 : opts.smallInt;
    var countries = (opts.countryNames || []).filter(function (c) { return c && c.length > 2; });
    var bad = [], used = [], m;
    WORD_FIGURE.lastIndex = 0;
    while ((m = WORD_FIGURE.exec(text))) bad.push({ raw: m[0], reason: "figure written in words" });
    RATIO_WORD.lastIndex = 0;
    while ((m = RATIO_WORD.exec(text))) if (user.toLowerCase().indexOf(m[0].toLowerCase()) < 0) bad.push({ raw: m[0], reason: "ratio the engine did not return" });
    VAGUE_SIZE.lastIndex = 0;
    while ((m = VAGUE_SIZE.exec(text))) bad.push({ raw: m[0], reason: "vague size the engine did not return" });
    // a figure next to a forecast the engine does not make (stock markets, GDP growth, prices, jobs...)
    text.split(/(?<=[.!?])\s+/).forEach(function (sent) {
      var f = sent.match(FORECAST);
      if (f && !NEGATION.test(sent) && extractNumbers(sent).length) bad.push({ raw: sent.trim().slice(0, 60), reason: "pairs a figure with a forecast the engine does not make (" + f[0] + ")" });
    });
    MULT_WORD.lastIndex = 0;
    while ((m = MULT_WORD.exec(text))) {
      var stem = m[0].toLowerCase().slice(0, 4);
      if (user.toLowerCase().indexOf(stem) < 0) bad.push({ raw: m[0], reason: "multiple or fraction the engine did not return" });
    }
    extractNumbers(text).forEach(function (n) {
      var before = text.slice(Math.max(0, n.index - 40), n.index), after = text.slice(n.end, n.end + 30);
      if (n.kind === "mult") {
        if (!extractNumbers(user).some(function (u) { return u.kind === "mult" && u.num === n.num; })) bad.push({ raw: n.raw, reason: "multiple the engine did not return" });
        return;
      }
      if (n.kind === "plain" && n.decimals === 0 && n.num <= smallInt && n.sign === 0 && (COUNT_BEFORE.test(before) || COUNT_AFTER.test(after))) return;
      // required direction: explicit sign, else a direction word right before ("rise by") or after ("a $2bn cut")
      var req = n.sign, d = before.match(DIR_BEFORE) || after.match(DIR_AFTER);
      if (!req && d) req = DOWN_SET.test(d[1]) ? -1 : 1;
      var tol = 0.5 * Math.pow(10, -n.decimals);
      var cands = entries.filter(function (a) {
        if (a.kind !== n.kind) return false;
        var mag = n.kind === "money" ? Math.abs(Math.abs(a.signed) - n.value) <= tol * n.scale : Math.abs(Math.abs(a.signed) - n.num) <= tol;
        if (!mag) return false;
        if (req < 0) return a.signed < 0;
        if (req > 0) return a.signed >= 0;
        return true;
      });
      if (!cands.length) {
        var wrongSign = entries.some(function (a) { return a.kind === n.kind && (n.kind === "money" ? Math.abs(Math.abs(a.signed) - n.value) <= tol * n.scale : Math.abs(Math.abs(a.signed) - n.num) <= tol); });
        bad.push({ raw: n.raw, reason: wrongSign ? "direction does not match the engine" : "not returned by the engine" });
        return;
      }
      // attribution: if every match belongs to a country, a country named in the clause must be one of them
      var cl = clauseAround(text, n.index), clause = cl.text, named = countries.filter(function (c) { return new RegExp("\\b" + esc(c) + "\\b").test(clause); });
      if (!named.length && PRONOUN.test(clause)) { var prev = lastCountryBefore(text, cl.start, countries); if (prev) named = [prev]; }
      var labelled = cands.every(function (a) { return a.label; });
      var pref = cands.filter(function (a) { return a.label && named.indexOf(a.label) >= 0; });
      if (labelled && named.length && !pref.length) { bad.push({ raw: n.raw, reason: "the engine gives this figure for " + cands[0].label + ", not " + named.join("/") }); return; }
      // provenance: the named country's figure first, then a figure tied to no country, then any match
      var pick = pref[0] || cands.filter(function (a) { return !a.label; })[0] || cands[0];
      used.push({ raw: n.raw, source: pick.path });
    });
    return { ok: bad.length === 0, bad: bad.map(function (b) { return b.raw; }), problems: bad, used: used };
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
    // lines omitted -> the user's current scenario; lines [] -> today's tariffs only
    function scen(lines, mode) {
      if (lines === undefined || lines === null) { var c = ctx.scenario ? ctx.scenario() : { lines: [], mode: "replace" }; return { lines: c.lines, mode: c.mode, used: "the user's current scenario" }; }
      return { lines: lines, mode: mode, used: lines.length ? "the lines given" : "today's tariffs only (no scenario)" };
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
      var raises = Object.keys(bc).filter(function (k) { return bc[k].imports > 0 && (bc[k].sim_bill - bc[k].cur_bill) / bc[k].imports > 0.0005; });
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
        who_gains: !raises.length && cuts.length ? "not shown: this scenario only lowers tariffs, so trade would move toward the targeted countries, not away from them" : gk.slice(0, 15).map(function (k) {
          var parts = Object.keys(g[k].chapters).sort(function (a, b) { return g[k].chapters[b] - g[k].chapters[a]; }).slice(0, 3);
          return { country: ctx.name(k), code: k, diversion_potential: money(g[k].total), share_of_its_us_exports: pct(g[k].share_of_us_exports),
                   top_products: parts.map(function (c) { return { chapter: c, name: ctx.chName(c), amount: money(g[k].chapters[c]) }; }) };
        }),
        who_gains_note: raises.length && cuts.length ? "for the countries in tariff_cuts this scenario lowers tariffs, so trade would move toward them; who_gains assumes every line is a new tariff" : undefined,
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
      { name: "run_scenario", description: "Run a US tariff scenario through the engine. Omit lines to use the user's current scenario; pass [] for today's tariffs only. Returns totals, most exposed countries, sectors hit, who gains, and any countries for which it is a tariff cut. Mode 'replace' (default) or 'add'.",
        inputSchema: { type: "object", properties: { lines: SCEN.properties.lines, mode: SCEN.properties.mode, year: { type: "integer", enum: ctx.years } } },
        run: function (inp) { var sc = scen(inp.lines, inp.mode), v = validLines(sc.lines, inp.year); if (v.errs.length) return { error: v.errs.join("; ") }; var out = summary(run(v.lines, sc.mode, inp.year), inp.year); out.scenario_used = sc.used; return out; } },
      { name: "country_detail", description: "One country under a scenario. Omit lines to use the user's current scenario; pass [] for today's tariffs only. Returns imports, duties today and with the scenario, its who-gains diversion potential and rank, top product chapters, GDP, and which of today's tariff measures apply. Use it for any country not in run_scenario's lists.",
        inputSchema: { type: "object", properties: { code: { type: "string", description: "ISO3 code" }, lines: SCEN.properties.lines, mode: SCEN.properties.mode, year: { type: "integer", enum: ctx.years } }, required: ["code"] },
        run: function (inp) {
          var iso = String(inp.code || "").toUpperCase(), sc = scen(inp.lines, inp.mode), v = validLines(sc.lines, inp.year);
          if (!D(inp.year).imports[iso]) return { error: "unknown country code " + iso };
          if (v.errs.length) return { error: v.errs.join("; ") };
          var res = run(v.lines, sc.mode, inp.year), r = res.byCountry[iso];
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
          row.tariffs_in_force = measures; row.year = inp.year || ctx.defaultYear; row.scenario_used = sc.used;
          return row;
        } },
      { name: "compare_scenarios", description: "Run two scenarios and return the differences (B minus A) overall and for the listed countries. Omit a_lines to use the user's current scenario as A. Use this instead of doing arithmetic yourself.",
        inputSchema: { type: "object", properties: { a_lines: SCEN.properties.lines, a_mode: SCEN.properties.mode, b_lines: SCEN.properties.lines, b_mode: SCEN.properties.mode,
                       codes: { type: "array", items: { type: "string" } }, year: { type: "integer", enum: ctx.years } }, required: ["b_lines"] },
        run: function (inp) {
          var sa = scen(inp.a_lines !== undefined ? inp.a_lines : (inp.a ? inp.a.lines : undefined), inp.a_mode || (inp.a && inp.a.mode));
          var aL = sa.lines, bL = inp.b_lines || (inp.b && inp.b.lines) || [];
          var aM = sa.mode, bM = inp.b_mode || (inp.b && inp.b.mode);
          var va = validLines(aL, inp.year), vb = validLines(bL, inp.year);
          if (va.errs.length || vb.errs.length) return { error: va.errs.concat(vb.errs).join("; ") };
          var ra = run(va.lines, aM, inp.year), rb = run(vb.lines, bM, inp.year);
          var codes = (inp.codes || []).map(function (s) { return String(s).toUpperCase(); }).filter(function (k) { return ra.byCountry[k]; });
          function d(x, y) { return money(y - x); }
          return { year: inp.year || ctx.defaultYear, a_is: sa.used,
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

  // ------------------------------------------------------------------ relative rates ("double", "halve", "+10 points")
  var FACTOR_WORDS = { doubl: 2, twice: 2, tripl: 3, quadrupl: 4, halv: 0.5, half: 0.5 };
  function factorsInText(t) {
    var out = [], tl = String(t || "").toLowerCase();
    Object.keys(FACTOR_WORDS).forEach(function (w) { if (tl.indexOf(w) >= 0 && out.indexOf(FACTOR_WORDS[w]) < 0) out.push(FACTOR_WORDS[w]); });
    extractNumbers(t).forEach(function (n) { if (n.kind === "mult" && out.indexOf(n.num) < 0) out.push(n.num); });
    return out;
  }
  // today's modelled average additional rate on (targets, products), then the new rate; returns {rate, today, how} or {error}
  function resolveRelative(ctx, L, y) {
    var T = makeTools(ctx), v = T.validLines([{ targets: L.targets, products: L.products, rate: 0, exclude_targets: L.exclude_targets, exclude_products: L.exclude_products }], y);
    if (v.errs.length) return { error: v.errs.join("; ") };
    var line = v.lines[0], d = ctx.data(y || ctx.defaultYear), res = T.run([], "replace", y), imp = 0, bill = 0;
    Object.keys(res.byCountry).forEach(function (k) { d.chapters.forEach(function (c, i) {
      if (!E.covers(line, k, c)) return; imp += d.imports[k][i] || 0; var x = res.byCountry[k].chapters[c]; if (x) bill += x.cur_bill; }); });
    if (imp <= 0) return { error: "no US imports in those products from those countries" };
    var today = Math.round(bill / imp * 1000) / 10, r = L.relative || {}, rate, how;
    if (r.factor !== undefined) { rate = Math.round(today * Number(r.factor) * 10) / 10; how = r.factor + " × today's modelled " + today + "%"; }
    else if (r.add_points !== undefined) { rate = Math.round((today + Number(r.add_points)) * 10) / 10; how = "today's modelled " + today + "% + " + r.add_points + " points"; }
    else return { error: "relative change has no factor or points" };
    if (!isFinite(rate) || rate < 0) return { error: "the new rate would be below 0%" };
    line.rate = rate;
    return { line: line, rate: rate, today: today, how: how };
  }

  // ------------------------------------------------------------------ prompts
  function chapterList(ctx) { return ctx.data(ctx.defaultYear).chapters.map(function (c) { return c + " " + ctx.chName(c); }).join("; "); }

  function parserSystem(ctx) {
    return [
      "You convert a plain-English US tariff scenario into structured lines for a trade-exposure engine.",
      "Only the United States can be the imposer in this version. If part of the text has another country imposing tariffs (e.g. retaliation), list it under unsupported and do not turn it into a line.",
      "Each line: targets (\"ALL\" or a list of ISO3 codes), products (\"ALL\" or a list of 2-digit HS chapters), rate (percent, 0 or higher), optional exclude_targets / exclude_products.",
      "Use find_codes to look up codes you are unsure of. EU means all 27 member states. Narrow products map to their chapter (smartphones -> 85, almonds -> 08, EVs -> 87); say so in notes.",
      "Rates must come from the user's text. For relative changes do NOT compute a rate: set rate to null and relative to {\"factor\": 2} for double, {\"factor\": 0.5} for halve, {\"factor\": 3} for triple, or {\"add_points\": N} for raising by N points. The page computes the new rate from today's modelled rate.",
      "Never invent a rate. If no rate can be determined, leave the line out and explain in unsupported. If the text is not a tariff scenario, return no lines and say so in unsupported.",
      "Reply with JSON only, no prose: {\"lines\":[{\"targets\":...,\"products\":...,\"rate\":... or null,\"relative\":null or {\"factor\":N} or {\"add_points\":N},\"exclude_targets\":[],\"exclude_products\":[]}],\"notes\":[],\"unsupported\":[]}",
      "HS chapters: " + chapterList(ctx)
    ].join("\n");
  }

  // The analyst prompt is a fixed base plus one line describing the user's scenario.
  // The Worker holds a generated copy of the base (worker/src/spec.generated.js) and rebuilds the same prompt.
  function analystBase(ctx) {
    return [
      "You are the analyst panel of a Tariff Exposure Simulator built from UN Comtrade trade data and World Bank GDP. The US is the only imposer in this version.",
      "RULES:",
      "1. Every number you write must come from a tool result in this conversation, copied as the tool formatted it, next to the country it belongs to, with its sign (a negative change is a fall). Never do arithmetic, never write multiples or fractions (double, half, 3 times) and never write figures in words. If you need a difference or comparison, call compare_scenarios. Answers that break this are blocked automatically.",
      "2. The engine measures exposure (the trade a tariff applies to), not damage, and does not forecast prices, GDP or stock markets. Never predict those.",
      "3. 'Who gains' is a frictionless benchmark: untaxed suppliers' current market share times the value hit. Real switching is slower; non-tariff barriers such as quality standards, certification and trade finance limit it (the ECO 359 survey behind this project found India's 2018-20 gains fell short of such benchmarks for that reason). It is not shown for a scenario that only cuts tariffs. Whenever you mention it, say it is a best-case benchmark. In a mixed scenario (some countries' tariffs rise, others' fall), never call a country whose own tariffs change a 'beneficiary' or 'winner'.",
      "4. Today's tariffs come from a dated hand-built table and stack in layers (Section 232 product tariffs; country-wide Section 301 duties). In replace mode, a country-wide line replaces the country-wide layers and keeps Section 232; a line naming products replaces everything on them.",
      "5. Share of GDP overstates the hit, because exports are gross sales and GDP is value added.",
      "6. Plain English, at most 150 words, no tables, no markdown headings. Mention in passing which tool results you relied on (e.g. 'the engine shows').",
      "7. Only answer questions about this simulator, its data and its scenarios. Politely decline anything else.",
      "8. The tools use the user's current scenario when you omit lines; pass [] only when you mean today's tariffs without the scenario. Each result says which it used (scenario_used); describe it accordingly.",
      "Data years available: " + ctx.years.join(", ") + " (default " + ctx.defaultYear + ").",
      "HS chapters: " + chapterList(ctx)
    ].join("\n");
  }
  function scenarioLine(scenarioLines, mode) {
    return "The user's current scenario (" + (mode === "add" ? "add" : "replace") + " mode): " + JSON.stringify(scenarioLines || []) + ". Use it when they say 'this scenario'.";
  }
  function analystSystem(ctx, scenarioLines, mode) { return analystBase(ctx) + "\n" + scenarioLine(scenarioLines, mode); }

  // Everything the Worker needs to rebuild prompts and tool definitions server-side.
  var READER_TOOLS = ["find_codes", "current_rate"];
  function workerSpec(ctx) {
    var T = makeTools(ctx), defs = function (names) { return T.defs.filter(function (d) { return !names || names.indexOf(d.name) >= 0; }).map(function (d) { return { name: d.name, description: d.description, input_schema: d.inputSchema }; }); };
    return { reader_system: parserSystem(ctx), analyst_base: analystBase(ctx), tools: { reader: defs(READER_TOOLS), analyst: defs(null) } };
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

  // HTTP provider: talks to the Cloudflare Worker in /worker. It sends only the task name, the user's
  // question, the scenario, recent plain-text history and the tool turns; the Worker holds the prompts and
  // tool definitions. Tools run here, in the page.
  function httpProvider(endpoint, fetchImpl) {
    var F = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
    return {
      name: "http", label: "Claude API via the project's proxy",
      run: function (o) {
        var log = [], tools = o.tools || [], turns = [];
        var history = (o.history || []).map(function (h) { return { role: h.role, content: h.content }; });
        function step(round) {
          if (round > 6) return Promise.resolve({ text: "", toolLog: log, error: "too_many_tool_rounds" });
          var body = { task: o.task, question: o.question || o.user, turns: turns };
          if (o.task === "analyst") { body.scenario = o.scenario || { lines: [], mode: "replace" }; body.history = history; }
          return F(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || ("HTTP " + r.status)); e.code = r.status === 429 ? "rate_limited" : "upstream"; throw e; } return j; }); })
            .then(function (j) {
              if (!j.tool_calls || !j.tool_calls.length) return { text: j.text || "", toolLog: log, usage: j.usage };
              turns.push({ role: "assistant", text: j.text || "", tool_calls: j.tool_calls });
              var results = j.tool_calls.map(function (c) {
                var t = tools.filter(function (x) { return x.name === c.name; })[0], out;
                try { out = t ? t.run(c.input || {}) : { error: "unknown tool " + c.name }; } catch (e) { out = { error: String(e.message || e) }; }
                log.push({ name: c.name, input: c.input, output: out });
                return { id: c.id, output: JSON.stringify(out) };
              });
              turns.push({ role: "tool", results: results });
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

  // AI parser. Returns {lines, notes, unsupported, warnings}; lines may be empty (caller then falls back).
  // Throws only if the reply is unusable. The model never supplies a computed rate: relative changes are resolved here.
  function aiParse(provider, ctx, text) {
    var T = makeTools(ctx), tools = T.defs.filter(function (d) { return READER_TOOLS.indexOf(d.name) >= 0; });
    return provider.run({ system: parserSystem(ctx), user: text, tools: tools, tier: "quick", task: "reader", question: text }).then(function (r) {
      var j = parseJSON(r.text), warnings = [], userNums = extractNumbers(text).map(function (n) { return n.num; }), factors = factorsInText(text);
      var lines = [];
      (j.lines || []).forEach(function (L) {
        if (L.relative && (L.rate === null || L.rate === undefined)) {
          var rel = L.relative;
          if (rel.factor !== undefined && factors.indexOf(Number(rel.factor)) < 0) { warnings.push("Dropped a relative change (× " + rel.factor + ") that your text does not state."); return; }
          if (rel.add_points !== undefined && userNums.indexOf(Number(rel.add_points)) < 0) { warnings.push("Dropped a relative change (+" + rel.add_points + " points) that your text does not state."); return; }
          var rr = resolveRelative(ctx, L);
          if (rr.error) { warnings.push("Could not work out the new rate: " + rr.error + "."); return; }
          warnings.push("New rate " + rr.rate + "% = " + rr.how + " average on those products (from the tariff table). Check it.");
          lines.push(rr.line); return;
        }
        var rate = Number(L.rate);
        if (!isFinite(rate) || rate < 0) { warnings.push("Dropped a line with an invalid rate."); return; }
        if (!(userNums.some(function (n) { return Math.abs(n - rate) < 1e-9; }) || rate === 0)) { warnings.push("Dropped a line whose rate (" + rate + "%) is not in your text."); return; }
        lines.push(L);
      });
      var v = T.validLines(lines);
      if (v.errs.length) throw new Error("AI output failed validation: " + v.errs.join("; "));
      return { lines: v.lines, notes: j.notes || [], unsupported: j.unsupported || [], warnings: warnings, toolLog: r.toolLog };
    });
  }

  // Analyst. Returns {text, ok, bad, problems, used, toolLog, retried}. Text failing the number check is withheld.
  // priorLogs: tool logs from earlier turns of this conversation (their figures stay allowed).
  function analyst(provider, ctx, question, history, scenarioLines, mode, priorLogs) {
    ctx = Object.assign({}, ctx, { scenario: function () { return { lines: scenarioLines || [], mode: mode || "replace" }; } });
    var T = makeTools(ctx), system = analystSystem(ctx, scenarioLines, mode);
    var userWords = [question].concat((history || []).filter(function (h) { return h.role === "user"; }).map(function (h) { return h.content; }))
      .concat([JSON.stringify(scenarioLines || [])]).join("\n");
    var countryNames = Object.keys(ctx.data(ctx.defaultYear).imports).map(ctx.name);
    var opts = { userText: userWords, countryNames: countryNames };
    var task = { task: "analyst", question: question, scenario: { lines: scenarioLines || [], mode: mode || "replace" } };
    function run(q) { return provider.run({ system: system, user: q, history: history, tools: T.defs, tier: "default", task: task.task, question: q, scenario: task.scenario }); }
    return run(question).then(function (r) {
      var log = (priorLogs || []).concat(r.toolLog), c = checkNumbers(r.text, buildAllowed(log, userWords), opts);
      if (c.ok) return { text: r.text, ok: true, bad: [], problems: [], used: c.used, toolLog: r.toolLog, retried: false };
      var fix = question + "\n\n[Your previous draft was blocked: " + c.problems.map(function (p) { return p.raw + " (" + p.reason + ")"; }).join("; ") +
        ". Call the tools again as needed. Use only figures they return, copied exactly, with the sign they have, next to the country they belong to, and no multiples or number words.]";
      return run(fix).then(function (r2) {
        var log2 = log.concat(r2.toolLog), c2 = checkNumbers(r2.text, buildAllowed(log2, userWords), opts);
        return { text: c2.ok ? r2.text : "", ok: c2.ok, bad: c2.bad, problems: c2.problems, used: c2.used, toolLog: r.toolLog.concat(r2.toolLog), retried: true };
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
  var api = { resolveRelative: resolveRelative, factorsInText: factorsInText, workerSpec: workerSpec, scenarioLine: scenarioLine, analystBase: analystBase, schemaDepth: schemaDepth, buildAllowed: buildAllowed, extractNumbers: extractNumbers, checkNumbers: checkNumbers, makeTools: makeTools, artifactProvider: artifactProvider,
              httpProvider: httpProvider, aiParse: aiParse, analyst: analyst, rateGate: rateGate, detect: detect,
              parserSystem: parserSystem, analystSystem: analystSystem, parseJSON: parseJSON, money: money, pct: pct };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TES_AI = api;
})(typeof window !== "undefined" ? window : this);

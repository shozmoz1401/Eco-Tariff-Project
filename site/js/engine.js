// Tariff Exposure Simulator — engine (JS). Mirrors pipeline/engine.py; see ENGINE_SPEC.md.
// Works in the browser (window.TES_ENGINE) and in Node (module.exports).
(function (root) {
  "use strict";

  function covers(line, p, c) {
    if (line.targets !== "ALL" && line.targets.indexOf(p) < 0) return false;
    if (line.exclude_targets && line.exclude_targets.indexOf(p) >= 0) return false;
    if (line.products !== "ALL" && line.products.indexOf(c) < 0) return false;
    if (line.exclude_products && line.exclude_products.indexOf(c) >= 0) return false;
    return true;
  }

  function specificity(line) {
    return (line.products !== "ALL" ? 2 : 0) + (line.targets !== "ALL" ? 1 : 0);
  }

  // Most specific line wins; ties go to the later line.
  function winner(lines, p, c) {
    var best = null, bestS = -1;
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!covers(L, p, c)) continue;
      var s = specificity(L);
      if (s >= bestS) { best = L; bestS = s; }
    }
    return best;
  }

  function coveredValue(line, data, p, c, v) {
    var x = v;
    if (line.exempt_ref && data.exempt && data.exempt[line.exempt_ref]) {
      var e = data.exempt[line.exempt_ref][p];
      if (e && e[c]) x -= e[c];
    }
    var cov = line.coverage;
    if (cov !== undefined && cov !== null) {
      if (typeof cov === "number") x *= cov;
      else if (cov[p] !== undefined) x *= cov[p];
    }
    return x > 0 ? x : 0;
  }

  function groupLayers(current) {
    var order = [], map = {};
    for (var i = 0; i < current.length; i++) {
      var k = current[i].layer || "default";
      if (!map[k]) { map[k] = []; order.push(k); }
      map[k].push(current[i]);
    }
    return order.map(function (k) { return map[k]; });
  }

  // Rates must be finite and >= 0. Throws on anything else.
  function validateLines(lines) {
    for (var i = 0; i < lines.length; i++) {
      var r = lines[i].rate;
      if (typeof r !== "number" || !isFinite(r) || r < 0) throw new Error("Invalid rate on line " + (i + 1) + ": rates must be 0% or higher.");
    }
  }

  function compute(data, gdp, current, scenario, elasticity, opts) {
    opts = opts || {};
    var mode = (scenario && scenario.mode) || "replace";
    var sLines = (scenario && scenario.lines) || [];
    validateLines(sLines);
    var layers = groupLayers(current || []);
    var chapters = data.chapters;
    var partners = Object.keys(data.imports).sort();
    var eps = elasticity || 0;

    var byCountry = {}, byChapter = {};
    chapters.forEach(function (c) { byChapter[c] = { hit: 0, bill: 0, cur_bill: 0, sim_bill: 0 }; });
    var tot = { hit: 0, bill: 0, cur_hit: 0, cur_bill: 0, sim_hit: 0, sim_bill: 0, lost: 0, imports: 0 };
    var H = {}; chapters.forEach(function (c) { H[c] = 0; });
    var nonTargetTotal = {}; chapters.forEach(function (c) { nonTargetTotal[c] = 0; });
    var isTarget = {};

    for (var pi = 0; pi < partners.length; pi++) {
      var p = partners[pi];
      var row = data.imports[p];
      var rec = { hit: 0, bill: 0, cur_hit: 0, cur_bill: 0, sim_hit: 0, sim_bill: 0, lost: 0, imports: 0, chapters: {} };
      for (var ci = 0; ci < chapters.length; ci++) {
        var c = chapters[ci];
        var v = row[ci] || 0;
        if (v <= 0) continue;
        rec.imports += v;
        // scenario
        var sw = winner(sLines, p, c);
        var hit = 0, bill = 0;
        if (sw && sw.rate > 0) { hit = v; bill = v * sw.rate / 100; }
        isTarget[p + "|" + c] = !!(sw && sw.rate > 0);
        if (!isTarget[p + "|" + c]) nonTargetTotal[c] += v;
        H[c] += hit;
        // current
        var curBill = 0, curHit = 0, prodBill = 0, prodHit = 0;
        for (var li = 0; li < layers.length; li++) {
          var w = winner(layers[li], p, c);
          if (!w || !(w.rate > 0)) continue;
          var cv = coveredValue(w, data, p, c, v);
          curBill += cv * w.rate / 100;
          if (cv > curHit) curHit = cv;
          if (w.scope === "product") { prodBill += cv * w.rate / 100; if (cv > prodHit) prodHit = cv; }
        }
        // simulated
        var simBill = curBill, simHit = curHit;
        if (sw) {
          if (mode === "add") {
            simBill = curBill + v * sw.rate / 100;
            simHit = sw.rate > 0 ? v : curHit;
          } else if (sw.products === "ALL") {
            // country-wide line: replaces country-wide layers, keeps Section 232 product tariffs
            simBill = prodBill + v * sw.rate / 100;
            simHit = sw.rate > 0 ? v : prodHit;
          } else {
            // product line: replaces everything on those products
            simBill = v * sw.rate / 100;
            simHit = sw.rate > 0 ? v : 0;
          }
        }
        // price-based change: tariff change / (1 + today's average rate on the flow)
        var dt = ((simBill - curBill) / v) / (1 + curBill / v);
        var lost = v * dt * eps;
        if (lost > v) lost = v; if (lost < -v) lost = -v;

        rec.hit += hit; rec.bill += bill; rec.cur_hit += curHit; rec.cur_bill += curBill;
        rec.sim_hit += simHit; rec.sim_bill += simBill; rec.lost += lost;
        if (hit > 0 || curBill > 0 || simBill > 0) {
          rec.chapters[c] = { imports: v, hit: hit, bill: bill, cur_bill: curBill, sim_bill: simBill, rate: sw ? sw.rate : null };
        }
        var bc = byChapter[c];
        bc.hit += hit; bc.bill += bill; bc.cur_bill += curBill; bc.sim_bill += simBill;
      }
      var g = gdp && gdp[p];
      rec.gdp = g ? g.value : null;
      rec.gdp_year = g ? g.year : null;
      rec.share_gdp = g && g.value > 0 ? rec.hit / g.value : null;
      rec.cur_share_gdp = g && g.value > 0 ? rec.cur_hit / g.value : null;
      rec.sim_share_gdp = g && g.value > 0 ? rec.sim_hit / g.value : null;
      byCountry[p] = rec;
      ["hit", "bill", "cur_hit", "cur_bill", "sim_hit", "sim_bill", "lost", "imports"].forEach(function (k) { tot[k] += rec[k]; });
    }

    // who gains
    var gains = {};
    for (var pj = 0; pj < partners.length; pj++) {
      var j = partners[pj];
      if (opts.excludeFromGains && opts.excludeFromGains.indexOf(j) >= 0) continue;
      var r = data.imports[j], gsum = 0, parts = {};
      for (var cj = 0; cj < chapters.length; cj++) {
        var ch = chapters[cj], vj = r[cj] || 0;
        if (vj <= 0 || H[ch] <= 0 || isTarget[j + "|" + ch] || nonTargetTotal[ch] <= 0) continue;
        var gpart = H[ch] * vj / nonTargetTotal[ch];
        gsum += gpart; parts[ch] = gpart;
      }
      if (gsum > 0) gains[j] = { total: gsum, chapters: parts, share_of_us_exports: byCountry[j].imports > 0 ? gsum / byCountry[j].imports : null };
    }

    return { byCountry: byCountry, byChapter: byChapter, totals: tot, gains: gains, mode: mode };
  }

  var api = { compute: compute, validateLines: validateLines, covers: covers, specificity: specificity, winner: winner, coveredValue: coveredValue };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TES_ENGINE = api;
})(this);

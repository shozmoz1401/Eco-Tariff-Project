// Tariff Exposure Simulator — UI. All numbers come from TES_ENGINE.compute().
(function () {
  "use strict";
  var E = window.TES_ENGINE, P = window.TES_PARSER, AI = window.TES_AI;
  var S = { year: null, data: {}, gdp: null, meta: null, current: null, world: null, worked: null,
            lines: [], mode: "replace", elasticity: 0.76, selected: null, result: null, notes: [], gainSort: "total" };

  var NICE = { "USA": "United States", "KOR": "South Korea", "VNM": "Vietnam", "TUR": "Türkiye", "HKG": "Hong Kong",
    "RUS": "Russia", "CZE": "Czechia", "IRN": "Iran", "SYR": "Syria", "LAO": "Laos", "MDA": "Moldova", "BOL": "Bolivia",
    "VEN": "Venezuela", "TZA": "Tanzania", "PRK": "North Korea", "COD": "DR Congo", "COG": "Congo", "MKD": "North Macedonia",
    "BIH": "Bosnia and Herzegovina", "DOM": "Dominican Republic", "CAF": "Central African Rep.", "ARE": "UAE", "GBR": "United Kingdom",
    "TWN": "Taiwan", "CHE": "Switzerland", "MAC": "Macao", "CIV": "Côte d'Ivoire", "FSM": "Micronesia", "KNA": "St Kitts and Nevis",
    "VCT": "St Vincent", "LCA": "St Lucia", "SXM": "Sint Maarten", "PSE": "Palestine", "SAU": "Saudi Arabia", "BRN": "Brunei" };
  var EXAMPLES = [
    "US puts 10% on India and 25% on autos from everyone",
    "60% on China, 25% on Vietnam electronics",
    "25% on everything from Mexico and Canada",
    "10% on everything from the EU except pharmaceuticals",
    "US removes tariffs on Canada",
    "50% on steel and aluminum from all countries except the UK"
  ];
  var PRODUCT_GROUPS = [
    ["Vehicles & parts", ["87"]], ["Steel (72–73)", ["72", "73"]], ["Aluminium", ["76"]], ["Copper", ["74"]],
    ["Electronics (85)", ["85"]], ["Machinery & computers (84)", ["84"]], ["Pharmaceuticals", ["30"]], ["Energy", ["27"]],
    ["Apparel (61–62)", ["61", "62"]], ["Furniture", ["94"]], ["Toys", ["95"]]
  ];

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, html) { var e = document.createElement(tag); if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]); if (html !== undefined) e.innerHTML = html; return e; }
  function escH(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function money(x) {
    if (x === null || x === undefined || isNaN(x)) return "–";
    var a = Math.abs(x), s = x < 0 ? "−" : "";
    if (a >= 1e12) return s + "$" + (a / 1e12).toFixed(2) + "tn";
    if (a >= 1e10) return s + "$" + (a / 1e9).toFixed(1) + "bn";
    if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "bn";
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(0) + "m";
    if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(0) + "k";
    if (a === 0) return "$0";
    return s + "$" + a.toFixed(0);
  }
  function signedMoney(x) { return (x > 0 ? "+" : "") + money(x); }
  function pct(x, d) { if (x === null || x === undefined || isNaN(x)) return "–"; return (x * 100).toFixed(d === undefined ? 2 : d) + "%"; }
  function name(iso) { return NICE[iso] || (S.data[S.year] && S.data[S.year].names[iso]) || iso; }
  function chName(c) { return (S.meta.chapters[c] || {}).short || c; }
  function D() { return S.data[S.year]; }
  function G() { return S.gdp[String(S.year)]; }
  function isEU(list) { return Array.isArray(list) && P.EU27.every(function (x) { return list.indexOf(x) >= 0; }); }

  var tip = null;
  function showTip(evt, html) { tip.innerHTML = html; tip.hidden = false; moveTip(evt); }
  function moveTip(evt) {
    var x = evt.clientX, y = evt.clientY, w = tip.offsetWidth, h = tip.offsetHeight;
    var left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    tip.style.left = Math.max(8, left) + "px"; tip.style.top = Math.max(8, top) + "px";
  }
  function hideTip() { tip.hidden = true; }

  // ---------- load ----------
  function getJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }
  function init() {
    tip = $("tip");
    Promise.all([getJSON("data/meta.json"), getJSON("data/current_us.json"), getJSON("data/gdp.json"), getJSON("data/world50m.json"),
                 getJSON("data/worked_examples.json").catch(function () { return null; }),
                 getJSON("data/calib.json").catch(function () { return null; })])
      .then(function (r) {
        S.meta = r[0]; S.current = r[1]; S.gdp = r[2]; S.world = r[3]; S.worked = r[4]; S.calib = r[5];
        S.year = S.meta.default_year;
        return Promise.all(S.meta.years.map(function (y) { return getJSON("data/usa_" + y + ".json").then(function (d) { S.data[y] = d; }); }));
      })
      .then(function () {
        setupControls();
        setupAI();
        runRuleText(EXAMPLES[0]);
        $("nl").value = EXAMPLES[0];
        route();
        window.addEventListener("hashchange", route);
      })
      .catch(function (e) { document.querySelector("main").innerHTML = '<div class="card">Could not load data: ' + escH(e.message) + "</div>"; });
  }

  function route() {
    var v = (location.hash || "#simulator").slice(1);
    if (v !== "how-it-works") v = "simulator";
    $("view-simulator").hidden = v !== "simulator";
    $("view-how-it-works").hidden = v !== "how-it-works";
    document.querySelectorAll(".tab").forEach(function (t) { if (t.dataset.view === v) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current"); });
    if (v === "how-it-works") renderHow();
  }

  // ---------- controls ----------
  function setupControls() {
    var ex = $("examples");
    EXAMPLES.forEach(function (t) { var b = el("button", { type: "button", "class": "chip" }, escH(t)); b.onclick = function () { $("nl").value = t; runText(t); }; ex.appendChild(b); });
    $("nl-form").addEventListener("submit", function (e) { e.preventDefault(); runText($("nl").value); });
    $("add-line").onclick = function () { S.lines.push({ targets: "ALL", products: "ALL", rate: 10 }); renderLines(); update(); };
    document.querySelectorAll(".scenario .seg button").forEach(function (b) {
      b.onclick = function () { S.mode = b.dataset.mode; document.querySelectorAll(".scenario .seg button").forEach(function (x) { x.setAttribute("aria-checked", x === b ? "true" : "false"); }); update(); };
    });
    document.querySelectorAll("#gain-sort button").forEach(function (b) {
      b.onclick = function () { S.gainSort = b.dataset.sort; document.querySelectorAll("#gain-sort button").forEach(function (x) { x.setAttribute("aria-checked", x === b ? "true" : "false"); }); renderGains(); };
    });
    var ys = $("year");
    S.meta.years.slice().reverse().forEach(function (y) { var o = el("option", { value: y }, y + (y === S.meta.default_year ? " (latest full year)" : "")); ys.appendChild(o); });
    ys.value = S.year;
    ys.onchange = function () { S.year = +ys.value; update(); };
    var sl = $("elast");
    sl.oninput = function () { S.elasticity = +sl.value; $("elast-out").textContent = S.elasticity.toFixed(2); renderLost(); };
    document.querySelectorAll(".presets .chip").forEach(function (b) { b.onclick = function () { sl.value = b.dataset.e; sl.oninput(); }; });
    $("cty-select").onchange = function () { S.selected = this.value; renderCountry(); highlightMap(); };
    $("built").textContent = "Data built " + S.meta.built + " · tariff table as of " + S.current.as_of;
  }

  function runText(t) {
    if (S.ai.provider && $("ai-parse").checked) return runAIText(t);
    return runRuleText(t);
  }

  function runRuleText(t, prefix) {
    var r = P.parse(t, D().names);
    var box = $("parse-msgs"); box.innerHTML = "";
    (prefix || []).forEach(function (w) { box.appendChild(el("div", { "class": "msg warn" }, escH(w))); });
    if (r.lines.length) S.lines = r.lines.map(function (l) { return { targets: l.targets, products: l.products, rate: l.rate, exclude_targets: l.exclude_targets, exclude_products: l.exclude_products }; });
    r.warnings.forEach(function (w) { box.appendChild(el("div", { "class": "msg warn" }, escH(w))); });
    r.notes.forEach(function (w) { box.appendChild(el("div", { "class": "msg" }, escH(w))); });
    if (r.lines.length) box.appendChild(el("div", { "class": "msg" }, "Parsed into " + r.lines.length + " line" + (r.lines.length > 1 ? "s" : "") + " below. Check them and edit if needed."));
    renderLines(); update();
  }

  function countryOptions() {
    var opts = [["ALL", "All countries"], ["EU", "European Union (27)"]];
    Object.keys(D().imports).sort(function (a, b) { return name(a).localeCompare(name(b)); }).forEach(function (iso) { opts.push([iso, name(iso)]); });
    return opts;
  }
  function productOptions() {
    var opts = [["ALL", "All products"]];
    PRODUCT_GROUPS.forEach(function (g) { opts.push(["G:" + g[1].join(","), g[0]]); });
    D().chapters.forEach(function (c) { opts.push([c, c + " · " + chName(c)]); });
    return opts;
  }

  function tagList(list, label, onRemove) {
    var wrap = document.createDocumentFragment();
    if (list === "ALL") { var t = el("span", { "class": "tag" }, label); wrap.appendChild(t); return wrap; }
    var items = list.slice(), shown = [];
    if (isEU(items)) { shown.push({ key: "EU", text: "EU (27)" }); items = items.filter(function (x) { return P.EU27.indexOf(x) < 0; }); }
    items.forEach(function (x) { shown.push({ key: x, text: label === "All products" ? x + " " + chName(x) : name(x) }); });
    shown.forEach(function (s) {
      var t = el("span", { "class": "tag" }, escH(s.text));
      var b = el("button", { type: "button", "aria-label": "Remove " + s.text }, "×");
      b.onclick = function () { onRemove(s.key); };
      t.appendChild(b); wrap.appendChild(t);
    });
    return wrap;
  }
  function selectAdder(opts, placeholder, onPick) {
    var s = el("select", { "aria-label": placeholder });
    s.appendChild(el("option", { value: "" }, placeholder));
    opts.forEach(function (o) { s.appendChild(el("option", { value: o[0] }, escH(o[1]))); });
    s.onchange = function () { if (s.value) onPick(s.value); };
    return s;
  }

  function renderLines() {
    var box = $("lines"); box.innerHTML = "";
    if (!S.lines.length) { box.appendChild(el("div", { "class": "empty" }, "No lines yet. Type a scenario above or add a line.")); }
    S.lines.forEach(function (L, i) {
      var row = el("div", { "class": "line" });
      row.appendChild(el("div", { "class": "imposer" }, "US"));
      var tg = el("div", { "class": "picker targets" });
      tg.appendChild(tagList(L.targets, "All countries", function (k) {
        var cur = L.targets === "ALL" ? [] : L.targets.slice();
        cur = k === "EU" ? cur.filter(function (x) { return P.EU27.indexOf(x) < 0; }) : cur.filter(function (x) { return x !== k; });
        L.targets = cur.length ? cur : "ALL"; renderLines(); update();
      }));
      tg.appendChild(selectAdder(countryOptions(), "+ country", function (v) {
        if (v === "ALL") L.targets = "ALL";
        else { var cur = L.targets === "ALL" ? [] : L.targets.slice(); (v === "EU" ? P.EU27 : [v]).forEach(function (x) { if (cur.indexOf(x) < 0) cur.push(x); }); L.targets = cur; }
        renderLines(); update();
      }));
      row.appendChild(tg);
      var pr = el("div", { "class": "picker products" });
      pr.appendChild(tagList(L.products, "All products", function (k) {
        var cur = L.products === "ALL" ? [] : L.products.filter(function (x) { return x !== k; });
        L.products = cur.length ? cur : "ALL"; renderLines(); update();
      }));
      pr.appendChild(selectAdder(productOptions(), "+ product", function (v) {
        if (v === "ALL") L.products = "ALL";
        else { var add = v.indexOf("G:") === 0 ? v.slice(2).split(",") : [v]; var cur = L.products === "ALL" ? [] : L.products.slice(); add.forEach(function (x) { if (cur.indexOf(x) < 0) cur.push(x); }); L.products = cur; }
        renderLines(); update();
      }));
      row.appendChild(pr);
      var ri = el("div", { "class": "rate-in" });
      var inp = el("input", { type: "number", min: "0", max: "1000", step: "0.5", value: L.rate, "aria-label": "Rate in percent" });
      var err = el("div", { "class": "line-note err", hidden: "" }, "Rates must be 0% or higher. The last valid rate (" + L.rate + "%) is still in use.");
      inp.oninput = function () {
        var v = parseFloat(inp.value);
        if (inp.value === "" || isNaN(v) || v < 0) { inp.setAttribute("aria-invalid", "true"); err.textContent = "Rates must be 0% or higher. The last valid rate (" + L.rate + "%) is still in use."; err.hidden = false; return; }
        inp.removeAttribute("aria-invalid"); err.hidden = true; L.rate = v; update();
      };
      ri.appendChild(inp); ri.appendChild(el("span", null, "%"));
      row.appendChild(ri);
      var del = el("button", { type: "button", "class": "del", "aria-label": "Delete line" }, "×");
      del.onclick = function () { S.lines.splice(i, 1); renderLines(); update(); };
      row.appendChild(del);
      var ex = [];
      if (L.exclude_targets && L.exclude_targets.length) ex.push("except " + L.exclude_targets.map(name).join(", "));
      if (L.exclude_products && L.exclude_products.length) ex.push("except products " + L.exclude_products.map(function (c) { return c + " " + chName(c); }).join(", "));
      if (ex.length) {
        var n = el("div", { "class": "line-note" }, escH(ex.join("; ")) + ' <button type="button" class="chip">clear exceptions</button>');
        n.querySelector("button").onclick = function () { delete L.exclude_targets; delete L.exclude_products; renderLines(); update(); };
        row.appendChild(n);
      }
      row.appendChild(err);
      box.appendChild(row);
    });
  }

  // ---------- compute + render ----------
  function scenarioLines() { return S.lines.map(function (l) { var o = { targets: l.targets, products: l.products, rate: l.rate }; if (l.exclude_targets) o.exclude_targets = l.exclude_targets; if (l.exclude_products) o.exclude_products = l.exclude_products; return o; }); }
  function update() {
    try { S.result = E.compute(D(), G(), S.current.lines, { mode: S.mode, lines: scenarioLines() }, S.elasticity); }
    catch (e) { $("cut-msgs").innerHTML = '<div class="msg warn">' + escH(e.message) + "</div>"; return; }
    var bc = S.result.byCountry;
    if (!S.selected || !bc[S.selected] || (bc[S.selected].hit === 0 && S.result.totals.hit > 0)) {
      var top = Object.keys(bc).sort(function (a, b) { return (bc[b].share_gdp || 0) - (bc[a].share_gdp || 0); })[0];
      var byHit = Object.keys(bc).sort(function (a, b) { return bc[b].hit - bc[a].hit; })[0];
      if (!S.selected || !bc[S.selected] || bc[S.selected].hit === 0) S.selected = bc[byHit] && bc[byHit].hit > 0 ? byHit : (top || "CHN");
    }
    var cs = $("cty-select"); cs.innerHTML = "";
    countryOptions().slice(2).forEach(function (o) { cs.appendChild(el("option", { value: o[0] }, escH(o[1]))); });
    cs.value = S.selected;
    renderCuts(); renderKPIs(); renderMap(); renderCountry(); renderSectors(); renderRank(); renderRealSim(); renderGains(); renderLost(); renderSources();
  }

  function srcTrade() { return "UN Comtrade, US imports " + S.year; }
  function srcGDP() { return "GDP: World Bank (Taiwan: DGBAS)"; }
  function renderSources() {
    var t = srcTrade(), g = srcGDP(), yrs = gdpYears();
    $("map-src").innerHTML = "Source: " + t + "; " + g + ", " + yrs + '. Grey = no trade hit; hatched = no GDP figure. Exports are gross sales and GDP is value added, so this share <b>overstates</b> the economic hit.';
    $("cty-src").textContent = "Source: " + t + "; " + g + ". Tariff bill = exports hit × rate.";
    $("sec-src").textContent = "Source: " + t + ", by HS 2-digit chapter (96 chapters).";
    $("rank-src").textContent = "Source: " + t + "; " + g + ", " + yrs + ". Click a row for the country panel.";
    $("rs-src").textContent = "Today's duties: hand-built table as of " + S.current.as_of + " (Federal Register notices; see How it works). Applied to " + t + ". Additional duties only; normal MFN duties excluded.";
    $("gain-src").innerHTML = "Source: " + t + '. The ECO 359 paper behind this project found India captured less than this kind of benchmark implies, because non-tariff barriers slowed switching. <a href="#how-it-works">More</a>';
  }
  function gdpYears() {
    var g = G(), ys = {}; Object.keys(g).forEach(function (k) { ys[g[k].year] = (ys[g[k].year] || 0) + 1; });
    var main = Object.keys(ys).sort(function (a, b) { return ys[b] - ys[a]; });
    return "GDP year " + main[0] + (main.length > 1 ? " (" + main.slice(1).join(", ") + " where " + main[0] + " is not yet published)" : "");
  }

  // One-line notice when the scenario lowers a country's average rate below today's.
  function renderCuts() {
    var bc = S.result.byCountry, box = $("cut-msgs"), lines = scenarioLines();
    var covered = Object.keys(bc).filter(function (k) {
      return bc[k].imports > 0 && lines.some(function (L) { return S.data[S.year].chapters.some(function (c) { return E.covers(L, k, c); }); });
    });
    var cuts = covered.filter(function (k) { var r = bc[k]; return (r.cur_bill - r.sim_bill) / r.imports > 0.0005; })
      .sort(function (a, b) { return (bc[b].cur_bill - bc[b].sim_bill) - (bc[a].cur_bill - bc[a].sim_bill); });
    if (!cuts.length) { box.innerHTML = ""; return; }
    var show = cuts.slice(0, 3).map(function (k) {
      var r = bc[k];
      return '<div class="msg warn">For ' + escH(name(k)) + " this is a tariff cut: today's modelled average is " + pct(r.cur_bill / r.imports, 1) +
        ", the scenario gives " + pct(r.sim_bill / r.imports, 1) + " (" + signedMoney(r.sim_bill - r.cur_bill) + " in duties).</div>";
    });
    if (cuts.length > 3) show.push('<div class="msg">' + (cuts.length - 3) + " more countries also get a cut; see “Today's tariffs vs. the scenario”.</div>");
    box.innerHTML = show.join("");
  }

  function renderKPIs() {
    var t = S.result.totals, bc = S.result.byCountry;
    var n = Object.keys(bc).filter(function (k) { return bc[k].hit > 0; }).length;
    var share = t.imports > 0 ? t.hit / t.imports : 0;
    var k = [
      ["Exports hit", money(t.hit), pct(share, 1) + " of US imports in " + S.year],
      ["Tariff bill (scenario)", money(t.bill), "exports hit × rate"],
      ["Change vs today's duties", signedMoney(t.sim_bill - t.cur_bill), "simulated " + money(t.sim_bill) + " vs today " + money(t.cur_bill)],
      ["Countries hit", String(n), "with any exports covered"]
    ];
    $("kpis").innerHTML = k.map(function (x) { return '<div class="kpi"><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div><div class="d">' + x[2] + "</div></div>"; }).join("");
  }

  // map
  var BINS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.02, 0.04];
  var BIN_LAB = ["<0.05%", "0.05%", "0.1%", "0.25%", "0.5%", "1%", "2%", "4%+"];
  function binOf(x) { for (var i = 0; i < BINS.length; i++) if (x < BINS[i]) return i + 1; return 8; }
  var mapSvg = null, mapPaths = null;
  function renderMap() {
    var box = $("map");
    if (!mapSvg) {
      var w = 960, h = 470;
      var feats = topojson.feature(S.world, S.world.objects.countries).features.filter(function (f) { return f.id !== "ATA"; });
      var proj = d3.geoNaturalEarth1().fitSize([w, h], { type: "FeatureCollection", features: feats });
      var path = d3.geoPath(proj);
      mapSvg = d3.select(box).append("svg").attr("viewBox", "0 0 " + w + " " + h).attr("role", "img").attr("aria-label", "World map of exposure");
      var defs = mapSvg.append("defs");
      var pat = defs.append("pattern").attr("id", "hatch").attr("patternUnits", "userSpaceOnUse").attr("width", 5).attr("height", 5).attr("patternTransform", "rotate(45)");
      pat.append("rect").attr("width", 5).attr("height", 5).attr("fill", "var(--seq-0)");
      pat.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 5).attr("stroke", "var(--text-muted)").attr("stroke-width", 1.2);
      mapPaths = mapSvg.append("g").selectAll("path").data(feats).enter().append("path").attr("class", "country").attr("d", path)
        .on("mousemove", function (ev, f) { showTip(ev, mapTip(f)); })
        .on("mouseleave", hideTip)
        .on("click", function (ev, f) { if (S.data[S.year].imports[f.id]) { S.selected = f.id; $("cty-select").value = f.id; renderCountry(); highlightMap(); } });
      var lg = $("map-legend"); var h2 = "";
      for (var i = 1; i <= 8; i++) h2 += '<span class="sw"><i style="background:var(--seq-' + i + ')"></i><span>' + BIN_LAB[i - 1] + "</span></span>";
      h2 += '<span class="gap"></span><span class="sw"><i style="background:var(--seq-0)"></i><span>none</span></span>';
      h2 += '<span class="sw"><i style="background:repeating-linear-gradient(45deg,var(--seq-0) 0 3px,var(--text-muted) 3px 4px)"></i><span>no GDP</span></span>';
      lg.innerHTML = h2;
    }
    var bc = S.result.byCountry;
    mapPaths.attr("fill", function (f) {
      var r = bc[f.id];
      if (!r || r.hit <= 0) return "var(--seq-0)";
      if (r.share_gdp === null) return "url(#hatch)";
      return "var(--seq-" + binOf(r.share_gdp) + ")";
    });
    highlightMap();
  }
  function highlightMap() { if (mapPaths) mapPaths.classed("sel", function (f) { return f.id === S.selected; }); }
  function mapTip(f) {
    var r = S.result.byCountry[f.id], n = NICE[f.id] || (D().names[f.id]) || f.properties.name;
    if (!r) return "<b>" + escH(n) + "</b><br>No US import data";
    return "<b>" + escH(n) + "</b><br>Exports hit: " + money(r.hit) + "<br>Share of GDP: " + (r.share_gdp === null ? "no GDP figure" : pct(r.share_gdp)) +
      "<br>Tariff bill: " + money(r.bill) + "<br><span style='opacity:.75'>US imports " + S.year + ": " + money(r.imports) + "</span>";
  }

  function renderCountry() {
    var iso = S.selected, r = S.result.byCountry[iso], box = $("country");
    if (!r) { box.innerHTML = '<div class="empty">No US import data for this country.</div>'; return; }
    var chs = Object.keys(r.chapters).filter(function (c) { return r.chapters[c].hit > 0; }).sort(function (a, b) { return r.chapters[b].hit - r.chapters[a].hit; }).slice(0, 6);
    var h = '<div class="cty-name">' + escH(name(iso)) + "</div>";
    h += '<div class="stats">' +
      '<div class="stat"><div class="k">Exports hit</div><div class="v">' + money(r.hit) + "</div></div>" +
      '<div class="stat"><div class="k">Share of GDP</div><div class="v">' + (r.share_gdp === null ? "n/a" : pct(r.share_gdp)) + "</div></div>" +
      '<div class="stat"><div class="k">Tariff bill</div><div class="v">' + money(r.bill) + "</div></div></div>";
    h += '<p class="sub" style="margin-top:10px">US imports from ' + escH(name(iso)) + " in " + S.year + ": " + money(r.imports) + " (" + pct(r.imports ? r.hit / r.imports : 0, 0) + " hit). " +
      "Today's duties ≈ " + money(r.cur_bill) + "; simulated " + money(r.sim_bill) + " (" + signedMoney(r.sim_bill - r.cur_bill) + ")." +
      (r.gdp ? " GDP " + money(r.gdp) + " (" + r.gdp_year + ")." : " No GDP figure available, so no share is shown.") + "</p>";
    if (chs.length) {
      var max = r.chapters[chs[0]].hit;
      h += '<div class="mini bars">' + chs.map(function (c) { var x = r.chapters[c]; return barRow(c + " " + chName(c), x.hit, max, money(x.hit), "bill " + money(x.bill) + " at " + x.rate + "%"); }).join("") + "</div>";
    } else h += '<div class="empty">This scenario does not hit ' + escH(name(iso)) + ".</div>";
    box.innerHTML = h; bindBarTips(box);
  }

  function barRow(label, v, max, valTxt, tipTxt) {
    var w = max > 0 ? Math.max(0.5, 100 * v / max) : 0;
    return '<div class="bar-row" data-tip="' + escH("<b>" + escH(label) + "</b><br>" + valTxt + (tipTxt ? "<br>" + tipTxt : "")) + '"><span class="lab" title="' + escH(label) + '">' + escH(label) +
      '</span><span class="track"><span class="fill" style="width:' + w + '%"></span></span><span class="val">' + valTxt + "</span></div>";
  }
  function bindBarTips(box) {
    box.querySelectorAll("[data-tip]").forEach(function (n) {
      n.addEventListener("mousemove", function (ev) { showTip(ev, n.getAttribute("data-tip")); });
      n.addEventListener("mouseleave", hideTip);
    });
  }

  function renderSectors() {
    var bc = S.result.byChapter, box = $("sectors");
    var chs = Object.keys(bc).filter(function (c) { return bc[c].hit > 0; }).sort(function (a, b) { return bc[b].hit - bc[a].hit; });
    if (!chs.length) { box.innerHTML = '<div class="empty">No products hit by this scenario.</div>'; return; }
    var top = chs.slice(0, 12), max = bc[top[0]].hit;
    var h = '<div class="bars">' + top.map(function (c) { return barRow(c + " " + chName(c), bc[c].hit, max, money(bc[c].hit), "tariff bill " + money(bc[c].bill) + "<br>" + escH((S.meta.chapters[c] || {}).name || "")); }).join("") + "</div>";
    if (chs.length > 12) { var rest = chs.slice(12).reduce(function (s, c) { return s + bc[c].hit; }, 0); h += '<p class="sub">Plus ' + (chs.length - 12) + " more chapters: " + money(rest) + ".</p>"; }
    box.innerHTML = h; bindBarTips(box);
  }

  function renderRank() {
    var bc = S.result.byCountry;
    var rows = Object.keys(bc).filter(function (k) { return bc[k].hit > 0; }).sort(function (a, b) { return bc[b].hit - bc[a].hit; }).slice(0, 15);
    var t = $("rank");
    if (!rows.length) { t.innerHTML = '<tr><td class="empty">No country is hit.</td></tr>'; return; }
    var h = "<thead><tr><th>Country</th><th>Exports hit</th><th>Share of its GDP</th><th>Tariff bill</th><th>Share of its US exports hit</th></tr></thead><tbody>";
    rows.forEach(function (k) { var r = bc[k]; h += '<tr class="clickable" data-iso="' + k + '"><td>' + escH(name(k)) + "</td><td>" + money(r.hit) + "</td><td>" + (r.share_gdp === null ? "n/a" : pct(r.share_gdp)) + "</td><td>" + money(r.bill) + "</td><td>" + pct(r.hit / r.imports, 0) + "</td></tr>"; });
    t.innerHTML = h + "</tbody>";
    t.querySelectorAll("tr.clickable").forEach(function (tr) { tr.onclick = function () { S.selected = tr.dataset.iso; $("cty-select").value = S.selected; renderCountry(); highlightMap(); $("country").scrollIntoView({ behavior: "smooth", block: "nearest" }); }; });
  }

  function renderRealSim() {
    var bc = S.result.byCountry, t = S.result.totals;
    $("rs-sub").textContent = S.mode === "replace"
      ? "Replace: a country-wide line replaces today's country-wide duties and keeps Section 232 product tariffs (metals, vehicles); a line that names products replaces everything on those products. Everything else keeps today's duties."
      : "Scenario rates are added on top of today's duties.";
    $("realsim-totals").innerHTML =
      '<div class="stat"><div class="k">Duties today</div><div class="v">' + money(t.cur_bill) + "</div></div>" +
      '<div class="stat"><div class="k">With scenario</div><div class="v">' + money(t.sim_bill) + "</div></div>" +
      '<div class="stat"><div class="k">Difference</div><div class="v ' + (t.sim_bill - t.cur_bill >= 0 ? "up" : "down") + '">' + signedMoney(t.sim_bill - t.cur_bill) + "</div></div>";
    var rows = Object.keys(bc).filter(function (k) { return Math.abs(bc[k].sim_bill - bc[k].cur_bill) > 1; })
      .sort(function (a, b) { return Math.abs(bc[b].sim_bill - bc[b].cur_bill) - Math.abs(bc[a].sim_bill - bc[a].cur_bill); }).slice(0, 12);
    var tb = $("realsim");
    if (!rows.length) { tb.innerHTML = '<tr><td class="empty">The scenario does not change any duties.</td></tr>'; return; }
    var maxd = Math.abs(bc[rows[0]].sim_bill - bc[rows[0]].cur_bill);
    var h = "<thead><tr><th>Country</th><th>Today: avg rate</th><th>Today: duties</th><th>Scenario: duties</th><th>Change</th></tr></thead><tbody>";
    rows.forEach(function (k) {
      var r = bc[k], d = r.sim_bill - r.cur_bill, w = 45 * Math.abs(d) / maxd;
      var bar = '<span class="diverge"><i style="' + (d >= 0 ? "left:50%;width:" + w + "%;background:var(--up)" : "right:50%;width:" + w + "%;background:var(--down)") + '"></i></span>';
      h += '<tr class="clickable" data-iso="' + k + '"><td>' + escH(name(k)) + "</td><td>" + pct(r.cur_bill / r.imports, 1) + "</td><td>" + money(r.cur_bill) + "</td><td>" + money(r.sim_bill) + '</td><td class="' + (d >= 0 ? "up" : "down") + '">' + signedMoney(d) + bar + "</td></tr>";
    });
    tb.innerHTML = h + "</tbody>";
    tb.querySelectorAll("tr.clickable").forEach(function (tr) { tr.onclick = function () { S.selected = tr.dataset.iso; $("cty-select").value = S.selected; renderCountry(); highlightMap(); }; });
    var cl = $("current-list");
    if (!cl.dataset.done) {
      cl.innerHTML = S.current.lines.map(function (L) {
        var tg = L.targets === "ALL" ? "All countries" : (isEU(L.targets) ? "EU (27)" + (L.targets.length > 27 ? " + " + L.targets.filter(function (x) { return P.EU27.indexOf(x) < 0; }).map(name).join(", ") : "") : L.targets.map(name).join(", "));
        var pr = L.products === "ALL" ? "All products" + (L.exclude_products ? " except ch. " + L.exclude_products.join(", ") : "") : "Ch. " + L.products.join(", ");
        return '<div class="cur-row"><div><span class="r">' + L.rate + "%</span> · " + escH(L.label) + "</div><div>" + escH(tg) + " · " + escH(pr) + (L.coverage ? " · partial coverage" : "") +
          '</div><div class="n">' + escH(L.basis) + ". In force from " + L.effective + (L.note ? ". " + escH(L.note) : "") + ' <a href="' + L.source + '">Source</a>' + (L.source2 ? ' · <a href="' + L.source2 + '">2</a>' : "") + "</div>" +
          (L.verified ? '<div class="n ' + (/^UNVERIFIED/.test(L.verified) ? "unv" : "") + '">' + escH(L.verified) + "</div>" : "") + "</div>";
      }).join("") + '<p class="n" style="margin-top:8px">' + escH(S.current.checked) + "</p>";
      cl.dataset.done = "1";
    }
  }

  function renderGains() {
    var g = S.result.gains, box = $("gains");
    var key = S.gainSort === "share" ? function (k) { return g[k].share_of_us_exports || 0; } : function (k) { return g[k].total; };
    var FLOOR = 5e7;
    var ks = Object.keys(g).filter(function (k) { return S.gainSort !== "share" || g[k].total >= FLOOR; }).sort(function (a, b) { return key(b) - key(a); }).slice(0, 12);
    $("gain-src").dataset.floor = S.gainSort === "share" ? "1" : "";
    if (!ks.length) { box.innerHTML = '<tr><td class="empty">Nothing to divert: the scenario hits no trade, or no untaxed supplier exists.</td></tr>'; return; }
    var max = Math.max.apply(null, ks.map(key));
    var h = "<thead><tr><th>Country</th><th>Diversion potential</th><th>Share of its current US exports</th></tr></thead><tbody>";
    ks.forEach(function (k) {
      var parts = Object.keys(g[k].chapters).sort(function (a, b) { return g[k].chapters[b] - g[k].chapters[a]; }).slice(0, 3);
      var tipTxt = "<b>" + escH(name(k)) + "</b><br>" + money(g[k].total) + " = " + pct(g[k].share_of_us_exports, 1) + " of its " + money(S.result.byCountry[k].imports) +
        " US exports in " + S.year + "<br>Top products: " + parts.map(function (c) { return escH(chName(c)) + " " + money(g[k].chapters[c]); }).join(", ");
      var w = max > 0 ? Math.max(1, 60 * key(k) / max) : 0;
      h += '<tr data-tip="' + escH(tipTxt) + '"><td>' + escH(name(k)) + '</td><td>' + money(g[k].total) + (S.gainSort === "total" ? ' <span class="inbar" style="width:' + w + 'px"></span>' : "") +
        "</td><td>" + pct(g[k].share_of_us_exports, 1) + (S.gainSort === "share" ? ' <span class="inbar" style="width:' + w + 'px"></span>' : "") + "</td></tr>";
    });
    if (S.gainSort === "share") h += '<tr><td colspan="3" class="sub" style="text-align:left;white-space:normal">Share ranking shows suppliers with at least $50m of diversion potential, so tiny flows do not dominate.</td></tr>';
    box.innerHTML = h + "</tbody>";
    bindBarTips(box);
  }

  function renderLost() {
    if (!S.result) return;
    var r = E.compute(D(), G(), S.current.lines, { mode: S.mode, lines: scenarioLines() }, S.elasticity);
    var t = r.totals, bc = r.byCountry;
    var ks = Object.keys(bc).filter(function (k) { return Math.abs(bc[k].lost) > 1; }).sort(function (a, b) { return Math.abs(bc[b].lost) - Math.abs(bc[a].lost); }).slice(0, 6);
    var h = '<div class="stat"><div class="k">' + (t.lost >= 0 ? "US imports lost" : "US imports gained") + " at sensitivity " + S.elasticity.toFixed(2) + '</div><div class="v">' + money(Math.abs(t.lost)) + "</div></div>";
    if (ks.length) h += '<div class="mini bars">' + ks.map(function (k) { return barRow(name(k), Math.abs(bc[k].lost), Math.abs(bc[ks[0]].lost), (bc[k].lost < 0 ? "+" : "−") + money(Math.abs(bc[k].lost)), bc[k].lost < 0 ? "trade gained (tariff cut)" : "trade lost"); }).join("") + "</div>";
    $("lost").innerHTML = h; bindBarTips($("lost"));
  }

  // ---------- AI (stage 2) ----------
  function aiCtx() {
    return { data: function (y) { return S.data[y]; }, gdp: function (y) { return S.gdp[String(y)]; }, current: S.current,
             years: S.meta.years, defaultYear: S.year, name: name, chName: chName, elasticity: function () { return S.elasticity; } };
  }
  var CHAT_EXAMPLES = ["Who is most exposed in this scenario, and why?", "Why does Vietnam gain more than Thailand?",
                       "Compare this scenario with 25% on China only.", "What does China pay today, and what changes?"];
  function setupAI() {
    var cfg = window.TES_CONFIG || {};
    S.ai = { provider: null, history: [], gate: AI.rateGate(cfg.aiCallsPerHour || 20, 3600e3, (function () { try { return window.localStorage; } catch (e) { return null; } })() || { getItem: function () { return null; }, setItem: function () {} }) };
    var ex = $("chat-examples");
    CHAT_EXAMPLES.forEach(function (q) { var b = el("button", { type: "button", "class": "chip", disabled: "" }, escH(q)); b.onclick = function () { $("chat-in").value = q; ask(q); }; ex.appendChild(b); });
    $("chat-form").addEventListener("submit", function (e) { e.preventDefault(); var q = $("chat-in").value.trim(); if (q) ask(q); });
    AI.detect({ endpoint: cfg.aiEndpoint }).then(function (prov) {
      S.ai.provider = prov;
      if (!prov) {
        $("ai-status").textContent = "AI is off here. The rule-based reader and all figures still work.";
        $("chat-status").textContent = "AI off";
        $("chat-log").innerHTML = '<div class="bubble ai">The AI analyst is not available on this copy of the page. Open the page on claude.ai, or deploy the proxy described on How it works.</div>';
        return;
      }
      $("ai-parse").disabled = false; $("ai-parse").checked = true;
      $("ai-status").textContent = "AI: " + prov.label + ". The first use asks your permission. Limit " + (cfg.aiCallsPerHour || 20) + " AI calls an hour.";
      $("chat-status").textContent = prov.label;
      $("chat-in").disabled = false; $("chat-send").disabled = false;
      ex.querySelectorAll("button").forEach(function (b) { b.removeAttribute("disabled"); });
    });
  }
  function gate() { var g = S.ai.gate.take(); if (!g.ok) throw { code: "local_limit", message: "AI limit reached for this browser. Try again in about " + g.retryInMin + " min. The rule-based tools still work." }; }
  function aiError(e) {
    if (e && e.code === "not_granted") { S.ai.provider = null; $("ai-parse").checked = false; $("ai-parse").disabled = true; return "AI permission was not granted, so AI is off. Everything else still works."; }
    if (e && e.code === "rate_limited") return "The AI service is rate-limited right now. Wait a minute and try again.";
    return (e && e.message) || "The AI call failed.";
  }
  function runAIText(t) {
    var box = $("parse-msgs"); box.innerHTML = '<div class="msg">Reading the scenario with AI…</div>';
    try { gate(); } catch (e) { return runRuleText(t, [e.message + " Used the rule-based reader instead."]); }
    AI.aiParse(S.ai.provider, aiCtx(), t).then(function (r) {
      if (!r.lines.length) throw new Error("AI found no lines it could use");
      S.lines = r.lines;
      box.innerHTML = "";
      box.appendChild(el("div", { "class": "msg" }, '<span class="badge">AI</span>Parsed into ' + r.lines.length + " line" + (r.lines.length > 1 ? "s" : "") + " below. Check them and edit if needed."));
      r.unsupported.concat(r.warnings).forEach(function (w) { box.appendChild(el("div", { "class": "msg warn" }, escH(w))); });
      r.notes.forEach(function (w) { box.appendChild(el("div", { "class": "msg" }, escH(w))); });
      renderLines(); update();
    }).catch(function (e) { runRuleText(t, [aiError(e) + " Used the rule-based reader instead."]); });
  }
  // escape first, then allow **bold** only
  function mdLite(t) { return escH(t).replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/^#+\s*/gm, ""); }
  function bubble(cls, html) { var b = el("div", { "class": "bubble " + cls }, html); $("chat-log").appendChild(b); b.scrollIntoView({ block: "nearest" }); return b; }
  function toolDetails(log) {
    if (!log || !log.length) return "";
    return "<details><summary>Engine calls (" + log.length + "): " + log.map(function (l) { return escH(l.name); }).join(", ") + "</summary>" +
      log.map(function (l) { return "<pre>" + escH(l.name + " " + JSON.stringify(l.input) + "\n→ " + JSON.stringify(l.output).slice(0, 2500)) + "</pre>"; }).join("") + "</details>";
  }
  function ask(q) {
    if (!S.ai.provider || S.ai.busy) return;
    $("chat-in").value = "";
    bubble("user", escH(q));
    try { gate(); } catch (e) { bubble("blocked", escH(e.message)); return; }
    S.ai.busy = true; $("chat-send").disabled = true;
    var wait = bubble("ai", "Running the engine…");
    AI.analyst(S.ai.provider, aiCtx(), q, S.ai.history.slice(-6), scenarioLines(), S.mode).then(function (r) {
      wait.remove();
      if (r.ok) {
        bubble("ai", mdLite(r.text) + toolDetails(r.toolLog));
        S.ai.history.push({ role: "user", content: q }, { role: "assistant", content: r.text });
      } else {
        bubble("blocked", "<b>Answer withheld.</b> It contained numbers the engine did not return (" + escH(r.bad.join(", ")) + "), even after one retry. The engine results it used are below." + toolDetails(r.toolLog));
      }
    }).catch(function (e) { wait.remove(); bubble("blocked", escH(aiError(e))); })
      .then(function () { S.ai.busy = false; $("chat-send").disabled = !S.ai.provider; });
  }

  // ---------- how it works ----------
  function calibTxt(k, add) { if (!S.calib || S.calib[k] === undefined) return "–"; return pct(S.calib[k] + (add || 0), 1); }
  function renderHow() {
    var a = $("how"); if (a.dataset.done) return;
    var cur = S.current, d = D();
    var wk = "";
    if (S.worked) {
      wk = S.worked.map(function (w) {
        return "<h3>" + escH(w.title) + "</h3><p><b>Scenario:</b> " + escH(w.scenario) + "</p><ul>" + w.steps.map(function (s) { return "<li>" + escH(s) + "</li>"; }).join("") + "</ul>";
      }).join("");
    }
    a.innerHTML = [
      "<h2>How it works</h2>",
      "<p>This tool answers one question: <b>if the US puts a tariff on these goods from these countries, how much trade does it touch, and who carries it?</b> It calculates exposure from real trade data. It does not predict stock prices, GDP or prices.</p>",
      "<h3>Data</h3><ul>",
      "<li><b>Trade:</b> UN Comtrade, US imports by partner and HS 2-digit chapter (96 chapters), annual " + S.meta.years.join(" and ") + ". Latest full year: " + S.meta.default_year + ". Values as reported by the US (Comtrade “primary value”). <a href=\"" + S.meta.trade_source_url + "\">Comtrade</a></li>",
      "<li><b>GDP:</b> World Bank, GDP in current US$ (NY.GDP.MKTP.CD), the same year as the trade data where published, otherwise the latest earlier year. Taiwan is not in World Bank data, so its GDP comes from its statistics office (DGBAS): $922.5bn for 2025, $801.5bn for 2024. <a href=\"" + S.meta.gdp_source_url + "\">World Bank</a> · <a href=\"" + S.meta.gdp_supplement_url + "\">DGBAS series</a></li>",
      "<li><b>Tariffs in force today:</b> a hand-built, dated table (as of " + cur.as_of + "), every row linked to its Federal Register notice. See the table on the Simulator page.</li>",
      "<li>Data built " + S.meta.built + ". Comtrade reports Taiwan as “Other Asia, nes”; it is shown as Taiwan. China's re-imports from itself are dropped.</li></ul>",
      "<h3>The calculation</h3>",
      "<p>A scenario is a list of lines: <code>(imposer, targets, products, rate %)</code>. For every country × product chapter the engine finds the line that applies and computes:</p>",
      "<table class=\"tbl\"><tr><th>Output</th><th>Definition</th></tr>",
      "<tr><td>Exports hit</td><td>US imports from that country in the tariffed chapters, " + S.meta.default_year + "</td></tr>",
      "<tr><td>Share of GDP</td><td>Exports hit ÷ that country's GDP</td></tr>",
      "<tr><td>Tariff bill</td><td>Exports hit × rate</td></tr>",
      "<tr><td>Today vs scenario</td><td>The same duties computed with today's tariff table, then with the scenario applied (replace or add on top), and the difference. A one-line notice flags any country whose average rate the scenario lowers.</td></tr>",
      "<tr><td>Who gains</td><td>For each hit chapter, untaxed suppliers' share of US imports of that chapter × the value hit, summed; also shown as a share of that supplier's current US exports</td></tr>",
      "<tr><td>Trade lost</td><td>Imports × (scenario rate − today's rate) ÷ (1 + today's rate) × sensitivity (your assumption), capped at the value of the trade</td></tr></table>",
      "<p><b>Replace vs. add on top.</b> In Replace mode (the default), a line that names no products is a country-wide tariff: it replaces today's country-wide duties (the forced-labour Section 301 duty and the China and Brazil Section 301 duties) and <b>keeps</b> Section 232 product tariffs on metals and vehicles, which stack on top. A line that names products replaces everything on those products, Section 232 included. So “10% on India” leaves the 50% on Indian steel in place, while “0% on vehicles from Canada” removes the vehicle duty. In practice many country-wide US tariffs skip Section 232 goods, so stacking the scenario rate on top of 232 slightly overstates duties on metals and vehicles. Add on top puts the scenario rate on top of everything in force. Rates below 0% are rejected.</p>",
      "<p><b>Overlapping lines:</b> the most specific line wins. A line that names products beats one that does not; a line that names countries beats one that does not; ties go to the later line. So in “10% on India and 25% on autos from everyone”, Indian cars pay 25%, not 35%. That mirrors US practice, where Section 232 product tariffs take precedence over country-wide tariffs.</p>",
      "<p><b>Today's tariffs stack by layer:</b> Section 232, the Section 301 forced-labour action and the China and Brazil Section 301 actions are separate layers that add up, as they do in law (e.g. Chinese steel pays the 232 duty plus the legacy China 301 duty).</p>",
      "<p><b>Engine written twice:</b> the same spec is implemented in JavaScript (runs in your browser) and Python (data pipeline and tests). A test runs both on the same scenarios and requires identical results.</p>",
      "<h3>Worked examples (checked by hand, and in both engines)</h3>", wk,
      "<h3>Who gains, and why it is only a benchmark</h3>",
      "<p>The ranking assumes buyers switch to untaxed suppliers in proportion to their current market share, instantly and with no friction. Real switching is slower and uneven. The ECO 359 survey behind this project (Kukreja Belligundu, 2026) found India's gains from the 2018–20 US-China trade war were partial and concentrated in easily substitutable goods such as textiles, because quality standards, certification and trade finance (non-tariff barriers) limited switching (Sanyal 2021; Khandelwal 2023). Countries already well integrated into supply chains, such as Vietnam and Mexico, gained most (Goldberg & Ruta 2025). Read this ranking as an upper-bound opportunity, not an outcome.</p>",
      "<h3>Trade-lost sensitivity</h3>",
      "<p>Default 0.76: Boehm, Levchenko &amp; Pandalai-Nayar (2023, <i>American Economic Review</i> 113(4)) estimate the elasticity of trade flows to tariffs at about −0.76 in the first year and about −2 in the long run (7–10 years). Their elasticity is defined on the tariff-inclusive price factor (1 + t), so the change used is (t₁ − t₀) ÷ (1 + t₀): a 10-point rise on a flow already taxed at 25% is an 8% price change, not 10%. The slider is your assumption; the linear formula is an approximation that is less accurate for large tariff changes.</p>",
      "<h3>Limits</h3><ul>",
      "<li><b>Exposure is the trade a tariff applies to, not the damage done.</b> Exporters can cut prices, reroute or find other buyers.</li>",
      "<li><b>Share of GDP overstates the hit:</b> exports are gross sales, while GDP is value added; imported inputs inside those exports are not the exporter's income.</li>",
      "<li>Trade data is annual with a monthly refresh planned; stock prices (stage 4) are daily. Nothing here is real-time.</li>",
      "<li>Sectors are 96 broad HS chapters. Narrower items (smartphones, almonds, EVs) map to their chapter, and the parser says so.</li>",
      "<li>The US current-tariff table is hand-maintained and dated (" + cur.as_of + "). Rates are approximated at chapter level; details below. Other countries' tariffs arrive with stage 3 and will be approximate and lagged.</li>",
      "<li>Past stock moves (stage 4) are history and had many causes.</li></ul>",
      "<h3>How today's tariffs are approximated</h3><ul>",
      "<li>Chapters 27 (energy), 30 (pharmaceuticals) and 88 (aircraft) are treated as exempt from the forced-labour Section 301 duty, as are the Section 232 chapters (72–74, 76, 87), which pay the 232 duty instead.</li>",
      "<li>Listed exempt products inside other chapters are netted out using their own trade values: " + Object.keys(cur.fl_exempt_products).map(function (k) { return cur.fl_exempt_products[k] + " (HS " + k + ")"; }).join(", ") + ".</li>",
      "<li>USMCA: most goods from Mexico and Canada enter duty-free, so the forced-labour duty is applied to 12% of Mexican and 15% of Canadian trade; vehicles from both are modelled at an effective 19%.</li>",
      "<li>EU, Taiwan, Japan, Korea and Switzerland have caps that include the normal MFN duty; modelled by subtracting the 2.2% US trade-weighted MFN average (WTO).</li>",
      "<li><b>China.</b> The 2018 and 2024 Section 301 duties are one average of 21.3 points, derived from the Congressional Research Service: its trade-weighted US average on China was 34% in Feb 2026 with the 10% Section 122 surcharge in force; removing that 10% and the 2.7% pre-war average leaves 21.3. On 2025 trade the model puts China at " + calibTxt("china_today") + " in additional duties today, about " + calibTxt("china_today", 0.027) + " with normal duties, against CRS's <a href=\"https://www.congress.gov/crs-product/IF12990\">36.5% for July 2026</a>. On CRS's own basis (no product exemptions, no Section 232) the model gives " + calibTxt("china_crs_basis", 0.027) + "; the remaining gap of about one point comes from using 2025 trade weights and treating energy, pharmaceuticals and aircraft as exempt chapters. Product exclusions and the 2024 increases enter only through that average, not line by line.</li>",
      "<li><b>Overall check:</b> applied to 2025 trade, the table implies " + (S.calib ? money(S.calib.total_today) : "–") + " of additional duties, an average of " + calibTxt("avg_today") + " of US imports, or about " + calibTxt("avg_today", 0.022) + " including the 2.2% average normal duty. For comparison, the <a href=\"https://ttd.wto.org/en/profiles/united-states-of-america\">WTO's Tariff & Trade Data</a> put the US effective applied tariff at 13.5% on 24 Feb 2026, under the earlier Section 122 regime, so the two are not strictly comparable. This is a rough plausibility check, not a validation of any single row.</li>",
      "<li>Every row in the tariff table says how it was verified. Rows marked UNVERIFIED (UK vehicle quota rate, Mexico/Canada vehicle coverage) rest on secondary sources only.</li>",
      "<li><b>Not modelled:</b><ul>" + cur.not_modelled.map(function (n) { return "<li>" + escH(n[0]) + " — " + escH(n[1]) + "</li>"; }).join("") + "</ul></li>",
      "<li>" + escH(cur.checked) + "</li></ul>",
      "<h3>AI features (stage 2)</h3>",
      "<p><b>What the AI does:</b> (1) reads a typed scenario into the same editable lines the menus produce, and you see and can correct them before anything is calculated; (2) answers questions in the analyst panel by calling the engine as a tool (run a scenario, inspect a country, compare two scenarios, look up codes, read today's rates). <b>What it never does:</b> produce a number. Every figure in an analyst answer is checked against the engine's own outputs for that question. If any figure is not there, at the precision shown, the answer is retried once and otherwise withheld, and the engine results are shown instead. A parsed rate must appear in your text, or be derived from today's modelled rate (for “double”), and the page tells you when it was derived.</p>",
      "<p><b>Where the AI runs:</b> on claude.ai, the page asks Claude through the artifact platform, with no API key and no server; the first use asks your permission, and it counts against the viewer's own Claude usage. A public copy can instead call a small Cloudflare Worker (in the repo's <code>worker/</code> folder) that holds the API key as a secret and forwards to the Anthropic API or any OpenAI-compatible endpoint. The provider sits behind one function, so swapping it changes no other code. Without either, AI is simply off and the rule-based reader is used.</p>",
      "<p><b>Spend controls:</b> each browser is limited to " + ((window.TES_CONFIG || {}).aiCallsPerHour || 20) + " AI calls an hour, the Worker limits requests per IP address and in total, and the API key should have a monthly spending limit set in the Claude Console.</p>",
      "<p><b>AI reader check:</b> the button below runs the 12 test phrases in <code>tests/parser_eval.json</code> through the AI reader on its cheapest tier and compares the lines with the expected answers (the rule-based reader scores 12/12 on the same set). It makes 12 AI calls. <button type=\"button\" class=\"btn\" id=\"ai-eval\">Run AI reader check</button></p><div id=\"ai-eval-out\" class=\"sub\"></div>",
      "<h3>Coming next</h3><p>Stage 3: any of the 40 largest economies as imposer, so retaliation can be modelled. Stage 4: past tariff episodes and stock-market moves, labelled as history. Stage 5: monthly auto-update.</p>",
      "<h3>Source code</h3><p>Engine spec, JavaScript and Python engines, pipeline and tests are published with this page: <a href=\"src/ENGINE_SPEC.md.txt\">spec</a> · <a href=\"js/engine.js\">engine.js</a> · <a href=\"src/engine.py.txt\">engine.py</a> · <a href=\"src/build.py.txt\">build.py</a> · <a href=\"src/test_engine.py.txt\">tests</a> · <a href=\"js/ai.js\">ai.js</a> · <a href=\"src/worker.js.txt\">worker</a> · <a href=\"src/current_tariffs.py.txt\">tariff table</a>.</p>"
    ].join("");
    a.dataset.done = "1";
    var b = $("ai-eval");
    if (b) b.onclick = function () {
      var out = $("ai-eval-out");
      if (!S.ai || !S.ai.provider) { out.textContent = "AI is not available on this copy of the page."; return; }
      b.disabled = true; out.textContent = "Running…";
      getJSON("data/parser_eval.json").then(function (ev) {
        var norm = function (x) { return JSON.stringify((x || []).map(function (l) { return { t: l.targets === "ALL" ? "ALL" : l.targets.slice().sort(), p: l.products === "ALL" ? "ALL" : l.products.slice().sort(), r: l.rate, xt: (l.exclude_targets || []).slice().sort(), xp: (l.exclude_products || []).slice().sort() }; })); };
        var ok = 0, rows = [];
        return ev.reduce(function (pr, c) {
          return pr.then(function () {
            return AI.aiParse(S.ai.provider, aiCtx(), c.text).then(function (r) { var pass = norm(r.lines) === norm(c.expect); ok += pass; rows.push((pass ? "✓ " : "✗ ") + c.text + (pass ? "" : " → " + norm(r.lines))); },
              function (e) { rows.push("✗ " + c.text + " → error: " + aiError(e)); });
          }).then(function () { out.innerHTML = escH("AI reader: " + ok + "/" + rows.length + " so far") + "<br>" + rows.map(escH).join("<br>"); });
        }, Promise.resolve()).then(function () { out.insertAdjacentHTML("afterbegin", "<b>" + (ok === ev.length ? "All passed on the cheapest tier." : ok + "/" + ev.length + " passed. Where it fails, the rule-based reader is the better default for those phrases.") + "</b><br>"); });
      }).then(function () { b.disabled = false; });
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

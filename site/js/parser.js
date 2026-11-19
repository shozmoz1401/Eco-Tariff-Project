// Rule-based scenario parser: plain English -> scenario lines. Works with no AI.
// Stage 2 adds an AI parser in front of this; this stays as the fallback.
(function (root) {
  "use strict";

  var EU27 = ["AUT","BEL","BGR","HRV","CYP","CZE","DNK","EST","FIN","FRA","DEU","GRC","HUN","IRL","ITA","LVA","LTU","LUX","MLT","NLD","POL","PRT","ROU","SVK","SVN","ESP","SWE"];
  var GROUPS = {
    "eu": EU27, "european union": EU27, "europe": EU27, "european": EU27,
    "asean": ["BRN","KHM","IDN","LAO","MYS","MMR","PHL","SGP","THA","VNM"],
    "brics": ["BRA","RUS","IND","CHN","ZAF","EGY","ETH","IRN","ARE","IDN"],
    "g7": ["CAN","FRA","DEU","ITA","JPN","GBR"],
    "usmca": ["CAN","MEX"], "nafta": ["CAN","MEX"], "north america": ["CAN","MEX"],
    "latin america": ["MEX","BRA","ARG","CHL","COL","PER","ECU","GTM","CRI","DOM","HND","SLV","NIC","PAN","URY","PRY","BOL","VEN"],
    "gulf": ["SAU","ARE","QAT","KWT","OMN","BHR"]
  };
  var ALIASES = {
    "china":"CHN","chinese":"CHN","prc":"CHN","india":"IND","indian":"IND","mexico":"MEX","mexican":"MEX",
    "canada":"CAN","canadian":"CAN","japan":"JPN","japanese":"JPN","south korea":"KOR","korea":"KOR","korean":"KOR",
    "germany":"DEU","german":"DEU","france":"FRA","french":"FRA","italy":"ITA","italian":"ITA","spain":"ESP","spanish":"ESP",
    "uk":"GBR","u.k.":"GBR","britain":"GBR","great britain":"GBR","british":"GBR","united kingdom":"GBR","england":"GBR",
    "ireland":"IRL","irish":"IRL","netherlands":"NLD","dutch":"NLD","holland":"NLD","belgium":"BEL","switzerland":"CHE","swiss":"CHE",
    "vietnam":"VNM","viet nam":"VNM","vietnamese":"VNM","thailand":"THA","thai":"THA","malaysia":"MYS","malaysian":"MYS",
    "indonesia":"IDN","indonesian":"IDN","philippines":"PHL","filipino":"PHL","singapore":"SGP","taiwan":"TWN","taiwanese":"TWN",
    "hong kong":"HKG","brazil":"BRA","brazilian":"BRA","argentina":"ARG","chile":"CHL","colombia":"COL","peru":"PER",
    "russia":"RUS","russian":"RUS","turkey":"TUR","turkiye":"TUR","türkiye":"TUR","turkish":"TUR","israel":"ISR","israeli":"ISR",
    "saudi arabia":"SAU","saudi":"SAU","uae":"ARE","emirates":"ARE","united arab emirates":"ARE","qatar":"QAT",
    "south africa":"ZAF","nigeria":"NGA","egypt":"EGY","australia":"AUS","australian":"AUS","new zealand":"NZL",
    "bangladesh":"BGD","pakistan":"PAK","sri lanka":"LKA","cambodia":"KHM","sweden":"SWE","swedish":"SWE","austria":"AUT",
    "poland":"POL","polish":"POL","denmark":"DNK","finland":"FIN","norway":"NOR","norwegian":"NOR","portugal":"PRT",
    "czechia":"CZE","czech republic":"CZE","hungary":"HUN","romania":"ROU","greece":"GRC","costa rica":"CRI",
    "dominican republic":"DOM","guatemala":"GTM","honduras":"HND","el salvador":"SLV","nicaragua":"NIC","ecuador":"ECU",
    "venezuela":"VEN","kazakhstan":"KAZ","iraq":"IRQ","kuwait":"KWT","algeria":"DZA","angola":"AGO","morocco":"MAR",
    "jordan":"JOR","laos":"LAO","myanmar":"MMR","ukraine":"UKR","belarus":"BLR","iran":"IRN","north korea":"PRK"
  };
  var IMPOSER = ["us","u.s.","usa","u.s.a.","united states","america","american","washington","trump","the us","the u.s."];
  var EVERYONE = ["everyone","everybody","all countries","every country","all trading partners","all partners","the world","the rest of the world","worldwide","globally","global","across the board","universal","all imports","everywhere","anyone"];
  var ALL_GOODS = ["everything","all goods","all products","all imports","all their goods","all its goods","all exports"];

  function range(a, b) { var r = []; for (var i = a; i <= b; i++) r.push((i < 10 ? "0" : "") + i); return r; }
  // keyword -> [chapters, note for narrower items]
  var SECTORS = [
    [["autos","auto","cars","car","vehicles","vehicle","automobiles","automobile","auto parts","car parts","trucks","automotive"], ["87"]],
    [["evs","ev","electric vehicles","electric cars"], ["87"], "EVs map to chapter 87 (all vehicles)."],
    [["steel"], ["72","73"]], [["iron"], ["72"]], [["aluminum","aluminium"], ["76"]], [["copper"], ["74"]],
    [["metals","base metals"], ["72","73","74","76"]],
    [["semiconductors","semiconductor","chips","microchips"], ["85"], "Chips map to chapter 85 (all electrical equipment)."],
    [["smartphones","smartphone","phones","iphones","mobile phones"], ["85"], "Smartphones map to chapter 85 (all electrical equipment)."],
    [["electronics","electrical equipment","electricals"], ["85"]],
    [["solar panels","solar"], ["85"], "Solar panels map to chapter 85."], [["batteries","battery"], ["85"], "Batteries map to chapter 85."],
    [["machinery","machines","industrial machinery"], ["84"]],
    [["computers","laptops","servers"], ["84"], "Computers map to chapter 84 (all machinery)."],
    [["pharmaceuticals","pharma","drugs","medicines","medicine"], ["30"]],
    [["chemicals"], ["28","29","38"]],
    [["oil","crude","petroleum","energy","gas","natural gas","lng","coal","fuel"], ["27"]],
    [["textiles","fabrics","yarn"], range(50,60).concat(["63"])],
    [["apparel","clothing","clothes","garments"], ["61","62"]],
    [["footwear","shoes","sneakers"], ["64"]],
    [["furniture"], ["94"]], [["toys","games"], ["95"]], [["plastics","plastic"], ["39"]],
    [["rubber","tyres","tires"], ["40"]], [["lumber","timber","wood"], ["44"]], [["paper"], ["48"]],
    [["agriculture","agricultural goods","agricultural products","farm goods","food"], range(1,24)],
    [["seafood","fish","shrimp"], ["03"]], [["meat","beef","pork","poultry"], ["02"]], [["dairy","cheese","milk"], ["04"]],
    [["fruit","nuts","almonds","pistachios","walnuts"], ["08"], "Nuts such as almonds map to chapter 08 (all fruit and nuts)."],
    [["vegetables"], ["07"]], [["coffee","tea","spices"], ["09"]], [["cereals","grain","grains","rice","wheat","corn"], ["10"]],
    [["soybeans","soybean","soy","oilseeds"], ["12"]], [["sugar"], ["17"]], [["cocoa","chocolate"], ["18"]],
    [["wine","beverages","spirits","whisky","whiskey","bourbon","beer","drinks"], ["22"]], [["tobacco","cigarettes"], ["24"]],
    [["jewelry","jewellery","gold","diamonds","gems"], ["71"]], [["aircraft","planes","airplanes","aerospace","jets"], ["88"]],
    [["ships","boats"], ["89"]], [["medical devices","medical equipment","instruments","optical"], ["90"]],
    [["cosmetics","perfume"], ["33"]], [["glass"], ["70"]], [["ceramics"], ["69"]], [["fertilizer","fertiliser","fertilizers"], ["31"]]
  ];

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function buildLexicon(names) {
    var lex = [];
    Object.keys(ALIASES).forEach(function (k) { lex.push({ k: k, type: "country", iso: [ALIASES[k]] }); });
    Object.keys(names || {}).forEach(function (iso) {
      var n = names[iso].toLowerCase().replace(/,.*$/, "");
      if (n.length > 3 && !ALIASES[n]) lex.push({ k: n, type: "country", iso: [iso] });
    });
    Object.keys(GROUPS).forEach(function (k) { lex.push({ k: k, type: "country", iso: GROUPS[k], group: true }); });
    EVERYONE.forEach(function (k) { lex.push({ k: k, type: "everyone" }); });
    ALL_GOODS.forEach(function (k) { lex.push({ k: k, type: "allgoods" }); });
    SECTORS.forEach(function (s) { s[0].forEach(function (k) { lex.push({ k: k, type: "sector", ch: s[1], note: s[2] }); }); });
    IMPOSER.forEach(function (k) { lex.push({ k: k, type: "imposer" }); });
    lex.sort(function (a, b) { return b.k.length - a.k.length; });
    return lex;
  }

  // find non-overlapping mentions, longest first
  function mentions(text, lex) {
    var taken = new Array(text.length).fill(false), out = [];
    lex.forEach(function (e) {
      var re = new RegExp("(^|[^a-z0-9])(" + esc(e.k) + ")(?=$|[^a-z0-9])", "g"), m;
      while ((m = re.exec(text))) {
        var s = m.index + m[1].length, t = s + m[2].length, free = true;
        for (var i = s; i < t; i++) if (taken[i]) { free = false; break; }
        if (!free) continue;
        for (var j = s; j < t; j++) taken[j] = true;
        out.push({ s: s, e: t, ent: e, text: m[2] });
      }
    });
    out.sort(function (a, b) { return a.s - b.s; });
    return out;
  }

  var RATE_RE = /(?<![0-9a-z])(-\s*|−\s*|minus\s+|negative\s+)?(\d+(?:\.\d+)?)\s*(%|percent|per cent|pct)/g;
  var NON_US_VERB = /^\s*(retaliates?|retaliating|hits back|responds|imposes|puts|slaps|levies|places|adds|charges)/;

  function parse(input, names) {
    var text = " " + (input || "").toLowerCase().replace(/[’']/g, "'") + " ";
    var lex = buildLexicon(names);
    var ms = mentions(text, lex);
    var warnings = [], notes = [];
    var rates = [], m;
    RATE_RE.lastIndex = 0;
    while ((m = RATE_RE.exec(text))) {
      var neg = !!m[1];
      if (neg) warnings.push("\"" + m[0].trim() + "\": negative tariff rates are not allowed (0% is the lowest). That part was skipped.");
      rates.push({ s: m.index, e: m.index + m[0].length, rate: parseFloat(m[2]), neg: neg });
    }

    // tariff removal phrases -> rate 0
    var zeroRe = /(remove[sd]?|drop[sp]?|scrap[sp]?|lift[s]?|end[s]?|eliminate[sd]?|cut[s]? to zero|zero)\s+(all\s+)?(the\s+)?tariffs?/g;
    while ((m = zeroRe.exec(text))) rates.push({ s: m.index, e: m.index + m[0].length, rate: 0, zero: true });
    rates.sort(function (a, b) { return a.s - b.s; });

    if (/raise[sd]? .* by \d/.test(text) && !/%/.test(text)) warnings.push("\"Raise by N points\" is not supported by the simple reader; enter the new rate as a percentage.");
    // foreign-imposer zones: "<country> retaliates/imposes ..." up to the next US mention
    var zones = [];
    ms.forEach(function (x, i) {
      if (x.ent.type !== "country" || x.ent.group || !NON_US_VERB.test(text.slice(x.e, x.e + 20))) return;
      var end = text.length;
      for (var k = i + 1; k < ms.length; k++) if (ms[k].ent.type === "imposer") { end = ms[k].s; break; }
      zones.push({ s: x.s, e: end });
    });
    function inZone(pos) { return zones.some(function (z) { return pos >= z.s && pos < z.e; }); }
    if (zones.length) {
      zones.forEach(function (z) {
        warnings.push("\"" + text.slice(z.s, z.e).trim().replace(/[ ,.;]*(and)?$/, "") + "\": only the US as imposer is supported in this version (other imposers arrive in stage 3). Skipped.");
      });
      rates = rates.filter(function (r) { return !inZone(r.s); });
      ms = ms.filter(function (x) { return !inZone(x.s); });
      if (!rates.length) return { lines: [], warnings: warnings, notes: notes };
    }

    if (!rates.length) {
      // relative change ("doubles tariffs on Chinese EVs"): the page computes the rate from today's modelled rate
      var fm = text.match(/\b(doubl\w*|twice|tripl\w*|quadrupl\w*|halv\w*|half)\b/);
      if (fm) {
        var factor = /^doubl|^twice/.test(fm[1]) ? 2 : /^tripl/.test(fm[1]) ? 3 : /^quadrupl/.test(fm[1]) ? 4 : 0.5;
        var tg = [], pr = [], every = false;
        ms.forEach(function (x) {
          if (x.ent.type === "country") tg.push.apply(tg, x.ent.iso); else if (x.ent.type === "everyone") every = true;
          else if (x.ent.type === "sector") { pr.push.apply(pr, x.ent.ch); if (x.ent.note && notes.indexOf(x.ent.note) < 0) notes.push(x.ent.note); }
        });
        warnings.length = 0;
        return { lines: [{ targets: tg.length && !every ? uniq(tg) : "ALL", products: pr.length ? uniq(pr) : "ALL", rate: null, relative: { factor: factor } }], warnings: warnings, notes: notes };
      }
      warnings.push("No tariff rate found. Include a number with %, e.g. \"25% on autos from Mexico\".");
      return { lines: [], warnings: warnings, notes: notes };
    }

    var firstTarget = ms.filter(function (x) { return x.ent.type !== "imposer"; })[0];
    var rateAfter = firstTarget && firstTarget.s < rates[0].s;
    var segs = rates.map(function (r, i) {
      if (rateAfter) return { s: i ? rates[i - 1].e : 0, e: r.e, rate: r.rate, zero: r.zero, neg: r.neg };
      return { s: r.s, e: i < rates.length - 1 ? rates[i + 1].s : text.length, rate: r.rate, zero: r.zero, neg: r.neg };
    });
    // a trailing remainder in rate-after mode (e.g. "... at 10% on steel") joins the last segment
    if (rateAfter) segs[segs.length - 1].e = text.length;

    segs.forEach(function (seg) {
      zones.forEach(function (z) { if (z.s > seg.s && z.s < seg.e) seg.e = z.s; });
    });
    var lines = [];
    segs.forEach(function (seg) {
      if (seg.neg) return;
      var inSeg = ms.filter(function (x) { return x.s >= seg.s && x.e <= seg.e; });
      var segText = text.slice(seg.s, seg.e);
      var exIdx = segText.search(/\b(except|excluding|other than|but not|apart from)\b/);
      var exAt = exIdx >= 0 ? seg.s + exIdx : Infinity;
      var targets = [], exT = [], products = [], exP = [], everyone = false, allGoods = false;
      inSeg.forEach(function (x) {
        var ex = x.s > exAt, e = x.ent;
        if (e.type === "country") (ex ? exT : targets).push.apply(ex ? exT : targets, e.iso);
        else if (e.type === "everyone") everyone = true;
        else if (e.type === "allgoods") allGoods = true;
        else if (e.type === "sector") {
          (ex ? exP : products).push.apply(ex ? exP : products, e.ch);
          if (e.note && notes.indexOf(e.note) < 0) notes.push(e.note);
        }
      });
      var line = {
        targets: targets.length && !everyone ? uniq(targets) : "ALL",
        products: products.length && !allGoods ? uniq(products) : "ALL",
        rate: seg.rate
      };
      if (exT.length) line.exclude_targets = uniq(exT);
      if (exP.length) line.exclude_products = uniq(exP);
      line.text = segText.trim();
      lines.push(line);
    });
    if (!lines.length) warnings.push("Nothing left to simulate after skipping unsupported parts.");
    return { lines: lines, warnings: warnings, notes: notes };
  }

  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  var api = { parse: parse, GROUPS: GROUPS, EU27: EU27 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TES_PARSER = api;
})(this);

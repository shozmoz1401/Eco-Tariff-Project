"""Build compact site data from cached raw pulls (run fetch.py and fetch_extra.py first)."""
import json, os, re, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import RAW, ROOT, YEARS, CHAPTERS, IMPOSERS, keep
from hs_short import SHORT
import current_tariffs as CT

OUT = os.path.join(ROOT, "site", "data")
os.makedirs(OUT, exist_ok=True)
CH = CHAPTERS + ["99"]

# Taiwan is not in World Bank data; Comtrade reports it as "Other Asia, nes" (code 490).
GDP_SUPPLEMENT = {
    "TWN": {2024: (801.529e9, "DGBAS (Taiwan statistics office)"), 2025: (922.454e9, "DGBAS (Taiwan statistics office)")},
}
GDP_SUPPLEMENT_URL = "https://statisticsoftheworld.com/series/NAT.L.GDP.USD.A/taiwan"


def load(name):
    with open(os.path.join(RAW, name)) as f:
        return json.load(f)


def partner_map():
    ref = load("ref_partnerAreas.json")["results"]
    m = {}
    for r in ref:
        code, iso = r["id"], (r.get("PartnerCodeIsoAlpha3") or "").strip()
        if code == 490:
            m[code] = ("TWN", "Taiwan")
            continue
        if r.get("isGroup") or code == 0 or not re.fullmatch(r"[A-Z]{3}", iso) or iso in ("W00",):
            continue
        m[code] = (iso, r["text"])
    return m


def rows(reporter, year, cmd):
    d = load(f"ct_{reporter}_{year}_{cmd}.json")
    return [r for r in (d.get("data") or []) if keep(r)]


def build_year(reporter, year, pmap):
    imports, names, world, unmapped = {}, {}, [0.0] * len(CH), {}
    for i, ch in enumerate(CH):
        for r in rows(reporter, year, ch):
            v = float(r["primaryValue"] or 0)
            pc = r["partnerCode"]
            if pc == 0:
                world[i] = v
                continue
            if pc == reporter:          # re-imports (e.g. China from itself): not foreign exposure
                continue
            if pc not in pmap:
                unmapped[pc] = unmapped.get(pc, 0) + v
                continue
            iso, name = pmap[pc]
            imports.setdefault(iso, [0.0] * len(CH))[i] += v
            names[iso] = name
    total = [r for r in rows(reporter, year, "TOTAL") if r["partnerCode"] == 0][0]["primaryValue"]
    by_partner_total = {}
    for r in rows(reporter, year, "TOTAL"):
        if r["partnerCode"] in pmap:
            by_partner_total[pmap[r["partnerCode"]][0]] = r["primaryValue"]
    # exempt products for the forced-labour 301 line
    fl = {}
    for code in CT.FL_EXEMPT_HS:
        for r in rows(reporter, year, code):
            if r["partnerCode"] in pmap:
                iso = pmap[r["partnerCode"]][0]
                fl.setdefault(iso, {}).setdefault(code[:2], 0.0)
                fl[iso][code[:2]] += float(r["primaryValue"] or 0)
    # round to whole dollars for compactness
    imports = {k: [round(x) for x in v] for k, v in sorted(imports.items())}
    fl = {k: {c: round(x) for c, x in v.items()} for k, v in sorted(fl.items())}
    return dict(imposer="USA", reporter_code=reporter, year=year, chapters=CH, imports=imports, names=names,
                world=[round(x) for x in world], world_total=total, partner_totals=by_partner_total,
                exempt={"fl_exempt": fl}, unmapped_value=sum(unmapped.values()),
                source="UN Comtrade (preview API), US imports by partner and HS chapter, annual",
                source_url="https://comtradeplus.un.org/")


def build_gdp():
    by_year = {}
    for y in YEARS:
        d = load(f"wb_gdp_{y}.json")
        for r in (d[1] if len(d) > 1 and d[1] else []):
            if r["value"] is not None and r["countryiso3code"]:
                by_year.setdefault(y, {})[r["countryiso3code"]] = r["value"]
    out = {}
    for y in YEARS:
        g = {}
        for yy in sorted(by_year):          # fall back to the latest earlier year
            if yy > y:
                continue
            for iso, v in by_year[yy].items():
                g[iso] = {"value": v, "year": yy, "src": "World Bank"}
        for iso, sup in GDP_SUPPLEMENT.items():
            if y in sup:
                g[iso] = {"value": sup[y][0], "year": y, "src": sup[y][1]}
        out[str(y)] = g
    return out, {str(y): len(by_year.get(y, {})) for y in YEARS}


def main():
    pmap = partner_map()
    built = {}
    for iso, code in IMPOSERS.items():
        for y in YEARS:
            d = build_year(code, y, pmap)
            built[y] = d
            with open(os.path.join(OUT, f"{iso.lower()}_{y}.json"), "w") as f:
                json.dump(d, f, separators=(",", ":"))
    gdp, counts = build_gdp()
    with open(os.path.join(OUT, "gdp.json"), "w") as f:
        json.dump(gdp, f, separators=(",", ":"))
    hs = {r["id"]: r["text"].split(" - ", 1)[-1] for r in load("ref_HS.json")["results"] if len(r["id"]) == 2}
    meta = dict(
        built=datetime.date.today().isoformat(), years=YEARS, default_year=max(YEARS),
        chapters={c: {"short": SHORT.get(c, hs.get(c, c)), "name": hs.get(c, "")} for c in CH},
        gdp_country_counts=counts, gdp_supplement_url=GDP_SUPPLEMENT_URL,
        trade_source="UN Comtrade", trade_source_url="https://comtradeplus.un.org/",
        gdp_source="World Bank WDI, GDP (current US$), NY.GDP.MKTP.CD",
        gdp_source_url="https://data.worldbank.org/indicator/NY.GDP.MKTP.CD",
    )
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    cur = dict(as_of=CT.AS_OF, lines=CT.LINES, not_modelled=CT.NOT_MODELLED, checked=CT.SOURCES_CHECKED,
               fl_exempt_products=CT.FL_EXEMPT_HS, groups={"EU27": CT.EU27})
    with open(os.path.join(OUT, "current_us.json"), "w") as f:
        json.dump(cur, f, indent=1)

    # ---- check figures (handoff section 4) ----
    b = lambda x: round(x / 1e9, 1)
    i87 = CH.index("87")
    d24, d25 = built[2024], built[2025]
    checks = [
        ("All goods, all partners, 2024", b(d24["world_total"]), 3356.8),
        ("From Mexico, 2024", b(d24["partner_totals"]["MEX"]), 510.0),
        ("From China, 2024", b(d24["partner_totals"]["CHN"]), 462.6),
        ("From Canada, 2024", b(d24["partner_totals"]["CAN"]), 421.2),
        ("From Germany, 2024", b(d24["partner_totals"]["DEU"]), 163.4),
        ("Vehicles (ch 87), all partners, 2024", b(d24["world"][i87]), 391.5),
        ("Vehicles from Mexico, 2024", b(d24["imports"]["MEX"][i87]), 137.2),
        ("Vehicles, all partners, 2025", b(d25["world"][i87]), 337.9),
    ]
    ok = True
    for name, got, want in checks:
        flag = "OK" if abs(got - want) < 0.051 else "MISMATCH"
        ok &= flag == "OK"
        print(f"{flag:9s} {name:40s} got {got:>8} want {want}")
    for y, d in built.items():
        s = sum(sum(v) for v in d["imports"].values())
        print(f"{y}: sum of country x chapter = {b(s)}bn; world total {b(d['world_total'])}bn; "
              f"chapter world sum {b(sum(d['world']))}bn; unmapped partners {b(d['unmapped_value'])}bn; partners {len(d['imports'])}")
    missing = [p for p in built[max(YEARS)]["imports"] if p not in gdp[str(max(YEARS))]]
    print("GDP rows per year:", counts, "| trade partners without GDP:", missing)
    with open(os.path.join(ROOT, "tests", "check_figures.json"), "w") as f:
        json.dump([dict(name=n, got=g, want=w) for n, g, w in checks], f, indent=1)
    if not ok:
        sys.exit("check figures failed")


if __name__ == "__main__":
    main()

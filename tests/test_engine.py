"""Parity (JS vs Python), hand-worked scenarios, and edge cases. Run: python tests/test_engine.py"""
import json, os, random, subprocess, sys, math
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
os.chdir(ROOT)
from engine import compute
L = lambda f: json.load(open(f))
CUR = L("site/data/current_us.json")["lines"]; GDP = L("site/data/gdp.json")
DATA = {y: L(f"site/data/usa_{y}.json") for y in (2024, 2025)}
EU = L("site/data/current_us.json")["groups"]["EU27"]
fails = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (("  " + detail) if detail else ""))
    if not cond: fails.append(name)
def close(a, b, tol=1e-9):
    if a is None or b is None: return a is b
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))

# ---------------- scenarios ----------------
named = [
 dict(name="India 10% + autos 25% from everyone", year=2025, mode="replace", elasticity=0.76,
      lines=[dict(targets=["IND"], products="ALL", rate=10), dict(targets="ALL", products=["87"], rate=25)]),
 dict(name="25% on Mexican vehicles", year=2025, mode="replace", elasticity=0.76,
      lines=[dict(targets=["MEX"], products=["87"], rate=25)]),
 dict(name="10% on China + Vietnam electronics", year=2025, mode="add", elasticity=2,
      lines=[dict(targets=["CHN", "VNM"], products=["85"], rate=10)]),
 dict(name="Russia 25% (almost no trade)", year=2025, mode="replace", elasticity=0.76,
      lines=[dict(targets=["RUS"], products="ALL", rate=25)]),
 dict(name="0% on Canada (removal)", year=2025, mode="replace", elasticity=0.76,
      lines=[dict(targets=["CAN"], products="ALL", rate=0)]),
 dict(name="Missing GDP (North Korea, Cuba, Syria) + Taiwan", year=2025, mode="replace", elasticity=0.76,
      lines=[dict(targets=["PRK", "CUB", "SYR", "TWN"], products="ALL", rate=20)]),
 dict(name="EU 10% except pharma, steel 50% all except UK", year=2024, mode="add", elasticity=1.0,
      lines=[dict(targets=EU, products="ALL", rate=10, exclude_products=["30"]),
             dict(targets="ALL", products=["72", "73", "76"], rate=50, exclude_targets=["GBR"])]),
 dict(name="Empty scenario", year=2025, mode="replace", elasticity=0.76, lines=[]),
]
rng = random.Random(7)
partners = sorted(DATA[2025]["imports"]); chs = DATA[2025]["chapters"]
rand = []
for i in range(40):
    lines = []
    for _ in range(rng.randint(1, 4)):
        t = "ALL" if rng.random() < 0.3 else rng.sample(partners, rng.randint(1, 6))
        p = "ALL" if rng.random() < 0.4 else rng.sample(chs, rng.randint(1, 5))
        ln = dict(targets=t, products=p, rate=rng.choice([0, 5, 10, 12.5, 25, 60, 145]))
        if rng.random() < 0.2: ln["exclude_products"] = rng.sample(chs, 2)
        if rng.random() < 0.2: ln["exclude_targets"] = rng.sample(partners, 2)
        lines.append(ln)
    rand.append(dict(name=f"random {i}", year=rng.choice([2024, 2025]), mode=rng.choice(["replace", "add"]),
                     elasticity=rng.choice([0, 0.76, 2, 3]), lines=lines))
allsc = named + rand
json.dump(allsc, open("/tmp/scen.json", "w"))
subprocess.run(["node", "tests/run_js.js", "/tmp/scen.json", "/tmp/js_out.json"], check=True)
JS = L("/tmp/js_out.json")

def diff(a, b, path=""):
    if isinstance(a, dict):
        if set(a) != set(b): return f"{path}: keys {sorted(set(a) ^ set(b))[:5]}"
        for k in a:
            d = diff(a[k], b[k], path + "/" + str(k))
            if d: return d
        return None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return None if close(a, b) else f"{path}: py {a} js {b}"
    return None if a == b else f"{path}: py {a!r} js {b!r}"

for s, js in zip(allsc, JS):
    py = compute(DATA[s["year"]], GDP[str(s["year"])], CUR, dict(mode=s["mode"], lines=s["lines"]), s["elasticity"])
    d = diff(json.loads(json.dumps(py)), js)
    if s in named or d: check("parity: " + s["name"], d is None, d or "")
print(f"parity checked on {len(allsc)} scenarios")

# ---------------- hand-worked scenarios (independent arithmetic from the raw arrays) ----------------
d25 = DATA[2025]; i = {c: k for k, c in enumerate(d25["chapters"])}
imp = lambda p, c=None: (sum(d25["imports"][p]) if c is None else d25["imports"][p][i[c]])
g = GDP["2025"]
worked = []
b = lambda x: f"${x/1e9:,.2f}bn"

# 1
r = compute(d25, g, CUR, dict(mode="replace", lines=named[0]["lines"]), 0)
ind_tot, ind87 = imp("IND"), imp("IND", "87")
hit = ind_tot; bill = (ind_tot - ind87) * 0.10 + ind87 * 0.25
check("hand 1: India exports hit", close(r["byCountry"]["IND"]["hit"], hit, 1e-12), b(hit))
check("hand 1: India tariff bill (overlap: autos at 25% not 35%)", close(r["byCountry"]["IND"]["bill"], bill, 1e-12), b(bill))
check("hand 1: India share of GDP", close(r["byCountry"]["IND"]["share_gdp"], hit / g["IND"]["value"]), f"{hit/g['IND']['value']*100:.2f}%")
w87 = sum(d25["imports"][p][i["87"]] for p in d25["imports"])
tot_hit = w87 + (ind_tot - ind87)
check("hand 1: total exports hit", close(r["totals"]["hit"], tot_hit), b(tot_hit))
r10 = compute(d25, g, CUR, dict(mode="replace", lines=[dict(targets=["IND"], products="ALL", rate=10)]), 0)
c73 = r10["byCountry"]["IND"]["chapters"]["73"]
v73 = imp("IND", "73")
check("hand 1b: '10% on India' keeps the 50% Section 232 duty on Indian steel articles",
      close(c73["cur_bill"], v73 * 0.5) and close(c73["sim_bill"], v73 * 0.5 + v73 * 0.10),
      f"today {b(c73['cur_bill'])} -> {b(c73['sim_bill'])}")
worked.append(dict(title="1. Overlapping lines", scenario="US puts 10% on India and 25% on autos from everyone (2025 data)", steps=[
    f"US imports from India: {b(ind_tot)}, of which vehicles (ch. 87) {b(ind87)}.",
    f"Most specific line wins, so Indian vehicles pay 25% and everything else from India pays 10%.",
    f"India's tariff bill = {b(ind_tot-ind87)} × 10% + {b(ind87)} × 25% = {b(bill)}.",
    f"India's GDP {g['IND']['year']}: {b(g['IND']['value'])}, so exposed exports = {b(hit)} ÷ {b(g['IND']['value'])} = {hit/g['IND']['value']*100:.2f}% of GDP.",
    f"Total exports hit = all US vehicle imports {b(w87)} + India's non-vehicle exports {b(ind_tot-ind87)} = {b(tot_hit)}.",
    f"Today vs. scenario: the India line is country-wide, so it replaces today's 10% forced-labour duty but keeps Section 232 tariffs. Indian steel articles (ch. 73, {b(v73)}) keep their 50% ({b(v73*0.5)}) and add the scenario's 10%, giving {b(v73*0.6)}."]))

# 2
r = compute(d25, g, CUR, dict(mode="replace", lines=named[1]["lines"]), 0.76)
mx87 = imp("MEX", "87"); cur_bill = mx87 * 0.76 * 0.25; sim_bill = mx87 * 0.25
c = r["byCountry"]["MEX"]["chapters"]["87"]
check("hand 2: Mexico vehicles hit", close(r["byCountry"]["MEX"]["hit"], mx87), b(mx87))
check("hand 2: today's vehicle duties (25% on 76% of value)", close(c["cur_bill"], cur_bill), b(cur_bill))
check("hand 2: scenario vehicle duties", close(c["sim_bill"], sim_bill), b(sim_bill))
t0, t1 = cur_bill / mx87, sim_bill / mx87
lost = mx87 * ((t1 - t0) / (1 + t0)) * 0.76
check("hand 2: trade lost uses change / (1 + today's rate)", close(r["byCountry"]["MEX"]["lost"], lost), b(lost))
worked.append(dict(title="2. Today vs. scenario", scenario="25% on vehicles from Mexico, replacing today's duties (2025 data)", steps=[
    f"US vehicle imports from Mexico: {b(mx87)}. Exports hit = {b(mx87)}; tariff bill = 25% × that = {b(sim_bill)}.",
    f"Today USMCA vehicles pay 25% on non-US content only, modelled as 76% coverage (≈19% effective): {b(mx87)} × 0.76 × 25% = {b(cur_bill)}.",
    f"Difference = {b(sim_bill)} − {b(cur_bill)} = {b(sim_bill-cur_bill)}.",
    f"Average rate on the flow: today {t0*100:.1f}%, scenario {t1*100:.1f}%. Price-based change = ({t1*100:.1f}% − {t0*100:.1f}%) ÷ (1 + {t0*100:.1f}%) = {(t1-t0)/(1+t0)*100:.2f}%.",
    f"Trade lost at sensitivity 0.76 = {b(mx87)} × {(t1-t0)/(1+t0)*100:.2f}% × 0.76 = {b(lost)}."]))

# 3
r = compute(d25, g, CUR, dict(mode="add", lines=named[2]["lines"]), 0)
H = imp("CHN", "85") + imp("VNM", "85")
wd85 = sum(d25["imports"][p][i["85"]] for p in d25["imports"])
non = wd85 - H
top = sorted(r["gains"], key=lambda k: -r["gains"][k]["total"])[:3]
for k in top:
    want = H * imp(k, "85") / non
    check(f"hand 3: who gains {k}", close(r["gains"][k]["total"], want), b(want))
k0 = top[0]
check("hand 3: gains sum to value hit", close(sum(x["total"] for x in r["gains"].values()), H), b(H))
worked.append(dict(title="3. Who gains", scenario="10% on electronics (ch. 85) from China and Vietnam (2025 data)", steps=[
    f"Value hit = China {b(imp('CHN','85'))} + Vietnam {b(imp('VNM','85'))} = {b(H)}.",
    f"All other suppliers sold the US {b(non)} of chapter 85.",
    f"{d25['names'].get(k0,k0)} sold {b(imp(k0,'85'))}, a {imp(k0,'85')/non*100:.1f}% share of untaxed supply, so its diversion potential = {b(H)} × {imp(k0,'85')/non*100:.1f}% = {b(H*imp(k0,'85')/non)}.",
    "Diversion potentials across all untaxed suppliers add up to the value hit: it splits the hit trade, it does not create more."]))
json.dump(worked, open("site/data/worked_examples.json", "w"), indent=1)

# ---------------- edge cases ----------------
r = compute(d25, g, CUR, dict(mode="replace", lines=named[3]["lines"]), 0.76)
ru = r["byCountry"].get("RUS")
check("edge: Russia small trade handled", ru is not None and ru["hit"] > 0 and ru["share_gdp"] < 0.01,
      f"hit {b(ru['hit'])}, {ru['share_gdp']*100:.4f}% of GDP")
r = compute(d25, g, CUR, dict(mode="replace", lines=named[4]["lines"]), 0.76)
ca = r["byCountry"]["CAN"]
prod_ca = sum(cc["cur_bill"] for ch, cc in ca["chapters"].items() if ch in ("72", "73", "74", "76", "87"))
check("edge: 0% country-wide on Canada -> no exports hit; forced-labour duty removed, 232 kept",
      ca["hit"] == 0 and close(ca["sim_bill"], prod_ca) and ca["cur_bill"] > ca["sim_bill"],
      f"today {b(ca['cur_bill'])} -> {b(ca['sim_bill'])} (Section 232 only); trade change {b(-ca['lost'])} gained")
r0p = compute(d25, g, CUR, dict(mode="replace", lines=[dict(targets=["CAN"], products=["87"], rate=0)]), 0.76)
check("edge: 0% on Canadian vehicles (products named) removes the 232 vehicle duty", r0p["byCountry"]["CAN"]["chapters"]["87"]["sim_bill"] == 0)
r = compute(d25, g, CUR, dict(mode="replace", lines=named[5]["lines"]), 0)
check("edge: missing GDP gives null share, not a crash", all(r["byCountry"][k]["share_gdp"] is None for k in ("PRK", "CUB", "SYR") if k in r["byCountry"]))
check("edge: Taiwan has GDP (DGBAS supplement)", r["byCountry"]["TWN"]["share_gdp"] is not None, f"{r['byCountry']['TWN']['share_gdp']*100:.1f}%")
r = compute(d25, g, CUR, dict(mode="replace", lines=[]), 0.76)
check("edge: empty scenario -> sim equals today", close(r["totals"]["sim_bill"], r["totals"]["cur_bill"]) and r["totals"]["hit"] == 0 and r["totals"]["lost"] == 0)
cur_tot = r["totals"]["cur_bill"]; print(f"INFO today's modelled additional duties on 2025 trade: {b(cur_tot)}; avg {cur_tot/r['totals']['imports']*100:.1f}% of imports")
r = compute(d25, g, CUR, dict(mode="replace", lines=[dict(targets="ALL", products="ALL", rate=1000)]), 3)
check("edge: trade lost capped at imports", r["totals"]["lost"] <= r["totals"]["imports"] * (1 + 1e-12))
# negative rates rejected in both engines
try:
    compute(d25, g, CUR, dict(mode="replace", lines=[dict(targets=["CHN"], products="ALL", rate=-10)]), 0.76); ok = False
except ValueError: ok = True
check("edge: Python engine rejects a negative rate", ok)
js = subprocess.run(["node", "-e", "const E=require('./site/js/engine.js');const fs=require('fs');const d=JSON.parse(fs.readFileSync('site/data/usa_2025.json'));"
     "try{E.compute(d,{},[],{lines:[{targets:['CHN'],products:'ALL',rate:-10}]},0.76);console.log('accepted')}catch(e){console.log('rejected')}"], capture_output=True, text=True).stdout.strip()
check("edge: JS engine rejects a negative rate", js == "rejected", js)
# the reviewer's case: 25% on China is shown as a cut and explained
r = compute(d25, g, CUR, dict(mode="replace", lines=[dict(targets=["CHN"], products="ALL", rate=25)]), 0.76)
cn = r["byCountry"]["CHN"]
print(f"INFO '25% on China': today avg {cn['cur_bill']/cn['imports']*100:.1f}%, scenario {cn['sim_bill']/cn['imports']*100:.1f}%, change {b(cn['sim_bill']-cn['cur_bill'])}")
r = compute(d25, g, CUR, dict(mode="replace", lines=[]), 0)
cn = r["byCountry"]["CHN"]
mfn = 2.7
print(f"INFO China today (model, additional duties): {cn['cur_bill']/cn['imports']*100:.1f}%; + {mfn}% MFN = {cn['cur_bill']/cn['imports']*100+mfn:.1f}% vs CRS 36.5%")
# China if exemptions were not netted (CRS basis: no exemptions, no 232)
import copy
cur_nx = [dict(L, exempt_ref=None) for L in CUR if L.get("scope") == "country"]
rc = compute(d25, g, cur_nx, dict(mode="replace", lines=[]), 0)["byCountry"]["CHN"]
print(f"INFO China on CRS basis (no exemptions netted, no Section 232): {rc['cur_bill']/rc['imports']*100:.1f}% + {mfn} = {rc['cur_bill']/rc['imports']*100+mfn:.1f}%")
json.dump(dict(china_today=cn['cur_bill']/cn['imports'], china_crs_basis=rc['cur_bill']/rc['imports'], total_today=r["totals"]["cur_bill"],
               avg_today=r["totals"]["cur_bill"]/r["totals"]["imports"]), open("site/data/calib.json", "w"))
print("\nFAILURES:", fails if fails else "none")
sys.exit(1 if fails else 0)

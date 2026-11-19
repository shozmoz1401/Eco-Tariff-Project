"""Stage 1 data pipeline: pull US imports by partner x HS chapter (UN Comtrade preview API)
and GDP (World Bank), cache raw responses, then build compact JSON for the site.

Usage:  python pipeline/fetch.py            # fetch (cached) + build
        python pipeline/fetch.py --refresh  # ignore cache
"""
import json, os, sys, time
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
os.makedirs(RAW, exist_ok=True)

COMTRADE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
REF = "https://comtradeapi.un.org/files/v1/app/reference/{}.json"
WB = "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?format=json&date={}&per_page=400"

IMPOSERS = {"USA": 842}          # stage 3 adds more reporters here
YEARS = [2024, 2025]
CHAPTERS = [f"{i:02d}" for i in range(1, 98) if i != 77]   # HS chapter 77 is reserved/unused
REFRESH = "--refresh" in sys.argv


def get_json(url, cache_name, pause=1.1):
    path = os.path.join(RAW, cache_name)
    if os.path.exists(path) and not REFRESH:
        with open(path) as f:
            return json.load(f)
    for attempt in range(5):
        r = requests.get(url, timeout=60)
        if r.status_code == 200:
            data = r.json()
            with open(path, "w") as f:
                json.dump(data, f)
            time.sleep(pause)
            return data
        print("  retry", r.status_code, url)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"failed: {url}")


def keep(row):
    """Drop breakdown rows so nothing is double counted."""
    return row["partner2Code"] == 0 and row["motCode"] == 0 and row["customsCode"] == "C00"


def fetch_comtrade(reporter, year, cmd):
    url = f"{COMTREAD_URL(reporter, year, cmd)}"
    data = get_json(url, f"ct_{reporter}_{year}_{cmd}.json")
    rows = data.get("data") or []
    if len(rows) >= 500:
        raise RuntimeError(f"500-row cap hit for {reporter} {year} {cmd}; split the call")
    return [r for r in rows if keep(r)]


def COMTREAD_URL(reporter, year, cmd):
    return f"{COMTRADE}?reporterCode={reporter}&period={year}&cmdCode={cmd}&flowCode=M"


def main():
    partners = get_json(REF.format("partnerAreas"), "ref_partnerAreas.json", pause=0)
    hs = get_json(REF.format("HS"), "ref_HS.json", pause=0)
    for iso, code in IMPOSERS.items():
        for y in YEARS:
            print("fetching", iso, y)
            fetch_comtrade(code, y, "TOTAL")
            for ch in CHAPTERS:
                fetch_comtrade(code, y, ch)
    for y in YEARS:
        get_json(WB.format(y), f"wb_gdp_{y}.json", pause=0.3)
    print("fetch done")


if __name__ == "__main__":
    main()

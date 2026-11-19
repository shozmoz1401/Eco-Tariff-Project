import re
import sys, asyncio
from playwright.async_api import async_playwright
url = sys.argv[1]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        out = []
        for name, vp in [("desk", dict(width=1280, height=900)), ("phone", dict(width=390, height=844))]:
            pg = await b.new_page(viewport=vp)
            pg.on("console", lambda m, n=name: out.append(f"{n} console {m.type}: {m.text}") if m.type in ("error", "warning") else None)
            pg.on("pageerror", lambda e, n=name: out.append(f"{n} pageerror: {e}"))
            pg.on("response", lambda r, n=name: out.append(f"{n} HTTP {r.status} {r.url}") if r.status >= 400 else None)
            await pg.goto(url, wait_until="networkidle"); await pg.wait_for_timeout(600)
            if name == "desk":
                await pg.fill("#nl", "25% on China"); await pg.click("#nl-form button"); await pg.wait_for_timeout(300)
                out.append("cut notice: " + (await pg.inner_text("#cut-msgs")).replace("\n", " | "))
                # negative rate in the form
                await pg.fill(".rate-in input", "-10"); await pg.wait_for_timeout(200)
                out.append("neg form: " + (await pg.inner_text(".line-note.err")) + " | KPI exports hit still: " + (await pg.inner_text("#kpis .kpi .v")))
                await pg.fill(".rate-in input", "25"); await pg.wait_for_timeout(200)
                out.append("cut scenario gains note: " + (await pg.inner_text("#gain-note"))[:120] + " | rows: " + str(len(await pg.query_selector_all("#gains tbody tr"))))
                await pg.fill("#nl", "60% on China"); await pg.click("#nl-form button"); await pg.wait_for_timeout(300)
                await pg.click("#gain-sort button[data-sort=share]"); await pg.wait_for_timeout(200)
                rows = await pg.eval_on_selector_all("#gains tbody tr", "rs => rs.slice(0,4).map(r => r.innerText.replace(/\\t/g,' / '))")
                out.append("gains by share: " + " || ".join(rows))
                await pg.screenshot(path="/tmp/v2_desk.png", full_page=True)
                await pg.goto(url + "#how-it-works"); await pg.wait_for_timeout(500)
                await pg.screenshot(path="/tmp/v2_how.png", full_page=True)
            else:
                out.append(f"phone scrollWidth={await pg.evaluate('document.documentElement.scrollWidth')}")
                await pg.screenshot(path="/tmp/v2_phone.png", full_page=True)
        print("\n".join(out)); await b.close()
        txt = "\n".join(out)
        checks = [
            ("cut notice shown", lambda t: re.search(r"cut notice: .*tariff cut", t) is not None),
            ("negative rate refused", lambda t: "0% or higher" in t),
            ("cut-only gains note", lambda t: "only lowers" in t),
            ("phone width 390", lambda t: "phone scrollWidth=390" in t),
        ]
        bad = [d for d, ok in checks if not ok(txt)]
        bad += [l for l in out if " pageerror" in l or " console error" in l]
        print("FAILED: " + "; ".join(bad) if bad else "all browser checks passed")
        sys.exit(1 if bad else 0)
asyncio.run(main())

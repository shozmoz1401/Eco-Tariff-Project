import sys, asyncio
from playwright.async_api import async_playwright
url = sys.argv[1]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        errs = []
        for name, vp in [("desk", dict(width=1280, height=900)), ("phone", dict(width=390, height=844))]:
            pg = await b.new_page(viewport=vp, device_scale_factor=1)
            pg.on("console", lambda m: errs.append(f"{name} console {m.type}: {m.text}") if m.type in ("error","warning") else None)
            pg.on("pageerror", lambda e: errs.append(f"{name} pageerror: {e}"))
            await pg.goto(url, wait_until="networkidle")
            await pg.wait_for_timeout(800)
            await pg.screenshot(path=f"/tmp/{name}.png", full_page=True)
            if name == "desk":
                # interaction: run another example, switch mode, click a country row
                await pg.fill("#nl", "60% on China, 25% on Vietnam electronics"); await pg.click("#nl-form button")
                await pg.wait_for_timeout(300)
                await pg.click(".seg button[data-mode=add]"); await pg.wait_for_timeout(300)
                await pg.screenshot(path="/tmp/desk2.png", full_page=True)
                await pg.goto(url + "#how-it-works"); await pg.wait_for_timeout(600)
                await pg.screenshot(path="/tmp/how.png", full_page=True)
                k = await pg.evaluate("document.body.scrollWidth")
            else:
                sw = await pg.evaluate("document.documentElement.scrollWidth")
                errs.append(f"phone scrollWidth={sw}")
        print("\n".join(errs) or "no errors")
        await b.close()
asyncio.run(main())

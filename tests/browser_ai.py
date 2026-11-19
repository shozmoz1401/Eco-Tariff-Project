"""Headless check of the AI wiring with a stand-in for the claude.ai 'sample' capability.
The fake model calls the real engine tools and writes answers from their output (and one that invents a number)."""
import sys, asyncio
from playwright.async_api import async_playwright
url = sys.argv[1]
STUB = r"""
window.__mode = "honest";
window.claude = { use: async (name) => {
  if (name !== "sample") return null;
  await new Promise(r => setTimeout(r, 50));
  return async (msgs, opts) => {
    const first = msgs[0].content, last = msgs[msgs.length - 1].content;
    if (first.startsWith("You convert")) {
      if (/brazil/i.test(last)) return { text: JSON.stringify({ lines: [{ targets: ["BRA"], products: ["09"], rate: 12.5 }], notes: ["Coffee maps to chapter 09."], unsupported: [] }) };
      return { text: JSON.stringify({ lines: [{ targets: ["CHN"], products: "ALL", rate: 25 }], notes: [], unsupported: [] }) };
    }
    const t = opts.tools.find(x => x.name === "run_scenario");
    const out = t.execute({ lines: [{ targets: ["CHN"], products: "ALL", rate: 25 }] });
    if (window.__mode === "liar") return { text: "Exports hit are $777.7bn." };
    return { text: "The engine shows " + out.totals.exports_hit + " of exports hit, and China's average rate goes from " + out.tariff_cuts[0].avg_rate_today + " to " + out.tariff_cuts[0].avg_rate_scenario + "." };
  };
} };
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        out = []
        for name, stub in [("ai", True), ("noai", False)]:
            pg = await b.new_page(viewport=dict(width=1280, height=900))
            pg.on("pageerror", lambda e, n=name: out.append(f"{n} pageerror: {e}"))
            pg.on("console", lambda m, n=name: out.append(f"{n} console {m.type}: {m.text}") if m.type == "error" else None)
            pg.on("response", lambda r, n=name: out.append(f"{n} HTTP {r.status} {r.url}") if r.status >= 400 else None)
            if stub: await pg.add_init_script(STUB)
            await pg.goto(url, wait_until="networkidle"); await pg.wait_for_timeout(700)
            out.append(f"{name} status: " + await pg.inner_text("#ai-status"))
            if stub:
                await pg.fill("#nl", "a 12.5% tariff on Brazilian coffee"); await pg.click("#nl-form button"); await pg.wait_for_timeout(500)
                out.append("ai parse msgs: " + (await pg.inner_text("#parse-msgs")).replace("\n", " | "))
                out.append("lines: " + (await pg.inner_text("#lines")).replace("\n", " "))
                await pg.fill("#chat-in", "What happens with 25% on China?"); await pg.click("#chat-send"); await pg.wait_for_timeout(500)
                out.append("chat honest: " + (await pg.inner_text("#chat-log")).replace("\n", " | ")[-260:])
                await pg.evaluate("window.__mode = 'liar'")
                await pg.fill("#chat-in", "And how big is it?"); await pg.click("#chat-send"); await pg.wait_for_timeout(500)
                out.append("chat liar: " + (await pg.inner_text("#chat-log .bubble.blocked")).replace("\n", " | ")[:200])
                await pg.screenshot(path="/tmp/ai_desk.png", full_page=True)
            else:
                out.append("noai chat: " + await pg.inner_text("#chat-log"))
                out.append("noai toggle disabled: " + str(await pg.is_disabled("#ai-parse")))
        pg = await b.new_page(viewport=dict(width=390, height=844)); await pg.add_init_script(STUB)
        await pg.goto(url, wait_until="networkidle"); await pg.wait_for_timeout(500)
        out.append(f"phone scrollWidth={await pg.evaluate('document.documentElement.scrollWidth')}")
        print("\n".join(out)); await b.close()
asyncio.run(main())

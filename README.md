# Tariff Exposure Simulator — stage 1

Live page: https://claude.ai/artifact/RbKqMPWoYBnZSnbwfttPkZ

- `pipeline/fetch.py`, `fetch_extra.py` — pull UN Comtrade (US imports by partner x HS chapter, 2024-25) and World Bank GDP into `data/raw/` (cached).
- `pipeline/build.py` — builds `site/data/*.json` and asserts the handoff check figures.
- `pipeline/current_tariffs.py` — hand-maintained US tariff table (dated, sourced).
- `pipeline/engine.py` + `site/js/engine.js` — same engine twice; spec in `ENGINE_SPEC.md`.
- `tests/test_engine.py` — JS/Python parity on 48 scenarios, 3 hand-worked scenarios, edge cases. `node tests/parser_test.js` for the parser.
- `site/` — the static site (open `index.html` via any static server).

Rebuild: `python pipeline/fetch.py && python pipeline/fetch_extra.py && python pipeline/build.py && python tests/test_engine.py`

## Stage 1.1 (review fixes, 18 Nov 2026)
1. Replace mode: a country-wide line replaces only country-wide layers; Section 232 product tariffs stay. A line naming products replaces everything on them. Tariff-cut notice added.
2. China 301 average raised from 16.3 to 21.3 points (derived from CRS IF12990); model now 34.2% additional, ~36.9% with MFN vs CRS 36.5%.
3. Negative rates rejected in both engines, the form and the parser.
4. Trade lost uses (t1 − t0) / (1 + t0).
5. Overall check now names and links the WTO figure.
6. Every tariff row has a `verified` field; UNVERIFIED rows flagged.
7. favicon 404 removed.
8. Who gains: share of the supplier's current US exports, with a rank toggle.
Browser check: `python tests/browser_check.py http://localhost:8765/index.html` (serve `site/` first).

## Stage 2: AI scenario reader and analyst (18 Nov 2026)
- `site/js/ai.js`: one provider interface with three routes: the claude.ai artifact "sample" capability (no key, used on the published page), an HTTP proxy (`worker/`), or off (rule-based reader only).
- The AI never produces a number: the analyst calls engine tools (`run_scenario`, `country_detail`, `compare_scenarios`, `find_codes`, `current_rate`), and `checkNumbers()` blocks any answer containing a figure the engine did not return (one retry, then withheld). AI-parsed rates must come from the user's text or from `current_rate`.
- Spend: 20 AI calls per browser per hour; the Worker adds per-IP and global rate limits; set a monthly limit on the API key.
- `worker/`: Cloudflare Worker proxy (Anthropic or any OpenAI-compatible endpoint, chosen in `callUpstream`). Not deployed; see `worker/DEPLOY.md`.
- Tests: `node tests/test_ai.js` (number check, tools, analyst loop with a scripted fake model, AI-parser validation), `node worker/test.mjs`, `python tests/browser_ai.py http://localhost:8766/index.html`, `node tests/cost_estimate.js`.

## Stage 2 review fixes (18 Nov 2026)
1. Number check rebuilt (`checkNumbers` in `site/js/ai.js`): allowed figures come only from tool results and the user's words (not the system prompt); money must match money and percent must match percent; signs and direction words must agree with the engine; figures written in words and multiples or fractions are blocked; small counts only pass as ranks or counts; a figure the engine tied to one country cannot sit next to another. Every answer lists the engine figures it used and their fields. The review's failing examples are tests in `tests/test_ai.js`.
2. Worker locked down: prompts and tool definitions live in `worker/src/spec.generated.js` (built by `node worker/build_spec.cjs` from `ai.js`; tests fail if stale). The page sends only task, question, scenario, recent history and tool turns; every other shape is rejected.
3. AI on claude.ai needs a signed-in Claude viewer; others get AI off. Not tested signed-out (link is private; Cloudflare blocks headless browsers).
4. Model prices confirmed on Anthropic's official pricing page.
5. `site/src` copies removed; How it works links to GitHub.
6. "Who gains" is hidden when a scenario only cuts tariffs and flagged when it mixes cuts and increases.

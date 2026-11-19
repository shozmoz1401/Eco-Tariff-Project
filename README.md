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

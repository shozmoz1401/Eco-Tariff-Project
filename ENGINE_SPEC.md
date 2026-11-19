# Engine spec (v2, 18 Nov 2026) — one spec, two implementations

`site/js/engine.js` (browser) and `pipeline/engine.py` (pipeline + tests) implement exactly this.
`tests/parity.py` runs both on the same scenarios and requires identical output.

## Inputs
- `data`: imports of one imposer for one year.
  `chapters` (list of HS2 codes), `imports[iso3][i]` = imports from partner in chapter i (USD),
  `exempt[ref][iso3][chapter]` = value of listed exempt products inside that chapter (USD).
- `gdp[iso3] = {value, year}` (may be missing).
- `current`: list of lines describing tariffs in force (each has a `layer`).
- `scenario`: `{mode: "replace" | "add", lines: [...]}`.
- `elasticity`: trade sensitivity (number, user-set).

## A line
`{targets: "ALL" | [iso3], products: "ALL" | [hs2], exclude_targets?, exclude_products?, rate (%), coverage?, exempt_ref?, scope?}`

- **Rates must be finite and ≥ 0.** Both engines reject anything else (JS throws `Error`, Python raises `ValueError`).
- Current-tariff lines carry `scope`: `"product"` for Section 232 product tariffs, `"country"` for country-wide layers.

- **Covers** flow (partner p, chapter c) if p is in targets (or ALL) and not excluded, and c is in products (or ALL) and not excluded.
- **Covered value** = (imports(p,c) − exempt(p,c)) × coverage(p), floored at 0. `coverage` is a number or a per-country map (default 1). Scenario lines never use coverage or exempt_ref.
- **Overlap rule (one rule everywhere): the most specific line wins.** Specificity = 2 if the line names products + 1 if it names targets. Ties go to the line listed later. So "25% on autos from everyone" beats "10% on India" for Indian autos, which matches how US Section 232 product tariffs take precedence over country-wide tariffs.

## Scenario outputs (scenario lines only)
For each flow whose winning line has rate > 0:
- exports hit = covered value
- tariff bill = exports hit × rate / 100
- share of GDP = country's exports hit ÷ its GDP (null if GDP missing)

## Current vs simulated
- Current lines are grouped into **layers** (e.g. Section 232, Section 301 forced labor, China legacy 301). Within a layer the most-specific rule picks one line; **layers add up**, because those US measures stack in law.
- Current bill(p,c) = Σ over layers of covered value × rate. Current exports hit = largest covered value among layers with rate > 0.
- Simulated: if a scenario line covers the flow:
  - `replace` (default), line names no products (country-wide): the scenario rate replaces today's **country-wide** layers; Section 232 **product** tariffs stay. Bill = product-layer bill + imports × rate.
  - `replace`, line names products: the scenario rate replaces everything on those products (bill = imports × rate).
  - `add`: the scenario rate is added on top of today's duties.
  - Simulated exports hit = imports if the scenario rate > 0; otherwise what remains hit by product layers (replace, country-wide), nothing (replace, products named), or today's hit (add).
  Otherwise simulated = current.
- Difference = simulated − current.

## Trade lost (optional, an assumption)
Per flow, with t₀ = current bill ÷ imports and t₁ = simulated bill ÷ imports (average rates as decimals):
Δ = (t₁ − t₀) ÷ (1 + t₀), the proportional change in the tariff-inclusive price factor (1 + t), which is what the cited elasticity is defined on.
Trade lost = imports × Δ × elasticity, capped at ±imports. Negative means trade gained (a tariff cut).

## Who gains (frictionless benchmark)
For each chapter c: H_c = scenario exports hit in c. Non-target suppliers N_c = partners with imports in c whose winning scenario line is absent or 0%.
Diversion potential of supplier j = Σ_c H_c × imports(j,c) ÷ Σ_{k∈N_c} imports(k,c).
Also reported: diversion potential ÷ the supplier's current exports to the imposer (`share_of_us_exports`), so small suppliers with a large opening stand out.
i.e. if all the hit trade moved to untaxed suppliers in proportion to their current market share. A ranking aid, not a forecast.

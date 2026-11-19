"""Tariff Exposure Simulator — engine (Python). Mirrors site/js/engine.js; see ENGINE_SPEC.md."""


def covers(line, p, c):
    if line["targets"] != "ALL" and p not in line["targets"]:
        return False
    if p in (line.get("exclude_targets") or []):
        return False
    if line["products"] != "ALL" and c not in line["products"]:
        return False
    if c in (line.get("exclude_products") or []):
        return False
    return True


def specificity(line):
    return (2 if line["products"] != "ALL" else 0) + (1 if line["targets"] != "ALL" else 0)


def winner(lines, p, c):
    """Most specific line wins; ties go to the later line."""
    best, best_s = None, -1
    for L in lines:
        if not covers(L, p, c):
            continue
        s = specificity(L)
        if s >= best_s:
            best, best_s = L, s
    return best


def covered_value(line, data, p, c, v):
    x = v
    ref = line.get("exempt_ref")
    if ref and data.get("exempt", {}).get(ref):
        e = data["exempt"][ref].get(p)
        if e and e.get(c):
            x -= e[c]
    cov = line.get("coverage")
    if cov is not None:
        if isinstance(cov, (int, float)):
            x *= cov
        elif p in cov:
            x *= cov[p]
    return x if x > 0 else 0


def group_layers(current):
    order, m = [], {}
    for L in current:
        k = L.get("layer") or "default"
        if k not in m:
            m[k] = []
            order.append(k)
        m[k].append(L)
    return [m[k] for k in order]


def _rate_pos(L):
    return L is not None and L["rate"] > 0


def validate_lines(lines):
    """Rates must be finite and >= 0. Raises ValueError on anything else."""
    for i, L in enumerate(lines):
        r = L.get("rate")
        if isinstance(r, bool) or not isinstance(r, (int, float)) or r != r or r in (float("inf"), float("-inf")) or r < 0:
            raise ValueError(f"Invalid rate on line {i + 1}: rates must be 0% or higher.")


def compute(data, gdp, current, scenario, elasticity=0.0, exclude_from_gains=None):
    mode = (scenario or {}).get("mode") or "replace"
    s_lines = (scenario or {}).get("lines") or []
    validate_lines(s_lines)
    layers = group_layers(current or [])
    chapters = data["chapters"]
    partners = sorted(data["imports"].keys())
    eps = elasticity or 0
    keys = ["hit", "bill", "cur_hit", "cur_bill", "sim_hit", "sim_bill", "lost", "imports"]

    by_country = {}
    by_chapter = {c: {"hit": 0, "bill": 0, "cur_bill": 0, "sim_bill": 0} for c in chapters}
    tot = {k: 0 for k in keys}
    H = {c: 0 for c in chapters}
    non_target_total = {c: 0 for c in chapters}
    is_target = {}

    for p in partners:
        row = data["imports"][p]
        rec = {k: 0 for k in keys}
        rec["chapters"] = {}
        for ci, c in enumerate(chapters):
            v = row[ci] or 0
            if v <= 0:
                continue
            rec["imports"] += v
            sw = winner(s_lines, p, c)
            hit = bill = 0
            if _rate_pos(sw):
                hit = v
                bill = v * sw["rate"] / 100
            is_target[(p, c)] = _rate_pos(sw)
            if not is_target[(p, c)]:
                non_target_total[c] += v
            H[c] += hit
            cur_bill = cur_hit = prod_bill = prod_hit = 0
            for layer in layers:
                w = winner(layer, p, c)
                if not _rate_pos(w):
                    continue
                cv = covered_value(w, data, p, c, v)
                cur_bill += cv * w["rate"] / 100
                if cv > cur_hit:
                    cur_hit = cv
                if w.get("scope") == "product":
                    prod_bill += cv * w["rate"] / 100
                    if cv > prod_hit:
                        prod_hit = cv
            sim_bill, sim_hit = cur_bill, cur_hit
            if sw is not None:
                if mode == "add":
                    sim_bill = cur_bill + v * sw["rate"] / 100
                    sim_hit = v if sw["rate"] > 0 else cur_hit
                elif sw["products"] == "ALL":
                    # country-wide line: replaces country-wide layers, keeps Section 232 product tariffs
                    sim_bill = prod_bill + v * sw["rate"] / 100
                    sim_hit = v if sw["rate"] > 0 else prod_hit
                else:
                    # product line: replaces everything on those products
                    sim_bill = v * sw["rate"] / 100
                    sim_hit = v if sw["rate"] > 0 else 0
            # price-based change: tariff change / (1 + today's average rate on the flow)
            dt = ((sim_bill - cur_bill) / v) / (1 + cur_bill / v)
            lost = v * dt * eps
            lost = min(lost, v)
            lost = max(lost, -v)
            rec["hit"] += hit; rec["bill"] += bill; rec["cur_hit"] += cur_hit; rec["cur_bill"] += cur_bill
            rec["sim_hit"] += sim_hit; rec["sim_bill"] += sim_bill; rec["lost"] += lost
            if hit > 0 or cur_bill > 0 or sim_bill > 0:
                rec["chapters"][c] = {"imports": v, "hit": hit, "bill": bill, "cur_bill": cur_bill,
                                      "sim_bill": sim_bill, "rate": sw["rate"] if sw else None}
            bc = by_chapter[c]
            bc["hit"] += hit; bc["bill"] += bill; bc["cur_bill"] += cur_bill; bc["sim_bill"] += sim_bill
        g = (gdp or {}).get(p)
        gv = g["value"] if g else None
        rec["gdp"] = gv
        rec["gdp_year"] = g["year"] if g else None
        ok = g is not None and gv and gv > 0
        rec["share_gdp"] = rec["hit"] / gv if ok else None
        rec["cur_share_gdp"] = rec["cur_hit"] / gv if ok else None
        rec["sim_share_gdp"] = rec["sim_hit"] / gv if ok else None
        by_country[p] = rec
        for k in keys:
            tot[k] += rec[k]

    gains = {}
    for j in partners:
        if exclude_from_gains and j in exclude_from_gains:
            continue
        r = data["imports"][j]
        gsum, parts = 0, {}
        for cj, ch in enumerate(chapters):
            vj = r[cj] or 0
            if vj <= 0 or H[ch] <= 0 or is_target.get((j, ch)) or non_target_total[ch] <= 0:
                continue
            gp = H[ch] * vj / non_target_total[ch]
            gsum += gp
            parts[ch] = gp
        if gsum > 0:
            imp_j = by_country[j]["imports"]
            gains[j] = {"total": gsum, "chapters": parts, "share_of_us_exports": gsum / imp_j if imp_j > 0 else None}

    return {"byCountry": by_country, "byChapter": by_chapter, "totals": tot, "gains": gains, "mode": mode}

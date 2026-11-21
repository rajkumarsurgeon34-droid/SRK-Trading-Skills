#!/usr/bin/env python3
"""NSE option chain analyzer: PCR, max pain, OI walls, OI build-up, ATM straddle.

Input (one of):
  --nse-json FILE  : JSON saved from NSE option-chain API
                     (records.data[] with strikePrice, CE{...}, PE{...}) — use nse-data-fetcher
  --csv FILE       : columns strike,ce_oi,ce_chg_oi,ce_ltp,ce_chg,ce_iv,pe_oi,pe_chg_oi,pe_ltp,pe_chg,pe_iv
                     (ce_chg/pe_chg = premium change; iv/chg columns optional)

Examples:
  python3 option_chain.py --csv nifty_chain.csv --spot 26050 --symbol NIFTY
  python3 option_chain.py --nse-json nifty.json --expiry 25-Nov-2026
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import safe_div  # noqa: E402


def _f(v, default=0.0):
    try:
        return float(v) if v not in (None, "", "-") else default
    except (TypeError, ValueError):
        return default


def load_csv(path):
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            r = {k.strip().lower(): v for k, v in r.items() if k}
            rows.append({
                "strike": _f(r.get("strike")),
                "ce_oi": _f(r.get("ce_oi")), "ce_chg_oi": _f(r.get("ce_chg_oi")),
                "ce_ltp": _f(r.get("ce_ltp")), "ce_chg": _f(r.get("ce_chg")), "ce_iv": _f(r.get("ce_iv")),
                "pe_oi": _f(r.get("pe_oi")), "pe_chg_oi": _f(r.get("pe_chg_oi")),
                "pe_ltp": _f(r.get("pe_ltp")), "pe_chg": _f(r.get("pe_chg")), "pe_iv": _f(r.get("pe_iv")),
            })
    return sorted((r for r in rows if r["strike"] > 0), key=lambda r: r["strike"])


def load_nse_json(path, expiry=None):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    recs = data.get("records", data)
    items = recs.get("data", [])
    spot = recs.get("underlyingValue")
    expiries = recs.get("expiryDates") or sorted({i.get("expiryDate") for i in items if i.get("expiryDate")})
    use = expiry or (expiries[0] if expiries else None)
    rows = []
    for it in items:
        if use and it.get("expiryDate") and it["expiryDate"] != use:
            continue
        ce, pe = it.get("CE") or {}, it.get("PE") or {}
        spot = spot or ce.get("underlyingValue") or pe.get("underlyingValue")
        rows.append({
            "strike": _f(it.get("strikePrice")),
            "ce_oi": _f(ce.get("openInterest")), "ce_chg_oi": _f(ce.get("changeinOpenInterest")),
            "ce_ltp": _f(ce.get("lastPrice")), "ce_chg": _f(ce.get("change")), "ce_iv": _f(ce.get("impliedVolatility")),
            "pe_oi": _f(pe.get("openInterest")), "pe_chg_oi": _f(pe.get("changeinOpenInterest")),
            "pe_ltp": _f(pe.get("lastPrice")), "pe_chg": _f(pe.get("change")), "pe_iv": _f(pe.get("impliedVolatility")),
        })
    return sorted(rows, key=lambda r: r["strike"]), (float(spot) if spot else None), use


def max_pain(rows):
    best, best_loss = None, None
    for s in rows:
        k = s["strike"]
        loss = sum(max(k - r["strike"], 0) * r["ce_oi"] + max(r["strike"] - k, 0) * r["pe_oi"] for r in rows)
        if best_loss is None or loss < best_loss:
            best, best_loss = k, loss
    return best


def buildup(price_chg, oi_chg):
    if oi_chg > 0 and price_chg > 0:
        return "long_buildup"
    if oi_chg > 0 and price_chg < 0:
        return "short_buildup"
    if oi_chg < 0 and price_chg > 0:
        return "short_covering"
    if oi_chg < 0 and price_chg < 0:
        return "long_unwinding"
    return "neutral"


def analyze(rows, spot, window=10, symbol=None, expiry=None):
    if not rows:
        raise ValueError("Option chain is empty")
    if spot is None:
        # estimate spot from put-call parity at min |CE-PE|
        r = min(rows, key=lambda r: abs(r["ce_ltp"] - r["pe_ltp"]) if r["ce_ltp"] and r["pe_ltp"] else 1e18)
        spot = r["strike"] + r["ce_ltp"] - r["pe_ltp"]
    atm = min(rows, key=lambda r: abs(r["strike"] - spot))
    i_atm = rows.index(atm)
    near = rows[max(0, i_atm - window): i_atm + window + 1]

    tot_ce = sum(r["ce_oi"] for r in rows)
    tot_pe = sum(r["pe_oi"] for r in rows)
    chg_ce = sum(r["ce_chg_oi"] for r in rows)
    chg_pe = sum(r["pe_chg_oi"] for r in rows)
    pcr = safe_div(tot_pe, tot_ce)
    pcr_chg = safe_div(chg_pe, chg_ce) if chg_ce > 0 else None

    above = [r for r in near if r["strike"] >= spot]
    below = [r for r in near if r["strike"] <= spot]
    res = sorted(above, key=lambda r: r["ce_oi"], reverse=True)[:3]
    sup = sorted(below, key=lambda r: r["pe_oi"], reverse=True)[:3]
    res_add = max(above, key=lambda r: r["ce_chg_oi"], default=None)
    sup_add = max(below, key=lambda r: r["pe_chg_oi"], default=None)

    straddle = atm["ce_ltp"] + atm["pe_ltp"]
    mp = max_pain(rows)

    # build-up near ATM (writers' view)
    ce_build = {}
    pe_build = {}
    for r in near:
        ce_build[buildup(r["ce_chg"], r["ce_chg_oi"])] = ce_build.get(buildup(r["ce_chg"], r["ce_chg_oi"]), 0) + 1
        pe_build[buildup(r["pe_chg"], r["pe_chg_oi"])] = pe_build.get(buildup(r["pe_chg"], r["pe_chg_oi"]), 0) + 1

    # bias score: positive = bullish
    score = 0
    reasons = []
    if pcr > 1.2:
        score += 1; reasons.append(f"PCR {pcr:.2f} > 1.2 (put writers active → supportive; >1.6 can be overcrowded)")
    elif pcr < 0.8:
        score -= 1; reasons.append(f"PCR {pcr:.2f} < 0.8 (call writers dominant → capped)")
    if chg_pe > chg_ce * 1.2:
        score += 1; reasons.append("Fresh put OI adding faster than call OI today")
    elif chg_ce > chg_pe * 1.2:
        score -= 1; reasons.append("Fresh call OI adding faster than put OI today")
    if mp and spot:
        d = (mp - spot) / spot * 100
        if abs(d) > 0.3:
            reasons.append(f"Max pain {mp:g} is {d:+.2f}% from spot (pull matters most on expiry day)")
    bias = "bullish" if score >= 2 else "mildly_bullish" if score == 1 else "bearish" if score <= -2 else "mildly_bearish" if score == -1 else "neutral"

    ivs = [(r["ce_iv"], r["pe_iv"]) for r in [atm] if r["ce_iv"] or r["pe_iv"]]
    return {
        "symbol": symbol,
        "expiry": expiry,
        "spot": round(spot, 2),
        "atm_strike": atm["strike"],
        "pcr_oi": round(pcr, 3),
        "pcr_change_oi": round(pcr_chg, 3) if pcr_chg is not None else None,
        "total_ce_oi": tot_ce,
        "total_pe_oi": tot_pe,
        "max_pain": mp,
        "resistance_ce_oi": [{"strike": r["strike"], "oi": r["ce_oi"], "chg_oi": r["ce_chg_oi"]} for r in res],
        "support_pe_oi": [{"strike": r["strike"], "oi": r["pe_oi"], "chg_oi": r["pe_chg_oi"]} for r in sup],
        "fresh_resistance": res_add["strike"] if res_add and res_add["ce_chg_oi"] > 0 else None,
        "fresh_support": sup_add["strike"] if sup_add and sup_add["pe_chg_oi"] > 0 else None,
        "atm_straddle": round(straddle, 2),
        "expected_range_to_expiry": [round(spot - straddle, 2), round(spot + straddle, 2)],
        "atm_iv": {"ce": ivs[0][0], "pe": ivs[0][1]} if ivs else None,
        "ce_buildup_near_atm": ce_build,
        "pe_buildup_near_atm": pe_build,
        "bias": bias,
        "bias_score": score,
        "reasons": reasons,
    }


def to_markdown(r):
    f = lambda xs: ", ".join(f"{x['strike']:g} ({x['oi']:,.0f})" for x in xs)
    return "\n".join([
        f"## Option chain — {r['symbol'] or ''} {r['expiry'] or ''}".rstrip(),
        f"- Spot **{r['spot']}**, ATM {r['atm_strike']:g}",
        f"- PCR (OI): **{r['pcr_oi']}**" + (f", PCR (change in OI): {r['pcr_change_oi']}" if r["pcr_change_oi"] is not None else ""),
        f"- Max pain: **{r['max_pain']:g}**",
        f"- Resistance (call OI walls): {f(r['resistance_ce_oi'])}; fresh writing at {r['fresh_resistance']}",
        f"- Support (put OI walls): {f(r['support_pe_oi'])}; fresh writing at {r['fresh_support']}",
        f"- ATM straddle {r['atm_straddle']} → market-implied range to expiry {r['expected_range_to_expiry'][0]} – {r['expected_range_to_expiry'][1]}",
        f"- Bias: **{r['bias']}** (score {r['bias_score']})",
        *[f"  - {x}" for x in r["reasons"]],
        "",
        "_OI shows where option writers are positioned, not a guaranteed level. Combine with price action._",
    ])


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv")
    src.add_argument("--nse-json")
    p.add_argument("--spot", type=float)
    p.add_argument("--symbol")
    p.add_argument("--expiry", help="Expiry string as in NSE JSON, e.g. 25-Nov-2026")
    p.add_argument("--window", type=int, default=10, help="Strikes each side of ATM to scan for walls")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    if a.csv:
        rows, spot, exp = load_csv(a.csv), a.spot, a.expiry
    else:
        rows, spot, exp = load_nse_json(a.nse_json, a.expiry)
        spot = a.spot or spot
    r = analyze(rows, spot, a.window, a.symbol, exp)
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

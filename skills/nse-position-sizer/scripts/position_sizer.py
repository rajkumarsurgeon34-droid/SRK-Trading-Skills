#!/usr/bin/env python3
"""Risk-based position sizing for Indian markets (NSE/BSE).

Modes:
  option-buy   : lots of an index/stock option given premium entry and premium stop
  futures      : lots of a future given entry and stop (index points)
  option-sell  : lots of a short option capped by margin per lot AND risk to stop
  equity       : shares of a cash-market stock (intraday or delivery)

Risk per trade includes estimated round-trip charges, so the rupee risk is real.

Examples:
  python3 position_sizer.py option-buy --capital 200000 --risk-pct 1 --symbol NIFTY --entry 110 --stop 85
  python3 position_sizer.py futures --capital 500000 --risk-pct 1 --symbol BANKNIFTY --entry 56200 --stop 56020 --margin-per-lot 120000
  python3 position_sizer.py option-sell --capital 500000 --risk-pct 1 --symbol NIFTY --entry 60 --stop 120 --margin-per-lot 105000
  python3 position_sizer.py equity --capital 300000 --risk-pct 0.5 --entry 1450 --stop 1432 --intraday --leverage 5
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import fmt_inr, load_config, lot_size, round_trip_charges  # noqa: E402


def size_derivative(mode, capital, risk_pct, lot, entry, stop, margin_per_lot=None,
                    max_capital_pct=100.0, config=None):
    cfg = config or load_config()
    if mode == "option-buy" and stop >= entry:
        raise ValueError("For option-buy the stop premium must be below entry")
    if mode == "option-sell" and stop <= entry:
        raise ValueError("For option-sell the stop premium must be above entry (short)")
    if entry == stop:
        raise ValueError("entry and stop cannot be equal")

    segment = "futures" if mode == "futures" else "options"
    risk_budget = capital * risk_pct / 100
    pts = abs(entry - stop)
    # charges for one lot hitting the stop
    if mode == "option-sell":
        ch1 = round_trip_charges(segment, stop, entry, lot, cfg).total
    else:
        ch1 = round_trip_charges(segment, min(entry, stop), max(entry, stop), lot, cfg).total
    risk_per_lot = pts * lot + ch1
    lots_by_risk = math.floor(risk_budget / risk_per_lot) if risk_per_lot > 0 else 0

    limits = {"risk": lots_by_risk}
    cap_budget = capital * max_capital_pct / 100
    if mode == "option-buy":
        limits["capital"] = math.floor(cap_budget / (entry * lot))
    if margin_per_lot:
        limits["margin"] = math.floor(cap_budget / margin_per_lot)
    elif mode in ("futures", "option-sell"):
        limits["margin"] = None  # unknown — warn
    usable = [v for v in limits.values() if v is not None]
    lots = max(0, min(usable)) if usable else 0
    binding = min((k for k, v in limits.items() if v is not None), key=lambda k: limits[k])

    warnings = []
    if mode in ("futures", "option-sell") and not margin_per_lot:
        warnings.append("Margin per lot not given — check your broker's SPAN+exposure margin before trading.")
    if lots == 0:
        warnings.append("Even 1 lot exceeds your risk budget. Tighten the stop, raise risk %, or skip the trade.")
    if mode == "option-sell":
        warnings.append("Short options have gap risk beyond your stop; consider a hedge (spread).")

    return {
        "mode": mode,
        "capital": capital,
        "risk_pct": risk_pct,
        "risk_budget": round(risk_budget, 2),
        "lot_size": lot,
        "entry": entry,
        "stop": stop,
        "stop_points": round(pts, 2),
        "charges_per_lot_at_stop": round(ch1, 2),
        "risk_per_lot": round(risk_per_lot, 2),
        "limits_lots": limits,
        "binding_limit": binding,
        "lots": lots,
        "quantity": lots * lot,
        "total_risk": round(lots * risk_per_lot, 2),
        "total_risk_pct": round(lots * risk_per_lot / capital * 100, 2),
        "premium_outlay": round(entry * lots * lot, 2) if mode == "option-buy" else None,
        "margin_required": round(margin_per_lot * lots, 2) if margin_per_lot else None,
        "warnings": warnings,
    }


def size_equity(capital, risk_pct, entry, stop, intraday=False, leverage=1.0,
                max_position_pct=25.0, config=None):
    cfg = config or load_config()
    if stop >= entry:
        raise ValueError("stop must be below entry for a long equity trade")
    seg = "equity_intraday" if intraday else "equity_delivery"
    risk_budget = capital * risk_pct / 100
    per_share = entry - stop
    shares = math.floor(risk_budget / per_share)
    # adjust for charges (iterate down)
    while shares > 0 and shares * per_share + round_trip_charges(seg, stop, entry, shares, cfg).total > risk_budget:
        shares -= 1
    buying_power = capital * (leverage if intraday else 1.0) * max_position_pct / 100
    by_cap = math.floor(buying_power / entry)
    final = max(0, min(shares, by_cap))
    ch = round_trip_charges(seg, stop, entry, final, cfg).total if final else 0.0
    return {
        "mode": "equity",
        "segment": seg,
        "capital": capital,
        "risk_budget": round(risk_budget, 2),
        "entry": entry,
        "stop": stop,
        "shares_by_risk": shares,
        "shares_by_position_cap": by_cap,
        "binding_limit": "risk" if shares <= by_cap else "position_cap",
        "shares": final,
        "position_value": round(final * entry, 2),
        "total_risk_incl_charges": round(final * per_share + ch, 2),
        "warnings": [] if final else ["Position size is zero with these inputs."],
    }


def to_markdown(r):
    if r["mode"] == "equity":
        return "\n".join([
            f"## Equity position size ({r['segment']})",
            f"- Shares: **{r['shares']}** (risk limit {r['shares_by_risk']}, position cap {r['shares_by_position_cap']})",
            f"- Position value: {fmt_inr(r['position_value'])}",
            f"- Risk incl. charges: {fmt_inr(r['total_risk_incl_charges'])} of budget {fmt_inr(r['risk_budget'])}",
            *[f"- ⚠️ {w}" for w in r["warnings"]],
        ])
    lines = [
        f"## {r['mode']} — {r['lots']} lot(s) = {r['quantity']} qty",
        f"- Risk budget: {fmt_inr(r['risk_budget'])} ({r['risk_pct']}% of {fmt_inr(r['capital'])})",
        f"- Stop distance: {r['stop_points']} pts × lot {r['lot_size']} + charges {fmt_inr(r['charges_per_lot_at_stop'])} = {fmt_inr(r['risk_per_lot'])}/lot",
        f"- Limits (lots): {r['limits_lots']} → binding: **{r['binding_limit']}**",
        f"- Total risk if stopped: **{fmt_inr(r['total_risk'])}** ({r['total_risk_pct']}%)",
    ]
    if r["premium_outlay"] is not None:
        lines.append(f"- Premium outlay: {fmt_inr(r['premium_outlay'])}")
    if r["margin_required"] is not None:
        lines.append(f"- Margin required: {fmt_inr(r['margin_required'])}")
    lines += [f"- ⚠️ {w}" for w in r["warnings"]]
    return "\n".join(lines)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="mode", required=True)
    for m in ("option-buy", "futures", "option-sell"):
        s = sub.add_parser(m)
        s.add_argument("--capital", type=float, required=True)
        s.add_argument("--risk-pct", type=float, default=1.0)
        s.add_argument("--symbol")
        s.add_argument("--lot-size", type=int)
        s.add_argument("--entry", type=float, required=True)
        s.add_argument("--stop", type=float, required=True)
        s.add_argument("--margin-per-lot", type=float)
        s.add_argument("--max-capital-pct", type=float, default=100.0,
                       help="Max %% of capital as premium/margin in this trade")
        s.add_argument("--json", action="store_true")
    e = sub.add_parser("equity")
    e.add_argument("--capital", type=float, required=True)
    e.add_argument("--risk-pct", type=float, default=1.0)
    e.add_argument("--entry", type=float, required=True)
    e.add_argument("--stop", type=float, required=True)
    e.add_argument("--intraday", action="store_true")
    e.add_argument("--leverage", type=float, default=1.0, help="Intraday MIS leverage from broker")
    e.add_argument("--max-position-pct", type=float, default=25.0)
    e.add_argument("--json", action="store_true")
    a = p.parse_args(argv)

    try:
        if a.mode == "equity":
            r = size_equity(a.capital, a.risk_pct, a.entry, a.stop, a.intraday, a.leverage, a.max_position_pct)
        else:
            lot = a.lot_size or (lot_size(a.symbol) if a.symbol else None)
            if not lot:
                p.error("give --symbol or --lot-size")
            r = size_derivative(a.mode, a.capital, a.risk_pct, lot, a.entry, a.stop,
                                a.margin_per_lot, a.max_capital_pct)
    except ValueError as exc:
        p.error(str(exc))
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

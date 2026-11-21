#!/usr/bin/env python3
"""Options strategy payoff + Greeks for NSE index/stock options (Black-Scholes, European).

Build a strategy from presets or custom legs, get max profit/loss, breakevens,
net Greeks, payoff table, and charges.

Presets: long_call, long_put, bull_call_spread, bear_put_spread, bull_put_spread,
         bear_call_spread, long_straddle, short_straddle, long_strangle,
         short_strangle, iron_condor, iron_fly

Examples:
  python3 options_strategy.py --symbol NIFTY --spot 26000 --days 6 --iv 12 \
      --preset bull_call_spread --strikes 26000 26200 --premiums 140 62
  python3 options_strategy.py --symbol NIFTY --spot 26000 --days 6 --iv 12 \
      --leg buy CE 26000 140 --leg sell CE 26300 45 --lots 2
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import fmt_inr, load_config, lot_size, round_trip_charges  # noqa: E402

RISK_FREE = 0.065  # approx. Indian 91-day T-bill; override with --rate


def _ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _npdf(x):
    return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


def bs(spot, strike, t, iv, r, kind):
    """Return price, delta, gamma, theta/day, vega per 1% IV."""
    if t <= 0 or iv <= 0:
        intrinsic = max(spot - strike, 0) if kind == "CE" else max(strike - spot, 0)
        delta = (1.0 if spot > strike else 0.0) if kind == "CE" else (-1.0 if spot < strike else 0.0)
        return intrinsic, delta, 0.0, 0.0, 0.0
    sq = iv * math.sqrt(t)
    d1 = (math.log(spot / strike) + (r + iv * iv / 2) * t) / sq
    d2 = d1 - sq
    if kind == "CE":
        price = spot * _ncdf(d1) - strike * math.exp(-r * t) * _ncdf(d2)
        delta = _ncdf(d1)
        theta = (-spot * _npdf(d1) * iv / (2 * math.sqrt(t)) - r * strike * math.exp(-r * t) * _ncdf(d2)) / 365
    else:
        price = strike * math.exp(-r * t) * _ncdf(-d2) - spot * _ncdf(-d1)
        delta = _ncdf(d1) - 1
        theta = (-spot * _npdf(d1) * iv / (2 * math.sqrt(t)) + r * strike * math.exp(-r * t) * _ncdf(-d2)) / 365
    gamma = _npdf(d1) / (spot * sq)
    vega = spot * _npdf(d1) * math.sqrt(t) / 100
    return price, delta, gamma, theta, vega


def preset_legs(name, strikes, premiums):
    s, pr = strikes, premiums
    need = {
        "long_call": 1, "long_put": 1, "bull_call_spread": 2, "bear_put_spread": 2,
        "bull_put_spread": 2, "bear_call_spread": 2, "long_straddle": 1, "short_straddle": 1,
        "long_strangle": 2, "short_strangle": 2, "iron_condor": 4, "iron_fly": 3,
    }[name]
    if len(s) != need:
        raise ValueError(f"{name} needs {need} strike(s) (low → high)")
    s = sorted(s)
    T = {
        "long_call": lambda: [("buy", "CE", s[0])],
        "long_put": lambda: [("buy", "PE", s[0])],
        "bull_call_spread": lambda: [("buy", "CE", s[0]), ("sell", "CE", s[1])],
        "bear_put_spread": lambda: [("buy", "PE", s[1]), ("sell", "PE", s[0])],
        "bull_put_spread": lambda: [("sell", "PE", s[1]), ("buy", "PE", s[0])],
        "bear_call_spread": lambda: [("sell", "CE", s[0]), ("buy", "CE", s[1])],
        "long_straddle": lambda: [("buy", "CE", s[0]), ("buy", "PE", s[0])],
        "short_straddle": lambda: [("sell", "CE", s[0]), ("sell", "PE", s[0])],
        "long_strangle": lambda: [("buy", "PE", s[0]), ("buy", "CE", s[1])],
        "short_strangle": lambda: [("sell", "PE", s[0]), ("sell", "CE", s[1])],
        "iron_condor": lambda: [("buy", "PE", s[0]), ("sell", "PE", s[1]), ("sell", "CE", s[2]), ("buy", "CE", s[3])],
        "iron_fly": lambda: [("buy", "PE", s[0]), ("sell", "PE", s[1]), ("sell", "CE", s[1]), ("buy", "CE", s[2])],
    }[name]()
    legs = []
    for i, (side, kind, k) in enumerate(T):
        legs.append({"side": side, "kind": kind, "strike": k, "premium": pr[i] if pr and i < len(pr) else None})
    return legs


def analyze(legs, spot, days, iv_pct, lot, lots=1, rate=RISK_FREE, config=None):
    cfg = config or load_config()
    t = max(days, 0) / 365
    iv = iv_pct / 100
    qty = lot * lots
    net = {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    debit = 0.0
    for L in legs:
        price, d, g, th, v = bs(spot, L["strike"], t, iv, rate, L["kind"])
        if L["premium"] is None:
            L["premium"] = round(price, 2)
            L["premium_source"] = "black_scholes"
        L["theoretical"] = round(price, 2)
        sign = 1 if L["side"] == "buy" else -1
        debit += sign * L["premium"]
        for k, val in zip(net, (d, g, th, v)):
            net[k] += sign * val * qty

    def payoff(S):
        tot = 0.0
        for L in legs:
            intr = max(S - L["strike"], 0) if L["kind"] == "CE" else max(L["strike"] - S, 0)
            tot += (intr - L["premium"]) * (1 if L["side"] == "buy" else -1)
        return tot * qty

    strikes = sorted({L["strike"] for L in legs})
    lo, hi = min(strikes + [spot]) * 0.85, max(strikes + [spot]) * 1.15
    step = max((hi - lo) / 2000, 0.5)
    grid = [lo + i * step for i in range(int((hi - lo) / step) + 1)] + strikes
    grid.sort()
    vals = [payoff(S) for S in grid]

    # unlimited detection: slope at edges
    up_slope = sum((1 if L["side"] == "buy" else -1) for L in legs if L["kind"] == "CE")
    dn_slope = sum((1 if L["side"] == "buy" else -1) for L in legs if L["kind"] == "PE")
    max_profit = "unlimited" if up_slope > 0 or dn_slope > 0 else round(max(vals), 2)
    max_loss = "unlimited" if up_slope < 0 or dn_slope < 0 else round(min(vals), 2)

    bes = []
    for i in range(1, len(grid)):
        a, b = vals[i - 1], vals[i]
        if (a < 0 <= b) or (a >= 0 > b):
            x = grid[i - 1] + (grid[i] - grid[i - 1]) * (-a / (b - a) if b != a else 0)
            if not bes or abs(x - bes[-1]) > step * 2:
                bes.append(round(x, 1))

    charges = 0.0
    for L in legs:  # assume each leg squared off at same premium (approx.)
        charges += round_trip_charges("options", L["premium"], L["premium"], qty, cfg).total

    table_pts = sorted(set([round(spot * (1 + p / 100), -1) for p in (-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3)] + strikes))
    rr = None
    if isinstance(max_profit, float) and isinstance(max_loss, float) and max_loss < 0:
        rr = round(max_profit / abs(max_loss), 2)

    return {
        "legs": legs,
        "spot": spot,
        "days_to_expiry": days,
        "iv_pct": iv_pct,
        "lot_size": lot,
        "lots": lots,
        "net_premium_per_unit": round(debit, 2),
        "net_type": "debit" if debit > 0 else "credit",
        "net_premium_total": round(debit * qty, 2),
        "max_profit": max_profit,
        "max_loss": max_loss,
        "reward_risk": rr,
        "breakevens": bes,
        "greeks_total": {k: round(v, 2) for k, v in net.items()},
        "est_charges_round_trip": round(charges, 2),
        "payoff_at_expiry": [{"spot": S, "pnl": round(payoff(S), 2)} for S in table_pts],
    }


def to_markdown(r):
    legs = "; ".join(f"{L['side']} {L['kind']} {L['strike']:g} @ {L['premium']}" for L in r["legs"])
    mp = r["max_profit"] if isinstance(r["max_profit"], str) else fmt_inr(r["max_profit"])
    ml = r["max_loss"] if isinstance(r["max_loss"], str) else fmt_inr(r["max_loss"])
    g = r["greeks_total"]
    out = [
        f"## Strategy: {legs}",
        f"- {r['lots']} lot(s) × {r['lot_size']}, spot {r['spot']}, {r['days_to_expiry']} days, IV {r['iv_pct']}%",
        f"- Net {r['net_type']}: {fmt_inr(abs(r['net_premium_total']))}",
        f"- Max profit: **{mp}**, max loss: **{ml}**" + (f", reward:risk {r['reward_risk']}" if r["reward_risk"] else ""),
        f"- Breakeven(s) at expiry: {', '.join(map(str, r['breakevens'])) or 'none'}",
        f"- Greeks (position): Δ {g['delta']}, Γ {g['gamma']}, Θ/day {fmt_inr(g['theta'])}, Vega/1% {fmt_inr(g['vega'])}",
        f"- Est. charges (round trip): {fmt_inr(r['est_charges_round_trip'])}",
        "", "| Spot at expiry | P&L |", "|---|---|",
    ]
    out += [f"| {p['spot']:g} | {fmt_inr(p['pnl'])} |" for p in r["payoff_at_expiry"]]
    return "\n".join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--symbol")
    p.add_argument("--lot-size", type=int)
    p.add_argument("--lots", type=int, default=1)
    p.add_argument("--spot", type=float, required=True)
    p.add_argument("--days", type=float, required=True, help="Calendar days to expiry")
    p.add_argument("--iv", type=float, required=True, help="Implied volatility in %% (e.g. 12)")
    p.add_argument("--rate", type=float, default=RISK_FREE)
    p.add_argument("--preset")
    p.add_argument("--strikes", type=float, nargs="*")
    p.add_argument("--premiums", type=float, nargs="*", help="Market premiums in leg order (else theoretical)")
    p.add_argument("--leg", nargs=4, action="append", metavar=("SIDE", "TYPE", "STRIKE", "PREMIUM"),
                   help="buy|sell CE|PE strike premium (premium 0 = theoretical)")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    lot = a.lot_size or (lot_size(a.symbol) if a.symbol else None)
    if not lot:
        p.error("give --symbol or --lot-size")
    if a.preset:
        legs = preset_legs(a.preset, a.strikes or [], a.premiums)
    elif a.leg:
        legs = [{"side": s.lower(), "kind": k.upper(), "strike": float(st), "premium": (float(pr) or None)}
                for s, k, st, pr in a.leg]
    else:
        p.error("give --preset or --leg")
    r = analyze(legs, a.spot, a.days, a.iv, lot, a.lots, a.rate)
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

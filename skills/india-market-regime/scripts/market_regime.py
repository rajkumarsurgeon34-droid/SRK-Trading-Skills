#!/usr/bin/env python3
"""Indian market regime: trend + volatility + flows + global cues → exposure posture.

Inputs (all optional except --nifty):
  --nifty CSV        NIFTY 50 daily OHLCV
  --banknifty CSV    BANK NIFTY daily OHLCV
  --vix CSV          INDIA VIX daily OHLCV (close used)
  --flows CSV        date,fii_net,dii_net   (₹ crore, cash market) — see fii-dii-flow-tracker
  --breadth N/M      advances/declines today, e.g. 1320/1180
  --global JSON      overnight % changes, e.g.
                     '{"gift_nifty_pct":0.3,"sp500":0.5,"nasdaq":0.8,"dow":0.2,"brent":-1.2,"usdinr":0.1,"dxy":0.2}'

Output: score 0–100, posture (aggressive / normal / defensive / stand_aside),
VIX-implied expected Nifty range for today, and scalping guidance.

Example:
  python3 market_regime.py --nifty NIFTY.csv --banknifty BANKNIFTY.csv --vix INDIAVIX.csv --flows flows.csv \
      --breadth 1320/1180 --global '{"gift_nifty_pct":0.25,"nasdaq":0.6,"brent":-0.8}'
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import ema, expected_daily_move, load_ohlcv, pct_change, rsi  # noqa: E402


def trend_component(rows, name):
    c = [r["close"] for r in rows]
    e20, e50 = ema(c, 20)[-1], ema(c, 50)[-1]
    e200 = ema(c, 200)[-1] if len(c) >= 200 else None
    pts, notes = 0, []
    if c[-1] > e20: pts += 1
    if c[-1] > e50: pts += 1
    if e20 > e50: pts += 1
    if e200 and c[-1] > e200: pts += 1
    if e200 and e50 > e200: pts += 1
    maxp = 5 if e200 else 3
    r = rsi(c, 14)[-1]
    notes.append(f"{name} {c[-1]:.0f} vs EMA20 {e20:.0f} / EMA50 {e50:.0f}" + (f" / EMA200 {e200:.0f}" if e200 else ""))
    return pts / maxp, notes, {"close": c[-1], "ema20": round(e20, 1), "ema50": round(e50, 1),
                              "ema200": round(e200, 1) if e200 else None, "rsi14": round(r, 1) if r else None,
                              "ret_5d_pct": round(pct_change(c[-6], c[-1]), 2) if len(c) > 6 else None}


def vix_component(vix_rows):
    v = [r["close"] for r in vix_rows]
    now = v[-1]
    chg5 = pct_change(v[-6], now) if len(v) > 6 else 0
    if now < 12: s, label = 0.9, "very low (complacent; option premiums cheap)"
    elif now < 15: s, label = 0.8, "calm"
    elif now < 18: s, label = 0.55, "elevated"
    elif now < 22: s, label = 0.3, "high"
    else: s, label = 0.1, "panic zone"
    if chg5 > 15:
        s -= 0.15
    return max(s, 0), now, chg5, label


def flows_component(path):
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            r = {k.strip().lower(): v for k, v in r.items() if k}
            try:
                rows.append((r["date"], float(r["fii_net"]), float(r.get("dii_net") or 0)))
            except (KeyError, ValueError):
                continue
    rows.sort()
    last5 = rows[-5:]
    fii5 = sum(x[1] for x in last5)
    dii5 = sum(x[2] for x in last5)
    combined = fii5 + dii5
    s = 0.5 + max(min(fii5 / 20000, 0.3), -0.3) + max(min(combined / 30000, 0.2), -0.2)
    return max(min(s, 1), 0), {"fii_5d_cr": round(fii5), "dii_5d_cr": round(dii5), "days": len(last5)}


def global_component(g):
    w = {"gift_nifty_pct": 0.35, "sp500": 0.15, "nasdaq": 0.15, "dow": 0.05, "eurostoxx": 0.05,
         "brent": -0.1, "usdinr": -0.1, "dxy": -0.05}
    raw = sum(w[k] * float(v) for k, v in g.items() if k in w)
    return max(min(0.5 + raw / 2, 1), 0), raw


def build(nifty, banknifty=None, vix=None, flows=None, breadth=None, global_cues=None):
    comps, notes, weights = {}, [], {}
    s, n, details = trend_component(nifty, "NIFTY")
    comps["nifty_trend"], weights["nifty_trend"] = s, 0.30
    notes += n
    out = {"nifty": details}
    if banknifty:
        s, n, d = trend_component(banknifty, "BANKNIFTY")
        comps["banknifty_trend"], weights["banknifty_trend"] = s, 0.15
        notes += n
        out["banknifty"] = d
    exp_move = None
    if vix:
        s, now, chg5, label = vix_component(vix)
        comps["volatility"], weights["volatility"] = s, 0.20
        notes.append(f"India VIX {now:.2f} ({label}), 5-day change {chg5:+.1f}%")
        exp_move = expected_daily_move(details["close"], now)
        out["india_vix"] = {"value": now, "chg_5d_pct": round(chg5, 1), "label": label}
    if flows:
        s, fd = flows_component(flows)
        comps["flows"], weights["flows"] = s, 0.15
        notes.append(f"FII 5-day net ₹{fd['fii_5d_cr']:,} cr, DII ₹{fd['dii_5d_cr']:,} cr")
        out["flows"] = fd
    if breadth:
        adv, dec = (float(x) for x in breadth.split("/"))
        ad = adv / dec if dec else 2
        comps["breadth"], weights["breadth"] = max(min((ad - 0.5) / 1.5, 1), 0), 0.10
        notes.append(f"Advance/decline {adv:.0f}/{dec:.0f} = {ad:.2f}")
        out["advance_decline_ratio"] = round(ad, 2)
    if global_cues:
        s, raw = global_component(global_cues)
        comps["global_cues"], weights["global_cues"] = s, 0.10
        notes.append(f"Global cues weighted {raw:+.2f}% ({', '.join(f'{k} {v:+}' for k, v in global_cues.items())})")
        out["global_cues"] = global_cues

    total_w = sum(weights.values())
    score = round(sum(comps[k] * weights[k] for k in comps) / total_w * 100)
    if score >= 70: posture, exposure = "aggressive", "Full size on A+ setups; trend-following longs favoured."
    elif score >= 50: posture, exposure = "normal", "Normal size; trade both directions with the intraday trend."
    elif score >= 35: posture, exposure = "defensive", "Half size; book profits quickly; prefer hedged/defined-risk option trades."
    else: posture, exposure = "stand_aside", "Capital protection first. Skip trades or paper-trade only."

    scalping = []
    if exp_move:
        scalping.append(f"VIX-implied 1σ Nifty move today ≈ ±{exp_move:.0f} pts ({details['close'] - exp_move:.0f} – {details['close'] + exp_move:.0f})")
        scalping.append(f"Reasonable scalp target ≈ {exp_move * 0.15:.0f}–{exp_move * 0.25:.0f} Nifty pts; stop ≈ {exp_move * 0.1:.0f}–{exp_move * 0.15:.0f} pts")
    if out.get("india_vix", {}).get("value", 0) > 20:
        scalping.append("High VIX: wider stops, fewer trades, smaller size; avoid naked option selling.")

    out.update({
        "score": score,
        "posture": posture,
        "exposure_guidance": exposure,
        "components": {k: round(v, 2) for k, v in comps.items()},
        "weights": weights,
        "expected_daily_move_pts": round(exp_move, 1) if exp_move else None,
        "scalping_guidance": scalping,
        "notes": notes,
        "date": nifty[-1]["date"],
    })
    return out


def to_markdown(r):
    return "\n".join([
        f"## Indian market regime — {r['date']}",
        f"**Score {r['score']}/100 → {r['posture'].upper()}**",
        f"{r['exposure_guidance']}",
        "",
        *[f"- {n}" for n in r["notes"]],
        "",
        "**Intraday / scalping**" if r["scalping_guidance"] else "",
        *[f"- {s}" for s in r["scalping_guidance"]],
        "",
        "_Posture, not a buy/sell signal._",
    ])


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--nifty", required=True)
    p.add_argument("--banknifty")
    p.add_argument("--vix")
    p.add_argument("--flows")
    p.add_argument("--breadth")
    p.add_argument("--global", dest="global_cues")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    r = build(
        load_ohlcv(a.nifty),
        load_ohlcv(a.banknifty) if a.banknifty else None,
        load_ohlcv(a.vix) if a.vix else None,
        a.flows,
        a.breadth,
        json.loads(a.global_cues) if a.global_cues else None,
    )
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

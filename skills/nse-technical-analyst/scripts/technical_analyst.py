#!/usr/bin/env python3
"""Technical snapshot for an NSE stock or index from an OHLCV CSV.

Indicators: EMA 9/20/50/200, RSI 14, MACD, ATR 14, Supertrend (10,3),
previous-day pivots + CPR, 52-week high/low, volume vs 20-day average,
trend stage and a plain-language read. Works on daily or intraday candles.

Example:
  python3 technical_analyst.py --csv RELIANCE.NS.csv --symbol RELIANCE
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import atr, ema, load_ohlcv, macd, pct_change, pivots_cpr, rsi, sma, supertrend  # noqa: E402


def analyze(rows, symbol=None):
    if len(rows) < 30:
        raise ValueError("Need at least 30 candles (200+ recommended for EMA200)")
    c = [r["close"] for r in rows]
    last = rows[-1]
    e = {p: ema(c, p)[-1] for p in (9, 20, 50, 200)}
    r14 = rsi(c, 14)[-1]
    m_line, m_sig, m_hist = macd(c)
    a14 = atr(rows, 14)[-1]
    st_val, st_dir = supertrend(rows)[-1]
    vol20 = sma([r["volume"] for r in rows], 20)[-1]
    lookback = rows[-252:]
    hi52 = max(r["high"] for r in lookback)
    lo52 = min(r["low"] for r in lookback)
    piv = pivots_cpr(rows[-2])
    price = last["close"]

    enough_200 = len(rows) >= 200
    if enough_200 and price > e[50] > e[200] and e[20] > e[50]:
        stage = "Stage 2 uptrend"
    elif enough_200 and price < e[50] < e[200] and e[20] < e[50]:
        stage = "Stage 4 downtrend"
    elif enough_200 and price > e[200]:
        stage = "Above 200 EMA — basing / pullback"
    elif enough_200:
        stage = "Below 200 EMA — weak / basing"
    else:
        stage = "Trend vs 200 EMA unknown (short history)"

    score = 0
    notes = []
    for p in (20, 50):
        if price > e[p]:
            score += 1
        else:
            score -= 1
    if enough_200:
        score += 1 if price > e[200] else -1
    if st_dir == 1:
        score += 1; notes.append(f"Supertrend bullish (trail {st_val:.2f})")
    elif st_dir == -1:
        score -= 1; notes.append(f"Supertrend bearish (trail {st_val:.2f})")
    if m_hist[-1] > 0 and m_hist[-1] > m_hist[-2]:
        score += 1; notes.append("MACD histogram positive and rising")
    elif m_hist[-1] < 0 and m_hist[-1] < m_hist[-2]:
        score -= 1; notes.append("MACD histogram negative and falling")
    if r14 is not None:
        if r14 > 70:
            notes.append(f"RSI {r14:.1f} overbought — avoid chasing")
        elif r14 < 30:
            notes.append(f"RSI {r14:.1f} oversold — wait for reversal sign")
        elif r14 > 55:
            score += 1
        elif r14 < 45:
            score -= 1
    vol_ratio = last["volume"] / vol20 if vol20 else None
    if vol_ratio and vol_ratio > 1.5:
        notes.append(f"Volume {vol_ratio:.1f}× 20-day average")
    if piv["cpr_width_pct"] < 0.15:
        notes.append("Narrow CPR — trending day more likely")
    elif piv["cpr_width_pct"] > 0.5:
        notes.append("Wide CPR — range-bound day more likely")

    bias = "bullish" if score >= 4 else "mildly_bullish" if score >= 2 else "bearish" if score <= -4 else "mildly_bearish" if score <= -2 else "neutral"
    return {
        "symbol": symbol,
        "date": last["date"],
        "close": price,
        "change_pct": round(pct_change(rows[-2]["close"], price), 2),
        "ema": {k: round(v, 2) for k, v in e.items()},
        "rsi14": round(r14, 1) if r14 is not None else None,
        "macd": {"line": round(m_line[-1], 2), "signal": round(m_sig[-1], 2), "hist": round(m_hist[-1], 2)},
        "atr14": round(a14, 2) if a14 else None,
        "atr_pct": round(a14 / price * 100, 2) if a14 else None,
        "supertrend": {"value": round(st_val, 2) if st_val else None, "direction": "up" if st_dir == 1 else "down" if st_dir == -1 else None},
        "pivots_for_next_session": piv,
        "high_52w": hi52,
        "low_52w": lo52,
        "pct_from_52w_high": round(pct_change(hi52, price), 2),
        "volume_vs_20d": round(vol_ratio, 2) if vol_ratio else None,
        "stage": stage,
        "score": score,
        "bias": bias,
        "notes": notes,
        "suggested_stop_long": round(price - 1.5 * a14, 2) if a14 else None,
        "suggested_stop_short": round(price + 1.5 * a14, 2) if a14 else None,
    }


def to_markdown(r):
    p = r["pivots_for_next_session"]
    return "\n".join([
        f"## {r['symbol'] or ''} technicals — {r['date']}",
        f"- Close **{r['close']}** ({r['change_pct']:+}%), {r['stage']}",
        f"- EMA 9/20/50/200: {r['ema'][9]} / {r['ema'][20]} / {r['ema'][50]} / {r['ema'][200]}",
        f"- RSI {r['rsi14']}, MACD hist {r['macd']['hist']}, ATR {r['atr14']} ({r['atr_pct']}%)",
        f"- Supertrend: {r['supertrend']['direction']} @ {r['supertrend']['value']}",
        f"- 52-week: high {r['high_52w']} ({r['pct_from_52w_high']}%), low {r['low_52w']}",
        f"- Next session pivots: S2 {p['s2']} · S1 {p['s1']} · CPR {p['cpr_bottom']}–{p['cpr_top']} · R1 {p['r1']} · R2 {p['r2']}",
        f"- Bias: **{r['bias']}** (score {r['score']})",
        *[f"  - {n}" for n in r["notes"]],
        f"- ATR stops: long {r['suggested_stop_long']} / short {r['suggested_stop_short']}",
    ])


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--csv", required=True)
    p.add_argument("--symbol")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    r = analyze(load_ohlcv(a.csv), a.symbol or Path(a.csv).stem)
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

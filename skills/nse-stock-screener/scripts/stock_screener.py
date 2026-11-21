#!/usr/bin/env python3
"""NSE stock screener over a folder of daily OHLCV CSVs (one file per stock).

Screens (pick with --screen, default all):
  vcp         Minervini-style volatility contraction near highs in a Stage 2 trend
  breakout    Close above 20/55-day high on ≥1.5× volume
  momentum    Strong 3/6-month return, near 52-week high, above rising 50 EMA
  pullback    Uptrend stock pulled back to 20/50 EMA with RSI 40–55
  high52      Within 3% of a 52-week high on rising volume
  relative    Outperforming NIFTY over 3 months (needs --benchmark CSV)

Also filters: min price, min average traded value (₹ crore).

Example:
  python3 stock_screener.py --data-dir data/nifty500 --benchmark data/NIFTY.csv --min-turnover-cr 10
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import atr, ema, load_ohlcv, pct_change, rsi, sma  # noqa: E402

SCREENS = ["vcp", "breakout", "momentum", "pullback", "high52", "relative"]


def _ret(c, n):
    return pct_change(c[-n - 1], c[-1]) if len(c) > n else None


def check_vcp(rows, c, e50, e150, e200):
    if len(rows) < 200:
        return None
    price = c[-1]
    hi52 = max(r["high"] for r in rows[-252:])
    lo52 = min(r["low"] for r in rows[-252:])
    trend = price > e50 > e150 > e200 and e200 > ema(c[:-20], 200)[-1] and price >= lo52 * 1.25 and price >= hi52 * 0.75
    if not trend:
        return None
    # contractions: range of last 3 windows shrinking
    def rng(seg):
        return (max(r["high"] for r in seg) - min(r["low"] for r in seg)) / max(r["high"] for r in seg) * 100
    w = [rng(rows[-60:-40]), rng(rows[-40:-20]), rng(rows[-20:])]
    vol = [sum(r["volume"] for r in rows[a:b]) / 20 for a, b in ((-60, -40), (-40, -20), (-20, None))]
    if w[0] > w[1] > w[2] and w[2] < 12 and vol[2] < vol[0]:
        pivot = max(r["high"] for r in rows[-20:])
        return {"contractions_pct": [round(x, 1) for x in w], "pivot": pivot,
                "dist_to_pivot_pct": round(pct_change(price, pivot), 2)}
    return None


def check_breakout(rows, c):
    if len(rows) < 60:
        return None
    v20 = sma([r["volume"] for r in rows], 20)[-2]
    for n in (55, 20):
        prior_hi = max(r["high"] for r in rows[-n - 1:-1])
        if c[-1] > prior_hi and v20 and rows[-1]["volume"] >= 1.5 * v20:
            return {"lookback": n, "level": prior_hi, "vol_x": round(rows[-1]["volume"] / v20, 2)}
    return None


def check_momentum(rows, c, e50):
    r3, r6 = _ret(c, 63), _ret(c, 126)
    if r3 is None or r6 is None:
        return None
    hi52 = max(r["high"] for r in rows[-252:])
    e50_prev = ema(c[:-10], 50)[-1]
    if r3 > 15 and r6 > 25 and c[-1] >= hi52 * 0.9 and c[-1] > e50 > e50_prev:
        return {"ret_3m": round(r3, 1), "ret_6m": round(r6, 1)}
    return None


def check_pullback(rows, c, e20, e50, e200):
    if len(rows) < 200:
        return None
    r = rsi(c, 14)[-1]
    if c[-1] > e200 and e50 > e200 and r and 40 <= r <= 55:
        near = min(abs(c[-1] - e20) / e20, abs(c[-1] - e50) / e50) * 100
        if near <= 2:
            return {"rsi": round(r, 1), "near_ema_pct": round(near, 2)}
    return None


def check_high52(rows, c):
    if len(rows) < 120:
        return None
    hi52 = max(r["high"] for r in rows[-252:])
    v20 = sma([r["volume"] for r in rows], 20)[-1]
    v50 = sma([r["volume"] for r in rows], 50)[-1]
    if c[-1] >= hi52 * 0.97 and v20 and v50 and v20 > v50:
        return {"pct_from_high": round(pct_change(hi52, c[-1]), 2)}
    return None


def check_relative(c, bench_c):
    if not bench_c or len(c) < 64 or len(bench_c) < 64:
        return None
    rs = _ret(c, 63) - _ret(bench_c, 63)
    return {"rs_vs_nifty_3m": round(rs, 1)} if rs > 10 else None


def screen_stock(name, rows, screens, bench_c=None, min_price=50, min_turnover_cr=5):
    if len(rows) < 60:
        return None
    c = [r["close"] for r in rows]
    turnover_cr = sum(r["close"] * r["volume"] for r in rows[-20:]) / 20 / 1e7
    if c[-1] < min_price or turnover_cr < min_turnover_cr:
        return None
    e20, e50, e150, e200 = (ema(c, p)[-1] for p in (20, 50, 150, 200))
    hits = {}
    checks = {
        "vcp": lambda: check_vcp(rows, c, e50, e150, e200),
        "breakout": lambda: check_breakout(rows, c),
        "momentum": lambda: check_momentum(rows, c, e50),
        "pullback": lambda: check_pullback(rows, c, e20, e50, e200),
        "high52": lambda: check_high52(rows, c),
        "relative": lambda: check_relative(c, bench_c),
    }
    for s in screens:
        res = checks[s]()
        if res:
            hits[s] = res
    if not hits:
        return None
    a = atr(rows, 14)[-1]
    return {
        "symbol": name,
        "close": c[-1],
        "date": rows[-1]["date"],
        "avg_turnover_cr": round(turnover_cr, 1),
        "atr_pct": round(a / c[-1] * 100, 2) if a else None,
        "hits": hits,
        "score": len(hits),
    }


def run(data_dir, screens, benchmark=None, min_price=50, min_turnover_cr=5, top=30):
    bench_c = [r["close"] for r in load_ohlcv(benchmark)] if benchmark else None
    results = []
    files = sorted(Path(data_dir).glob("*.csv"))
    for f in files:
        name = f.stem.replace(".NS", "").replace(".BO", "")
        try:
            res = screen_stock(name, load_ohlcv(f), screens, bench_c, min_price, min_turnover_cr)
        except Exception as exc:  # bad file shouldn't stop the scan
            print(f"skip {f.name}: {exc}", file=sys.stderr)
            continue
        if res:
            results.append(res)
    results.sort(key=lambda r: (-r["score"], -r["avg_turnover_cr"]))
    return {"scanned": len(files), "matches": len(results), "screens": screens, "results": results[:top]}


def to_markdown(r):
    out = [f"## NSE screener — {r['matches']} matches from {r['scanned']} stocks ({', '.join(r['screens'])})", "",
           "| Stock | Close | Avg ₹cr/day | ATR% | Screens hit |", "|---|---|---|---|---|"]
    for x in r["results"]:
        out.append(f"| {x['symbol']} | {x['close']} | {x['avg_turnover_cr']} | {x['atr_pct']} | {', '.join(x['hits'])} |")
    out.append("\n_A screen is a shortlist, not a buy signal. Check the chart, sector and market regime first._")
    return "\n".join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data-dir", required=True)
    p.add_argument("--screen", action="append", choices=SCREENS)
    p.add_argument("--benchmark", help="NIFTY OHLCV CSV for the relative-strength screen")
    p.add_argument("--min-price", type=float, default=50)
    p.add_argument("--min-turnover-cr", type=float, default=5)
    p.add_argument("--top", type=int, default=30)
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    screens = a.screen or [s for s in SCREENS if s != "relative" or a.benchmark]
    r = run(a.data_dir, screens, a.benchmark, a.min_price, a.min_turnover_cr, a.top)
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Nifty sectoral index rotation (relative strength vs NIFTY 50).

Input: a folder of daily OHLCV CSVs, one per sector index (file name = index
name, e.g. NIFTY_BANK.csv, NIFTY_IT.csv, NIFTY_AUTO.csv, NIFTY_PHARMA.csv,
NIFTY_FMCG.csv, NIFTY_METAL.csv, NIFTY_REALTY.csv, NIFTY_ENERGY.csv,
NIFTY_PSU_BANK.csv, NIFTY_MEDIA.csv …) and a NIFTY 50 benchmark CSV.

Quadrants (like an RRG): Leading, Weakening, Lagging, Improving.

Example:
  python3 sector_rotation.py --data-dir data/sectors --benchmark data/NIFTY.csv
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import ema, load_ohlcv, pct_change  # noqa: E402


def rs_series(sec, bench):
    bmap = {r["date"]: r["close"] for r in bench}
    pairs = [(r["date"], r["close"] / bmap[r["date"]]) for r in sec if r["date"] in bmap]
    return [p[1] for p in pairs]


def analyze_sector(name, rows, bench):
    rs = rs_series(rows, bench)
    if len(rs) < 70:
        return None
    rs_ratio = rs[-1] / ema(rs, 50)[-1] * 100          # level vs its trend
    rs_mom = rs[-1] / rs[-11] * 100                      # 10-day RS momentum
    c = [r["close"] for r in rows]
    quad = ("Leading" if rs_ratio >= 100 and rs_mom >= 100 else
            "Weakening" if rs_ratio >= 100 else
            "Improving" if rs_mom >= 100 else "Lagging")
    return {
        "sector": name,
        "close": c[-1],
        "ret_1w": round(pct_change(c[-6], c[-1]), 2),
        "ret_1m": round(pct_change(c[-22], c[-1]), 2),
        "ret_3m": round(pct_change(c[-64], c[-1]), 2) if len(c) > 64 else None,
        "rs_ratio": round(rs_ratio, 2),
        "rs_momentum": round(rs_mom, 2),
        "quadrant": quad,
        "above_ema50": c[-1] > ema(c, 50)[-1],
    }


def run(data_dir, benchmark):
    bench = load_ohlcv(benchmark)
    out = []
    for f in sorted(Path(data_dir).glob("*.csv")):
        if Path(f).resolve() == Path(benchmark).resolve():
            continue
        r = analyze_sector(f.stem.replace("_", " ").replace("^", ""), load_ohlcv(f), bench)
        if r:
            out.append(r)
    out.sort(key=lambda r: (r["rs_ratio"] + r["rs_momentum"]), reverse=True)
    by_q = {q: [r["sector"] for r in out if r["quadrant"] == q] for q in ("Leading", "Improving", "Weakening", "Lagging")}
    return {"sectors": out, "quadrants": by_q,
            "focus": by_q["Leading"] + by_q["Improving"], "avoid_longs": by_q["Lagging"]}


def to_markdown(r):
    out = ["## Sector rotation vs NIFTY 50", "",
           "| Sector | 1W% | 1M% | 3M% | RS ratio | RS mom | Quadrant |", "|---|---|---|---|---|---|---|"]
    for s in r["sectors"]:
        out.append(f"| {s['sector']} | {s['ret_1w']} | {s['ret_1m']} | {s['ret_3m']} | {s['rs_ratio']} | {s['rs_momentum']} | {s['quadrant']} |")
    out += ["", f"- Focus for longs: {', '.join(r['focus']) or '—'}",
            f"- Avoid longs / short candidates: {', '.join(r['avoid_longs']) or '—'}"]
    return "\n".join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data-dir", required=True)
    p.add_argument("--benchmark", required=True)
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    r = run(a.data_dir, a.benchmark)
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

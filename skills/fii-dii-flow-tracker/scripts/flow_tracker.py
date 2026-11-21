#!/usr/bin/env python3
"""FII / DII cash-market flow tracker.

Input CSV: date,fii_net,dii_net  (₹ crore; positive = net buy). NSE/NSDL publish
these daily. Optional extra columns: fii_index_fut_long, fii_index_fut_short
(contracts) for FII index-futures long/short ratio.

Example:
  python3 flow_tracker.py --csv flows.csv
  python3 flow_tracker.py --csv flows.csv --add 2026-11-20 -1830.5 2412.0
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import safe_div  # noqa: E402


def load(path):
    rows = []
    p = Path(path)
    if not p.exists():
        return rows
    with open(p, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            r = {k.strip().lower(): v for k, v in r.items() if k}
            try:
                row = {"date": r["date"], "fii_net": float(r["fii_net"]), "dii_net": float(r.get("dii_net") or 0)}
            except (KeyError, ValueError):
                continue
            for k in ("fii_index_fut_long", "fii_index_fut_short"):
                if r.get(k):
                    row[k] = float(r[k])
            rows.append(row)
    return sorted(rows, key=lambda x: x["date"])


def add_row(path, date, fii, dii):
    rows = [r for r in load(path) if r["date"] != date]
    rows.append({"date": date, "fii_net": fii, "dii_net": dii})
    rows.sort(key=lambda x: x["date"])
    keys = ["date", "fii_net", "dii_net"]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return rows


def streak(values):
    if not values:
        return 0
    sign = 1 if values[-1] > 0 else -1
    n = 0
    for v in reversed(values):
        if (v > 0) == (sign > 0) and v != 0:
            n += 1
        else:
            break
    return n * sign


def analyze(rows):
    if not rows:
        raise ValueError("No flow data")
    fii = [r["fii_net"] for r in rows]
    dii = [r["dii_net"] for r in rows]
    def s(xs, n): return round(sum(xs[-n:]), 1)
    out = {
        "last_date": rows[-1]["date"],
        "today": {"fii": fii[-1], "dii": dii[-1], "net": round(fii[-1] + dii[-1], 1)},
        "fii_sum": {"5d": s(fii, 5), "10d": s(fii, 10), "20d": s(fii, 20)},
        "dii_sum": {"5d": s(dii, 5), "10d": s(dii, 10), "20d": s(dii, 20)},
        "fii_streak_days": streak(fii),
        "dii_streak_days": streak(dii),
        "dii_absorption_20d_pct": round(safe_div(-s(dii, 20), s(fii, 20)) * -100, 0) if s(fii, 20) < 0 else None,
    }
    last = rows[-1]
    if "fii_index_fut_long" in last and "fii_index_fut_short" in last:
        tot = last["fii_index_fut_long"] + last["fii_index_fut_short"]
        out["fii_index_fut_long_pct"] = round(safe_div(last["fii_index_fut_long"], tot) * 100, 1)

    f5, d5 = out["fii_sum"]["5d"], out["dii_sum"]["5d"]
    if f5 > 0 and d5 > 0: reading = "Both FII and DII buying — strong tailwind"
    elif f5 > 0: reading = "FII buying, DII booking — foreign-led rally; watch USDINR"
    elif f5 < 0 and d5 > abs(f5): reading = "FII selling fully absorbed by DII — market resilient"
    elif f5 < 0 and d5 > 0: reading = "FII selling partly absorbed by DII — choppy / mild pressure"
    else: reading = "Both selling — risk-off"
    out["reading"] = reading
    lp = out.get("fii_index_fut_long_pct")
    if lp is not None:
        out["fii_futures_note"] = ("FII index futures very short (<25% long) — contrarian short-covering risk" if lp < 25
                                   else "FII index futures heavily long (>65%) — crowded" if lp > 65 else "FII futures positioning neutral")
    return out


def to_markdown(r):
    return "\n".join([
        f"## FII / DII flows — {r['last_date']}",
        f"- Today: FII ₹{r['today']['fii']:,.0f} cr · DII ₹{r['today']['dii']:,.0f} cr · combined ₹{r['today']['net']:,.0f} cr",
        f"- FII 5/10/20-day: ₹{r['fii_sum']['5d']:,} / {r['fii_sum']['10d']:,} / {r['fii_sum']['20d']:,} cr (streak {r['fii_streak_days']:+} days)",
        f"- DII 5/10/20-day: ₹{r['dii_sum']['5d']:,} / {r['dii_sum']['10d']:,} / {r['dii_sum']['20d']:,} cr (streak {r['dii_streak_days']:+} days)",
        f"- **{r['reading']}**",
        *( [f"- FII index futures long: {r['fii_index_fut_long_pct']}% — {r['fii_futures_note']}"] if "fii_index_fut_long_pct" in r else []),
    ])


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--csv", required=True)
    p.add_argument("--add", nargs=3, metavar=("DATE", "FII_NET", "DII_NET"))
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    rows = add_row(a.csv, a.add[0], float(a.add[1]), float(a.add[2])) if a.add else load(a.csv)
    r = analyze(rows)
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

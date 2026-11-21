#!/usr/bin/env python3
"""NSE/BSE index derivatives expiry calendar with holiday shifts.

Examples:
  python3 expiry_calendar.py                      # next 4 expiries, all indices
  python3 expiry_calendar.py --symbol NIFTY --count 8
  python3 expiry_calendar.py --date 2026-11-20 --json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import holidays, is_trading_day, load_config, upcoming_expiries  # noqa: E402


def build(today: date, symbols: list[str], count: int, config=None) -> dict:
    cfg = config or load_config()
    hol = holidays(cfg)
    max_year = max((int(y) for y in cfg.get("holidays", {})), default=today.year)
    result = {
        "date": today.isoformat(),
        "is_trading_day": is_trading_day(today, hol),
        "expiries": {s: upcoming_expiries(s, today, count, cfg) for s in symbols},
        "warnings": [],
    }
    result["expiry_today"] = [
        s for s, ex in result["expiries"].items() if ex and ex[0]["calendar_days_left"] == 0
    ]
    if today.year > max_year or (today.month >= 11 and today.year == max_year):
        result["warnings"].append(
            f"Holiday list only covers up to {max_year}. Add the next year's NSE holidays to "
            "india_fno_config.json, or expiry shifts will be missed."
        )
    return result


def to_markdown(r: dict) -> str:
    out = [f"## Expiry calendar from {r['date']}"]
    if r["expiry_today"]:
        out.append(f"**Expiry today:** {', '.join(r['expiry_today'])} — expect fast premium decay and gamma spikes.")
    out += ["", "| Index | Type | Expiry | Days left (cal/trading) | Note |", "|---|---|---|---|---|"]
    for sym, items in r["expiries"].items():
        for e in items:
            note = f"moved from {e['scheduled']} (holiday)" if e["shifted"] else ""
            out.append(f"| {sym} | {e['kind']} | {e['expiry']} | {e['calendar_days_left']} / {e['trading_days_left']} | {note} |")
    out += [f"- ⚠️ {w}" for w in r["warnings"]]
    return "\n".join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--date", help="YYYY-MM-DD (default today)")
    p.add_argument("--symbol", action="append", help="Repeatable. Default: all configured indices")
    p.add_argument("--count", type=int, default=4)
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    cfg = load_config()
    today = date.fromisoformat(a.date) if a.date else date.today()
    syms = [s.upper() for s in (a.symbol or cfg["expiry_rules"].keys())]
    r = build(today, syms, a.count, cfg)
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Trade journal + performance review for Indian F&O / equity traders.

Journal CSV columns:
  date,time,symbol,segment,side,qty,entry,exit,setup,notes
  segment: options | futures | equity_intraday | equity_delivery
  side: BUY (long) or SELL (short)

Net P&L includes brokerage, STT, exchange charges, SEBI fee, stamp duty and GST.

Examples:
  python3 trade_journal.py add --journal journal.csv --date 2026-11-20 --time 10:05 --symbol "NIFTY 26100 CE" \
      --segment options --side BUY --qty 65 --entry 112 --exit 131 --setup ORB --notes "clean breakout"
  python3 trade_journal.py review --journal journal.csv --from 2026-11-01
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import fmt_inr, round_trip_charges, safe_div  # noqa: E402

FIELDS = ["date", "time", "symbol", "segment", "side", "qty", "entry", "exit", "setup", "notes"]


def load(path):
    if not Path(path).exists():
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        return [{k.strip().lower(): (v or "").strip() for k, v in r.items() if k} for r in csv.DictReader(fh)]


def add(path, trade):
    new = not Path(path).exists()
    with open(path, "a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore")
        if new:
            w.writeheader()
        w.writerow(trade)


def enrich(t):
    q, e, x = float(t["qty"]), float(t["entry"]), float(t["exit"])
    long = t.get("side", "BUY").upper().startswith("B")
    gross = (x - e) * q if long else (e - x) * q
    buy, sell = (e, x) if long else (x, e)
    ch = round_trip_charges(t.get("segment") or "options", buy, sell, int(q)).total
    return {**t, "gross": gross, "charges": ch, "net": gross - ch}


def stats(trades):
    if not trades:
        return {"trades": 0}
    nets = [t["net"] for t in trades]
    wins = [n for n in nets if n > 0]
    losses = [n for n in nets if n <= 0]
    eq, peak, mdd = 0.0, 0.0, 0.0
    for n in nets:
        eq += n
        peak = max(peak, eq)
        mdd = max(mdd, peak - eq)
    avg_w = safe_div(sum(wins), len(wins))
    avg_l = safe_div(sum(losses), len(losses))
    return {
        "trades": len(nets),
        "net_pnl": round(sum(nets), 2),
        "gross_pnl": round(sum(t["gross"] for t in trades), 2),
        "charges": round(sum(t["charges"] for t in trades), 2),
        "win_rate_pct": round(len(wins) / len(nets) * 100, 1),
        "avg_win": round(avg_w, 2),
        "avg_loss": round(avg_l, 2),
        "payoff_ratio": round(safe_div(avg_w, abs(avg_l)), 2),
        "profit_factor": round(safe_div(sum(wins), abs(sum(losses)), float("inf")), 2) if losses else None,
        "expectancy_per_trade": round(sum(nets) / len(nets), 2),
        "max_drawdown": round(mdd, 2),
        "largest_win": round(max(nets), 2),
        "largest_loss": round(min(nets), 2),
    }


def group(trades, key):
    g = defaultdict(list)
    for t in trades:
        g[key(t)].append(t)
    return {k: stats(v) for k, v in sorted(g.items())}


def review(rows, start=None, end=None):
    trades = [enrich(t) for t in rows if (not start or t["date"] >= start) and (not end or t["date"] <= end)]
    weekday = lambda t: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][date.fromisoformat(t["date"]).weekday()]
    hour = lambda t: (t.get("time") or "??")[:2] + ":00"
    overall = stats(trades)
    by_setup = group(trades, lambda t: t.get("setup") or "untagged")
    insights = []
    if overall.get("trades"):
        if overall["charges"] > 0.3 * abs(overall["gross_pnl"] or 1):
            insights.append(f"Charges are {overall['charges'] / max(abs(overall['gross_pnl']), 1) * 100:.0f}% of gross P&L — trade less, aim for bigger moves")
        best = max(by_setup.items(), key=lambda kv: kv[1]["net_pnl"])
        worst = min(by_setup.items(), key=lambda kv: kv[1]["net_pnl"])
        if best[1]["net_pnl"] > 0:
            insights.append(f"Best setup: {best[0]} ({fmt_inr(best[1]['net_pnl'])}, {best[1]['trades']} trades) — do more of this")
        if worst[1]["net_pnl"] < 0:
            insights.append(f"Worst setup: {worst[0]} ({fmt_inr(worst[1]['net_pnl'])}) — cut or fix it")
        if overall["payoff_ratio"] and overall["payoff_ratio"] < 1 and overall["win_rate_pct"] < 55:
            insights.append("Average loss bigger than average win with <55% win rate — let winners run / cut losers faster")
        hrs = group(trades, hour)
        bad_hrs = [h for h, s in hrs.items() if s["net_pnl"] < 0 and s["trades"] >= 3]
        if bad_hrs:
            insights.append(f"Losing hours: {', '.join(bad_hrs)} — consider not trading then")
    return {
        "period": {"from": start, "to": end},
        "overall": overall,
        "by_setup": by_setup,
        "by_weekday": group(trades, weekday),
        "by_hour": group(trades, hour),
        "by_symbol": group(trades, lambda t: t["symbol"].split()[0]),
        "insights": insights,
    }


def to_markdown(r):
    o = r["overall"]
    if not o.get("trades"):
        return "No trades in this period."
    out = [
        "## Trading performance review",
        f"- Trades {o['trades']}, win rate {o['win_rate_pct']}%, payoff {o['payoff_ratio']}, profit factor {o['profit_factor']}",
        f"- Net P&L **{fmt_inr(o['net_pnl'])}** (gross {fmt_inr(o['gross_pnl'])}, charges {fmt_inr(o['charges'])})",
        f"- Expectancy {fmt_inr(o['expectancy_per_trade'])}/trade, max drawdown {fmt_inr(o['max_drawdown'])}",
        "", "| Setup | Trades | Win% | Net |", "|---|---|---|---|",
    ]
    out += [f"| {k} | {s['trades']} | {s['win_rate_pct']} | {fmt_inr(s['net_pnl'])} |" for k, s in r["by_setup"].items()]
    out += ["", "| Weekday | Trades | Net |", "|---|---|---|"]
    out += [f"| {k} | {s['trades']} | {fmt_inr(s['net_pnl'])} |" for k, s in r["by_weekday"].items()]
    out += ["", "**Insights**", *[f"- {i}" for i in r["insights"]]]
    return "\n".join(out)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a_ = sub.add_parser("add")
    a_.add_argument("--journal", required=True)
    for f in FIELDS:
        a_.add_argument(f"--{f}", required=f not in ("notes", "setup", "time"), default="")
    r_ = sub.add_parser("review")
    r_.add_argument("--journal", required=True)
    r_.add_argument("--from", dest="start")
    r_.add_argument("--to", dest="end")
    r_.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    if a.cmd == "add":
        t = {f: getattr(a, f) for f in FIELDS}
        add(a.journal, t)
        e = enrich(t)
        print(f"Logged {t['symbol']}: gross {fmt_inr(e['gross'])}, charges {fmt_inr(e['charges'])}, net {fmt_inr(e['net'])}")
        return e
    r = review(load(a.journal), a.start, a.end)
    print(json.dumps(r, indent=2, default=str) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

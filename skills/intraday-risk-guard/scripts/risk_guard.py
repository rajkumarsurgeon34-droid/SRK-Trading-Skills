#!/usr/bin/env python3
"""Intraday risk guard + drawdown circuit breaker for Indian F&O / intraday traders.

Reads today's closed trades and returns GO / REDUCE / STOP with reasons.

Trades CSV columns: time,symbol,side,qty,entry,exit,pnl  (pnl = net ₹ after charges;
if missing it is computed as (exit-entry)*qty for BUY, reversed for SELL).
Optional equity curve CSV (date,equity) for multi-day drawdown checks.

Example:
  python3 risk_guard.py --trades today.csv --capital 300000 --now 11:42 --expiry-day
  python3 risk_guard.py --trades today.csv --capital 300000 --equity equity.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import fmt_inr, holidays, load_config  # noqa: E402

DEFAULT_RULES = {
    "max_daily_loss_pct": 2.0,
    "max_trades_per_day": 6,
    "max_consecutive_losses": 3,
    "profit_lock_pct": 3.0,          # after this day profit, protect half of it
    "no_trade_before": "09:20",
    "no_new_trade_after": "15:00",
    "expiry_day_size_factor": 0.5,
    "weekly_dd_stop_pct": 5.0,
    "monthly_dd_stop_pct": 10.0,
    "reduce_at_dd_pct": 6.0,
}


def load_trades(path):
    out = []
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            r = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}
            if r.get("pnl"):
                pnl = float(r["pnl"])
            else:
                q, e, x = float(r["qty"]), float(r["entry"]), float(r["exit"])
                pnl = (x - e) * q if r.get("side", "BUY").upper().startswith("B") else (e - x) * q
            out.append({"time": r.get("time", ""), "symbol": r.get("symbol", ""), "pnl": pnl})
    return sorted(out, key=lambda t: t["time"])


def load_equity(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return sorted(((r["date"], float(r["equity"])) for r in csv.DictReader(fh)), key=lambda x: x[0])


def drawdowns(equity):
    if not equity:
        return {}
    vals = [e for _, e in equity]
    peak = max(vals)
    cur = vals[-1]
    w = vals[-6:] if len(vals) >= 2 else vals
    m = vals[-22:]
    return {
        "from_peak_pct": round((peak - cur) / peak * 100, 2),
        "week_pct": round((max(w) - cur) / max(w) * 100, 2),
        "month_pct": round((max(m) - cur) / max(m) * 100, 2),
    }


def evaluate(trades, capital, rules=None, now=None, expiry_day=False, equity=None, today=None):
    R = {**DEFAULT_RULES, **(rules or {})}
    pnl = sum(t["pnl"] for t in trades)
    peak_pnl, run = 0.0, 0.0
    for t in trades:
        run += t["pnl"]
        peak_pnl = max(peak_pnl, run)
    consec = 0
    for t in reversed(trades):
        if t["pnl"] < 0:
            consec += 1
        else:
            break
    loss_limit = capital * R["max_daily_loss_pct"] / 100
    status, reasons, actions = "GO", [], []

    def stop(msg):
        nonlocal status
        status = "STOP"
        reasons.append(msg)

    def reduce(msg):
        nonlocal status
        if status != "STOP":
            status = "REDUCE"
        reasons.append(msg)

    if today:
        cfg = load_config()
        if today.weekday() >= 5 or today in holidays(cfg):
            stop("Market holiday / weekend")
    if -pnl >= loss_limit:
        stop(f"Daily loss {fmt_inr(pnl)} hit limit {fmt_inr(-loss_limit)} ({R['max_daily_loss_pct']}%)")
    elif -pnl >= 0.7 * loss_limit:
        reduce(f"Daily loss at {(-pnl / loss_limit) * 100:.0f}% of limit — trade half size, A+ setups only")
    if len(trades) >= R["max_trades_per_day"]:
        stop(f"Max trades reached ({len(trades)}/{R['max_trades_per_day']}) — overtrading guard")
    if consec >= R["max_consecutive_losses"]:
        stop(f"{consec} losses in a row — take a break, revenge-trading risk")
    elif consec == R["max_consecutive_losses"] - 1:
        reduce(f"{consec} consecutive losses — next trade half size")
    lock = capital * R["profit_lock_pct"] / 100
    if peak_pnl >= lock and pnl < peak_pnl * 0.5:
        stop(f"Gave back over half of peak day profit {fmt_inr(peak_pnl)} — lock the rest")
    elif peak_pnl >= lock:
        actions.append(f"Profit lock active: stop for the day if P&L falls below {fmt_inr(peak_pnl * 0.5)}")
    if now:
        if now < R["no_trade_before"]:
            reduce(f"Before {R['no_trade_before']} — opening volatility; wait for first candles")
        if now >= R["no_new_trade_after"]:
            stop(f"After {R['no_new_trade_after']} — no new intraday positions; square off before auto square-off")
    if expiry_day:
        actions.append(f"Expiry day: size × {R['expiry_day_size_factor']}, avoid buying far OTM options after 13:30 (theta crush), avoid naked shorts near ATM (gamma)")
    dd = drawdowns(equity) if equity else {}
    if dd:
        if dd["month_pct"] >= R["monthly_dd_stop_pct"]:
            stop(f"Monthly drawdown {dd['month_pct']}% ≥ {R['monthly_dd_stop_pct']}% — circuit breaker: paper-trade until review")
        elif dd["week_pct"] >= R["weekly_dd_stop_pct"]:
            stop(f"Weekly drawdown {dd['week_pct']}% ≥ {R['weekly_dd_stop_pct']}% — stop for the week")
        elif dd["from_peak_pct"] >= R["reduce_at_dd_pct"]:
            reduce(f"Drawdown {dd['from_peak_pct']}% from peak — half size until new equity high")

    remaining = max(loss_limit + pnl, 0)
    return {
        "status": status,
        "day_pnl": round(pnl, 2),
        "peak_day_pnl": round(peak_pnl, 2),
        "trades_taken": len(trades),
        "trades_left": max(R["max_trades_per_day"] - len(trades), 0),
        "consecutive_losses": consec,
        "loss_limit": round(loss_limit, 2),
        "risk_left_today": round(remaining, 2),
        "suggested_max_risk_next_trade": round(min(remaining, capital * 0.01) * (0.5 if status == "REDUCE" or expiry_day else 1), 2) if status != "STOP" else 0,
        "drawdown": dd,
        "reasons": reasons or ["All rules within limits"],
        "actions": actions,
        "rules": R,
    }


def to_markdown(r):
    icon = {"GO": "🟢", "REDUCE": "🟡", "STOP": "🔴"}[r["status"]]
    return "\n".join([
        f"## {icon} {r['status']}",
        f"- Day P&L {fmt_inr(r['day_pnl'])} (peak {fmt_inr(r['peak_day_pnl'])}), trades {r['trades_taken']} (left {r['trades_left']}), losing streak {r['consecutive_losses']}",
        f"- Risk left today: {fmt_inr(r['risk_left_today'])}; max risk on next trade: **{fmt_inr(r['suggested_max_risk_next_trade'])}**",
        *[f"- {x}" for x in r["reasons"]],
        *[f"- 👉 {x}" for x in r["actions"]],
    ])


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--trades", help="Today's trades CSV (omit for a fresh day)")
    p.add_argument("--capital", type=float, required=True)
    p.add_argument("--now", help="HH:MM IST")
    p.add_argument("--date", help="YYYY-MM-DD (holiday check)")
    p.add_argument("--expiry-day", action="store_true")
    p.add_argument("--equity", help="date,equity CSV for drawdown circuit breaker")
    p.add_argument("--rules", help="JSON overriding default rules")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    trades = load_trades(a.trades) if a.trades else []
    r = evaluate(trades, a.capital, json.loads(a.rules) if a.rules else None, a.now, a.expiry_day,
                 load_equity(a.equity) if a.equity else None,
                 date.fromisoformat(a.date) if a.date else None)
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

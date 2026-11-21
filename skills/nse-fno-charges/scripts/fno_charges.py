#!/usr/bin/env python3
"""NSE F&O / equity charges and breakeven calculator.

Examples:
  # 2 lots NIFTY option bought at 120, sold at 135
  python3 fno_charges.py --segment options --symbol NIFTY --lots 2 --buy 120 --sell 135
  # 50 shares intraday
  python3 fno_charges.py --segment equity_intraday --qty 50 --buy 1500 --sell 1512
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import breakeven_move, fmt_inr, load_config, lot_size, round_trip_charges  # noqa: E402

SEGMENTS = ["options", "futures", "equity_intraday", "equity_delivery"]


def calculate(segment, buy, sell, qty, config=None, brokerage=None):
    cfg = config or load_config()
    ch = round_trip_charges(segment, buy, sell, qty, cfg, brokerage_per_order=brokerage)
    gross = (sell - buy) * qty
    net = gross - ch.total
    return {
        "segment": segment,
        "quantity": qty,
        "buy": buy,
        "sell": sell,
        "gross_pnl": round(gross, 2),
        "charges": ch.as_dict(),
        "net_pnl": round(net, 2),
        "charges_pct_of_gross": round(ch.total / abs(gross) * 100, 1) if gross else None,
        "breakeven_points": breakeven_move(segment, buy, qty, cfg),
        "config_as_of": cfg["as_of"],
    }


def to_markdown(r: dict) -> str:
    c = r["charges"]
    lines = [
        f"## Charges — {r['segment']} × {r['quantity']} qty",
        f"Buy {r['buy']} → Sell {r['sell']}",
        "",
        "| Item | Amount |",
        "|---|---|",
    ]
    for k in ["brokerage", "stt", "exchange_txn", "sebi_fee", "stamp_duty", "gst", "total"]:
        lines.append(f"| {k.replace('_', ' ').title()} | {fmt_inr(c[k])} |")
    lines += [
        "",
        f"- Gross P&L: **{fmt_inr(r['gross_pnl'])}**",
        f"- Net P&L after charges: **{fmt_inr(r['net_pnl'])}**",
        f"- Breakeven move: **{r['breakeven_points']} points** per unit",
        f"- Rates as of {r['config_as_of']} — verify against your contract note.",
    ]
    return "\n".join(lines)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--segment", choices=SEGMENTS, required=True)
    p.add_argument("--buy", type=float, required=True, help="Buy price (premium for options)")
    p.add_argument("--sell", type=float, required=True, help="Sell price")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--qty", type=int, help="Quantity in units/shares")
    g.add_argument("--lots", type=int, help="Number of lots (needs --symbol or --lot-size)")
    p.add_argument("--symbol", help="NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX…")
    p.add_argument("--lot-size", type=int, help="Override lot size (stock F&O)")
    p.add_argument("--brokerage", type=float, help="Override brokerage per order (₹)")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)

    qty = a.qty
    if a.lots:
        if a.lot_size:
            qty = a.lots * a.lot_size
        elif a.symbol:
            qty = a.lots * lot_size(a.symbol)
        else:
            p.error("--lots needs --symbol or --lot-size")
    if qty <= 0 or a.buy <= 0 or a.sell <= 0:
        p.error("quantity and prices must be positive")
    r = calculate(a.segment, a.buy, a.sell, qty, brokerage=a.brokerage)
    print(json.dumps(r, indent=2) if a.json else to_markdown(r))
    return r


if __name__ == "__main__":
    main()

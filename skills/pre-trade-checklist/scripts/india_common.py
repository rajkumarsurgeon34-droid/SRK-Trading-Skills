"""Shared helpers for SRK Trading Skills — Indian market (NSE/BSE).

Canonical copy lives in `india_common/`. `scripts/sync_india_common.py` copies
this file and `india_fno_config.json` into each India skill's `scripts/` folder
so every skill stays self-contained (stdlib only).
"""

from __future__ import annotations

import calendar
import json
import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name("india_fno_config.json")
WEEKDAYS = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4}


def load_config(path: str | Path | None = None) -> dict:
    with open(path or CONFIG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def lot_size(symbol: str, config: dict | None = None) -> int:
    cfg = config or load_config()
    sym = symbol.upper()
    if sym not in cfg["lot_sizes"]:
        raise KeyError(
            f"No lot size for {sym}. Add it to india_fno_config.json or pass --lot-size."
        )
    return int(cfg["lot_sizes"][sym])


# ─── Trading calendar ────────────────────────────────────────────────────────


def holidays(config: dict | None = None) -> set[date]:
    cfg = config or load_config()
    out: set[date] = set()
    for days in cfg.get("holidays", {}).values():
        out.update(date.fromisoformat(d) for d in days)
    return out


def is_trading_day(d: date, hol: set[date]) -> bool:
    return d.weekday() < 5 and d not in hol


def previous_trading_day(d: date, hol: set[date]) -> date:
    while not is_trading_day(d, hol):
        d -= timedelta(days=1)
    return d


def last_weekday_of_month(year: int, month: int, weekday: int) -> date:
    last = date(year, month, calendar.monthrange(year, month)[1])
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def scheduled_expiries(symbol: str, start: date, end: date, config: dict | None = None):
    """Yield (scheduled_date, kind) for weekly and monthly expiries in [start-7, end+7]."""
    cfg = config or load_config()
    rule = cfg["expiry_rules"][symbol.upper()]
    items: dict[date, str] = {}
    if rule.get("monthly"):
        wd = WEEKDAYS[rule["monthly"].split("_")[1]]
        y, m = start.year, start.month
        while date(y, m, 1) <= end + timedelta(days=40):
            items[last_weekday_of_month(y, m, wd)] = "monthly"
            m += 1
            if m == 13:
                y, m = y + 1, 1
    if rule.get("weekly"):
        wd = WEEKDAYS[rule["weekly"]]
        d = start - timedelta(days=7)
        d += timedelta(days=(wd - d.weekday()) % 7)
        while d <= end + timedelta(days=7):
            items.setdefault(d, "weekly")
            d += timedelta(days=7)
    return sorted(items.items())


def upcoming_expiries(symbol: str, today: date, count: int = 4, config: dict | None = None):
    """Return list of dicts with actual (holiday-adjusted) expiry dates >= today."""
    cfg = config or load_config()
    hol = holidays(cfg)
    out = []
    for sched, kind in scheduled_expiries(symbol, today, today + timedelta(days=120), cfg):
        actual = previous_trading_day(sched, hol)
        if actual < today:
            continue
        out.append(
            {
                "symbol": symbol.upper(),
                "kind": kind,
                "scheduled": sched.isoformat(),
                "expiry": actual.isoformat(),
                "shifted": actual != sched,
                "calendar_days_left": (actual - today).days,
                "trading_days_left": sum(
                    1
                    for i in range((actual - today).days + 1)
                    if is_trading_day(today + timedelta(days=i), hol)
                ),
            }
        )
        if len(out) >= count:
            break
    return out


# ─── Charges ─────────────────────────────────────────────────────────────────


@dataclass
class ChargeBreakdown:
    turnover: float
    brokerage: float
    stt: float
    exchange_txn: float
    sebi_fee: float
    stamp_duty: float
    gst: float
    total: float = field(init=False)

    def __post_init__(self):
        self.total = round(
            self.brokerage + self.stt + self.exchange_txn + self.sebi_fee + self.stamp_duty + self.gst,
            2,
        )

    def as_dict(self) -> dict:
        return {k: round(v, 2) for k, v in self.__dict__.items()}


def round_trip_charges(
    segment: str,
    buy_price: float,
    sell_price: float,
    quantity: int,
    config: dict | None = None,
    brokerage_per_order: float | None = None,
    orders_per_side: int = 1,
) -> ChargeBreakdown:
    """Charges for one buy + one sell of `quantity` units.

    segment: options | futures | equity_intraday | equity_delivery
    For options, prices are premiums.
    """
    cfg = config or load_config()
    ch = cfg["charges"]
    seg = ch["segments"][segment]
    buy_val = buy_price * quantity
    sell_val = sell_price * quantity
    turnover = buy_val + sell_val

    per_order = seg.get("brokerage_per_order", ch["brokerage_per_order"])
    if brokerage_per_order is not None:
        per_order = brokerage_per_order
    cap = ch.get("brokerage_pct_cap")
    if segment.startswith("equity") and cap and per_order:
        b_buy = min(per_order, buy_val * cap)
        b_sell = min(per_order, sell_val * cap)
        brokerage = (b_buy + b_sell) * orders_per_side
    else:
        brokerage = per_order * 2 * orders_per_side

    # STT is rounded to the nearest rupee by exchanges; keep paise here for transparency.
    stt = sell_val * seg.get("stt_sell_pct", 0) + buy_val * seg.get("stt_buy_pct", 0)
    exchange_txn = turnover * seg["exchange_txn_pct"]
    sebi = turnover * ch["sebi_fee_pct"]
    stamp = buy_val * seg["stamp_buy_pct"]
    gst = (brokerage + exchange_txn + sebi) * ch["gst_pct"]
    return ChargeBreakdown(turnover, brokerage, stt, exchange_txn, sebi, stamp, gst)


def breakeven_move(segment: str, entry: float, quantity: int, config: dict | None = None) -> float:
    """Points the price must move (for a long) to cover round-trip charges."""
    lo, hi = 0.0, max(entry * 0.5, 50.0)
    for _ in range(60):
        mid = (lo + hi) / 2
        ch = round_trip_charges(segment, entry, entry + mid, quantity, config)
        if mid * quantity >= ch.total:
            hi = mid
        else:
            lo = mid
    return round(hi, 2)


def fmt_inr(x: float) -> str:
    """Indian digit grouping: 1234567.8 -> ₹12,34,567.80"""
    neg = x < 0
    x = abs(round(x, 2))
    whole, frac = f"{x:.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts + [tail])
    return f"{'-' if neg else ''}₹{whole}.{frac}"


def safe_div(a: float, b: float, default: float = 0.0) -> float:
    return a / b if b else default


def ema(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def expected_daily_move(spot: float, vix: float) -> float:
    """1-sigma expected one-day move implied by India VIX (annualised %)."""
    return spot * (vix / 100) / math.sqrt(252)


# ─── OHLCV data + indicators ─────────────────────────────────────────────────

import csv as _csv


def load_ohlcv(path: str | Path) -> list[dict]:
    """Load a CSV with columns date,open,high,low,close,volume (case-insensitive;
    'Adj Close' ignored). Rows sorted oldest -> newest."""
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = _csv.DictReader(fh)
        for r in reader:
            k = {key.strip().lower(): v for key, v in r.items() if key}
            try:
                rows.append(
                    {
                        "date": (k.get("date") or k.get("datetime") or "").strip(),
                        "open": float(k["open"]),
                        "high": float(k["high"]),
                        "low": float(k["low"]),
                        "close": float(k["close"]),
                        "volume": float(k.get("volume") or 0),
                    }
                )
            except (KeyError, ValueError, TypeError):
                continue
    rows.sort(key=lambda r: r["date"])
    return rows


def sma(values: list[float], period: int) -> list[float | None]:
    out: list[float | None] = []
    s = 0.0
    for i, v in enumerate(values):
        s += v
        if i >= period:
            s -= values[i - period]
        out.append(s / period if i >= period - 1 else None)
    return out


def rsi(closes: list[float], period: int = 14) -> list[float | None]:
    out: list[float | None] = [None] * len(closes)
    if len(closes) <= period:
        return out
    gains = losses = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0)
        losses += max(-d, 0)
    ag, al = gains / period, losses / period
    out[period] = 100 - 100 / (1 + ag / al) if al else 100.0
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        ag = (ag * (period - 1) + max(d, 0)) / period
        al = (al * (period - 1) + max(-d, 0)) / period
        out[i] = 100 - 100 / (1 + ag / al) if al else 100.0
    return out


def true_ranges(rows: list[dict]) -> list[float]:
    tr = []
    for i, r in enumerate(rows):
        if i == 0:
            tr.append(r["high"] - r["low"])
        else:
            pc = rows[i - 1]["close"]
            tr.append(max(r["high"] - r["low"], abs(r["high"] - pc), abs(r["low"] - pc)))
    return tr


def atr(rows: list[dict], period: int = 14) -> list[float | None]:
    tr = true_ranges(rows)
    out: list[float | None] = [None] * len(rows)
    if len(rows) < period:
        return out
    a = sum(tr[:period]) / period
    out[period - 1] = a
    for i in range(period, len(rows)):
        a = (a * (period - 1) + tr[i]) / period
        out[i] = a
    return out


def macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9):
    ef, es = ema(closes, fast), ema(closes, slow)
    line = [a - b for a, b in zip(ef, es)]
    sig = ema(line, signal)
    return line, sig, [a - b for a, b in zip(line, sig)]


def supertrend(rows: list[dict], period: int = 10, mult: float = 3.0):
    """Returns list of (value, direction) where direction 1=up, -1=down."""
    a = atr(rows, period)
    out = []
    fu = fl = None
    direction = 1
    for i, r in enumerate(rows):
        if a[i] is None:
            out.append((None, 0))
            continue
        hl2 = (r["high"] + r["low"]) / 2
        bu, bl = hl2 + mult * a[i], hl2 - mult * a[i]
        pc = rows[i - 1]["close"] if i else r["close"]
        fu = bu if fu is None or bu < fu or pc > fu else fu
        fl = bl if fl is None or bl > fl or pc < fl else fl
        if direction == 1 and r["close"] < fl:
            direction = -1
        elif direction == -1 and r["close"] > fu:
            direction = 1
        out.append((fl if direction == 1 else fu, direction))
    return out


def pivots_cpr(prev: dict) -> dict:
    """Classic floor pivots + Central Pivot Range from previous session OHLC."""
    h, l, c = prev["high"], prev["low"], prev["close"]
    p = (h + l + c) / 3
    bc = (h + l) / 2
    tc = 2 * p - bc
    return {
        "pivot": round(p, 2),
        "cpr_top": round(max(tc, bc), 2),
        "cpr_bottom": round(min(tc, bc), 2),
        "cpr_width_pct": round(abs(tc - bc) / p * 100, 3),
        "r1": round(2 * p - l, 2),
        "s1": round(2 * p - h, 2),
        "r2": round(p + (h - l), 2),
        "s2": round(p - (h - l), 2),
        "r3": round(h + 2 * (p - l), 2),
        "s3": round(l - 2 * (h - p), 2),
    }


def pct_change(a: float, b: float) -> float:
    """Percent change from a to b."""
    return (b - a) / a * 100 if a else 0.0

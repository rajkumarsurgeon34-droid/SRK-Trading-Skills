#!/usr/bin/env python3
"""Download Indian market data to CSV/JSON for the other SRK skills.

Run on your own computer (needs internet). Sources:
  * Yahoo Finance via `yfinance` (pip install yfinance) — NSE stocks (.NS), indices, India VIX, global cues
  * NSE website JSON API — option chain (uses browser-like headers + cookies; NSE may block or rate-limit)

Commands:
  python3 fetch_data.py ohlcv --symbols RELIANCE TCS HDFCBANK --out data/stocks --period 2y
  python3 fetch_data.py indices --out data/indices            # NIFTY, BANKNIFTY, INDIAVIX + global cues
  python3 fetch_data.py sectors --out data/sectors            # Nifty sectoral indices
  python3 fetch_data.py option-chain --symbol NIFTY --out data/nifty_chain.json
  python3 fetch_data.py global-cues                           # prints overnight % changes as JSON for market_regime.py

Respect each site's terms of use; this is for personal research, not redistribution.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from india_common import load_config  # noqa: E402

SECTORS = {
    "NIFTY_BANK": "^NSEBANK", "NIFTY_IT": "^CNXIT", "NIFTY_AUTO": "^CNXAUTO", "NIFTY_PHARMA": "^CNXPHARMA",
    "NIFTY_FMCG": "^CNXFMCG", "NIFTY_METAL": "^CNXMETAL", "NIFTY_REALTY": "^CNXREALTY", "NIFTY_ENERGY": "^CNXENERGY",
    "NIFTY_PSU_BANK": "^CNXPSUBANK", "NIFTY_MEDIA": "^CNXMEDIA", "NIFTY_INFRA": "^CNXINFRA",
    "NIFTY_FIN_SERVICE": "NIFTY_FIN_SERVICE.NS",
}


def _yf():
    try:
        import yfinance as yf  # type: ignore
        return yf
    except ImportError:
        sys.exit("Install yfinance first:  pip install yfinance")


def save_yahoo(ticker, path, period="2y", interval="1d"):
    yf = _yf()
    df = yf.download(ticker, period=period, interval=interval, progress=False, auto_adjust=False)
    if df is None or df.empty:
        print(f"  no data for {ticker}", file=sys.stderr)
        return False
    if hasattr(df.columns, "levels") and getattr(df.columns, "nlevels", 1) > 1:
        df.columns = df.columns.get_level_values(0)
    df = df.reset_index().rename(columns=lambda c: str(c).lower().replace(" ", "_"))
    if "datetime" in df.columns:
        df = df.rename(columns={"datetime": "date"})
    df[["date", "open", "high", "low", "close", "volume"]].to_csv(path, index=False)
    return True


def cmd_ohlcv(a):
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    syms = list(a.symbols or [])
    if a.symbols_file:
        syms += [s.strip() for s in Path(a.symbols_file).read_text().split() if s.strip()]
    for s in syms:
        t = s if "." in s or s.startswith("^") else f"{s}.NS"
        ok = save_yahoo(t, out / f"{s.replace('^', '')}.csv", a.period, a.interval)
        print(f"{'✓' if ok else '✗'} {t}")


def cmd_indices(a):
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    for name, t in load_config()["yahoo_symbols"].items():
        ok = save_yahoo(t, out / f"{name}.csv", a.period)
        print(f"{'✓' if ok else '✗'} {name} ({t})")


def cmd_sectors(a):
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    for name, t in SECTORS.items():
        ok = save_yahoo(t, out / f"{name}.csv", a.period)
        print(f"{'✓' if ok else '✗'} {name} ({t})")


def cmd_global(a):
    yf = _yf()
    m = {"sp500": "^GSPC", "nasdaq": "^IXIC", "dow": "^DJI", "eurostoxx": "^STOXX50E",
         "brent": "BZ=F", "usdinr": "INR=X", "dxy": "DX-Y.NYB"}
    out = {}
    for k, t in m.items():
        df = yf.download(t, period="5d", interval="1d", progress=False, auto_adjust=False)
        if df is not None and len(df) >= 2:
            c = df["Close"].squeeze()
            out[k] = round(float((c.iloc[-1] / c.iloc[-2] - 1) * 100), 2)
    print(json.dumps(out))
    print("Add gift_nifty_pct manually (GIFT Nifty vs previous Nifty close) — not on Yahoo.", file=sys.stderr)


def cmd_option_chain(a):
    try:
        import requests  # type: ignore
    except ImportError:
        sys.exit("pip install requests")
    sym = a.symbol.upper()
    idx = sym in {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"}
    url = (f"https://www.nseindia.com/api/option-chain-indices?symbol={sym}" if idx
           else f"https://www.nseindia.com/api/option-chain-equities?symbol={sym}")
    h = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
         "Accept": "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9",
         "Referer": "https://www.nseindia.com/option-chain"}
    s = requests.Session()
    s.get("https://www.nseindia.com/option-chain", headers=h, timeout=10)
    time.sleep(1)
    r = s.get(url, headers=h, timeout=10)
    r.raise_for_status()
    data = r.json()
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(data))
    rec = data.get("records", {})
    print(f"Saved {sym} chain: spot {rec.get('underlyingValue')}, expiries {rec.get('expiryDates', [])[:3]} → {a.out}")
    print("If NSE returns 401/403, open nseindia.com in a browser first, or use your broker API (Angel One SmartAPI) instead.", file=sys.stderr)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    o = sub.add_parser("ohlcv"); o.add_argument("--symbols", nargs="*"); o.add_argument("--symbols-file")
    o.add_argument("--out", default="data/stocks"); o.add_argument("--period", default="2y"); o.add_argument("--interval", default="1d")
    i = sub.add_parser("indices"); i.add_argument("--out", default="data/indices"); i.add_argument("--period", default="2y")
    s = sub.add_parser("sectors"); s.add_argument("--out", default="data/sectors"); s.add_argument("--period", default="1y")
    sub.add_parser("global-cues")
    c = sub.add_parser("option-chain"); c.add_argument("--symbol", default="NIFTY"); c.add_argument("--out", default="data/option_chain.json")
    a = p.parse_args(argv)
    {"ohlcv": cmd_ohlcv, "indices": cmd_indices, "sectors": cmd_sectors,
     "global-cues": cmd_global, "option-chain": cmd_option_chain}[a.cmd](a)


if __name__ == "__main__":
    main()

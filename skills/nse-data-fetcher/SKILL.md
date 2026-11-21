---
name: nse-data-fetcher
description: Download Indian market data for the other SRK skills — NSE stock and index OHLCV, India VIX, Nifty sectoral indices, global cues via Yahoo Finance, and NSE option chain JSON. Use when a skill needs data files, or for 'download Nifty data', 'get option chain'.
---

# NSE Data Fetcher

Runs on the user's own computer (needs internet and `pip install yfinance requests`).

## Commands
```bash
python3 skills/nse-data-fetcher/scripts/fetch_data.py indices --out data/indices        # NIFTY, BANKNIFTY, INDIAVIX, S&P, Nasdaq, Dow, Brent, USDINR, DXY
python3 skills/nse-data-fetcher/scripts/fetch_data.py sectors --out data/sectors        # Nifty sectoral indices
python3 skills/nse-data-fetcher/scripts/fetch_data.py ohlcv --symbols RELIANCE TCS INFY --out data/stocks
python3 skills/nse-data-fetcher/scripts/fetch_data.py ohlcv --symbols-file nifty500.txt --out data/nifty500
python3 skills/nse-data-fetcher/scripts/fetch_data.py global-cues                        # JSON for market_regime.py
python3 skills/nse-data-fetcher/scripts/fetch_data.py option-chain --symbol NIFTY --out data/nifty.json
```
## Notes
- Stocks get `.NS` appended automatically (use `.BO` for BSE)
- NSE's website blocks automated access at times (401/403). Fallbacks: open nseindia.com in a browser first, or use the broker API (Angel One SmartAPI, Zerodha Kite Connect) and save in the CSV format the analyzer accepts
- Yahoo data is delayed and occasionally has gaps — fine for daily analysis, not for live scalping execution
- Respect site terms; personal research use only

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

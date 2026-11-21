---
name: nse-stock-screener
description: Screen NSE stocks (Nifty 50/100/500 or any list) for VCP, breakouts, momentum, pullbacks to EMA, 52-week highs and relative strength vs NIFTY, with a minimum traded-value liquidity filter. Use for 'find breakout stocks', 'swing trade ideas', 'momentum stocks NSE', 'VCP scan'.
---

# NSE Stock Screener

Scans a folder of daily OHLCV CSVs (one per stock).

## Workflow
1. Put symbols in a text file (e.g. Nifty 500 list from niftyindices.com) and download:
```bash
python3 skills/nse-data-fetcher/scripts/fetch_data.py ohlcv --symbols-file nifty500.txt --out data/nifty500 --period 2y
python3 skills/nse-data-fetcher/scripts/fetch_data.py indices --out data/indices
```
2. Scan:
```bash
python3 skills/nse-stock-screener/scripts/stock_screener.py --data-dir data/nifty500 \
  --benchmark data/indices/NIFTY.csv --min-turnover-cr 10 --top 25
# one screen only
python3 skills/nse-stock-screener/scripts/stock_screener.py --data-dir data/nifty500 --screen vcp
```
## Screens
| Screen | Rule |
|---|---|
| vcp | Stage 2 trend (price > EMA50 > EMA150 > EMA200), 3 tightening ranges, drying volume |
| breakout | Close above 20/55-day high on ≥1.5× volume |
| momentum | 3M > 15%, 6M > 25%, within 10% of 52W high, rising EMA50 |
| pullback | Uptrend, price within 2% of EMA20/50, RSI 40–55 |
| high52 | Within 3% of 52-week high with rising volume |
| relative | 3M return beats NIFTY by > 10 points |

## After screening
Check `india-market-regime` first (don't buy breakouts in stand_aside), prefer stocks from Leading sectors (`india-sector-rotation`), then `nse-technical-analyst` → `nse-position-sizer` → `pre-trade-checklist`.

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

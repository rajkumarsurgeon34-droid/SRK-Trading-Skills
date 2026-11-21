---
name: nse-technical-analyst
description: Technical analysis snapshot for any NSE stock or index from OHLCV data — EMA 9/20/50/200, RSI, MACD, ATR, Supertrend, CPR and floor pivots, 52-week levels, volume, trend stage, bias and ATR stop levels. Use for 'analyse RELIANCE chart', 'Nifty levels for tomorrow', 'support resistance', 'CPR'.
---

# NSE Technical Analyst

Indicator set Indian traders actually use: EMAs, RSI, MACD, **Supertrend (10,3)**, **CPR + pivots** for the next session, ATR stops.

## Workflow
1. Get data: `python3 skills/nse-data-fetcher/scripts/fetch_data.py ohlcv --symbols RELIANCE --out data/stocks` (intraday: `--period 60d --interval 15m`).
2. Run:
```bash
python3 skills/nse-technical-analyst/scripts/technical_analyst.py --csv data/stocks/RELIANCE.csv --symbol RELIANCE
```
3. If the user shares a chart image instead, read it visually and apply the same checklist below.

## Checklist when interpreting
- Trend stage (Stage 2 uptrend / Stage 4 downtrend / basing)
- Price vs EMA20/50/200 and Supertrend direction
- Momentum: RSI zone, MACD histogram slope
- Next-session levels: CPR (narrow = trending day likely, wide = range day), R1/S1, R2/S2
- Volume confirmation (×20-day average)
- ATR-based stop (1.5 × ATR) — hand to `nse-position-sizer`

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

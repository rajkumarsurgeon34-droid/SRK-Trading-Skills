---
name: india-market-regime
description: Daily Indian market regime check — NIFTY/BANKNIFTY trend, India VIX, FII/DII flows, breadth and global cues (GIFT Nifty, US markets, crude, USDINR) combined into a 0–100 score and an exposure posture. Use before the market opens or when asked 'how is the market today', 'should I trade today', 'market mood', 'Nifty outlook'.
---

# India Market Regime

Turns the morning checklist every Indian trader does in their head into one score and a clear posture: **aggressive / normal / defensive / stand_aside**. Also gives the India VIX-implied Nifty range for the day and scalping target/stop sizes.

## Prerequisites
- Python 3.9+, standard library only
- Data CSVs from `nse-data-fetcher` (`fetch_data.py indices`) or any date,open,high,low,close,volume CSV

## Workflow
1. Get data: `python3 skills/nse-data-fetcher/scripts/fetch_data.py indices --out data/indices` and `fetch_data.py global-cues` (add GIFT Nifty % yourself).
2. Optional: update flows with `fii-dii-flow-tracker`.
3. Run:
```bash
python3 skills/india-market-regime/scripts/market_regime.py \
  --nifty data/indices/NIFTY.csv --banknifty data/indices/BANKNIFTY.csv --vix data/indices/INDIAVIX.csv \
  --flows data/flows.csv --breadth 1320/1180 \
  --global '{"gift_nifty_pct":0.25,"sp500":0.4,"nasdaq":0.7,"brent":-0.8,"usdinr":0.1}'
```
4. Report the score, posture, the 3–4 notes that drove it, and the VIX-implied range. Add `--json` for machine output.

## Scoring
| Component | Weight | Bullish when |
|---|---|---|
| NIFTY trend | 30% | Above EMA20/50/200, EMAs stacked up |
| BANKNIFTY trend | 15% | Same, for the banking heavyweight |
| India VIX | 20% | Below 15 and not spiking |
| FII/DII 5-day flows | 15% | Net buying |
| Advance/decline | 10% | Ratio > 1 |
| Global cues | 10% | GIFT Nifty and US up; crude, USDINR, DXY down |

Missing inputs are skipped and the weights re-normalised.

## Output use
Feed `posture` into `pre-trade-checklist` and size with `nse-position-sizer`. On `stand_aside`, recommend no new trades.

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

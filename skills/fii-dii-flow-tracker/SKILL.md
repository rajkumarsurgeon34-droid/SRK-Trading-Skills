---
name: fii-dii-flow-tracker
description: Track and interpret FII and DII cash-market flows in India — 5/10/20-day totals, buying/selling streaks, DII absorption, optional FII index-futures long %. Use when asked about FII selling, DII buying, foreign flows, institutional activity.
---

# FII / DII Flow Tracker

Foreign (FII/FPI) and domestic institutional (DII) cash flows are the biggest daily driver of Nifty direction. This skill keeps a running CSV and explains what the flows mean.

## Data
NSE publishes provisional FII/DII cash figures every evening (nseindia.com → Reports → FII/DII). Values are ₹ crore, positive = net buy.

## Workflow
```bash
# add today's numbers (creates the file if missing; same date is replaced)
python3 skills/fii-dii-flow-tracker/scripts/flow_tracker.py --csv data/flows.csv --add 2026-11-20 -1830.5 2412.0
# analyse
python3 skills/fii-dii-flow-tracker/scripts/flow_tracker.py --csv data/flows.csv
```
Optional CSV columns `fii_index_fut_long,fii_index_fut_short` (from NSE participant-wise OI) add the FII futures long % — below 25% long is a short-covering risk, above 65% is crowded.

## Readings
- Both buying → strong tailwind
- FII buying, DII selling → foreign-led; watch USDINR
- FII selling, DII absorbing fully → resilient market
- Both selling → risk-off

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

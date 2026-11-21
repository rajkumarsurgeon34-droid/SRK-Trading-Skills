---
name: india-trade-journal
description: Trade journal and performance review for Indian traders — logs trades, computes net P&L after all charges, win rate, payoff ratio, profit factor, expectancy, drawdown, and breaks results down by setup, weekday, hour and symbol with actionable insights. Use for 'log this trade', 'review my trades', 'monthly performance', 'what am I doing wrong'.
---

# India Trade Journal

## Workflow
```bash
# log a trade
python3 skills/india-trade-journal/scripts/trade_journal.py add --journal data/journal.csv \
  --date 2026-11-20 --time 10:05 --symbol "NIFTY 26100 CE" --segment options --side BUY \
  --qty 65 --entry 112 --exit 131 --setup ORB --notes "clean breakout above CPR"
# weekly / monthly review
python3 skills/india-trade-journal/scripts/trade_journal.py review --journal data/journal.csv --from 2026-11-01
```
Broker tradebook exports can be converted to the journal columns: `date,time,symbol,segment,side,qty,entry,exit,setup,notes`.

## Review conversation
1. Headline: net P&L, win rate, expectancy, charges share
2. Best and worst setup — do more of the best, fix or drop the worst
3. Time patterns (hours/weekdays that lose money)
4. One concrete rule change for next week — feed it into `intraday-risk-guard` rules

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

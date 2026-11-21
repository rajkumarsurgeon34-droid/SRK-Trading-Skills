---
name: intraday-risk-guard
description: Intraday discipline and drawdown circuit breaker for Indian F&O/intraday traders — daily loss limit, max trades, consecutive-loss lockout, profit lock, 9:20/15:00 time rules, expiry-day size cut, weekly/monthly drawdown stop. Returns GO / REDUCE / STOP. Use before every trade, or for 'should I keep trading', 'I lost 3 trades', 'daily loss limit'.
---

# Intraday Risk Guard

The skill that stops a bad day from becoming a bad month.

## Workflow
```bash
# fresh day
python3 skills/intraday-risk-guard/scripts/risk_guard.py --capital 300000 --now 09:25 --date 2026-12-01 --expiry-day
# after some trades (time,symbol,side,qty,entry,exit[,pnl])
python3 skills/intraday-risk-guard/scripts/risk_guard.py --trades today.csv --capital 300000 --now 11:40
# with equity curve for drawdown breaker
python3 skills/intraday-risk-guard/scripts/risk_guard.py --trades today.csv --capital 300000 --equity equity.csv
# custom rules
python3 skills/intraday-risk-guard/scripts/risk_guard.py --capital 300000 --rules '{"max_daily_loss_pct":1.5,"max_trades_per_day":4}'
```
## Default rules
| Rule | Default |
|---|---|
| Max daily loss | 2% of capital |
| Max trades/day | 6 |
| Consecutive losses → stop | 3 |
| Profit lock | after +3%, stop if half is given back |
| No trades before / new trades after | 09:20 / 15:00 |
| Expiry-day size | × 0.5 |
| Weekly / monthly drawdown stop | 5% / 10% |

When the status is STOP, be firm and kind: no new trades today. Never help find a way around a STOP.

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

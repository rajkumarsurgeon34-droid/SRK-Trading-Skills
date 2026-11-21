---
name: pre-trade-checklist
description: Pre-trade discipline gate for Indian traders — checks stop-loss, reward:risk, risk %, risk-guard status, market regime, trend alignment, event risk (results, RBI, Budget), liquidity, named setup and written reason before entry. Returns CLEAR / CAUTION / BLOCKED. Use when the user is about to take a trade or asks 'should I take this trade'.
---

# Pre-Trade Checklist

## Workflow
1. Build the plan from the conversation (ask only for missing essentials: entry, stop, target, setup).
2. Pull `posture` from `india-market-regime` and `status` from `intraday-risk-guard` if available.
3. Run:
```bash
python3 skills/pre-trade-checklist/scripts/pre_trade_checklist.py --plan plan.json
```
Plan fields: symbol, direction, instrument (equity/futures/option), entry, stop, target, setup, regime_posture, trend_aligned, risk_guard_status, risk_pct, event_risk, liquidity_ok, reason, expiry_day, option_dte, option_delta.

## Verdicts
- **BLOCKED**: no stop, risk > 2%, risk guard STOP, regime stand_aside, illiquid → do not take the trade
- **CAUTION**: poor R:R, counter-trend, event today, no named setup → reduce size or skip
- **CLEAR**: proceed with planned size

Events to check for India: company results, RBI MPC, Union Budget, US CPI/FOMC, monthly expiry.

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

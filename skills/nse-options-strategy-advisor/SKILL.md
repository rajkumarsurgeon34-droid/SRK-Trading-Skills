---
name: nse-options-strategy-advisor
description: Build and evaluate options strategies on NSE index/stock options — spreads, straddles, strangles, iron condor, iron fly or custom legs — with payoff table, max profit/loss, breakevens, Black-Scholes Greeks and charges, using current lot sizes. Use for 'iron condor on Nifty', 'bull call spread', 'option strategy for expiry', 'hedge my position'.
---

# NSE Options Strategy Advisor

## Workflow
1. Collect: underlying, spot, days to expiry (`nse-expiry-calendar`), IV (ATM IV from the chain or India VIX for Nifty), strikes and market premiums.
2. Run a preset or custom legs:
```bash
python3 skills/nse-options-strategy-advisor/scripts/options_strategy.py --symbol NIFTY --spot 26000 --days 6 --iv 12 \
  --preset bull_call_spread --strikes 26000 26200 --premiums 140 62
python3 skills/nse-options-strategy-advisor/scripts/options_strategy.py --symbol BANKNIFTY --lots 2 --spot 56200 --days 20 --iv 14 \
  --leg sell CE 57000 180 --leg buy CE 57500 70
```
If premiums are omitted, Black-Scholes theoretical prices are used — say so.

## Choosing a strategy
| View | Low IV | High IV |
|---|---|---|
| Bullish | Long call / bull call spread | Bull put spread |
| Bearish | Long put / bear put spread | Bear call spread |
| Range-bound | — | Iron condor / iron fly (defined risk) |
| Big move, unsure direction | Long straddle / strangle | — |

## Rules of thumb for Indian retail
- Prefer **defined-risk** spreads over naked selling; SEBI data shows most retail F&O traders lose money
- Hedged positions get lower margin under SPAN
- On expiry day theta and gamma are extreme — use smaller size

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

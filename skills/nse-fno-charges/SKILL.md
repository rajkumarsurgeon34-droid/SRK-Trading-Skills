---
name: nse-fno-charges
description: Calculate exact Indian trading charges — brokerage, STT (2026 rates), exchange transaction charges, SEBI fee, stamp duty, GST — net P&L and breakeven points for options, futures, intraday and delivery trades. Use for 'charges for 2 lots Nifty', 'how much STT', 'net profit after charges', 'breakeven'.
---

# NSE F&O Charges Calculator

## Workflow
```bash
python3 skills/nse-fno-charges/scripts/fno_charges.py --segment options --symbol NIFTY --lots 2 --buy 120 --sell 135
python3 skills/nse-fno-charges/scripts/fno_charges.py --segment futures --symbol BANKNIFTY --lots 1 --buy 56200 --sell 56300
python3 skills/nse-fno-charges/scripts/fno_charges.py --segment equity_intraday --qty 100 --buy 1450 --sell 1462 --brokerage 20
```
## Rates used (see config for the source of truth)
| Item | Options | Futures |
|---|---|---|
| STT | 0.15% of sell premium (from 1 Apr 2026) | 0.05% of sell value (from 1 Apr 2026) |
| Exchange txn (NSE) | ~0.035% of premium | ~0.0017% |
| Stamp duty (buy) | 0.003% | 0.002% |
| SEBI fee | ₹10 per crore | ₹10 per crore |
| GST | 18% on brokerage + exchange + SEBI | same |
| Brokerage | ₹20/order default | ₹20/order default |

Change `--brokerage` for the user's broker. Explain to scalpers how charges eat into small targets — the breakeven points output shows this directly.

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

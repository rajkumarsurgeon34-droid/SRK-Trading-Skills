---
name: nse-position-sizer
description: Risk-based position sizing for Indian markets — lots for option buying, futures and option selling (with margin cap) using current NSE lot sizes, or shares for intraday/delivery equity — including charges in the risk. Use for 'how many lots', 'position size', 'risk 1% on Nifty options', 'how many shares to buy'.
---

# NSE Position Sizer

## Workflow
1. Collect capital, risk % (default 1%; suggest 0.5% for beginners), instrument, entry, stop; margin per lot for futures/short options (from the broker's margin calculator).
2. Run:
```bash
python3 skills/nse-position-sizer/scripts/position_sizer.py option-buy --capital 200000 --risk-pct 1 --symbol NIFTY --entry 110 --stop 85
python3 skills/nse-position-sizer/scripts/position_sizer.py futures --capital 500000 --risk-pct 1 --symbol BANKNIFTY --entry 56200 --stop 56020 --margin-per-lot 120000
python3 skills/nse-position-sizer/scripts/position_sizer.py option-sell --capital 500000 --symbol NIFTY --entry 60 --stop 120 --margin-per-lot 105000
python3 skills/nse-position-sizer/scripts/position_sizer.py equity --capital 300000 --risk-pct 0.5 --entry 1450 --stop 1432 --intraday --leverage 5
```
3. Report lots/shares, which limit bound it (risk / capital / margin), total rupee risk, and warnings.

## Rules
- Lots are always whole; if even 1 lot exceeds the risk budget, say so plainly rather than rounding up
- Stock F&O: pass `--lot-size` (from NSE contract specs)
- On `REDUCE` from `intraday-risk-guard` or expiry day, halve the risk %

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

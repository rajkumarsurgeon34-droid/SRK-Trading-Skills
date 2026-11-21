---
name: nse-option-chain-analyzer
description: Analyse an NSE option chain (NIFTY, BANKNIFTY, FINNIFTY, stock options) — PCR, change-in-OI PCR, max pain, call/put OI walls as resistance/support, fresh writing, long/short build-up, ATM straddle expected range and a directional bias. Use for 'Nifty option chain analysis', 'PCR today', 'max pain', 'OI support resistance'.
---

# NSE Option Chain Analyzer

## Workflow
1. Get the chain:
   - NSE JSON: `python3 skills/nse-data-fetcher/scripts/fetch_data.py option-chain --symbol NIFTY --out data/nifty.json`
   - Or export from your broker (Angel One, Zerodha, etc.) to CSV with columns `strike,ce_oi,ce_chg_oi,ce_ltp,ce_chg,ce_iv,pe_oi,pe_chg_oi,pe_ltp,pe_chg,pe_iv`
   - Or the user pastes a screenshot — read the numbers and build the CSV
2. Run:
```bash
python3 skills/nse-option-chain-analyzer/scripts/option_chain.py --nse-json data/nifty.json --symbol NIFTY
python3 skills/nse-option-chain-analyzer/scripts/option_chain.py --csv chain.csv --spot 26050 --symbol NIFTY
```
## How to read it
- **PCR (OI)** > 1.2 supportive (put writers confident); < 0.8 capped; > 1.6 or < 0.5 can be contrarian extremes
- **Highest call OI above spot** = resistance; **highest put OI below spot** = support; strikes with the biggest *fresh* OI addition matter most intraday
- **Max pain** pulls price mainly on expiry day
- **ATM straddle** ≈ market's expected move to expiry
- Build-up: price↑OI↑ long build-up, price↓OI↑ short build-up, price↑OI↓ short covering, price↓OI↓ long unwinding

OI is positioning, not a guarantee. Always confirm with price action and `nse-technical-analyst`.

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

# Workflow: Intraday F&O Daily (Nifty / Bank Nifty)

**When:** every trading day, 8:45–9:15 IST, then before each trade.
**Time:** ~15 minutes pre-market.

| Step | Skill | Output | Gate |
|---|---|---|---|
| 1 | nse-data-fetcher (`indices`, `global-cues`) | fresh CSVs | — |
| 2 | fii-dii-flow-tracker (`--add` yesterday's numbers) | flow reading | — |
| 3 | india-market-regime | score, posture, VIX range | `stand_aside` → no trading today |
| 4 | nse-expiry-calendar | expiry today? DTE | expiry → half size |
| 5 | nse-technical-analyst (NIFTY / BANKNIFTY) | CPR, pivots, Supertrend | mark key levels |
| 6 | nse-option-chain-analyzer (after 9:30) | OI walls, PCR, bias | trade with the walls, not into them |
| 7 | intraday-risk-guard | GO / REDUCE / STOP | STOP → done for the day |
| 8 | pre-trade-checklist | CLEAR / CAUTION / BLOCKED | BLOCKED → skip |
| 9 | nse-position-sizer | lots | — |
| 10 | india-trade-journal `add` | logged trade | after every exit |

Repeat steps 7–10 for each trade.

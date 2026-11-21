---
name: srk-trading-navigator
description: Start here for SRK Trading Skills (Indian stock market). Routes the user to the right skill or daily workflow — market regime, screeners, technicals, option chain, strategies, position sizing, charges, expiry, risk guard, checklist, journal. Use when the user asks what the trading skills can do or is unsure where to start.
---

# SRK Trading Navigator

SRK Trading Skills is a toolkit for **Indian markets (NSE/BSE)** by Dr. M. Rajkumar · ShazVerse Technologies.

## Pick by question
| User asks… | Skill |
|---|---|
| How's the market today? Should I trade? | india-market-regime |
| FII/DII buying or selling? | fii-dii-flow-tracker |
| Which sectors are strong? | india-sector-rotation |
| Find stocks to trade | nse-stock-screener |
| Analyse this chart / levels for tomorrow | nse-technical-analyst |
| Nifty option chain, PCR, max pain | nse-option-chain-analyzer |
| Which option strategy? Payoff? | nse-options-strategy-advisor |
| When is expiry? | nse-expiry-calendar |
| Charges / net profit / breakeven | nse-fno-charges |
| How many lots / shares? | nse-position-sizer |
| Can I keep trading today? | intraday-risk-guard |
| Should I take this trade? | pre-trade-checklist |
| Log / review my trades | india-trade-journal |
| I need data | nse-data-fetcher |

## Daily workflows
See `workflows/` in the repo:
- **intraday-fno-daily** — pre-market regime → expiry check → option chain → risk guard → checklist → size → journal
- **swing-equity-weekly** — regime → sector rotation → screener → technicals → size → checklist
- **weekly-review** — journal review → adjust risk-guard rules

Educational decision-support only — not SEBI-registered advice.

# SRK Trading Skills 🇮🇳

**Claude skills for the Indian stock market (NSE/BSE)**
By **Dr. M. Rajkumar · [ShazVerse Technologies](https://shazverse.com)**, part of the SRK app family.

SRK Trading Skills helps an Indian trader follow a disciplined routine: check the market, find setups, read the option chain, size the trade correctly, know the real charges, stop when the day goes wrong, and learn from every trade. It's built for Nifty / Bank Nifty F&O and NSE equity traders, including intraday and scalping.

> **Disclaimer:** Educational and process-improvement tool only. Not SEBI-registered investment advice, not a tip or signal service, and not a broker. F&O trading carries a high risk of loss: SEBI studies show most individual F&O traders lose money. All decisions are your own.

## Skills (15)

| Category | Skill | What it does |
|---|---|---|
| **Market regime** | `india-market-regime` | NIFTY/BANKNIFTY trend + India VIX + FII/DII + breadth + global cues → 0–100 score and posture, VIX-implied Nifty range |
| | `fii-dii-flow-tracker` | FII/DII cash flows: 5/10/20-day totals, streaks, DII absorption, FII futures positioning |
| | `india-sector-rotation` | Nifty sectoral indices in Leading / Improving / Weakening / Lagging quadrants vs NIFTY 50 |
| **Opportunities** | `nse-stock-screener` | VCP, breakout, momentum, pullback, 52-week high, relative strength, with a liquidity filter |
| | `nse-technical-analyst` | EMA 9/20/50/200, RSI, MACD, ATR, Supertrend, CPR + pivots, trend stage, ATR stops |
| **Options** | `nse-option-chain-analyzer` | PCR, max pain, OI walls, fresh writing, build-up, ATM straddle range, bias |
| | `nse-options-strategy-advisor` | Spreads, straddles, strangles, iron condor/fly: payoff, breakevens, Greeks, charges |
| | `nse-expiry-calendar` | NIFTY Tue weekly, BANKNIFTY monthly, SENSEX Thu, with holiday shifts |
| **Trade planning** | `nse-position-sizer` | Lots for option buy / futures / option sell (margin-capped), shares for equity, charges included |
| | `nse-fno-charges` | Brokerage, STT (2026 rates), exchange charges, SEBI fee, stamp duty, GST, breakeven |
| **Discipline** | `intraday-risk-guard` | Daily loss limit, max trades, losing-streak lockout, profit lock, time rules, drawdown breaker → GO / REDUCE / STOP |
| | `pre-trade-checklist` | Stop, R:R, risk %, regime, event risk, liquidity → CLEAR / CAUTION / BLOCKED |
| **Memory** | `india-trade-journal` | Net P&L after charges, win rate, expectancy, profit factor, by setup / hour / weekday, insights |
| **Data** | `nse-data-fetcher` | NSE stocks, indices, India VIX, sectors, global cues (Yahoo), NSE option chain |
| **Start here** | `srk-trading-navigator` | Routes any question to the right skill |

## Workflows

- [`intraday-fno-daily`](workflows/intraday-fno-daily.md): pre-market → option chain → risk guard → checklist → size → journal
- [`swing-equity-weekly`](workflows/swing-equity-weekly.md): regime → sectors → screener → technicals → size
- [`weekly-review`](workflows/weekly-review.md): journal review → one rule change

## Installation

**Claude Code**
```bash
git clone https://github.com/rajkumarsurgeon34-droid/SRK-Trading-Skills.git
cp -r SRK-Trading-Skills/skills/* ~/.claude/skills/
```

**Claude app (claude.ai)**
```bash
python3 scripts/package_skills.py     # creates dist/<skill>.skill
```
Upload the `.skill` files under Settings → Capabilities → Skills.

**Data (optional, on your computer)**
```bash
pip install yfinance requests
python3 skills/nse-data-fetcher/scripts/fetch_data.py indices --out data/indices
```

All analysis scripts use the Python standard library only (Python 3.9+).

## Quick examples

```bash
# Charges and breakeven for 2 lots of Nifty options
python3 skills/nse-fno-charges/scripts/fno_charges.py --segment options --symbol NIFTY --lots 2 --buy 120 --sell 135

# How many lots, risking 1% of ₹2 lakh
python3 skills/nse-position-sizer/scripts/position_sizer.py option-buy --capital 200000 --risk-pct 1 --symbol NIFTY --entry 110 --stop 85

# Next expiries
python3 skills/nse-expiry-calendar/scripts/expiry_calendar.py --symbol NIFTY

# Can I keep trading?
python3 skills/intraday-risk-guard/scripts/risk_guard.py --trades today.csv --capital 300000 --now 11:40
```

## Keeping rules up to date

Lot sizes, STT and other charges, expiry days and the NSE holiday list are stored in one file:
[`india_common/india_fno_config.json`](india_common/india_fno_config.json) (current as of **21 Nov 2026**: NIFTY 65, BANKNIFTY 30, FINNIFTY 60, MIDCPNIFTY 120; options STT 0.15%, futures STT 0.05%).

When NSE changes something, edit that file and run:
```bash
python3 scripts/sync_india_common.py
```
**Add the 2027 NSE holiday list when NSE publishes it in December**, otherwise expiry-date shifts will be missed.

## Tests

```bash
pip install pytest
python3 -m pytest
```

## Credits

The idea and skill-based structure were inspired by [claude-trading-skills](https://github.com/tradermonty/claude-trading-skills) by TraderMonty (MIT License), which is built for US markets. SRK Trading Skills is a separate, India-specific implementation. See [`LICENSE`](LICENSE).

---
name: nse-expiry-calendar
description: Upcoming NSE/BSE index derivative expiry dates (NIFTY weekly Tuesday, BANKNIFTY/FINNIFTY/MIDCPNIFTY monthly last Tuesday, SENSEX weekly Thursday) with holiday shifts and days to expiry. Use for 'when is Nifty expiry', 'is today expiry', 'days to expiry'.
---

# NSE Expiry Calendar

## Workflow
```bash
python3 skills/nse-expiry-calendar/scripts/expiry_calendar.py                 # all indices, next 4
python3 skills/nse-expiry-calendar/scripts/expiry_calendar.py --symbol NIFTY --count 8
python3 skills/nse-expiry-calendar/scripts/expiry_calendar.py --date 2026-11-20 --json
```
## Rules encoded (as of the config date)
- NIFTY: weekly every Tuesday, monthly last Tuesday
- BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50: monthly only, last Tuesday
- SENSEX (BSE): weekly Thursday, monthly last Thursday
- Holiday on expiry → previous trading day

## Maintenance
NSE publishes next year's holiday list each December. Add it under `holidays` in `india_common/india_fno_config.json` and run `python3 scripts/sync_india_common.py`. The script warns when the list is running out.

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

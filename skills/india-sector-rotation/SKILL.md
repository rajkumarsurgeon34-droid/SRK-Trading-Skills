---
name: india-sector-rotation
description: Rank Nifty sectoral indices (Bank, IT, Auto, Pharma, FMCG, Metal, Realty, Energy, PSU Bank…) by relative strength vs NIFTY 50 and place them in Leading / Improving / Weakening / Lagging quadrants. Use when asked which sectors are strong, sector rotation, where money is flowing.
---

# India Sector Rotation

RRG-style view of Nifty sectors versus the NIFTY 50: RS ratio (relative strength vs its 50-day trend) and RS momentum (10-day change).

## Workflow
```bash
python3 skills/nse-data-fetcher/scripts/fetch_data.py sectors --out data/sectors
python3 skills/nse-data-fetcher/scripts/fetch_data.py indices --out data/indices
python3 skills/india-sector-rotation/scripts/sector_rotation.py --data-dir data/sectors --benchmark data/indices/NIFTY.csv
```
## Quadrants
- **Leading** (strong and strengthening): look for longs here first
- **Improving** (weak but turning up): early rotation candidates
- **Weakening** (strong but slowing): tighten stops, book partial profits
- **Lagging** (weak and weakening): avoid longs; short candidates in F&O stocks

Combine with `nse-stock-screener` — pick stocks from Leading/Improving sectors.

## Important

Educational decision-support only, not SEBI-registered investment advice. Exchange rules, lot sizes and charges change — `india_fno_config.json` holds the values used (check its `as_of` date). All trading decisions are the user's own.

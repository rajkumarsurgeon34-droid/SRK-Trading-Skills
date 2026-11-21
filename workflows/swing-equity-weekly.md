# Workflow: Swing Equity (weekend scan)

**When:** Saturday/Sunday. **Time:** ~30–45 minutes.

1. **nse-data-fetcher** — `ohlcv --symbols-file nifty500.txt`, `indices`, `sectors`
2. **india-market-regime** — only hunt for longs on `normal` or `aggressive`
3. **india-sector-rotation** — note Leading and Improving sectors
4. **nse-stock-screener** — `--screen vcp --screen breakout --screen momentum --screen relative`, keep stocks from strong sectors
5. **nse-technical-analyst** — shortlist 3–5; define entry (pivot), stop (ATR/structure), target
6. **nse-position-sizer** `equity` — shares per stock, 0.5–1% risk each
7. **pre-trade-checklist** — check results dates (event risk) before placing GTT orders
8. **india-trade-journal** — log entries and exits

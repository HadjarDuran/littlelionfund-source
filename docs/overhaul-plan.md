---
title: "LLF Dashboard Overhaul — Plan"
type: plan
status: complete
date: 2026-11-18
updated: 2026-11-18
summary: "Plan for the Little Lion Fund dashboard overhaul: full trade-history import, benchmarks, pro chart controls, right-side navigation, light/dark theme, motion, and a QA pass."
owner: shared
project: littlelionfund
---

# LLF Dashboard Overhaul — Plan

> [!note] Where this lives
> Meant for the Obsidian second brain. The vault connector was down
> (502) when work started, so it is kept here in the repo until it can be
> copied over.

## Decisions (confirmed 2026-11-18)

| Question | Decision |
|---|---|
| Role of the Master File trade ledger | **History layer.** Every trade from the ledger becomes a Transactions dataset (activity feed, realized gains, past holdings, chart trade markers). Current Holdings stay the editable source of truth. A new "Add transaction" flow updates both. |
| More data coming? | No. Master File + the existing 166-month unit value history in Redis. |
| Theme | Light + dark, follows the device by default, with a manual toggle. |
| Chart depth | Pro controls on line charts. No candlesticks or indicators. |
| Navigation | Left-side panel (desktop), collapsible to icons. Bottom bar + slide-in sheet on mobile. (Was right-side; switched to left at the user's request mid-build.) |
| Motion | Clean motion everywhere. All of it honours `prefers-reduced-motion`. |

The user overrode CONTEXT.md's "not a trading platform" guidance for chart
controls only. The line is still no order entry, no intraday or streaming
data, no indicators.

## Workstreams

### 1. Historical data
- [x] `Lion/scripts/import_ledger.py`: Master File → `Lion/data/ledger.json` (924 buys, 160 grouped sells from 607 lot rows, 14 split/spinoff events, 127 tickers, 2012-05-29 → 2026-10-15). Re-runnable. Cross-checks open shares against the sheet's own Total rows (22/23 match).
- [x] `api/transactions.js`: GET returns trades added in the app since the import. POST (holdings password) appends one.
- [x] Activity view: filterable feed, realized gains by year (short/long term), closed positions with holding period and P&L.
- [x] Trade markers on single-stock charts.

### 2. Benchmarks
- [x] S&P 500 (SPY), Nasdaq-100 (QQQ), Dow (DIA), Russell 2000 (IWM), Total Market (VTI).
- [x] Sector SPDR ETFs mapped to LLF sectors (XLK, XLC, XLP, XLY, XLV, XLI, XLF, XLE+XLU).
- [x] Fund-vs-benchmark return table (1M / 3M / YTD / 1Y / 3Y / 5Y / since inception), using the real unit value series.

### 3. Chart engine (pro controls)
- [x] Multi-series overlays (portfolio + any benchmarks).
- [x] Y-axis: $ value vs % return, linear vs log, auto-fit vs from-zero, manual min/max.
- [x] Range presets (1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, Max) + custom date range.
- [x] Crosshair with a tooltip covering every series; drag-to-measure kept.
- [x] Series source toggle: *Fund unit value (actual)* vs *Current holdings (hypothetical backtest)*, labelled honestly.

### 4. Shell, theme, motion
- [x] Left-side nav panel, collapsible. Mobile bottom bar + "More" sheet.
- [x] Design tokens for light/dark. Toggle saved per device.
- [x] Motion: view transitions, staggered card entrances, count-up KPIs, line draw-in, price-change flash, hover lift. Reduced-motion safe.
- [x] Command-palette style quick search (⌘K / `/`) to jump to any holding or view.

### 5. Google-Finance-style "Add transaction"
- [x] One modal: Buy/Sell toggle, ticker, date, shares, price (prefilled with that day's close), fee.
- [x] Buy recalculates weighted average cost. Sell keeps average cost and records realized gain.

### 6. QA fixes found in the review
- [x] Holdings and cash were POSTed back to the server on every load and every 2-min refresh (`updateSummary(true)` in `loadAll`).
- [x] `fetchWithRetry` passed `opts` as the timeout → `setTimeout(…, {})` fired immediately, so single-ticker reloads always "timed out".
- [x] `/api/auth` takes the password in the query string (ends up in logs). Move it to a POST body.
- [x] `/api/hist` and `/api/quote` strip `.` and `-` from tickers (BRK.B etc. break).
- [x] Annualised % blew up for positions held under a year. TTM used a loose ±3-day window.
- [x] Unit Value cards: "Total Return" always shown green with "+"; "S&P since Dec 2018" label was hardcoded.
- [x] Positions table not sortable. Dead `checkHPwd` code. Duplicate modal markup.

### 7. Verification
- [x] Local dev server with mocked APIs (`Lion/scripts/dev-server.js`) so the UI can be QA'd without Vercel.
- [x] Playwright screenshots, desktop and mobile, light and dark. Console-error sweep.

## Known source-data gaps (from the importer)
- CCJ: a 107-share lot bought 2023-01-30 has no recorded sale, but the sheet shows only the 2025 lot as current.
- HTGC (2021-11-02), VTRS (2023-10-10), JBLU (2016-12-27): sales recorded without a price or proceeds.
- LLY, LQDA, MCK: one buy row each with a blank date (dated to the previous lot, flagged "estimated").

## Round 2 (2026-11-18): Cloudflare + live spreadsheet

- [x] Hosting moved to Cloudflare earlier on the `cloudflare-migration` branch. The overhaul was merged onto it: frontend in `Lion/public/`, new Worker route `src/routes/transactions.js`, `/api/auth` takes a POST body (GET kept for the verify workflow), class-share tickers in `/api/hist` and `/api/quote`. 4 new unit tests (17 total, passing). `wrangler deploy --dry-run` bundles cleanly.
- [x] Kept the Cloudflare branch's safety fixes in the new frontend: never save a record that didn't load from the server, show the server's error message, no credits footer.
- [x] Matched the live spreadsheet: weights over invested money (cash excluded), sheet-style "Annual %" (gain ÷ days/360), rebalancing $ on Weightings, live unit value for "since inception".
- [x] Preview server seeded from the live spreadsheet (`scripts/make_dev_fixture.py` → `scripts/dev-fixture.json`): totals match the sheet to the cent ($217,155.83 · $52.8227/unit).
- [x] Unit Value page flags months not yet recorded and likely typos.

### Things found in the live spreadsheet (for a human to check)
- Unit Value by Month stops at Feb 2026 in this copy (Mar–Oct 2026 missing). The daily job now fills the current month going forward.
- Oct 2025 unit value is $67.88 between $58.12 (Sep) and $58.12 (Nov). Likely a typo.
- Recommended Weightings, column E ("S&P in LLF") doesn't add to 100%. The lower table (S&P weight ÷ 0.955) does, and that's what the preview uses.
- The ROI tab's "33.9% annualized" is gain ÷ weighted invested capital ÷ years (not compounded). By unit value the fund is +448% since May 2012, about 12.5%/yr compounded, vs. the S&P 500's +455% (price only).

## Round 3 (2026-11-18): short-term prices and the sector debrief

- [x] 1D / 1W views from Yahoo Finance's free intraday bars (`/api/intraday`), cached minutes and expiring within 24 h. Verified on production.
- [x] Sector debrief page (`#/debrief/<sector>/<ticker>`) for the morning meeting: each stock on the left, the whole sector (value-weighted) on the right, keyboard stepping, full-screen Present mode.

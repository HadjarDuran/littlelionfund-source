# Little Lion Fund dashboard

The live dashboard for the Little Lion Fund, the student-run investment fund
at State College Area High School. Read [CONTEXT.md](CONTEXT.md) first for
*why* it exists and who it's for.

Plain HTML/CSS/JS with no build step, served by a **Cloudflare Worker** that
also answers every `/api/*` route. Data lives in Upstash Redis. Everything
deployable lives in `Lion/`. Deploy and secrets setup:
[Lion/CLOUDFLARE_SETUP.md](Lion/CLOUDFLARE_SETUP.md).

## Run it on your laptop

**Preview with realistic data (no secrets needed):**

```bash
node Lion/scripts/dev-server.cjs
```

Open http://localhost:5173. Every `/api/*` route is mocked. Fund data
(holdings, cost basis, cash, units, sector targets, unit value history) comes
from `Lion/scripts/dev-fixture.json`, a snapshot of the live spreadsheet.
**Prices are simulated** (pinned to the sheet's current price, its price one
year ago and every real trade price, but made up in between), so never use a
preview chart as real data. The password for every lock is `dev`.

To refresh the snapshot from a newer copy of the spreadsheet:

```bash
python3 Lion/scripts/make_dev_fixture.py "path/to/Little Lion Fund Live Spreadsheet.xlsx"
```

**The real Worker against the real database:** copy `Lion/.dev.vars.example`
to `Lion/.dev.vars`, fill it in, then `cd Lion && npm install && npm run dev`.
This reads and writes the live data.

**Tests:** `cd Lion && npm test`.

## Where things live

| Path | What it is |
|---|---|
| `Lion/public/index.html` | Page shell. Loads the CSS and scripts below, in order. |
| `Lion/public/css/app.css` | The design system: light/dark colour tokens at the top, then layout, components, motion. Change colours only in the token blocks. |
| `Lion/public/js/icons.js` | Bundled [Lucide](https://lucide.dev) icons (ISC licence). `icon('chart-line')`. No icon CDN. |
| `Lion/public/js/util.js` | Formatting, dates, safe HTML escaping, local storage, count-up animation. |
| `Lion/public/js/data.js` | **All data and maths**: loading from `/api`, sectors and benchmarks, positions, totals, realized gains, the time series behind every chart. Also the "never save what didn't load" guard. |
| `Lion/public/js/chart.js` | The chart engine (plain SVG): line chart with crosshair, drag-to-measure, $/% mode, linear/log scale, y-range control, trade markers. Plus sparkline, donut, bar chart. |
| `Lion/public/js/ui.js` | Shared UI: toasts, modals, popovers, lock screen, sortable tables, and `chartCard()`, the full chart panel with range/compare/axis/table controls. |
| `Lion/public/js/views/*.js` | One file per page. Each registers itself in `VIEWS`. |
| `Lion/public/js/app.js` | Routing (`#/performance`, `#/stock/AAPL` …), the left navigation rail, theme, ⌘K search, boot and background refresh. |
| `Lion/public/data/ledger.json` | The fund's full trade history 2012→, generated from the Master File. Don't hand-edit. |
| `Lion/src/worker.js` | The Worker: routes `/api/*` to `src/routes/*.js`, runs the daily NAV snapshot (cron). |
| `Lion/src/lib/` | Auth tokens, Redis client, holdings diff, transaction validation (all unit-tested in `Lion/test/`). |
| `Lion/scripts/` | Developer tools (ledger import, preview server, fixture builder, CI deploy). Not served: only `public/` is. |
| `.github/workflows/` | Tests, deploy, live-site verification, and repair tools (restore holdings, rebuild NAV days). |

### Pages

| Page | Route | Who |
|---|---|---|
| Overview | `#/` | Everyone: fund value, KPIs, performance vs S&P, returns table, positions, allocation, movers, recent trades |
| Performance | `#/performance` | Everyone: big chart with all controls, returns vs benchmarks, holdings grid |
| Stock detail | `#/stock/TICKER` | Everyone: price chart with the fund's buy/sell markers, position stats, full trade history. Works for past holdings too |
| Sectors | `#/sectors`, `#/sectors/Name` | Everyone: each sector vs its SPDR sector ETF and vs target weight |
| Activity | `#/activity` | Everyone: every trade since 2012, realized gains by year, past holdings, data-quality notes |
| Holdings | `#/holdings` | Managers (password): Add transaction, edit positions, cash and units |
| Weightings | `#/weightings` | Managers (weightings password): sector targets vs actual vs S&P, with $ to rebalance |
| Unit Value | `#/unitvalue` | Managers (holdings password): the official month-end unit value record; flags missing months and likely typos |

Keyboard: `⌘K` or `/` search, `1`–`7` switch pages, `[` collapse the nav.

## API (`Lion/src/routes/`)

| Route | Read | Write (needs a manager token) |
|---|---|---|
| `/api/holdings` | current positions `[{t, n, s, sh, ac, d, vlSafety?, vlTimeliness?}]` | replace all (refuses an empty list; appends a diff to `holdings_log`) |
| `/api/cash` | `{bank, brokerage}` | replace |
| `/api/units` | `{units}` | replace |
| `/api/weightings` | `[{s, p, sp}]` | replace (weightings password) |
| `/api/unitvalue` | `[{d: "M/D/YYYY", u, sp}]` month-end record | replace |
| `/api/transactions` | trades recorded in the app since the import | `{action:'add', txn}` / `{action:'delete', id}` |
| `/api/auth` | — | `POST {pwd, type}` → 12-hour token (`GET ?pwd=` still accepted for the verify workflow) |
| `/api/quote?ticker=` | Finnhub live quote | — |
| `/api/hist?ticker=` | daily closes (Stooq, Yahoo fallback), last good copy kept in Redis | — |
| `/api/nav-history` | daily NAV snapshots written by the cron | correct specific days |
| `/api/holdings-log` | holdings change log | — |

Worker secrets (set in Cloudflare, never in the repo): `HOLDINGS_PWD`,
`WEIGHTINGS_PWD`, `FINNHUB_KEY`, `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or
the `LION_` prefixed versions), `SESSION_SECRET` (recommended).

## Updating the trade history from the Master File

The Activity page, realized gains, past holdings and chart trade markers come
from the fund's "LLF Activity - Master File.xlsx" spreadsheet.

```bash
pip install openpyxl
python3 Lion/scripts/import_ledger.py "path/to/LLF Activity - Master File.xlsx"
```

That rewrites `Lion/public/data/ledger.json`. Read the warnings it prints
(rows it couldn't classify, missing dates or prices, open positions that don't
match the sheet's own Total rows). Fix those in the spreadsheet if you can,
re-run, then commit `ledger.json` and deploy. The same warnings are shown to
everyone on the Activity page, so gaps are never hidden.

Trades recorded with **Holdings → Add transaction** are stored separately in
Redis (`/api/transactions`) and shown alongside the imported history, so
re-importing never wipes them. If the Master File later includes a trade that
was also recorded in the app, delete the app copy from the Holdings page.

## How the numbers work (worth knowing before changing them)

- **Fund performance, long term** = the hand-recorded month-end unit value
  (`/api/unitvalue`). It's the only series that includes cash, fees and every
  past holding, so it's what the returns table and "Since 2012" use.
- **Holdings line, %** = time-weighted return of *today's* holdings: a new
  purchase adds value but not "performance", so the line doesn't jump when
  cash is invested. **Holdings line, $** = market value of today's holdings
  from each purchase date. That one does step up at purchases, and it says so.
- **Benchmarks** are ETFs (SPY, QQQ, DIA, IWM, VTI, sector SPDRs), price
  return only (no dividends). In $ mode they're rebased to the fund's starting
  value; in % mode everything starts at 0%. One y-axis, always.
- **Matches the live spreadsheet.** Portfolio weight = market value ÷
  invested total (cash excluded). "Annual %" = total % gain ÷ (days held ÷
  360), the formula behind the sheet's "Annual % Gain or Loss" column. It's a
  simple average, not compounded; the stock page shows the compounded rate
  next to it. Weightings' "Target $" and "To rebalance" are the sheet's
  "Proposed $" and "Change $".
- **Returns-table annualizing** (periods over a year) is compounded, so the
  fund and the benchmarks are measured the same way.
- **"Since 2012"** compares today's live unit value with the first recorded
  month (May 2012). The ROI tab in the spreadsheet uses a different method
  (gain ÷ weighted invested capital ÷ years), so its "annualized" figure is
  much higher than the compounded one here. Neither is wrong; they answer
  different questions.
- **Price histories** come from Stooq, then Yahoo, and the last good copy
  is kept in Redis. A download is only accepted if it reaches the last few
  days (a source once served an S&P file that stopped in mid-October). If
  every source is behind, charts say "thru <date>" on that line and the
  returns table shows "prices thru <date>" instead of a wrong number. To
  preview that state: `STALE=SPY node Lion/scripts/dev-server.cjs`.
- **"Dividend reinvestment"** in Activity is a heuristic: a buy under $100
  into a position that's already open. The ledger records DRIP purchases as
  ordinary buys.

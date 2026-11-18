# Little Lion Fund dashboard

The live dashboard for the Little Lion Fund, the student-run investment fund
at State College Area High School. Read [CONTEXT.md](CONTEXT.md) first for
*why* it exists and who it's for.

Plain HTML/CSS/JS with no build step, hosted on Vercel, with Vercel serverless
functions and Upstash Redis (Vercel KV) for data. Everything deployable lives
in `Lion/`.

## Run it on your laptop (fake data)

```bash
node Lion/scripts/dev-server.js
```

Open http://localhost:5173. Every `/api/*` route is mocked with deterministic
fake prices, so it works with no internet, keys or database. The password for
every lock is `dev`. **The numbers are not real.** Never screenshot it for
investors.

## Where things live

| Path | What it is |
|---|---|
| `Lion/index.html` | Page shell. Loads the CSS and scripts below, in order. |
| `Lion/css/app.css` | The design system: light/dark colour tokens at the top, then layout, components, motion. Change colours only in the token blocks. |
| `Lion/js/icons.js` | Bundled [Lucide](https://lucide.dev) icons (ISC licence). `icon('chart-line')`. No icon CDN. |
| `Lion/js/util.js` | Formatting, dates, safe HTML escaping, local storage, count-up animation. |
| `Lion/js/data.js` | **All data and maths**: loading from `/api`, sectors and benchmarks, positions, totals, realized gains, the time series behind every chart. |
| `Lion/js/chart.js` | The chart engine (plain SVG): line chart with crosshair, drag-to-measure, $/% mode, linear/log scale, y-range control, trade markers. Plus sparkline, donut, bar chart. |
| `Lion/js/ui.js` | Shared UI: toasts, modals, popovers, lock screen, sortable tables, and `chartCard()`, the full chart panel with range/compare/axis/table controls. |
| `Lion/js/views/*.js` | One file per page. Each registers itself in `VIEWS`. |
| `Lion/js/app.js` | Routing (`#/performance`, `#/stock/AAPL` …), the left navigation rail, theme, ⌘K search, boot and background refresh. |
| `Lion/api/*.js` | Vercel serverless functions (see below). |
| `Lion/data/ledger.json` | The fund's full trade history 2012→, generated from the Master File. Don't hand-edit. |
| `Lion/scripts/` | Tools for developers, not deployed (`.vercelignore`). |

### Pages

| Page | Route | Who |
|---|---|---|
| Overview | `#/` | Everyone: fund value, KPIs, performance vs S&P, returns table, positions, allocation, movers, recent trades |
| Performance | `#/performance` | Everyone: big chart with all controls, returns vs benchmarks, holdings grid |
| Stock detail | `#/stock/TICKER` | Everyone: price chart with the fund's buy/sell markers, position stats, full trade history. Works for past holdings too |
| Sectors | `#/sectors`, `#/sectors/Name` | Everyone: each sector vs its SPDR sector ETF and vs target weight |
| Activity | `#/activity` | Everyone: every trade since 2012, realized gains by year, past holdings, data-quality notes |
| Holdings | `#/holdings` | Managers (password): Add transaction, edit positions, cash and units |
| Weightings | `#/weightings` | Managers (weightings password): sector targets vs actual vs S&P |
| Unit Value | `#/unitvalue` | Managers (holdings password): the official month-end unit value record |

Keyboard: `⌘K` or `/` search, `1`–`7` switch pages, `[` collapse the nav.

## API (Vercel functions in `Lion/api/`)

| Route | Read | Write (needs a manager token) |
|---|---|---|
| `/api/holdings` | current positions `[{t, n, s, sh, ac, d, vlSafety?, vlTimeliness?}]` | replace all (also appends a diff to `holdings_log`) |
| `/api/cash` | `{bank, brokerage}` | replace |
| `/api/units` | `{units}` | replace |
| `/api/weightings` | `[{s, p, sp}]` | replace (weightings password) |
| `/api/unitvalue` | `[{d: "M/D/YYYY", u, sp}]` month-end record | replace |
| `/api/transactions` | trades recorded in the app since the import | `{action:'add', txn}` / `{action:'delete', id}` |
| `/api/auth` | — | `POST {pwd, type}` → 12-hour token |
| `/api/quote?ticker=` | Finnhub live quote | — |
| `/api/hist?ticker=` | daily closes (Stooq, Yahoo fallback), cached 1 h at the edge | — |
| `/api/nav-history`, `/api/holdings-log` | daily NAV snapshots (cron), holdings change log | — |

Environment variables on Vercel: `FINNHUB_KEY`, `HOLDINGS_PWD`,
`WEIGHTINGS_PWD`, `SESSION_SECRET` (recommended), `CRON_SECRET`,
`KV_REST_API_URL` / `KV_REST_API_TOKEN` (or the `LION_` prefixed versions),
`CREDITS_TEXT` (optional).

## Updating the trade history from the Master File

The Activity page, realized gains, past holdings and chart trade markers come
from the fund's "LLF Activity - Master File.xlsx" spreadsheet.

```bash
pip install openpyxl
python3 Lion/scripts/import_ledger.py "path/to/LLF Activity - Master File.xlsx"
```

That rewrites `Lion/data/ledger.json`. Read the warnings it prints (rows it
couldn't classify, missing dates or prices, open positions that don't match
the sheet's own Total rows). Fix those in the spreadsheet if you can, re-run,
then commit `ledger.json` and deploy. The same warnings are shown to everyone
on the Activity page, so gaps are never hidden.

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
- **Annualized** returns are shown only after a full year (shorter periods
  annualize into nonsense).
- **"Dividend reinvestment"** in Activity is a heuristic: a buy under $100
  into a position that's already open. The ledger records DRIP purchases as
  ordinary buys.

# Little Lion Fund Dashboard — Context

This file exists to keep everyone (present and future) grounded in *why* this
project exists before we start changing *what* it looks like. Read this
before making product or design decisions — code-level and deployment notes
live in the app itself and in commit history; this is the "why."

## What the Little Lion Fund is

The Little Lion Fund is a student-run investment fund at State College Area
High School. It holds real money, invested by real outside investors, and
the portfolio is managed by students. This is not a simulation, a paper-
trading exercise, or a classroom exercise with fake money — decisions made
here have real financial consequences for real people, and the fund's
credibility rests on being run seriously.

## What this dashboard is for

The dashboard is the shared window into the fund for two different
audiences, both of whom need it for the same underlying reason: **so nobody
has to ask a student manager for a spreadsheet or a status update.**

- **Investors** — people who put money into the fund. They want to check
  how their investment is doing, see what it's invested in, and trust that
  what they're looking at is accurate and current. They are not day-trading
  the fund's holdings through this tool; they're checking in.
- **Student fund managers** — the students running the fund need a fast,
  low-friction way to record what they've actually done (bought/sold a
  position, moved cash, changed a sector target) so the dashboard reflects
  reality without a developer having to intervene every time.

Before this project, that "window" barely existed in a usable form — this
dashboard is what makes the fund's activity visible and legible to both
groups without manual reporting.

## Who's building it

The dashboard was originally hand-built by a previous student developer.
It's now being carried forward by a new student, using AI-assisted
development (this Claude Code project) to keep moving quickly without a
professional engineering team behind it. That fact should shape every
decision below: **there is no ops team, no on-call, no dedicated designer.**
Whatever gets added has to be something a student, working part-time around
a full course load, can understand, run, and fix a year from now — possibly
a different student than the one reading this.

## Current state (brief, as of this writing)

- Single-page app (vanilla HTML/JS) hosted on Vercel, with serverless
  functions for data and quotes.
- Data lives in Upstash Redis (Vercel KV): current holdings, cash, sector
  weightings, and monthly unit-value history (166 months, imported from the
  fund's real historical spreadsheet). A daily cron job now snapshots NAV
  going forward automatically.
- Live prices come from Finnhub; historical price series come from Stooq,
  falling back to Yahoo Finance.
- Tabs today: **Dashboard** (top-line value, P&L, positions, allocation),
  **Sectors** (sector-level performance + holdings), **Performance** (total
  equity chart with timeframe selection, per-holding drill-down),
  **Holdings**, **Weightings**, and **Unit Value** (the last three are
  password-gated for editing by fund managers).
- Recent work has mostly been correctness and trust fixes — charts were
  showing distorted/unrealistic swings from data-handling bugs (staggered
  price feeds, holdings projected backward before their purchase date).
  That kind of bug is worth taking seriously here specifically *because*
  real investors are looking at these numbers.

## Design philosophy going forward

- **This is not a trading platform.** No order execution, no real-time tick
  data, no options/margin/derivatives-style analytics. The comparison class
  is closer to a small fund's investor letter or a simple brokerage
  summary page than a trading terminal.
- **Sustainability beats sophistication.** Every feature added is a feature
  some future student has to understand and maintain. When in doubt, prefer
  the boring, well-understood choice over the impressive one.
- **Trust and clarity over flash.** Real money, real investors, and student
  credibility are on the line. Numbers need to be correct and easy to read
  in plain language before anything gets to look impressive. A confident,
  clean, professional presentation matters more than dense analytics.
- **Two jobs, kept simple:** an investor should be able to answer "how is
  my money doing?" in under 30 seconds without confusion; a student manager
  should be able to record a real-world change (a trade, a cash move, a
  target shift) without needing to touch code.

## Next step: research

We're about to look at what best-in-class dashboards do for a similar
audience — software that presents portfolio/fund information to a group of
people or investors — to figure out what patterns are worth borrowing.
Ground rules for that research, given everything above:

- Look at tools built for **small funds, family offices, endowments, or
  investor-update products** (e.g. simple investor-letter-style reporting,
  retail brokerage summary views, cap-table/investor-update tools) rather
  than professional trading terminals (Bloomberg, TradingView, etc.) — the
  latter solve a different problem for a different audience.
- The question to keep asking while looking at any given product: **"does
  this make an investor feel more informed and confident, and could two
  student developers actually build and maintain something like it?"** If
  the answer to the second half is no, it's not a fit here, no matter how
  good it looks.
- We are explicitly *not* looking to add: complex risk analytics, technical
  trading indicators, real-time streaming data, or anything that reads as
  "trying to be a professional trading platform." That was an explicit,
  deliberate choice earlier in this project's life and still holds.

The output of this research should be a short, prioritized list of concrete
patterns or changes worth making — not a redesign from scratch, and not a
feature wishlist disconnected from what a small student team can sustain.

---
title: "How the dashboard calculates the fund's numbers: review after class feedback"
type: report
date: 2026-11-20
summary: "Checks the dashboard's performance numbers against Luke Alexander's comments and Mrs. Miller's question. The +1,212% line was a what-if, not the fund's return; MCK, LQDA and RKLB trade records were misread; one unit value typo drove the -22% 1-year figure."
project: littlelionfund
---

# How the dashboard calculates the fund's numbers

Written after Luke Alexander's comments and Mrs. Miller's email (Nov 2026).
Short version: **the class was right.** The big "+1,212% vs. +420%" chart was
not the fund's real return. Part of the trade history was misread. One
typo in the unit value record made the last year look worse than it was.
All of these are fixed on the work branch. Nothing in the Master File was
changed. It was read from a copy only.

## 1. "We haven't outperformed the S&P by that much" (comment 5)

That chart line was **not the fund's return.** It was the "Holdings" view:
it took the stocks the fund owns today and priced them back to the date each
was first bought. AAPL, for example, was counted from 2012.

That is a hindsight backtest. It:

- leaves out every stock the fund sold along the way, including the losers;
- leaves out the cash the fund held;
- counts today's winners from their very first purchase.

So over long periods it always looks far better than the fund really did.
Mrs. Miller's guess was close: the line used purchase dates, not the fund's
actual record.

**The fund's actual record is the month-end unit value.** It includes cash,
fees and every stock ever held, and it doesn't depend on trade dates at all.

| Since May 2012 (to Nov 17, 2026) | Total | Per year (compounded) |
|---|---|---|
| Little Lion Fund (unit value $9.63 → $51.54) | **about +435%** | about 12.3% |
| S&P 500 (SPY, price only) | about +420% | about 12.0% |

Over the whole history, the fund has roughly **matched** the S&P 500's price.
The fund's unit value includes reinvested dividends; the S&P figure doesn't.
With dividends, the S&P would be ahead by roughly 1.5 to 2 points a year.

**Changed:**

- Every performance chart now defaults to **Unit value**.
- The other view is renamed **"Today's holdings (what-if)"**. Over any range
  longer than a year it shows a warning: "What-if, not the fund's return".

## 2. "Only up 6.3% in 5 years, down 22% in one year?" (comment 6)

Two separate problems:

- **The 5-year column showed a per-year rate, not a total.** +6.3% a year is
  about +36% in total. As of Nov 17 the 5-year total is about **+29%**,
  measured from Nov 2021, which was near the 2021 peak.
  - The returns table now shows the **total** return. For periods longer than
    a year, it also shows the per-year rate underneath (for example
    "+32.6%, then 5.8%/yr").
- **The 1-year figure used a typo as its starting point.** The record shows
  Oct 2025 at **$67.88**, between $58.12 (Sep) and $58.12 (Nov). That looks
  like a typo.
  - Measured from $67.88, the year reads **−24%**. Measured from the real
    level (Nov 2025, $58.12), it is **about −11%**.
  - The dashboard now leaves any month that jumps more than 10% and comes
    straight back out of the returns and charts, and says so in the returns
    table's footnote.
  - The Oct 2025 entry should still be **corrected on the Unit Value page**:
    edit the month, password required.

**Still true:** 2026 has been a weak year. The unit value fell from $58.45
(Dec 2025) to $51.54 (Nov 17), about −12%, while the S&P rose. That's the
real number.

## 3. MCK "bought $3K+ in July" (comment 2)

The Master File's MCK block ends with a line that is a running total but
isn't labelled "Total":

> row 218: no date, no price, 3.4725 sh, $3,203.74.

The importer read it as a purchase, dated it to the lot above (July 2,
2026), and so doubled the position. The same thing happened to **LQDA**
(row 176).

**Fixed:** a row with shares but no date and no price is now treated as a
total and skipped.

MCK's real history in the Master File:

- sold Feb 6, 2026;
- bought back **Mar 6, 2026**: 3.4689 sh at $922.47 ($3,200.95);
- a $2.78 dividend reinvestment on Jul 2.

The live spreadsheet still gives MCK a purchase date of Apr 5, 2023. The
Data → Checks tab flags that.

## 4. "We never sold RKLB" (comment 3)

Correct. The Master File records an RKLB **buy** on Oct 15, 2026 (74.7 sh,
$4,001) and no sale. The dashboard listed RKLB as a past holding only
because RKLB is **missing from the live site's Holdings**: it was never
added there.

**Fixed:** "Past holdings" now lists only positions the trade history shows
being sold. A stock that was bought, never sold, and isn't in Holdings is
shown as a data check instead. On the live site, that will be RKLB.

**To do (a person, with the holdings password):** add RKLB on the Holdings
page.

Until then, the live fund value leaves out about $4,000 of stock. The
brokerage cash may also still include the money that paid for it.

## 5. Sector targets (comment 4)

A target can now be left **blank**. On Weightings, after unlocking, the
**Clear all targets** button blanks them all; the S&P weights stay. With no
targets set, the site shows actual weights vs. the S&P only: no target
ticks, no "drift", no "buy/trim to target".

When the class sets new targets, type them in and save.

## 6. "Can we see the data running the charts?" (Mrs. Miller)

There's a new **Data** page in the left menu. It is read-only and has a
**Download CSV** button on every tab.

| Tab | What it shows |
|---|---|
| How it's calculated | Each number on the site, what it's built from, and where to check it. |
| Unit value | Every month-end entry, the change from the prior month, and whether it's used in returns. |
| Daily snapshots | The automatic after-close value of the fund each day. |
| Trades | Every buy and sale, with the **Master File row number** it came from. Flags missing or estimated dates. |
| Holdings | The Holdings page vs. what the trade history adds up to: shares and purchase dates side by side. |
| Checks | Everything that doesn't add up, in one list. |

**Rearranging the Master File isn't needed for the dashboard.** The two
things that would help most are:

1. label the MCK and LQDA running-total rows "MCK Total" and "LQDA Total";
2. give the LLY row 165 dividend reinvestment its date (likely Mar 11, 2025).

The importer handles both cases now either way.

## 7. Other things found

- **Daily snapshot bug.** If a stock's price failed to load, the after-close
  job counted that stock as $0. LQDA on Nov 17 knocked about 1.3% off that
  day's value.
  - **Fixed:** the job now uses the stock's last good price.
  - If a stock has no price at all, the job skips updating the month's unit
    value rather than writing a number that's too low.
- **Months missing from the record.** The unit value record has no entries
  for Mar–Oct 2026; the daily job only started filling months in from
  Sep 2026. Charts draw a straight line across the gap. Typing those months
  in on the Unit Value page fixes it.
- **Units.** The unit value is fund value ÷ units (4,111.03, unchanged). If
  money was ever added to or taken out of the fund without changing the
  units, the unit value moved for a reason that wasn't investment
  performance. Worth confirming with Mrs. Miller.
- **CCJ.** The trade history has a 2023 CCJ lot with no sale, so it adds up
  to 175 shares; Holdings has 68. The dashboard uses Holdings and flags the
  difference.

## 8. Draft: a whole sector on one page (comment 1)

Sector debrief now has a layout switch: **One at a time** (as before) or
**Whole sector (draft)**. The draft shows:

- the sector's own weighted line vs. its sector ETF across the top;
- a small chart for every holding in the sector, each against the sector as
  a whole, with its return, its share of the sector and today's move;
- the sector summary on the right, as before.

Clicking a stock opens it in "One at a time" for discussion. It's labelled
"draft" until the class has used it.

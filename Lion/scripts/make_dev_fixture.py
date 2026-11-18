#!/usr/bin/env python3
"""
Builds Lion/scripts/dev-fixture.json from the fund's live spreadsheet
("Little Lion Fund Live Spreadsheet.xlsx"), so the local preview server
(scripts/dev-server.cjs) shows the fund's real holdings, cash, units, sector
targets and unit value history instead of made-up numbers.

    pip install openpyxl
    python3 Lion/scripts/make_dev_fixture.py "path/to/Little Lion Fund Live Spreadsheet.xlsx"

Only used for local previews and QA. The deployed site always reads the
live database. Prices in the preview are still simulated, but each path is
pinned to the sheet's current share price and its "price one year ago", so
today's totals match the sheet to the cent.
"""
import datetime as dt
import json
import sys
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parent / "dev-fixture.json"

# Section headings on the LLF tab → the sector names the app uses.
SECTOR_NAMES = {
    "Information Technology": "Information Technology",
    "Communication Services": "Communication Services",
    "Consumer Staples": "Consumer Staples",
    "Consumer Discretionary": "Consumer Discretionary",
    "Health Care": "Health Care",
    "Industrials": "Industrials",
    "Financials": "Financials",
    "Energy": "Energy + Utilities",
    "Energy + Utilities": "Energy + Utilities",
}
# Short names on the weightings tabs → app sector names.
WEIGHT_NAMES = {
    "Info Tech": "Information Technology", "Comm Svcs": "Communication Services", "Cons Staples": "Consumer Staples",
    "Cons Disc": "Consumer Discretionary", "Health Care": "Health Care", "Healthcare": "Health Care",
    "Industrials": "Industrials", "Financials": "Financials", "Energy": "Energy + Utilities",
    "Energy + Utilities": "Energy + Utilities",
}


def iso(v):
    return v.strftime("%Y-%m-%d") if isinstance(v, (dt.datetime, dt.date)) else None


def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)

    # ---- LLF tab: holdings, cash, units ----
    ws = wb["LLF"]
    as_of = None
    holdings, prices, cash, units = [], {}, {}, None
    sector = None
    for row in ws.iter_rows(values_only=True):
        row = list(row) + [None] * 20
        if as_of is None and isinstance(row[0], dt.datetime):
            as_of = iso(row[0])
        a = row[0].strip() if isinstance(row[0], str) else None
        if a and a in SECTOR_NAMES:
            sector = SECTOR_NAMES[a]
            continue
        name, ticker = row[1], row[3]
        if isinstance(ticker, str) and ticker.strip().isupper() and num(row[5]):
            t = ticker.strip()
            holdings.append({"t": t, "n": str(name).strip(), "s": sector, "sh": round(num(row[5]), 4),
                             "ac": round(num(row[6]), 4), "d": iso(row[4])})
            prices[t] = {"c": num(row[8]), "y1": num(row[14])}
        label = str(row[1] or "").strip()
        if label == "Cash - Bank":
            cash["bank"] = num(row[9])
        elif label == "Cash - Brokerage":
            cash["brokerage"] = num(row[9])
        elif label == "Total Units in Fund":
            units = num(row[4])

    # ---- Recommended Weightings tab: proposed % and S&P-in-LLF % ----
    # Column A is each sector's actual S&P 500 weight. "S&P in LLF" rescales the
    # eight sectors the fund holds to 100% (A / sum of A), same as the
    # sheet's lower comparison table. Column E's header says "S&P in LLF" but
    # its values don't add to 100%, so it isn't used.
    weightings, raw = [], []
    ws = wb["Recommended Weightings"]
    for row in ws.iter_rows(min_row=2, max_row=12, values_only=True):
        nm = str(row[1] or "").strip()
        if nm in WEIGHT_NAMES and num(row[6]) is not None and num(row[0]) is not None:
            raw.append((WEIGHT_NAMES[nm], num(row[6]), num(row[0])))
    held = sum(r[2] for r in raw) or 1
    for s, proposed, spx_w in raw:
        weightings.append({"s": s, "p": round(proposed * 100, 2), "sp": round(spx_w / held * 100, 2)})

    # ---- Unit Value by Month ----
    uv = []
    ws = wb["Unit Value by Month"]
    for row in ws.iter_rows(min_row=4, values_only=True):
        d, u, sp = row[0], num(row[1]), num(row[2])
        if isinstance(d, dt.datetime) and u:
            uv.append({"d": f"{d.month}/{d.day}/{d.year}", "u": round(u, 4), "sp": round(sp, 2) if sp else None})

    # ---- Return on Investment tab: S&P index level at inception and today ----
    spx = {}
    ws = wb["Return on Investment"]
    for row in ws.iter_rows(min_row=1, max_row=6, values_only=True):
        if row[1] == ".INX" and num(row[2]):
            spx["today"] = {"d": iso(row[3]), "v": num(row[2])}
        if row[0] == "S&P on" and num(row[2]):
            spx["inception"] = {"d": iso(row[1]), "v": num(row[2])}

    out = {"source": Path(path).name, "asOf": as_of, "holdings": holdings, "prices": prices, "cash": cash,
           "units": units, "weightings": weightings, "unitvalue": uv, "spx": spx}
    OUT.write_text(json.dumps(out, indent=1))
    eq = sum(h["sh"] * prices[h["t"]]["c"] for h in holdings)
    total = eq + (cash.get("bank") or 0) + (cash.get("brokerage") or 0)
    print(f"Wrote {OUT}: {len(holdings)} holdings, {len(weightings)} sector targets, {len(uv)} unit value months")
    print(f"Equity ${eq:,.2f} · fund ${total:,.2f} · unit value ${total / units:.4f} (as of {as_of})")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])

#!/usr/bin/env python3
"""
Turns the fund's "LLF Activity - Master File.xlsx" trade ledger into
Lion/public/data/ledger.json, the historical Transactions dataset the dashboard
reads (Activity tab, realized gains, past holdings, chart trade markers).

Usage (from the repo root):
    pip install openpyxl
    python3 Lion/scripts/import_ledger.py "path/to/LLF Activity - Master File.xlsx"

Re-run it whenever the Master File is updated, commit the new ledger.json,
and redeploy. It never touches the live holdings/cash in Redis: current
holdings stay the source of truth for "what do we own right now".

How the "LLF Inventory" sheet is laid out (what this script relies on):
  * One block per ticker. Column A names the ticker on each buy-lot row
    (blank on continuation rows), and the block ends with "<TICKER> Total"
    or just "Total".
  * Columns B-F are a buy lot: date, shares, price/share, commission, total.
  * Columns H-P are a sale of (part of) that lot, matched to the lot on the
    same row: date, shares, price, proceeds, basis/share, basis, gain,
    other deductions, net gain. A lot sold in pieces gets extra rows with
    blank A-F.
  * A "Sold Stocks:" header splits current holdings (above) from closed
    positions (below).
  * Share counts and prices are already split-adjusted in the sheet; the
    "SPLIT 1:7"-style rows are markers only, so they become `split` events
    with no share changes.

Everything the script can't confidently classify is listed in the
`warnings` array of the output and printed at the end, never silently
dropped.
"""
import datetime as dt
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "ledger.json"

# Column indexes (0-based) in "LLF Inventory".
A, B, C, D, E, F = 0, 1, 2, 3, 4, 5
H, I, J, K, L, M, N, O, P = 7, 8, 9, 10, 11, 12, 13, 14, 15
R = 17  # running "remaining shares" column

# Ledger names → the ticker the fund actually held. Old names are kept as
# their own tickers (FB, PCLN, ...) since that is what was traded; the app
# maps them to today's symbol only when it needs a price history.
NAME_FIXES = {
    "KFT/MDLZ": "MDLZ",   # Kraft Foods Inc. renamed Mondelez Oct 2012
    "KRFT-SPINOFF": "KRFT",
    "KRFT-SALE": "KRFT",
    "KO-SPLIT": "KO",
    "IBB - SPLIT": "IBB",
    "LMT (SHARES LEFT)": "LMT",
    "WM (SOLD PART)": "WM",
    "PTGI-NON DIV DIST": "PTGI",
    "PTGI-SALE": "PTGI",
    "THI - ROUNDING": "THI",
}
SKIP_A = re.compile(r"^(TOTAL|SUBTOTAL|SOLD STOCKS|STOCK|SPINOFF|TOTAL AFTER SPINOFF|NO REMAINING SHARES)\b", re.I)
TICKER = re.compile(r"^[A-Z]{1,5}(\.[A-Z])?$")
SPLIT_TXT = re.compile(r"split\s*:?\s*(\d+)\s*:\s*(\d+)", re.I)


def iso(v):
    """Excel cell → 'YYYY-MM-DD' or None. Repairs '6/27/0206'-style typos."""
    if isinstance(v, dt.datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, str):
        m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s*$", v)
        if m:
            mo, d, y = int(m[1]), int(m[2]), m[3]
            if len(y) == 4 and y.startswith("02"):
                y = "20" + y[2:]          # 0217 → 2017
            elif len(y) == 2:
                y = "20" + y
            try:
                return dt.date(int(y), mo, d).isoformat()
            except ValueError:
                return None
    return None


def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def r2(v, n=2):
    return None if v is None else round(v, n)


def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["LLF Inventory"]

    warnings, buys, sells, events = [], [], [], []
    expected_open = {}          # ticker → remaining shares per the sheet's Total row
    section = "current"
    cur = None
    last_ticker = None          # notes that follow a block's Total row belong to it
    last_buy_date = {}

    def warn(row, msg):
        warnings.append({"row": row, "msg": msg})

    for rn, row in enumerate(ws.iter_rows(min_row=3, values_only=True), start=3):
        row = list(row) + [None] * 20
        a = row[A].strip() if isinstance(row[A], str) else row[A]
        if cur:
            last_ticker = cur

        # "2017-12-01 | Split: 3:1" — a date in column A, note in column B
        if isinstance(a, dt.datetime):
            mm = SPLIT_TXT.search(str(row[B] or ""))
            if mm:
                events.append({"d": iso(a), "t": cur or last_ticker, "type": "split",
                               "ratio": f"{mm[1]}:{mm[2]}", "memo": str(row[B]).strip(), "row": rn})
            else:
                warn(rn, f"Date in column A with no recognisable note: {row[B]!r} — row skipped")
            continue

        # ---- column A: work out which ticker this row belongs to ----------
        if isinstance(a, str) and a:
            up = a.upper()
            if up.startswith("SOLD STOCKS"):
                section, cur = "closed", None
                continue
            m_total = re.match(r"^([A-Z]{1,5}) TOTAL$", up)
            if m_total:
                if section == "current" and num(row[R]) is not None:
                    expected_open[m_total[1]] = num(row[R])
                cur = None
                continue
            if SKIP_A.match(up):
                # Totals / notes. A spinoff or split note still matters.
                if "SPINOFF" in up and iso(row[B]):
                    events.append({"d": iso(row[B]), "t": cur or last_ticker, "type": "spinoff",
                                   "memo": "Spinoff (Kraft Foods Group / KRFT spun off from KFT, now MDLZ)"
                                   if (cur or last_ticker) == "MDLZ" else a, "row": rn})
                if up.startswith("TOTAL") or up.startswith("SUBTOTAL"):
                    cur = None if up.startswith("TOTAL") else cur
                continue
            if up in NAME_FIXES:
                cur = NAME_FIXES[up]
            elif TICKER.match(up):
                cur = up
            else:
                m = SPLIT_TXT.search(a) or re.search(r"split\s*(\d+):(\d+)", a, re.I)
                if m:
                    # e.g. "Split 4:1 7/20/21" sitting on its own row
                    dm = re.search(r"(\d{1,2}/\d{1,2}/\d{2,4})", a)
                    events.append({"d": iso(dm[1]) if dm else None, "t": cur or last_ticker, "type": "split",
                                   "ratio": f"{m[1]}:{m[2]}", "memo": a, "row": rn})
                elif "SPINOFF" in up:
                    events.append({"d": None, "t": cur or last_ticker, "type": "note", "memo": a, "row": rn})
                else:
                    warn(rn, f"Unrecognised label in column A: {a!r} — row skipped")
                continue

        if a == "" or a is None:
            if cur is None:
                # Text-only note rows (e.g. "Wash Sale Disallowed Loss") land here.
                if any(isinstance(x, (int, float, dt.datetime)) for x in row[B:P + 1]):
                    warn(rn, "Numbers on a row with no ticker in scope — row skipped")
                continue

        # Split marker inside a ticker block: "AAPL | 2014-06-09 | SPLIT 1:7"
        for txt in (row[C], row[B]):
            if isinstance(txt, str) and SPLIT_TXT.search(txt):
                m = SPLIT_TXT.search(txt)
                events.append({"d": iso(row[B]), "t": cur, "type": "split",
                               "ratio": f"{m[1]}:{m[2]}", "memo": txt.strip(), "row": rn})
                break
        else:
            pass

        is_split_row = isinstance(a, str) and "SPLIT" in a.upper()

        # ---- buy side -----------------------------------------------------
        b_sh, b_px, b_fee, b_amt = num(row[C]), num(row[D]), num(row[E]), num(row[F])
        if b_sh is not None and b_sh != 0:
            d = iso(row[B])
            est = False
            if d is None and b_px is None and not b_fee:
                # A running-total line without the word "Total" (no date, no
                # price, shares = the lots above it). Counting it would
                # double the position, as it did for MCK and LQDA.
                warn(rn, f"{cur}: row with {b_sh} sh but no date or price looks like an unlabelled "
                         "Total row — skipped (not a purchase)")
                continue
            if d is None:
                d = last_buy_date.get(cur)
                est = True
                warn(rn, f"{cur}: buy of {b_sh} sh has no readable date ({row[B]!r}); "
                         f"dated {d} (previous lot) and flagged as estimated")
            if (b_amt or 0) == 0 and (b_px or 0) == 0:
                events.append({"d": d, "t": cur, "type": "split", "sh": r2(b_sh, 4),
                               "memo": f"{a}: +{b_sh} sh at $0 (split shares)", "row": rn})
            else:
                if b_amt is None and b_px is not None:
                    b_amt = b_sh * b_px + (b_fee or 0)
                buys.append({"d": d, "t": cur, "sh": r2(b_sh, 4), "px": r2(b_px, 4),
                             "fee": r2(b_fee), "amt": r2(b_amt), "est": est or None, "row": rn,
                             "memo": "Post-split lot" if is_split_row else None})
                last_buy_date[cur] = d
        elif isinstance(a, str) and "SPINOFF" in a.upper() and iso(row[B]):
            events.append({"d": iso(row[B]), "t": cur, "type": "spinoff",
                           "memo": f"{cur} shares received in a spinoff", "row": rn})
        elif b_amt is not None and b_amt < 0 and b_sh is None:
            events.append({"d": iso(row[B]), "t": cur, "type": "basis_adj", "amt": r2(b_amt),
                           "memo": f"{a or cur}: cost basis reduced by ${-b_amt:,.2f} (non-dividend distribution)",
                           "row": rn})

        # ---- sell side (only rows with a real sale date; "STCG"/summary
        # rows in column H are tax breakdowns of a sale recorded elsewhere) --
        s_d = iso(row[H])
        s_sh, s_px, s_amt = num(row[I]), num(row[J]), num(row[K])
        if s_d and s_sh:
            basis = num(row[M])
            gain = num(row[N])
            fee = num(row[O]) or 0
            if s_amt is None and s_px is not None:
                s_amt = s_sh * s_px
            if not s_px and not s_amt:
                warn(rn, f"{cur}: sale of {s_sh} sh on {s_d} has no price or proceeds in the sheet; "
                         "recorded with the price marked missing")
                s_px, s_amt, basis, gain = None, None, None, None
            if gain is None and s_amt is not None and basis is not None:
                gain = s_amt - basis
            lot_d = iso(row[B]) or last_buy_date.get(cur)
            sells.append({"d": s_d, "t": cur, "sh": s_sh, "px": s_px, "amt": s_amt,
                          "basis": basis, "gain": gain, "fee": fee, "lot": lot_d, "row": rn})
        elif row[H] is not None and not s_d and not isinstance(row[H], str):
            warn(rn, f"{cur}: unreadable sale date {row[H]!r} — sale skipped")

    # ---- group lot-level sells into one transaction per ticker/date/price --
    grouped = defaultdict(lambda: {"sh": 0.0, "amt": 0.0, "basis": 0.0, "gain": 0.0, "st": 0.0, "lt": 0.0,
                                   "fee": 0.0, "lots": 0, "rows": []})
    for s in sells:
        key = (s["t"], s["d"], round(s["px"] or 0, 4))
        s["nopx"] = s["px"] is None
        g = grouped[key]
        g["sh"] += s["sh"]
        g["amt"] += s["amt"] or 0
        g["nopx"] = g.get("nopx") or s["px"] is None
        g["basis"] += s["basis"] or 0
        g["gain"] += s["gain"] or 0
        g["fee"] += s["fee"] or 0
        g["lots"] += 1
        g["rows"].append(s["row"])
        held_days = None
        if s["lot"]:
            held_days = (dt.date.fromisoformat(s["d"]) - dt.date.fromisoformat(s["lot"])).days
        if held_days is not None and held_days > 365:
            g["lt"] += s["gain"] or 0
        else:
            g["st"] += s["gain"] or 0

    txns = []
    for b in buys:
        txns.append({"d": b["d"], "t": b["t"], "type": "buy", "sh": b["sh"], "px": b["px"],
                     "amt": b["amt"], "fee": b["fee"], "memo": b["memo"], "row": b["row"],
                     **({"est": True} if b["est"] else {})})
    for (t, d, px), g in grouped.items():
        txns.append({"d": d, "t": t, "type": "sell", "sh": round(g["sh"], 4), "px": px,
                     "amt": round(g["amt"], 2), "basis": round(g["basis"], 2),
                     "gain": round(g["gain"], 2), "st": round(g["st"], 2), "lt": round(g["lt"], 2),
                     "fee": round(g["fee"], 2) or None, "lots": g["lots"], "rows": g["rows"],
                     **({"noPx": True, "px": None, "amt": None, "gain": None, "basis": None, "st": None, "lt": None}
                        if g.get("nopx") else {})})
    for e in events:
        e = {k: v for k, v in e.items() if v is not None}
        txns.append(e)
    txns.sort(key=lambda x: (x.get("d") or "", x.get("t") or "", {"buy": 0, "sell": 1}.get(x["type"], 2)))
    for i, t in enumerate(txns):
        t["id"] = i + 1
        for k in [k for k, v in t.items() if v is None]:
            del t[k]

    # ---- cross-check open positions against the sheet's own Total rows ----
    net = defaultdict(float)
    for b in buys:
        net[b["t"]] += b["sh"]
    for e in events:
        if e["type"] == "split" and e.get("sh"):
            net[e["t"]] += e["sh"]
    for s in sells:
        net[s["t"]] -= s["sh"]
    checks = []
    for t, exp in sorted(expected_open.items()):
        got = round(net[t], 4)
        ok = abs(got - exp) < 0.01
        checks.append({"t": t, "ledger": got, "sheet": round(exp, 4), "ok": ok})
        if not ok:
            warn(None, f"{t}: open shares from trades ({got}) don't match the sheet's Total row ({round(exp, 4)})")

    open_now = sorted(t for t, v in net.items() if v > 0.001 and t in expected_open)
    out = {
        "source": Path(path).name,
        "generated": dt.date.today().isoformat(),
        "range": [min(t["d"] for t in txns if t.get("d")), max(t["d"] for t in txns if t.get("d"))],
        "counts": {"buys": len(buys), "sells": len(grouped), "sellLots": len(sells), "events": len(events),
                   "tickers": len({t["t"] for t in txns if t.get("t")})},
        "open": open_now,
        "checks": checks,
        "warnings": warnings,
        "txns": txns,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {OUT} — {out['counts']}  range {out['range']}")
    bad = [c for c in checks if not c["ok"]]
    print(f"Open-position check: {len(checks) - len(bad)}/{len(checks)} match the sheet's Total rows")
    for w in warnings:
        print(f"  ! row {w['row']}: {w['msg']}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])

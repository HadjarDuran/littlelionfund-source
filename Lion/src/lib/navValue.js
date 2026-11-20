// Values the holdings for the daily NAV snapshot. A quote that fails to load
// (Finnhub sometimes returns nothing for a ticker) falls back to that
// ticker's last good price instead of counting the position as $0. On
// 2026-11-17 a missing LQDA quote did exactly that and knocked about 1.3%
// off that day's unit value.
//   hold:   [{t, sh}]
//   quotes: {T: price|null} for today
//   last:   {T: {p, d}} last good price per ticker (from earlier runs)
// Returns { equity, missing, stale, unpriced, last } where `last` is the
// updated last-good-price map to store.
export function valueHoldings(hold, quotes, last = {}, today = '') {
  const next = { ...last };
  let equity = 0;
  const missing = [], stale = [], unpriced = [];
  for (const h of hold) {
    const q = quotes[h.t];
    if (q != null && q > 0) {
      equity += q * h.sh;
      next[h.t] = { p: q, d: today };
      continue;
    }
    missing.push(h.t);
    const prev = last[h.t];
    if (prev && prev.p > 0) { equity += prev.p * h.sh; stale.push(h.t); }
    else unpriced.push(h.t);
  }
  return { equity, missing, stale, unpriced, last: next };
}

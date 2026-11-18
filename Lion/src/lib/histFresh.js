// Freshness rules for cached daily price history (used by routes/hist.js).
// Pure functions so they can be unit-tested without the network.

const DAY_MS = 864e5;
// A series whose newest close is older than this is "stale". Five calendar
// days covers a normal weekend plus a market holiday (e.g. Thanksgiving).
export const STALE_DAYS = 5;

export function lastDate(series) {
  return Array.isArray(series) && series.length ? series[series.length - 1].date : null;
}

export function daysOld(series, now = Date.now()) {
  const d = lastDate(series);
  return d ? Math.floor((now - Date.parse(d + 'T00:00:00Z')) / DAY_MS) : Infinity;
}

export const isStale = (series, now) => daysOld(series, now) > STALE_DAYS;

// Of several candidate series (e.g. Stooq's and Yahoo's), the one whose
// newest close is most recent. Ties go to the longer history.
export function freshest(candidates) {
  const ok = candidates.filter(s => Array.isArray(s) && s.length);
  ok.sort((a, b) => (lastDate(b) || '').localeCompare(lastDate(a) || '') || b.length - a.length);
  return ok[0] || null;
}

// Intraday (short-term) price bars for the 1D and 1W chart views.
// Pure functions so they can be unit-tested without the network.
//
// Source: Yahoo Finance's public chart API (free, no key). 1D = 5-minute
// bars for the latest session; 1W = 15-minute bars for the last 5 sessions.
// Regular trading hours only (no pre/after-market).

export const INTRADAY = {
  '1d': { range: '1d', interval: '5m', freshMs: 2 * 60 * 1000 },
  '5d': { range: '5d', interval: '15m', freshMs: 10 * 60 * 1000 },
};

// Saved copies expire on their own after a day: short-term bars are only a
// cache, never kept as history.
export const MAX_AGE_SECONDS = 24 * 60 * 60;

export const isFresh = (saved, rangeKey, now = Date.now()) =>
  !!(saved && saved.at && Array.isArray(saved.points) && saved.points.length && now - saved.at < INTRADAY[rangeKey].freshMs);

// Yahoo chart JSON → { points: [{ t: ISO-8601 UTC, c: close }], prevClose, tz }
// or null if the response has no usable bars.
export function parseYahooChart(body) {
  const r = body && body.chart && Array.isArray(body.chart.result) && body.chart.result[0];
  if (!r || !Array.isArray(r.timestamp)) return null;
  const q = r.indicators && r.indicators.quote && r.indicators.quote[0];
  const closes = (q && q.close) || [];
  const points = [];
  r.timestamp.forEach((ts, i) => {
    const c = closes[i];
    if (typeof c === 'number' && isFinite(c) && c > 0) points.push({ t: new Date(ts * 1000).toISOString().replace('.000Z', 'Z'), c: +c.toFixed(4) });
  });
  if (points.length < 2) return null;
  const m = r.meta || {};
  const prev = m.chartPreviousClose ?? m.previousClose ?? null;
  return { points, prevClose: typeof prev === 'number' && prev > 0 ? +prev.toFixed(4) : null, tz: m.exchangeTimezoneName || 'America/New_York' };
}

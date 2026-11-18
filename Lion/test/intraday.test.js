import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooChart, isFresh, INTRADAY, MAX_AGE_SECONDS } from '../src/lib/intraday.js';

const yahoo = (ts, closes, meta = {}) => ({ chart: { result: [{ meta, timestamp: ts, indicators: { quote: [{ close: closes }] } }] } });

test('parses Yahoo bars, skipping empty ones', () => {
  const t0 = Date.parse('2026-11-18T14:30:00Z') / 1000;
  const out = parseYahooChart(yahoo([t0, t0 + 300, t0 + 600], [353.1, null, 353.5], { chartPreviousClose: 351.69, exchangeTimezoneName: 'America/New_York' }));
  assert.deepEqual(out.points, [{ t: '2026-11-18T14:30:00Z', c: 353.1 }, { t: '2026-11-18T14:40:00Z', c: 353.5 }]);
  assert.equal(out.prevClose, 351.69);
  assert.equal(out.tz, 'America/New_York');
});

test('rejects responses without usable bars', () => {
  assert.equal(parseYahooChart(null), null);
  assert.equal(parseYahooChart({ chart: { result: null, error: { code: 'Not Found' } } }), null);
  assert.equal(parseYahooChart(yahoo([1], [10])), null, 'one bar is not a chart');
});

test('freshness windows: 1D re-fetches after 2 min, 1W after 10', () => {
  const now = Date.parse('2026-11-18T16:00:00Z');
  const rec = at => ({ at, points: [{ t: 'x', c: 1 }] });
  assert.equal(isFresh(rec(now - 60e3), '1d', now), true);
  assert.equal(isFresh(rec(now - 3 * 60e3), '1d', now), false);
  assert.equal(isFresh(rec(now - 5 * 60e3), '5d', now), true);
  assert.equal(isFresh(null, '1d', now), false);
  assert.equal(INTRADAY['5d'].interval, '15m');
});

test('stored copies expire within a day', () => {
  assert.ok(MAX_AGE_SECONDS <= 24 * 60 * 60);
});

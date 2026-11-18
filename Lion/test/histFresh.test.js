import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStale, freshest, daysOld } from '../src/lib/histFresh.js';

const NOW = Date.parse('2026-11-18T16:00:00Z');
const s = (...dates) => dates.map((date, i) => ({ date, close: 100 + i }));

test('a history ending mid-October is stale in mid-November', () => {
  assert.equal(isStale(s('2026-10-14', '2026-10-15'), NOW), true);
  assert.equal(isStale(s('2026-11-16', '2026-11-17'), NOW), false);
  // Friday close seen on Monday morning is not stale
  assert.equal(isStale(s('2026-11-13'), Date.parse('2026-11-16T12:00:00Z')), false);
  assert.equal(daysOld([], NOW), Infinity);
});

test('freshest picks the source that reaches the latest day', () => {
  const stooq = s('2026-01-02', '2026-10-15');
  const yahoo = s('2026-11-16', '2026-11-17');
  assert.equal(freshest([stooq, yahoo]), yahoo);
  assert.equal(freshest([null, stooq]), stooq);
  assert.equal(freshest([null, undefined]), null);
});

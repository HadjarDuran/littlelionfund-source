import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueHoldings } from '../src/lib/navValue.js';

const hold = [{ t: 'AAPL', sh: 10 }, { t: 'LQDA', sh: 50 }];

test('every quote present: plain sum, last prices updated', () => {
  const r = valueHoldings(hold, { AAPL: 300, LQDA: 60 }, {}, '2026-11-17');
  assert.equal(r.equity, 3000 + 3000);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.last.LQDA, { p: 60, d: '2026-11-17' });
});

test('a missing quote uses the last good price instead of $0', () => {
  const r = valueHoldings(hold, { AAPL: 300, LQDA: null }, { LQDA: { p: 58, d: '2026-11-16' } }, '2026-11-17');
  assert.equal(r.equity, 3000 + 58 * 50);
  assert.deepEqual(r.missing, ['LQDA']);
  assert.deepEqual(r.stale, ['LQDA']);
  assert.deepEqual(r.last.LQDA, { p: 58, d: '2026-11-16' }); // not overwritten
});

test('no quote and no earlier price: reported as unpriced', () => {
  const r = valueHoldings(hold, { AAPL: 300 }, {}, '2026-11-17');
  assert.equal(r.equity, 3000);
  assert.deepEqual(r.unpriced, ['LQDA']);
});

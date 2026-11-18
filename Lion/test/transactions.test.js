import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTxn, cleanTicker } from '../src/lib/transactions.js';

test('buy: amount includes the fee', () => {
  const t = cleanTxn({ d: '2026-11-02', t: 'v', type: 'buy', sh: 10, px: 344.01, fee: 1 });
  assert.deepEqual(t, { d: '2026-11-02', t: 'V', type: 'buy', sh: 10, px: 344.01, fee: 1, amt: 3441.1 });
});

test('sell: proceeds net of fee, gain against the basis sent', () => {
  const t = cleanTxn({ d: '2026-11-18', t: 'V', type: 'sell', sh: 4, px: 344.23, fee: 0, basis: 1376.44 });
  assert.equal(t.amt, 1376.92);
  assert.equal(t.gain, 0.48);
});

test('rejects unusable trades', () => {
  assert.equal(cleanTxn(null), null);
  assert.equal(cleanTxn({ d: '2026-11-02', t: 'V', type: 'buy', sh: 0, px: 10 }), null);
  assert.equal(cleanTxn({ d: '11/2/2026', t: 'V', type: 'buy', sh: 1, px: 10 }), null);
  assert.equal(cleanTxn({ d: '2026-11-02', t: '', type: 'buy', sh: 1, px: 10 }), null);
  assert.equal(cleanTxn({ d: '2026-11-02', t: 'V', type: 'gift', sh: 1, px: 10 }), null);
  assert.equal(cleanTxn({ d: '2026-11-02', t: 'V', type: 'buy', sh: 1, px: 10, fee: -5 }), null);
});

test('tickers keep class-share punctuation and drop everything else', () => {
  assert.equal(cleanTicker('brk.b'), 'BRK.B');
  assert.equal(cleanTicker('BRK-B'), 'BRK-B');
  assert.equal(cleanTicker(' aapl;drop '), 'AAPLDROP');
});

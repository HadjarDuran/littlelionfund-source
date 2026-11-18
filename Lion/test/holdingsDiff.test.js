import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffHoldings } from '../src/lib/holdingsDiff.js';

test('adding a new ticker emits an add event', () => {
  const events = diffHoldings([], [{ t: 'AAPL', sh: 10, ac: 150, s: 'Tech' }]);
  assert.deepEqual(events, [{ action: 'add', ticker: 'AAPL', sh: 10, ac: 150, s: 'Tech' }]);
});

test('removing a ticker emits a remove event', () => {
  const events = diffHoldings([{ t: 'AAPL', sh: 10, ac: 150, s: 'Tech' }], []);
  assert.deepEqual(events, [{ action: 'remove', ticker: 'AAPL', sh: 10, ac: 150, s: 'Tech' }]);
});

test('changing shares/cost/sector on an existing ticker emits an edit event', () => {
  const oldArr = [{ t: 'AAPL', sh: 10, ac: 150, s: 'Tech' }];
  const newArr = [{ t: 'AAPL', sh: 15, ac: 150, s: 'Tech' }];
  const events = diffHoldings(oldArr, newArr);
  assert.deepEqual(events, [{
    action: 'edit', ticker: 'AAPL',
    from: { sh: 10, ac: 150, s: 'Tech' },
    to: { sh: 15, ac: 150, s: 'Tech' },
  }]);
});

test('an unchanged ticker emits no event', () => {
  const arr = [{ t: 'AAPL', sh: 10, ac: 150, s: 'Tech' }];
  const events = diffHoldings(arr, arr.map(h => ({ ...h })));
  assert.deepEqual(events, []);
});

test('handles null/undefined inputs as empty arrays', () => {
  assert.deepEqual(diffHoldings(null, undefined), []);
  assert.deepEqual(diffHoldings(undefined, [{ t: 'AAPL', sh: 1, ac: 1, s: 'Tech' }]), [
    { action: 'add', ticker: 'AAPL', sh: 1, ac: 1, s: 'Tech' },
  ]);
});

test('add, remove, and edit can all be produced from one diff', () => {
  const oldArr = [
    { t: 'AAPL', sh: 10, ac: 150, s: 'Tech' },
    { t: 'MSFT', sh: 5, ac: 300, s: 'Tech' },
  ];
  const newArr = [
    { t: 'AAPL', sh: 12, ac: 150, s: 'Tech' },
    { t: 'GOOG', sh: 3, ac: 130, s: 'Tech' },
  ];
  const events = diffHoldings(oldArr, newArr);
  const byAction = Object.fromEntries(events.map(e => [e.action + ':' + e.ticker, e]));
  assert.equal(events.length, 3);
  assert.ok(byAction['add:GOOG']);
  assert.ok(byAction['remove:MSFT']);
  assert.ok(byAction['edit:AAPL']);
});

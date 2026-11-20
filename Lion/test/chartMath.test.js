// The maths behind every chart, tested against hand-computed answers.
// Runs the real browser files (public/js) in a vm; see helpers/browser.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, days } from './helpers/browser.js';

const A = loadApp();
const plain = x => JSON.parse(JSON.stringify(x)); // vm objects → this realm
const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} ≠ ${b}`);

// ---- lining compared series up with the main one -------------------------

test('a daily benchmark keeps its own daily points and starts on the main line\'s first date', () => {
  const fund = [{ d: '2025-10-31', v: 100 }, { d: '2025-11-28', v: 104 }, { d: '2025-12-31', v: 101 }];
  const spy = days('2025-10-01', '2025-12-31', (d, i) => 500 + i);
  const [, b] = plain(A.alignSeries([{ key: 'fund', primary: true, points: fund }, { key: 'SPY', points: spy }]));
  // starts exactly where the fund starts, from SPY's own close that day
  assert.equal(b.points[0].d, '2025-10-31');
  assert.equal(b.points[0].v, spy.find(p => p.d === '2025-10-31').v);
  // every later daily close is kept (it's its own line, not the fund's dates)
  assert.equal(b.points.length, spy.filter(p => p.d >= '2025-10-31').length);
  assert.ok(b.points.length > 40);
});

test('if the main line starts on a day the benchmark has no close, it uses the last close before (never after)', () => {
  const fund = [{ d: '2025-11-30', v: 100 }, { d: '2025-12-31', v: 101 }]; // a Sunday
  const spy = days('2025-11-01', '2025-12-31', (d, i) => 500 + i);
  const [, b] = plain(A.alignSeries([{ primary: true, points: fund }, { points: spy }]));
  assert.equal(b.points[0].d, '2025-11-30');
  assert.equal(b.points[0].v, spy.find(p => p.d === '2025-11-28').v); // Friday's close
  assert.equal(b.points[0].from, '2025-11-28');
  assert.equal(b.points[1].d, '2025-12-01');
});

test('a benchmark with no history that far back starts later and is flagged', () => {
  const fund = days('2012-05-01', '2012-12-31', () => 10);
  const late = days('2014-01-01', '2014-03-01', () => 1);
  const [, b] = plain(A.alignSeries([{ primary: true, points: fund }, { points: late }]));
  assert.equal(b.lateStart, '2014-01-01');
  assert.equal(b.points.length, late.length);
});

test('a benchmark whose last close is months before the main start is not used as its base', () => {
  const fund = days('2020-06-01', '2020-07-01', () => 10);
  const old = days('2020-01-01', '2020-02-01', () => 1).concat(days('2020-06-15', '2020-07-01', () => 2));
  const [, b] = plain(A.alignSeries([{ primary: true, points: fund }, { points: old }]));
  assert.equal(b.lateStart, '2020-06-15');
  assert.equal(b.points[0].d, '2020-06-15');
});

test('aligning twice changes nothing, and the main series is never touched', () => {
  const fund = [{ d: '2025-10-31', v: 100 }, { d: '2025-11-28', v: 104 }];
  const spy = days('2025-10-01', '2025-11-28', (d, i) => 500 + i);
  const once = A.alignSeries([{ primary: true, points: fund }, { points: spy }]);
  const twice = A.alignSeries(once);
  assert.deepEqual(plain(twice), plain(once));
  assert.deepEqual(plain(once[0].points), fund);
});

test('compareSeries returns the benchmark\'s daily closes over the window (no resampling)', () => {
  A.S.hist.SPY = days('2024-01-01', '2025-12-31', (d, i) => ({ date: d, close: 400 + i })).map(p => p.v);
  const out = plain(A.compareSeries({ compare: ['SPY'] }, '2025-06-30', null));
  const pts = out[0].points;
  // base = the close at/before the window start, then every trading day after
  assert.equal(pts[0].d, '2025-06-30');
  assert.equal(pts.length, A.S.hist.SPY.filter(x => x.date >= '2025-06-30').length);
  delete A.S.hist.SPY;
});

// ---- reading values for tooltips / measuring -----------------------------

test('valueAt never returns a later value, and nothing outside the series', () => {
  const pts = [{ t: 10, v: 1 }, { t: 20, v: 2 }, { t: 30, v: 3 }];
  assert.equal(A.valueAt(pts, 5), null);           // before it starts
  assert.equal(A.valueAt(pts, 19).v, 1);           // at/before, not the nearer later point
  assert.equal(A.valueAt(pts, 20).v, 2);
  assert.equal(A.valueAt(pts, 30 + 5, 10).v, 3);   // just after the end: last value
  assert.equal(A.valueAt(pts, 30 + 50, 10), null); // long after the end: stale, hidden
});

// ---- holdings lines ------------------------------------------------------

test('time-weighted holdings index: buying a new position adds no "performance"', () => {
  A.S.hist.AAA = [{ date: '2026-01-05', close: 100 }, { date: '2026-01-06', close: 110 }, { date: '2026-01-07', close: 110 }, { date: '2026-01-08', close: 121 }];
  A.S.hist.BBB = [{ date: '2026-01-05', close: 50 }, { date: '2026-01-06', close: 50 }, { date: '2026-01-07', close: 40 }, { date: '2026-01-08', close: 44 }];
  A.invalidate();
  const list = [{ t: 'AAA', sh: 1, d: '2026-01-05' }, { t: 'BBB', sh: 10, d: '2026-01-07' }];
  const idx = plain(A.holdingsReturnIndex(list));
  // day 1→2: AAA +10% → 110. day 2→3: AAA flat; BBB is bought (not counted) → 110.
  // day 3→4: AAA 110→121, BBB 400→440: (121+440)/(110+400) = 1.1 → 121.
  assert.deepEqual(idx.map(p => p.v), [100, 110, 110, 121]);
  // the $ line does step up by the new position's value on the day it's bought
  const val = plain(A.holdingsValueSeries(list));
  assert.deepEqual(val.map(p => p.v), [100, 110, 110 + 400, 121 + 440]);
  delete A.S.hist.AAA; delete A.S.hist.BBB; A.invalidate();
});

test('holdings index carries a lagging feed\'s last price instead of dropping to zero', () => {
  A.S.hist.CCC = [{ date: '2026-01-05', close: 10 }, { date: '2026-01-06', close: 11 }];
  A.S.hist.DDD = [{ date: '2026-01-05', close: 10 }, { date: '2026-01-06', close: 10 }, { date: '2026-01-07', close: 12 }];
  A.invalidate();
  const idx = plain(A.holdingsReturnIndex([{ t: 'CCC', sh: 1 }, { t: 'DDD', sh: 1 }]));
  // 1→2: (11+10)/(10+10) = 1.05. 2→3: CCC has no bar (carried at 11), DDD 10→12: (11+12)/(11+10)
  close(idx[1].v, 105, 1e-4);
  close(idx[2].v, 105 * 23 / 21, 1e-3);
  delete A.S.hist.CCC; delete A.S.hist.DDD; A.invalidate();
});

test('blended benchmark (Energy + Utilities) = equal-weight daily average of the two', () => {
  A.S.hist.XLE = [{ date: '2026-01-05', close: 100 }, { date: '2026-01-06', close: 110 }, { date: '2026-01-07', close: 110 }];
  A.S.hist.XLU = [{ date: '2026-01-05', close: 50 }, { date: '2026-01-06', close: 50 }, { date: '2026-01-07', close: 55 }];
  const b = plain(A.blendIndex(['XLE', 'XLU']));
  close(b[1].v, 105, 1e-9);            // (+10% + 0%) / 2
  close(b[2].v, 105 * 1.05, 1e-3);     // (0% + 10%) / 2
  delete A.S.hist.XLE; delete A.S.hist.XLU;
});

test('short-term (1D) sector line sums the holdings bar by bar and starts at the previous close', () => {
  const bars = c => ({ points: [{ t: '2026-11-19T14:30:00Z', c }, { t: '2026-11-19T14:35:00Z', c: c + 1 }], prevClose: c - 1 });
  A._intra['1d:EEE'] = { data: bars(10), at: Date.now() };
  A._intra['1d:FFF'] = { data: bars(20), at: Date.now() };
  A.invalidate();
  const h = plain(A.holdingsIntraday([{ t: 'EEE', sh: 2 }, { t: 'FFF', sh: 1 }], '1D'));
  assert.deepEqual(h.points.map(p => p.v), [2 * 9 + 19, 2 * 10 + 20, 2 * 11 + 21]);
  assert.equal(h.prevClose, 2 * 9 + 19);
});

// ---- windows and returns -------------------------------------------------

test('sliceSeries starts at the last point at or before the window start', () => {
  const s = [{ d: '2025-01-31', v: 1 }, { d: '2025-02-28', v: 2 }, { d: '2025-03-31', v: 3 }];
  assert.deepEqual(plain(A.sliceSeries(s, '2025-02-15')).map(p => p.d), ['2025-01-31', '2025-02-28', '2025-03-31']);
  assert.deepEqual(plain(A.sliceSeries(s, '2025-02-28', '2025-03-01')).map(p => p.d), ['2025-02-28']);
});

test('periodReturn: plain % change, and "—" when the record has a gap at the start', () => {
  const s = [{ d: '2025-01-31', v: 100 }, { d: '2025-12-31', v: 110 }, { d: '2026-01-31', v: 121 }];
  close(A.periodReturn(s, '2025-12-31', '2026-01-31'), 10);
  close(A.periodReturn(s, '2026-01-01', '2026-01-31'), 10); // base = Dec 31, one day before
  assert.equal(A.periodReturn(s, '2025-06-30', '2026-01-31'), null); // nearest earlier record is 5 months off
});

test('annualize is compounded: +21% over two years is +10% a year', () => {
  close(A.annualize(21, '2024-01-01', '2026-01-01'), 10, 0.01);
  assert.equal(A.annualize(5, '2025-06-01', '2026-01-01'), 5); // under a year: left as is
});

test('range starts', () => {
  assert.equal(A.rangeStart('YTD', '2026-11-20'), '2025-12-31');
  assert.equal(A.rangeStart('1Y', '2026-11-20'), '2025-11-20');
  assert.equal(A.rangeStart('5Y', '2026-11-20'), '2021-11-20');
  assert.equal(A.rangeStart('MAX', '2026-11-20'), null);
});

test('downsampling keeps the first point, the last point, and the extremes', () => {
  const pts = Array.from({ length: 5000 }, (_, i) => ({ t: i, x: i / 10, y: i === 1234 ? -999 : i === 4321 ? 999 : Math.sin(i / 50) }));
  const out = plain(A.downsample(pts, 300));
  assert.ok(out.length < 1000);
  assert.equal(out[0].t, 0);
  assert.equal(out[out.length - 1].t, 4999);
  assert.ok(out.some(p => p.y === -999) && out.some(p => p.y === 999));
  for (let i = 1; i < out.length; i++) assert.ok(out[i].t >= out[i - 1].t, 'stays in time order');
});

test('a monthly window starts on the month-end nearest its start (chart and returns table agree)', () => {
  const s = [{ d: '2025-09-30', v: 1 }, { d: '2025-11-30', v: 2 }, { d: '2025-12-31', v: 3 }, { d: '2026-11-20', v: 4, live: true }];
  assert.equal(A.nearestPoint(s, '2025-11-20'), '2025-11-30');  // 10 days after beats 51 days before
  assert.equal(A.nearestPoint(s, '2025-10-20'), '2025-09-30');  // tie-break / nearer earlier
  assert.equal(A.nearestPoint(s, '2026-06-01'), null);          // nothing within 40 days
  assert.equal(A.nearestPoint(s, '2026-11-01'), null);          // the live point is never a start
});

test('gaps: a missing stretch in a monthly or daily series is found, normal spacing is not', () => {
  const D = 864e5;
  const monthly = [0, 31, 59, 90, 120, 151, 365, 396].map(d => ({ t: d * D }));
  assert.deepEqual(Array.from(A.seriesGaps(monthly)), [6]);           // 151 → 365 days
  const daily = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 30, 31].map(d => ({ t: d * D }));
  assert.deepEqual(Array.from(A.seriesGaps(daily)), [11]);            // weekends fine, 14 → 30 is a gap
  assert.deepEqual(Array.from(A.seriesGaps(daily.slice(0, 10))), []);
});

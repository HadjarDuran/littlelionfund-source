// ---------------------------------------------------------------------------
// data.js — everything the views read: app state, loading from /api, the
// imported trade ledger, benchmarks, and the derived numbers (positions,
// totals, returns, realized gains). Views never fetch on their own; they
// call these functions.
// ---------------------------------------------------------------------------

// Sector colours avoid the red and green hue bands on purpose: a red or
// green sector line would read as "losing/making money" regardless of its
// real trend. `etf` = the SPDR sector fund used as that sector's benchmark.
const SECTORS = {
  'Information Technology': { color: '#3b82f6', etf: ['XLK'], short: 'Tech' },
  'Communication Services': { color: '#8b5cf6', etf: ['XLC'], short: 'Comm.' },
  'Consumer Staples': { color: '#eab308', etf: ['XLP'], short: 'Staples' },
  'Consumer Discretionary': { color: '#f97316', etf: ['XLY'], short: 'Discretionary' },
  'Health Care': { color: '#d946ef', etf: ['XLV'], short: 'Health Care' },
  'Industrials': { color: '#06b6d4', etf: ['XLI'], short: 'Industrials' },
  'Financials': { color: '#0ea5e9', etf: ['XLF'], short: 'Financials' },
  'Energy + Utilities': { color: '#14b8a6', etf: ['XLE', 'XLU'], short: 'Energy + Util.' },
};
const sectorColor = s => (SECTORS[s] || { color: '#94a3b8' }).color;

// Benchmarks offered in every "Compare" picker. All are ETFs (so they come
// from the same /api/hist price source as holdings) and are price return,
// i.e. dividends not included — said so in the UI wherever returns show.
const BENCHMARKS = {
  SPY: { name: 'S&P 500', group: 'Market' },
  QQQ: { name: 'Nasdaq-100', group: 'Market' },
  DIA: { name: 'Dow Jones', group: 'Market' },
  IWM: { name: 'Russell 2000', group: 'Market' },
  VTI: { name: 'Total US Market', group: 'Market' },
  XLK: { name: 'Technology (XLK)', group: 'Sector' },
  XLC: { name: 'Communication (XLC)', group: 'Sector' },
  XLP: { name: 'Consumer Staples (XLP)', group: 'Sector' },
  XLY: { name: 'Consumer Discr. (XLY)', group: 'Sector' },
  XLV: { name: 'Health Care (XLV)', group: 'Sector' },
  XLI: { name: 'Industrials (XLI)', group: 'Sector' },
  XLF: { name: 'Financials (XLF)', group: 'Sector' },
  XLE: { name: 'Energy (XLE)', group: 'Sector' },
  XLU: { name: 'Utilities (XLU)', group: 'Sector' },
};
const benchName = t => (BENCHMARKS[t] ? BENCHMARKS[t].name : t);

// Old tickers in the ledger → the symbol their price history lives under now.
const TICKER_ALIASES = { FB: 'META', PCLN: 'BKNG', KFT: 'MDLZ', GOOGL: 'GOOGL' };

const DEFAULT_UNITS = 4111.03;
const S = {
  hold: [], cashBank: 0, cashBrok: 0, units: DEFAULT_UNITS, weightings: [], uv: [],
  prices: {}, hist: {}, histErr: {}, ledger: null, added: [],
  auth: { holdings: null, weightings: null },
  lastUpdate: null, offline: false, loadingHist: false,
};
// Unlocks survive a page refresh within the same tab (the server token
// itself expires after 12 hours).
try { Object.assign(S.auth, JSON.parse(sessionStorage.getItem('llf_auth') || '{}')); } catch (e) { }
const isUnlocked = scope => !!S.auth[scope === 'unitvalue' ? 'holdings' : scope];

// ---------------------------------------------------------------- fetching
async function fetchJSON(url, { timeout = 10000, ...opts } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { cache: 'no-store', ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function parallelLimit(items, limit, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Core fund records: small, fast, needed before anything can render.
async function loadCore() {
  const get = (u, fb) => fetchJSON(u).catch(e => { console.warn(e); S.offline = true; return fb; });
  const [hold, cash, w, uv, units, added, ledger] = await Promise.all([
    get('/api/holdings', null), get('/api/cash', null), get('/api/weightings', null),
    get('/api/unitvalue', null), get('/api/units', null), get('/api/transactions', null),
    S.ledger ? Promise.resolve(S.ledger) : fetchJSON('/data/ledger.json', { cache: 'default' }).catch(() => null),
  ]);
  if (Array.isArray(hold)) S.hold = hold;
  if (cash) { S.cashBank = +cash.bank || 0; S.cashBrok = +cash.brokerage || 0; }
  if (Array.isArray(w)) S.weightings = w;
  if (Array.isArray(uv) && uv.length) S.uv = uv;
  if (units && units.units > 0) S.units = units.units;
  if (Array.isArray(added)) S.added = added;
  if (ledger && Array.isArray(ledger.txns)) S.ledger = ledger;
  invalidate();
}

async function loadQuote(t) {
  try {
    const d = await fetchJSON(`/api/quote?ticker=${encodeURIComponent(t)}`, { timeout: 7000 });
    if (d && d.c > 0) { S.prices[t] = { c: d.c, pc: d.pc || d.c, hi: d.h, lo: d.l }; return true; }
  } catch (e) { }
  return false;
}
async function loadQuotes(onProgress) {
  let done = 0;
  await parallelLimit(S.hold.map(h => h.t), 5, async t => { await loadQuote(t); done++; onProgress && onProgress(done, S.hold.length); });
  invalidate();
}

// Price history, fetched once per ticker per page load and shared by every
// chart. Returns [{date, close}] or null. Concurrent callers share one request.
const _histInflight = {};
function getHist(t) {
  t = TICKER_ALIASES[t] || t;
  if (S.hist[t]) return Promise.resolve(S.hist[t]);
  if (S.histErr[t]) return Promise.resolve(null); // don't hammer a ticker with no data
  if (_histInflight[t]) return _histInflight[t];
  return (_histInflight[t] = fetchJSON(`/api/hist?ticker=${encodeURIComponent(t)}`, { timeout: 20000, cache: 'default' })
    .then(d => {
      if (Array.isArray(d) && d.length > 5) { S.hist[t] = d; invalidate(true); return d; }
      S.histErr[t] = true; return null;
    })
    .catch(() => { S.histErr[t] = true; return null; })
    .finally(() => { delete _histInflight[t]; }));
}
const histOf = t => S.hist[TICKER_ALIASES[t] || t] || null;

async function loadAllHist(onProgress) {
  S.loadingHist = true;
  let done = 0;
  const tickers = S.hold.map(h => h.t);
  await parallelLimit(tickers, 5, async t => { await getHist(t); done++; onProgress && onProgress(done, tickers.length); });
  S.loadingHist = false;
}

// ---- writes (only ever triggered by an explicit manager action) ----
function authHeaders(scope) {
  const h = { 'Content-Type': 'application/json' };
  if (S.auth[scope]) h.Authorization = 'Bearer ' + S.auth[scope];
  return h;
}
async function post(url, scope, body) {
  try {
    const r = await fetch(url, { method: 'POST', headers: authHeaders(scope), body: JSON.stringify(body) });
    if (r.status === 401) { S.auth[scope] = null; persistAuth(); }
    return r.ok ? (await r.json().catch(() => ({}))) || {} : null;
  } catch (e) { return null; }
}
const api = {
  saveHoldings: () => post('/api/holdings', 'holdings', S.hold),
  saveCash: () => post('/api/cash', 'holdings', { bank: S.cashBank, brokerage: S.cashBrok }),
  saveUnits: () => post('/api/units', 'holdings', { units: S.units }),
  saveUV: () => post('/api/unitvalue', 'holdings', S.uv),
  saveWeightings: () => post('/api/weightings', 'weightings', S.weightings.map(({ s, p, sp }) => ({ s, p, sp }))),
  addTxn: txn => post('/api/transactions', 'holdings', { action: 'add', txn }),
  deleteTxn: id => post('/api/transactions', 'holdings', { action: 'delete', id }),
};
function persistAuth() { try { sessionStorage.setItem('llf_auth', JSON.stringify(S.auth)); } catch (e) { } }
async function unlock(type, pwd) {
  try {
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pwd, type }) });
    const d = await r.json();
    if (!d.ok) return false;
    S.auth[type === 'weightings' ? 'weightings' : 'holdings'] = d.token;
    persistAuth();
    return true;
  } catch (e) { return false; }
}
function lockAll() { S.auth = { holdings: null, weightings: null }; persistAuth(); }

// ---- instant repaint cache: last good state, so a reload paints at once ----
const SNAP_KEY = 'llf_snapshot_v2';
function saveSnapshot() {
  store.set(SNAP_KEY, { ts: Date.now(), hold: S.hold, cashBank: S.cashBank, cashBrok: S.cashBrok, units: S.units,
    weightings: S.weightings, uv: S.uv, prices: S.prices, added: S.added });
}
function loadSnapshot() {
  const s = store.get(SNAP_KEY);
  if (!s || Date.now() - s.ts > 24 * 3600 * 1000) return false;
  Object.assign(S, { hold: s.hold || [], cashBank: s.cashBank || 0, cashBrok: s.cashBrok || 0, units: s.units || DEFAULT_UNITS,
    weightings: s.weightings || [], uv: s.uv || [], prices: s.prices || {}, added: s.added || [] });
  S.lastUpdate = new Date(s.ts);
  invalidate();
  return true;
}

// ------------------------------------------------------------ derived data
// Memoised per "data version": anything that changes inputs calls
// invalidate(), and every derived getter recomputes lazily on next read.
let _ver = 0, _memo = {};
const histListeners = new Set();
function invalidate(histOnly) {
  _ver++; _memo = {};
  if (histOnly) histListeners.forEach(fn => fn());
}
function memo(key, fn) { return key in _memo ? _memo[key] : (_memo[key] = fn()); }

function positions() {
  return memo('pos', () => {
    const eq = S.hold.reduce((s, h) => s + (S.prices[h.t]?.c || 0) * h.sh, 0);
    const total = eq + S.cashBank + S.cashBrok;
    return S.hold.map(h => {
      const q = S.prices[h.t] || {};
      const price = q.c || 0, pc = q.pc || price;
      const val = price * h.sh, cost = h.ac * h.sh;
      const held = h.d ? dt.days(h.d, dt.today()) : null;
      const out = {
        ...h, price, pc, val, cost, pnl: val - cost, pnlPct: cost ? (val - cost) / cost * 100 : 0,
        dayChg: (price - pc) * h.sh, dayPct: pc ? (price - pc) / pc * 100 : 0,
        weight: total ? val / total * 100 : 0, held, hasPrice: price > 0,
      };
      // Annualised return only makes sense after a full year; under a year
      // the CAGR formula wildly exaggerates (a +5% month becomes "+80%/yr").
      out.cagr = price > 0 && cost > 0 && held >= 365 ? (Math.pow(val / cost, 365 / held) - 1) * 100 : null;
      out.ttm = trailingReturn(h.t, price, 12);
      return out;
    });
  });
}
function trailingReturn(t, price, months) {
  const h = histOf(t);
  if (!h || !price) return null;
  const target = dt.addMonths(h[h.length - 1].date, -months);
  const i = bisectDate(h, target, 'date');
  if (i < 0 || dt.days(h[i].date, target) > 7) return null; // not enough history
  return (price - h[i].close) / h[i].close * 100;
}
function totals() {
  return memo('tot', () => {
    const pos = positions();
    const equity = pos.reduce((s, p) => s + p.val, 0);
    const cost = pos.reduce((s, p) => s + p.cost, 0);
    const day = pos.reduce((s, p) => s + p.dayChg, 0);
    const prevEquity = pos.reduce((s, p) => s + p.pc * p.sh, 0);
    const cash = S.cashBank + S.cashBrok;
    const total = equity + cash;
    return {
      equity, cost, cash, total, pnl: equity - cost, pnlPct: cost ? (equity - cost) / cost * 100 : 0,
      day, dayPct: prevEquity ? day / (prevEquity + cash) * 100 : 0, unit: S.units ? total / S.units : 0,
      priced: pos.filter(p => p.hasPrice).length, count: pos.length,
    };
  });
}
function bySector() {
  return memo('sec', () => {
    const t = totals(), out = {};
    for (const p of positions()) {
      const k = p.s || 'Other';
      const o = out[k] || (out[k] = { s: k, val: 0, cost: 0, day: 0, n: 0, pos: [] });
      o.val += p.val; o.cost += p.cost; o.day += p.dayChg; o.n++; o.pos.push(p);
    }
    return Object.values(out).map(o => ({ ...o, pnl: o.val - o.cost, pnlPct: o.cost ? (o.val - o.cost) / o.cost * 100 : 0,
      weight: t.equity ? o.val / t.equity * 100 : 0 })).sort((a, b) => b.val - a.val);
  });
}

// ---- transactions: imported ledger + trades added in the app ----
function allTxns() {
  return memo('txns', () => {
    const base = (S.ledger?.txns || []).map(x => ({ ...x, src: 'ledger' }));
    const added = (S.added || []).map(x => ({ ...x, src: 'app' }));
    const all = base.concat(added);
    // Small periodic buys after a position is open are almost always
    // reinvested dividends (the ledger records DRIP as ordinary buys).
    const seen = new Set();
    all.sort((a, b) => (a.d || '').localeCompare(b.d || '') || String(a.id).localeCompare(String(b.id)));
    for (const x of all) {
      if (x.type === 'buy') {
        if (seen.has(x.t) && (x.amt || 0) < 100) x.drip = true;
        seen.add(x.t);
      }
    }
    return all.reverse(); // newest first
  });
}
function txnsFor(t) { return allTxns().filter(x => x.t === t || TICKER_ALIASES[x.t] === t); }

function realized() {
  return memo('realized', () => {
    const years = {};
    let all = 0, st = 0, lt = 0, proceeds = 0;
    for (const x of allTxns()) {
      if (x.type !== 'sell' || x.gain == null) continue;
      const y = x.d.slice(0, 4);
      const o = years[y] || (years[y] = { y, gain: 0, st: 0, lt: 0, n: 0, proceeds: 0 });
      o.gain += x.gain; o.n++; o.proceeds += x.amt || 0;
      // App-added sells don't know their lots; count them as short-term
      // unless the matching position was held more than a year.
      o.st += x.st ?? x.gain; o.lt += x.lt ?? 0;
      all += x.gain; st += x.st ?? x.gain; lt += x.lt ?? 0; proceeds += x.amt || 0;
    }
    const list = Object.values(years).sort((a, b) => a.y.localeCompare(b.y));
    const ytd = years[dt.today().slice(0, 4)]?.gain || 0;
    return { years: list, all, st, lt, proceeds, ytd };
  });
}

// Closed positions = every ticker in the trade history the fund no longer holds.
function pastHoldings() {
  return memo('past', () => {
    const cur = new Set(S.hold.map(h => h.t));
    const m = {};
    for (const x of allTxns()) {
      if (!x.t || cur.has(x.t) || cur.has(TICKER_ALIASES[x.t])) continue;
      const o = m[x.t] || (m[x.t] = { t: x.t, first: x.d, last: x.d, invested: 0, proceeds: 0, gain: 0, buys: 0, sells: 0, missing: false });
      if (x.d && x.d < o.first) o.first = x.d;
      if (x.d && x.d > o.last) o.last = x.d;
      if (x.type === 'buy') { o.invested += x.amt || 0; o.buys++; }
      if (x.type === 'sell') { o.proceeds += x.amt || 0; o.gain += x.gain || 0; o.sells++; if (x.noPx) o.missing = true; }
    }
    return Object.values(m).filter(o => o.buys || o.sells).map(o => ({ ...o, ret: o.invested ? o.gain / o.invested * 100 : null }))
      .sort((a, b) => b.last.localeCompare(a.last));
  });
}

// ---- time series for charts. A series is [{d:'YYYY-MM-DD', v:number}] ----

// The fund's real, hand-recorded month-end unit value since 2012. This is the
// honest long-run performance record: it includes cash, fees, and every past
// holding, which a re-pricing of today's holdings can't.
function fundSeries() {
  return memo('fund', () => S.uv.map(r => ({ d: dt.fromMDY(r.d), v: r.u })).filter(p => p.v > 0).sort((a, b) => a.d.localeCompare(b.d)));
}
function priceSeries(t) {
  const h = histOf(t);
  return h ? h.map(x => ({ d: x.date, v: x.close })) : null;
}

// Value of a set of holdings over time, using TODAY's share counts from each
// holding's purchase date onward. Each holding's last known price is carried
// forward over dates its feed hasn't caught up on, so a lagging feed doesn't
// read as a crash. The full calendar is built first and windowed afterwards
// (slicing first lets a position "switch on" mid-window as a fake spike).
function holdingsValueSeries(list) {
  const key = 'hv:' + list.map(p => p.t + p.sh).join(',');
  return memo(key, () => {
    const parts = list.map(p => ({ p, h: histOf(p.t) })).filter(x => x.h);
    if (!parts.length) return [];
    const dates = new Set();
    parts.forEach(({ h }) => h.forEach(x => dates.add(x.date)));
    const cal = [...dates].sort();
    const out = [];
    const idx = parts.map(() => 0);
    for (const d of cal) {
      let v = 0, any = false;
      parts.forEach(({ p, h }, k) => {
        if (p.d && d < p.d) return;
        while (idx[k] < h.length - 1 && h[idx[k] + 1].date <= d) idx[k]++;
        if (h[idx[k]].date <= d) { v += h[idx[k]].close * p.sh; any = true; }
      });
      if (any) out.push({ d, v: +v.toFixed(2) });
    }
    return out;
  });
}

// Same holdings, as a time-weighted return index (starts at 100). Each day's
// return only counts positions held on BOTH days, so buying a new position
// adds value but not "performance" — no step-jumps when cash is deployed.
// This is the line to compare against benchmarks.
function holdingsReturnIndex(list) {
  const key = 'hr:' + list.map(p => p.t + p.sh).join(',');
  return memo(key, () => {
    const parts = list.map(p => ({ p, h: histOf(p.t) })).filter(x => x.h);
    if (!parts.length) return [];
    const dates = new Set();
    parts.forEach(({ h }) => h.forEach(x => dates.add(x.date)));
    const cal = [...dates].sort();
    const idx = parts.map(() => -1);
    const prevPx = parts.map(() => null);
    let level = 100; const out = [];
    for (const d of cal) {
      let num = 0, den = 0, live = false;
      parts.forEach(({ p, h }, k) => {
        while (idx[k] < h.length - 1 && h[idx[k] + 1].date <= d) idx[k]++;
        const px = idx[k] >= 0 ? h[idx[k]].close : null;
        const held = !p.d || d >= p.d;
        if (held && px != null) {
          live = true;
          if (prevPx[k] != null) { num += px * p.sh; den += prevPx[k] * p.sh; }
          prevPx[k] = px;
        } else prevPx[k] = null;
      });
      if (!live) continue;
      if (den > 0) level *= num / den;
      out.push({ d, v: +level.toFixed(4) });
    }
    return out;
  });
}

// Blend of several benchmarks with equal daily weights (used for the
// "Energy + Utilities" sector, benchmarked against XLE and XLU together).
function blendIndex(tickers) {
  const hs = tickers.map(t => priceSeries(t));
  if (hs.some(h => !h)) return null;
  if (hs.length === 1) return hs[0];
  const maps = hs.map(h => new Map(h.map(x => [x.d, x.v])));
  const dates = hs[0].map(x => x.d).filter(d => maps.every(m => m.has(d)));
  let lvl = 100; const out = [];
  dates.forEach((d, i) => {
    if (i > 0) {
      const r = maps.reduce((s, m) => s + m.get(d) / m.get(dates[i - 1]), 0) / maps.length;
      lvl *= r;
    }
    out.push({ d, v: +lvl.toFixed(4) });
  });
  return out;
}

// ---- ranges & returns ----
const RANGES = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'MAX'];
const RANGE_LABEL = { '1M': '1 month', '3M': '3 months', '6M': '6 months', YTD: 'Year to date', '1Y': '1 year', '3Y': '3 years', '5Y': '5 years', MAX: 'All time' };
function rangeStart(range, end) {
  if (!end) return null;
  switch (range) {
    case '1M': return dt.addMonths(end, -1);
    case '3M': return dt.addMonths(end, -3);
    case '6M': return dt.addMonths(end, -6);
    case 'YTD': return dt.addDays(end.slice(0, 4) + '-01-01', -1);
    case '1Y': return dt.addMonths(end, -12);
    case '3Y': return dt.addMonths(end, -36);
    case '5Y': return dt.addMonths(end, -60);
    default: return null;
  }
}
function sliceSeries(series, from, to) {
  if (!series || !series.length) return [];
  let i0 = 0;
  if (from) {
    const i = bisectDate(series, from);
    i0 = Math.max(0, i); // include the last point at/before `from` as the base
  }
  const i1 = to ? bisectDate(series, to) : series.length - 1;
  return series.slice(i0, i1 + 1);
}
// % change between the value at/before `from` and the value at/before `to`.
function periodReturn(series, from, to) {
  if (!series || series.length < 2) return null;
  const j = to ? bisectDate(series, to) : series.length - 1;
  if (j < 0) return null;
  let i = from ? bisectDate(series, from) : 0;
  if (i < 0) return null; // series doesn't reach back that far
  if (from && dt.days(series[i].d, from) > 40) return null;
  if (i >= j) return null;
  return (series[j].v / series[i].v - 1) * 100;
}
function annualize(pct, from, to) {
  const yrs = dt.days(from, to) / 365.25;
  if (pct == null || yrs < 1) return pct;
  return (Math.pow(1 + pct / 100, 1 / yrs) - 1) * 100;
}

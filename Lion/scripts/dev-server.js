#!/usr/bin/env node
/*
 * Local preview of the dashboard with FAKE data — no Vercel, Redis or
 * market-data access needed. Useful for working on the UI and for QA.
 *
 *   node Lion/scripts/dev-server.js        → http://localhost:5173
 *   PORT=8080 node Lion/scripts/dev-server.js
 *
 * Every /api/* route is mocked in memory (writes are kept until you stop
 * the server). Prices are a deterministic random walk, so the numbers are
 * NOT real — never take a screenshot from this for investors.
 * Password for every lock: "dev".
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = +process.env.PORT || 5173;
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ledger.json'), 'utf8'));

// ---- deterministic fake prices -------------------------------------------
function rng(seed) {
  let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const lastBuyPx = {};
for (const t of ledger.txns) if (t.type === 'buy' && t.px) lastBuyPx[t.t] = t.px;
const ANCHOR = { SPY: 590, QQQ: 520, DIA: 440, IWM: 225, VTI: 290, XLK: 240, XLC: 105, XLP: 80, XLY: 220,
  XLV: 145, XLI: 140, XLF: 52, XLE: 90, XLU: 82 };
const histCache = {};
function fakeHist(t) {
  if (histCache[t]) return histCache[t];
  const r = rng(t);
  const end = new Date(Date.UTC(2026, 10, 17));
  const start = new Date(Date.UTC(2011, 0, 3));
  const days = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay(); if (wd === 0 || wd === 6) continue;
    days.push(d.toISOString().slice(0, 10));
  }
  const drift = 0.00035 + (r() - 0.4) * 0.0004, vol = 0.009 + r() * 0.012;
  let v = 1; const raw = days.map(() => { v *= Math.exp(drift + vol * (r() + r() + r() - 1.5) * 1.4); return v; });
  const target = (ANCHOR[t] || lastBuyPx[t] || 50) * (0.9 + r() * 0.4);
  const k = target / raw[raw.length - 1];
  return (histCache[t] = days.map((date, i) => ({ date, close: +(raw[i] * k).toFixed(2) })));
}

// ---- fake fund state derived from the real ledger's open positions -------
const SECTOR = {
  AAPL: 'Information Technology', MSFT: 'Information Technology', NVDA: 'Information Technology', TSM: 'Information Technology',
  GOOG: 'Communication Services', META: 'Communication Services', NFLX: 'Communication Services', NYT: 'Communication Services', TTWO: 'Communication Services',
  AMZN: 'Consumer Discretionary', COST: 'Consumer Staples', WMT: 'Consumer Staples',
  LLY: 'Health Care', MCK: 'Health Care', LQDA: 'Health Care',
  CAT: 'Industrials', NOC: 'Industrials', GEV: 'Industrials', RKLB: 'Industrials', ACHR: 'Industrials',
  AXP: 'Financials', COF: 'Financials', GS: 'Financials', HOOD: 'Financials',
  CEG: 'Energy + Utilities', CCJ: 'Energy + Utilities',
};
const NAMES = { AAPL: 'Apple Inc.', MSFT: 'Microsoft Corp.', NVDA: 'NVIDIA Corp.', TSM: 'Taiwan Semiconductor', GOOG: 'Alphabet Inc.',
  META: 'Meta Platforms', NFLX: 'Netflix', NYT: 'New York Times', TTWO: 'Take-Two Interactive', AMZN: 'Amazon.com',
  COST: 'Costco Wholesale', WMT: 'Walmart', LLY: 'Eli Lilly', MCK: 'McKesson', LQDA: 'Liquidia', CAT: 'Caterpillar',
  NOC: 'Northrop Grumman', GEV: 'GE Vernova', RKLB: 'Rocket Lab', ACHR: 'Archer Aviation', AXP: 'American Express',
  COF: 'Capital One', GS: 'Goldman Sachs', HOOD: 'Robinhood', CEG: 'Constellation Energy', CCJ: 'Cameco' };
const pos = {};
for (const t of ledger.txns) {
  if (!ledger.open.includes(t.t)) continue;
  const p = pos[t.t] || (pos[t.t] = { sh: 0, cost: 0, first: t.d });
  if (t.type === 'buy') { p.sh += t.sh; p.cost += t.amt || 0; }
  if (t.type === 'sell') { const ac = p.sh ? p.cost / p.sh : 0; p.sh -= t.sh; p.cost -= ac * t.sh; }
}
const db = {
  holdings: Object.entries(pos).filter(([, p]) => p.sh > 0.01).map(([t, p]) => ({
    t, n: NAMES[t] || t, s: SECTOR[t] || 'Industrials', sh: +p.sh.toFixed(4), ac: +(p.cost / p.sh).toFixed(2), d: p.first,
    ...(t === 'AAPL' ? { vlSafety: 1, vlTimeliness: 3 } : {}),
  })),
  cash: { bank: 265.24, brokerage: 11387.02 },
  weightings: [
    { s: 'Information Technology', p: 26, sp: 31.5 }, { s: 'Communication Services', p: 11, sp: 9.4 },
    { s: 'Consumer Discretionary', p: 8, sp: 10.4 }, { s: 'Consumer Staples', p: 7, sp: 5.6 },
    { s: 'Health Care', p: 12, sp: 9.8 }, { s: 'Industrials', p: 14, sp: 8.3 },
    { s: 'Financials', p: 14, sp: 13.6 }, { s: 'Energy + Utilities', p: 8, sp: 5.7 },
  ],
  units: 4111.03,
  unitvalue: (() => {
    const r = rng('uv'), out = []; let u = 20, sp = 1350;
    for (let y = 2012, m = 5; y < 2026 || (y === 2026 && m <= 10); m++) {
      if (m > 12) { m = 1; y++; }
      u *= 1 + 0.009 + (r() - 0.5) * 0.08; sp *= 1 + 0.009 + (r() - 0.5) * 0.07;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      out.push({ d: `${m}/${last}/${y}`, u: +u.toFixed(2), sp: y >= 2019 || (y === 2018 && m === 12) ? +sp.toFixed(2) : null });
    }
    return out;
  })(),
  transactions_added: [],
  nav_daily: [],
  holdings_log: [],
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise(ok => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
}
const authed = req => (req.headers.authorization || '') === 'Bearer dev-token';

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (p.startsWith('/api/')) {
    const route = p.slice(5);
    const delay = +process.env.API_DELAY || 60;
    await new Promise(r => setTimeout(r, delay));
    if (route === 'hist') return send(res, 200, fakeHist(u.searchParams.get('ticker').toUpperCase()));
    if (route === 'quote') {
      const h = fakeHist(u.searchParams.get('ticker').toUpperCase());
      const c = h[h.length - 1].close, pc = h[h.length - 2].close;
      return send(res, 200, { c, pc, h: +(c * 1.01).toFixed(2), l: +(c * 0.99).toFixed(2), d: +(c - pc).toFixed(2) });
    }
    if (route === 'credits') return send(res, 200, { text: 'Local preview — fake prices' });
    if (route === 'auth') {
      const src = req.method === 'POST' ? await readBody(req) : Object.fromEntries(u.searchParams);
      return src.pwd === 'dev' ? send(res, 200, { ok: true, token: 'dev-token' }) : send(res, 401, { ok: false });
    }
    if (route === 'units') {
      if (req.method === 'POST') { if (!authed(req)) return send(res, 401, {}); db.units = (await readBody(req)).units; }
      return send(res, 200, { units: db.units });
    }
    if (route === 'transactions' && req.method === 'POST') {
      if (!authed(req)) return send(res, 401, { error: 'Unauthorized' });
      const b = await readBody(req);
      if (b.action === 'delete') { db.transactions_added = db.transactions_added.filter(x => x.id !== b.id); return send(res, 200, { success: true }); }
      const t = b.txn || {};
      const amt = t.type === 'buy' ? +(t.sh * t.px + (t.fee || 0)).toFixed(2) : +(t.sh * t.px - (t.fee || 0)).toFixed(2);
      const txn = { ...t, amt, ...(t.type === 'sell' && t.basis != null ? { gain: +(amt - t.basis).toFixed(2) } : {}), id: 'a' + Date.now().toString(36), at: new Date().toISOString() };
      db.transactions_added.push(txn); return send(res, 200, { success: true, txn });
    }
    const keyMap = { holdings: 'holdings', cash: 'cash', weightings: 'weightings', unitvalue: 'unitvalue',
      transactions: 'transactions_added', 'nav-history': 'nav_daily', 'holdings-log': 'holdings_log' };
    if (keyMap[route]) {
      if (req.method === 'POST') {
        if (!authed(req)) return send(res, 401, { error: 'Unauthorized' });
        db[keyMap[route]] = await readBody(req); return send(res, 200, { success: true });
      }
      return send(res, 200, db[keyMap[route]]);
    }
    return send(res, 404, { error: 'no mock for ' + route });
  }
  let file = path.join(ROOT, decodeURIComponent(p === '/' ? '/index.html' : p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, () => console.log(`LLF preview with FAKE data → http://localhost:${PORT}  (password: dev)`));

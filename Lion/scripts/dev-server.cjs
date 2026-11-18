#!/usr/bin/env node
/*
 * Local preview of the dashboard — no Cloudflare, Redis or market-data
 * access needed. Useful for working on the UI and for QA.
 *
 *   node Lion/scripts/dev-server.cjs        → http://localhost:5173
 *   PORT=8080 node Lion/scripts/dev-server.cjs
 *
 * Fund data comes from scripts/dev-fixture.json when it exists (built from
 * the live spreadsheet by make_dev_fixture.py): real holdings, cost basis,
 * cash, units, sector targets and unit value history. PRICE HISTORY IS
 * SIMULATED: each path is pinned to the sheet's current price, its price one
 * year ago, and every real trade price in the activity ledger, so totals and
 * trade markers line up, but the wiggles in between are made up. Never use a
 * preview chart as real data.
 *
 * Every /api/* route is mocked in memory (writes last until you stop the
 * server). Password for every lock: "dev".
 * (`npm run dev` / `wrangler dev` runs the real Worker instead, but needs
 * the database secrets in Lion/.dev.vars.)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'public');
const PORT = +process.env.PORT || 5173;
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ledger.json'), 'utf8'));
const fixturePath = path.join(__dirname, 'dev-fixture.json');
const fx = fs.existsSync(fixturePath) ? JSON.parse(fs.readFileSync(fixturePath, 'utf8')) : null;
const TODAY = (fx && fx.asOf) || new Date().toISOString().slice(0, 10);

// ---- deterministic simulated prices ---------------------------------------
function rng(seed) {
  let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const gauss = r => (r() + r() + r() + r() - 2) * 1.2247; // ~N(0,1)
const dayMs = 864e5;
const tradingDays = (() => {
  const out = [];
  for (let t = Date.UTC(2011, 0, 3); t <= Date.parse(TODAY + 'T00:00:00Z'); t += dayMs) {
    const wd = new Date(t).getUTCDay(); if (wd && wd < 6) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
})();
const yearAgo = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() - 1); return x.toISOString().slice(0, 10); };

// Anchor points per ticker: real trade prices from the ledger, plus (from the
// fixture) today's price and the price one year ago.
const anchors = {};
const addAnchor = (t, d, v) => { if (v > 0 && d) (anchors[t] = anchors[t] || {})[d] = v; };
for (const x of ledger.txns) if ((x.type === 'buy' || x.type === 'sell') && x.px > 0 && !x.est) addAnchor(x.t, x.d, x.px);
if (fx) {
  for (const [t, p] of Object.entries(fx.prices)) {
    addAnchor(t, TODAY, p.c);
    if (p.y1) addAnchor(t, yearAgo(TODAY), p.y1);
  }
  // S&P 500: inception and today from the sheet, month-ends from the unit value tab. SPY ≈ index ÷ 10.
  const spy = {};
  if (fx.spx.inception) spy[fx.spx.inception.d] = fx.spx.inception.v / 10;
  for (const r of fx.unitvalue) if (r.sp) { const [m, d, y] = r.d.split('/'); spy[`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`] = r.sp / 10; }
  if (fx.spx.today) spy[fx.spx.today.d] = fx.spx.today.v / 10;
  anchors.SPY = spy;
}
const DEFAULT_END = { QQQ: 640, DIA: 470, IWM: 245, VTI: 360, XLK: 300, XLC: 115, XLP: 80, XLY: 235, XLV: 150, XLI: 150, XLF: 54, XLE: 92, XLU: 85, VOO: 670 };

const histCache = {};
function simHist(t) {
  if (histCache[t]) return histCache[t];
  const r = rng(t + ':v2');
  const vol = 0.011 + r() * 0.01;
  // Snap anchors onto trading days (weekend trades → previous trading day).
  const snap = d => { let i = tradingDays.length - 1; while (i > 0 && tradingDays[i] > d) i--; return i; };
  let pts = Object.entries(anchors[t] || {}).map(([d, v]) => [snap(d), Math.log(v)]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const p of pts) { const l = merged[merged.length - 1]; if (l && l[0] === p[0]) l[1] = (l[1] + p[1]) / 2; else merged.push(p); }
  pts = merged;
  if (!pts.length) pts = [[tradingDays.length - 1, Math.log(DEFAULT_END[t] || 50 + r() * 150)]];
  const n = tradingDays.length, lp = new Array(n);
  // Before the first anchor and after the last: plain random walk outward.
  const drift = 0.0003;
  lp[pts[0][0]] = pts[0][1];
  for (let i = pts[0][0] - 1; i >= 0; i--) lp[i] = lp[i + 1] - drift - vol * gauss(r);
  // Between anchors: Brownian bridge (random walk bent to hit both ends).
  for (let k = 0; k < pts.length - 1; k++) {
    const [i0, v0] = pts[k], [i1, v1] = pts[k + 1];
    const w = [0]; for (let i = i0 + 1; i <= i1; i++) w.push(w[w.length - 1] + vol * gauss(r));
    const span = i1 - i0 || 1;
    for (let i = i0; i <= i1; i++) { const f = (i - i0) / span; lp[i] = v0 + (v1 - v0) * f + (w[i - i0] - f * w[span]); }
  }
  const last = pts[pts.length - 1][0];
  for (let i = last + 1; i < n; i++) lp[i] = lp[i - 1] + drift + vol * gauss(r);
  return (histCache[t] = tradingDays.map((date, i) => ({ date, close: +Math.exp(lp[i]).toFixed(2) })));
}

// ---- fund state -----------------------------------------------------------
function fallbackHoldings() {
  const pos = {};
  for (const t of ledger.txns) {
    if (!ledger.open.includes(t.t)) continue;
    const p = pos[t.t] || (pos[t.t] = { sh: 0, cost: 0, first: t.d });
    if (t.type === 'buy') { p.sh += t.sh; p.cost += t.amt || 0; }
    if (t.type === 'sell') { const ac = p.sh ? p.cost / p.sh : 0; p.sh -= t.sh; p.cost -= ac * t.sh; }
  }
  return Object.entries(pos).filter(([, p]) => p.sh > 0.01).map(([t, p]) => ({ t, n: t, s: 'Industrials', sh: +p.sh.toFixed(4), ac: +(p.cost / p.sh).toFixed(2), d: p.first }));
}
const db = {
  holdings: fx ? fx.holdings : fallbackHoldings(),
  cash: fx ? fx.cash : { bank: 0, brokerage: 0 },
  weightings: fx ? fx.weightings : [],
  units: fx ? fx.units : 4111.03,
  unitvalue: fx ? fx.unitvalue : [],
  transactions_added: [], nav_daily: [], holdings_log: [],
};
if (!fx) console.warn('No scripts/dev-fixture.json: holdings fall back to the ledger, with no cash, targets or unit value history. Run make_dev_fixture.py.');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const readBody = req => new Promise(ok => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
const authed = req => (req.headers.authorization || '') === 'Bearer dev-token';

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (p.startsWith('/api/')) {
    const route = p.slice(5);
    await new Promise(r => setTimeout(r, +process.env.API_DELAY || 60));
    const tk = (u.searchParams.get('ticker') || '').toUpperCase();
    if (route === 'hist') return send(res, 200, simHist(tk));
    if (route === 'quote') {
      const h = simHist(tk), c = h[h.length - 1].close, pc = h[h.length - 2].close;
      return send(res, 200, { c, pc, h: +(Math.max(c, pc) * 1.006).toFixed(2), l: +(Math.min(c, pc) * 0.994).toFixed(2), d: +(c - pc).toFixed(2) });
    }
    if (route === 'credits') return send(res, 200, { text: '' });
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
        const body = await readBody(req);
        // same guard as the real Worker
        if (route === 'holdings' && Array.isArray(body) && !body.length && db.holdings.length) return send(res, 409, { error: 'Refusing to replace the existing holdings with an empty list. Reload the page and try again.' });
        db[keyMap[route]] = body; return send(res, 200, { success: true });
      }
      return send(res, 200, db[keyMap[route]]);
    }
    return send(res, 404, { error: 'no mock for ' + route });
  }
  const file = path.join(ROOT, decodeURIComponent(p === '/' ? '/index.html' : p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, () => console.log(`LLF local preview → http://localhost:${PORT}  (password: dev)${fx ? `  · fund data from ${fx.source}, as of ${fx.asOf}` : ''} · prices simulated`));

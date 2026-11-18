const { createClient } = require('@vercel/kv');
const { verify, bearerFrom } = require('./_lib/authToken');
const kv = createClient({
  url: process.env.LION_REST_API_URL || process.env.KV_REST_API_URL,
  token: process.env.LION_REST_API_TOKEN || process.env.KV_REST_API_TOKEN
});

// Trades recorded in the app (Holdings → "Add transaction") AFTER the
// Master File import. The imported history itself is a static file
// (/data/ledger.json, built by scripts/import_ledger.py) so it can't be
// edited or lost from here. The app shows both together.
//
// GET  → [{ id, d, t, type: 'buy'|'sell', sh, px, fee, amt, gain?, at }]
// POST → { action: 'add', txn } or { action: 'delete', id } (holdings password)
const KEY = 'transactions_added';
const MAX = 5000;

function clean(t) {
  const type = t.type === 'sell' ? 'sell' : 'buy';
  const sh = Number(t.sh), px = Number(t.px), fee = Number(t.fee) || 0;
  const ticker = String(t.t || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10);
  const d = String(t.d || '');
  if (!ticker || !(sh > 0) || !(px > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const out = { d, t: ticker, type, sh: +sh.toFixed(6), px: +px.toFixed(4), fee: +fee.toFixed(2) };
  out.amt = type === 'buy' ? +(sh * px + fee).toFixed(2) : +(sh * px - fee).toFixed(2);
  if (type === 'sell' && Number.isFinite(Number(t.basis))) {
    out.basis = +Number(t.basis).toFixed(2);
    out.gain = +(out.amt - out.basis).toFixed(2);
  }
  if (t.memo) out.memo = String(t.memo).slice(0, 200);
  return out;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      res.status(200).json((await kv.get(KEY)) || []);
      return;
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!verify(bearerFrom(req), 'holdings')) return res.status(401).json({ error: 'Unauthorized' });

    const body = req.body || {};
    const list = (await kv.get(KEY)) || [];
    if (body.action === 'delete') {
      const next = list.filter(x => x.id !== body.id);
      await kv.set(KEY, next);
      return res.status(200).json({ success: true, removed: list.length - next.length });
    }
    const txn = clean(body.txn || {});
    if (!txn) return res.status(400).json({ error: 'Need ticker, date (YYYY-MM-DD), shares > 0 and price > 0' });
    txn.id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    txn.at = new Date().toISOString();
    await kv.set(KEY, list.concat(txn).slice(-MAX));
    res.status(200).json({ success: true, txn });
  } catch (error) {
    console.error('KV Error:', error);
    res.status(500).json({ error: error.message });
  }
};

import { kv } from '../lib/kv.js';
import { verify, bearerFrom } from '../lib/auth.js';
import { cleanTxn } from '../lib/transactions.js';
import { json } from '../lib/http.js';

// Trades recorded in the app (Holdings → "Add transaction") AFTER the Master
// File import. The imported history itself is a static file
// (public/data/ledger.json, built by scripts/import_ledger.py) so it can't be
// edited or lost from here; the app shows both together.
//
// GET  → [{ id, d, t, type: 'buy'|'sell', sh, px, fee, amt, basis?, gain?, at }]
// POST → { action: 'add', txn } or { action: 'delete', id }   (holdings password)
const KEY = 'transactions_added';
const MAX = 5000;

export async function handleTransactions(request, env) {
  const client = kv(env);
  try {
    if (request.method === 'GET') return json((await client.get(KEY)) || []);
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!(await verify(bearerFrom(request), 'holdings', env))) return json({ error: 'Unauthorized' }, 401);

    const body = await request.json().catch(() => ({}));
    const list = (await client.get(KEY)) || [];
    if (body.action === 'delete') {
      const next = list.filter(x => x.id !== body.id);
      await client.set(KEY, next);
      return json({ success: true, removed: list.length - next.length });
    }
    const txn = cleanTxn(body.txn);
    if (!txn) return json({ error: 'Need buy/sell, ticker, date (YYYY-MM-DD), shares > 0 and price > 0' }, 400);
    txn.id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    txn.at = new Date().toISOString();
    await client.set(KEY, list.concat(txn).slice(-MAX));
    return json({ success: true, txn });
  } catch (error) {
    console.error('KV Error:', error);
    return json({ error: error.message }, 500);
  }
}

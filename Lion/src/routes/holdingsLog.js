import { kv } from '../lib/kv.js';
import { json } from '../lib/http.js';

// Read-only: entries are written by routes/holdings.js whenever a save
// changes the holdings array, not by anyone posting here directly.
export async function handleHoldingsLog(request, env) {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const log = (await kv(env).get('holdings_log')) || [];
    return json(log);
  } catch (error) {
    console.error('KV Error:', error);
    return json({ error: error.message }, 500);
  }
}

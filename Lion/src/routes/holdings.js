import { kv } from '../lib/kv.js';
import { verify, bearerFrom } from '../lib/auth.js';
import { diffHoldings } from '../lib/holdingsDiff.js';
import { json } from '../lib/http.js';

const MAX_LOG_ENTRIES = 5000;

export async function handleHoldings(request, env) {
  const client = kv(env);
  try {
    if (request.method === 'GET') {
      const holdings = (await client.get('holdings')) || [];
      return json(holdings);
    } else if (request.method === 'POST') {
      if (!(await verify(bearerFrom(request), 'holdings', env))) return json({ error: 'Unauthorized' }, 401);
      const holdings = await request.json();
      if (!Array.isArray(holdings)) return json({ error: 'Expected a list of holdings' }, 400);

      const prevHoldings = (await client.get('holdings')) || [];
      // A client that failed to load holdings can end up posting its empty
      // default back — this wiped all 25 positions on 2026-09-24.
      if (holdings.length === 0 && prevHoldings.length > 0) {
        return json({ error: 'Refusing to replace the existing holdings with an empty list. Reload the page and try again.' }, 409);
      }
      const events = diffHoldings(prevHoldings, holdings);
      if (events.length) {
        const now = new Date().toISOString();
        const log = (await client.get('holdings_log')) || [];
        const dated = events.map(e => ({ ...e, at: now }));
        const next = log.concat(dated).slice(-MAX_LOG_ENTRIES);
        await client.set('holdings_log', next);
      }

      await client.set('holdings', holdings);
      return json({ success: true });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('KV Error:', error);
    return json({ error: error.message }, 500);
  }
}

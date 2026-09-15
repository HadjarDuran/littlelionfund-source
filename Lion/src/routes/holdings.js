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

      const prevHoldings = (await client.get('holdings')) || [];
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

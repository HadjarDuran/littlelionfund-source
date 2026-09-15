import { kv } from '../lib/kv.js';
import { verify, bearerFrom } from '../lib/auth.js';
import { json } from '../lib/http.js';

// Units outstanding used to be a hardcoded constant in the frontend. Moved
// here so it can change (new investor contributions/redemptions) without a
// code deploy, and so the NAV snapshot job can read the same number the
// app displays.
const DEFAULT_UNITS = 4111.03;

export async function handleUnits(request, env) {
  const client = kv(env);
  try {
    if (request.method === 'GET') {
      const units = await client.get('fund_units');
      return json({ units: typeof units === 'number' && units > 0 ? units : DEFAULT_UNITS });
    } else if (request.method === 'POST') {
      if (!(await verify(bearerFrom(request), 'holdings', env))) return json({ error: 'Unauthorized' }, 401);
      const body = await request.json();
      const units = Number(body && body.units);
      if (!(units > 0)) return json({ error: 'units must be a positive number' }, 400);
      await client.set('fund_units', units);
      return json({ success: true, units });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('KV Error:', error);
    return json({ error: error.message }, 500);
  }
}

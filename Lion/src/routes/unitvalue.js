import { kv } from '../lib/kv.js';
import { verify, bearerFrom } from '../lib/auth.js';
import { json } from '../lib/http.js';

export async function handleUnitvalue(request, env) {
  const client = kv(env);
  try {
    if (request.method === 'GET') {
      const unitvalue = await client.get('unitvalue');
      return json(unitvalue || []);
    } else if (request.method === 'POST') {
      // Unit Value shares the Holdings password/lock in the UI, so it shares the "holdings" token scope.
      if (!(await verify(bearerFrom(request), 'holdings', env))) return json({ error: 'Unauthorized' }, 401);
      const unitvalue = await request.json();
      if (!Array.isArray(unitvalue)) return json({ error: 'Expected a list of unit value entries' }, 400);
      if (unitvalue.length === 0) {
        const prev = await client.get('unitvalue');
        if (Array.isArray(prev) && prev.length > 0) {
          return json({ error: 'Refusing to replace the existing unit value history with an empty list. Reload the page and try again.' }, 409);
        }
      }
      await client.set('unitvalue', unitvalue);
      return json({ success: true });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('KV Error:', error);
    return json({ error: error.message }, 500);
  }
}

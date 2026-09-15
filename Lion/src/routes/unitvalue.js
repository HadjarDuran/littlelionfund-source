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
      await client.set('unitvalue', unitvalue);
      return json({ success: true });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('KV Error:', error);
    return json({ error: error.message }, 500);
  }
}

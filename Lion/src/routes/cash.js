import { kv } from '../lib/kv.js';
import { verify, bearerFrom } from '../lib/auth.js';
import { json } from '../lib/http.js';

export async function handleCash(request, env) {
  const client = kv(env);
  try {
    if (request.method === 'GET') {
      const cash = (await client.get('cash')) || { bank: 0, brokerage: 0 };
      return json(cash);
    } else if (request.method === 'POST') {
      if (!(await verify(bearerFrom(request), 'holdings', env))) return json({ error: 'Unauthorized' }, 401);
      const cash = await request.json();
      await client.set('cash', cash);
      return json({ success: true });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('KV Error:', error);
    return json({ error: error.message }, 500);
  }
}

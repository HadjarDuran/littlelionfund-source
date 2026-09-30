import { kv } from '../lib/kv.js';
import { verify, bearerFrom } from '../lib/auth.js';
import { json } from '../lib/http.js';

export async function handleWeightings(request, env) {
  const client = kv(env);
  try {
    if (request.method === 'GET') {
      const weightings = await client.get('weightings');
      return json(weightings || []);
    } else if (request.method === 'POST') {
      if (!(await verify(bearerFrom(request), 'weightings', env))) return json({ error: 'Unauthorized' }, 401);
      const weightings = await request.json();
      if (!Array.isArray(weightings)) return json({ error: 'Expected a list of weightings' }, 400);
      if (weightings.length === 0) {
        const prev = await client.get('weightings');
        if (Array.isArray(prev) && prev.length > 0) {
          return json({ error: 'Refusing to replace the existing weightings with an empty list. Reload the page and try again.' }, 409);
        }
      }
      await client.set('weightings', weightings);
      return json({ success: true });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('KV Error:', error);
    return json({ error: error.message }, 500);
  }
}

import { kv } from '../lib/kv.js';
import { json } from '../lib/http.js';

// Read-only: entries are written once a day by routes/snapshotNav.js's
// scheduled handler, not by anyone posting here directly. This is the
// full daily series; snapshotNav.js also rolls the same computed value
// into the current month's row of the monthly "unitvalue" series
// (routes/unitvalue.js) so that display stays current without manual
// entry, while leaving every already-completed month exactly as entered.
export async function handleNavHistory(request, env) {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const nav = (await kv(env).get('nav_daily')) || [];
    return json(nav);
  } catch (error) {
    console.error('KV Error:', error);
    return json({ error: error.message }, 500);
  }
}

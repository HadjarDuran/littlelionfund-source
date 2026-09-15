import { kv } from '../lib/kv.js';
import { json } from '../lib/http.js';

// Read-only: entries are written once a day by routes/snapshotNav.js's
// scheduled handler, not by anyone posting here directly. Separate from
// the existing hand-entered monthly "unitvalue" series (routes/unitvalue.js)
// — that one is the fund's real historical record going back to 2018 and
// isn't touched by this. This is the new, automatic, daily-going-forward
// series.
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

import { kv } from '../lib/kv.js';
import { verify, bearerFrom } from '../lib/auth.js';
import { json } from '../lib/http.js';

// Entries are written once a day by routes/snapshotNav.js's scheduled
// handler. This is the full daily series; snapshotNav.js also rolls the
// same computed value into the current month's row of the monthly
// "unitvalue" series (routes/unitvalue.js) so that display stays current
// without manual entry, while leaving every already-completed month exactly
// as entered.
//
// POST is for correcting days the snapshot recorded wrongly (e.g. while the
// holdings list was missing). It only replaces the dates it is given and
// leaves every other day untouched; it never removes entries.
export async function handleNavHistory(request, env) {
  const client = kv(env);
  try {
    if (request.method === 'GET') {
      const nav = (await client.get('nav_daily')) || [];
      return json(nav);
    } else if (request.method === 'POST') {
      if (!(await verify(bearerFrom(request), 'holdings', env))) return json({ error: 'Unauthorized' }, 401);
      const fixes = await request.json();
      if (!Array.isArray(fixes) || fixes.length === 0) return json({ error: 'Expected a non-empty list of corrected entries' }, 400);
      for (const e of fixes) {
        if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !(e.unitValue > 0) || !(e.totalEquity > 0)) {
          return json({ error: 'Each entry needs a YYYY-MM-DD date and positive unitValue and totalEquity' }, 400);
        }
      }
      const nav = (await client.get('nav_daily')) || [];
      for (const e of fixes) {
        const entry = {
          date: e.date,
          unitValue: +e.unitValue,
          totalEquity: +e.totalEquity,
          spy: e.spy ?? null,
          missingQuotes: Array.isArray(e.missingQuotes) ? e.missingQuotes : [],
        };
        const idx = nav.findIndex(r => r.date === e.date);
        if (idx >= 0) nav[idx] = entry; else nav.push(entry);
      }
      nav.sort((a, b) => a.date.localeCompare(b.date));
      await client.set('nav_daily', nav);
      return json({ success: true, updated: fixes.length });
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('KV Error:', error);
    return json({ error: error.message }, 500);
  }
}

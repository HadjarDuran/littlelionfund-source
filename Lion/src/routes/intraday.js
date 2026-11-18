import { kv } from '../lib/kv.js';
import { json } from '../lib/http.js';
import { cleanTicker } from '../lib/transactions.js';
import { INTRADAY, MAX_AGE_SECONDS, isFresh, parseYahooChart } from '../lib/intraday.js';

// GET /api/intraday?ticker=AAPL&range=1d|5d
// → { points: [{ t, c }], prevClose, tz, at, stale? }
//
// Short-term bars for the 1D / 1W chart views. A copy is kept in Redis for a
// couple of minutes so 25 holdings × every visitor doesn't hammer Yahoo, and
// every copy is set to delete itself after 24 hours (MAX_AGE_SECONDS): this
// data is never stored long-term. If Yahoo refuses a request, the last copy
// (at most a day old) is served and marked stale.
const UPSTREAM_TIMEOUT_MS = 6000;

async function fetchYahoo(sym, cfg) {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?range=${cfg.range}&interval=${cfg.interval}&includePrePost=false`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }
      );
      if (!r.ok) continue;
      const parsed = parseYahooChart(await r.json());
      if (parsed) return parsed;
    } catch (e) {}
  }
  return null;
}

export async function handleIntraday(request, env, ctx) {
  const url = new URL(request.url);
  const sym = cleanTicker(url.searchParams.get('ticker')).replace('.', '-'); // Yahoo spells BRK-B
  const rangeKey = url.searchParams.get('range') === '5d' ? '5d' : '1d';
  if (!sym) return json({ error: 'Missing ticker' }, 400);
  const cfg = INTRADAY[rangeKey];
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' };

  const client = kv(env);
  const key = `intra:${rangeKey}:${sym}`;
  let saved = null;
  try { saved = await client.get(key); } catch (e) {}
  if (isFresh(saved, rangeKey)) return json(saved, 200, headers);

  const fresh = await fetchYahoo(sym, cfg);
  if (fresh) {
    const rec = { ...fresh, at: Date.now() };
    const save = client.set(key, rec, { ex: MAX_AGE_SECONDS }).catch(e => console.error('intraday save failed', sym, e));
    if (ctx && ctx.waitUntil) ctx.waitUntil(save); else await save;
    return json(rec, 200, headers);
  }
  if (saved && Array.isArray(saved.points) && saved.points.length) return json({ ...saved, stale: true }, 200, headers);
  return json({ error: 'Intraday prices are unavailable right now' }, 502, { ...headers, 'Cache-Control': 'no-store' });
}

import { kv } from '../lib/kv.js';
import { json } from '../lib/http.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=3600', // cache 1 hour at the edge
};

// Each holding's full daily history used to be fetched live from Stooq/Yahoo
// on every page load, 4 tickers at a time. Those sources regularly refuse or
// rate-limit requests from Cloudflare's servers, so on any given load some
// tickers came back empty and their charts showed "No history data". Now the
// last good copy of each ticker's history is kept in the database: it's
// served straight from there while fresh, refreshed in the background once
// stale, and still served if a refresh fails — a chart only goes empty if a
// ticker has never once loaded successfully.
const FRESH_MS = 6 * 60 * 60 * 1000;
// Stooq in particular can stall without ever answering; without a cutoff the
// request (and the chart waiting on it) hangs until Cloudflare kills it.
const UPSTREAM_TIMEOUT_MS = 8000;

async function fetchStooq(ticker) {
  const r = await fetch(`https://stooq.com/q/d/l/?s=${ticker}.US&i=d`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const text = await r.text();
  const lines = text.trim().split('\n');
  if (lines.length <= 5) return null;
  const data = lines.slice(1).map(l => {
    const [date, , , , close] = l.split(',');
    return date && close ? { date: date.trim(), close: parseFloat(close) } : null;
  }).filter(d => d && !isNaN(d.close)).sort((a, b) => a.date.localeCompare(b.date));
  return data.length > 20 ? data : null;
}

// Explicit period1/period2 rather than range=max: Yahoo's chart API silently
// collapses to coarser-than-daily candles (monthly/quarterly) for range=max
// on tickers with a long history, even with interval=1d set — range=max lets
// the server pick "appropriate" granularity for the full span instead of
// honoring the requested interval. An explicit bounded window is reliably
// daily. Tries both of Yahoo's hosts, since one is often throttled when the
// other isn't.
async function fetchYahoo(ticker) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 20 * 365 * 86400; // 20 years back — plenty for 5 Year / All Time
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${from}&period2=${to}&interval=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }
      );
      if (!r.ok) continue;
      const body = await r.json();
      const result = body.chart.result[0];
      const closes = result.indicators.quote[0].close;
      const data = result.timestamp.map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        close: closes[i] ? +closes[i].toFixed(4) : null,
      })).filter(d => d.close !== null);
      if (data.length > 20) return data;
    } catch (e) {}
  }
  return null;
}

async function fetchUpstream(ticker) {
  try {
    const s = await fetchStooq(ticker);
    if (s) return s;
  } catch (e) {}
  return fetchYahoo(ticker);
}

async function refresh(client, key, ticker) {
  const data = await fetchUpstream(ticker);
  if (data) {
    try { await client.set(key, { at: Date.now(), data }); } catch (e) { console.error('hist save failed', ticker, e); }
  }
  return data;
}

export async function handleHist(request, env, ctx) {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!ticker) return new Response('Missing ticker', { status: 400 });

  const client = kv(env);
  const key = `hist:${ticker}`;
  let saved = null;
  try { saved = await client.get(key); } catch (e) {}
  const hasSaved = saved && Array.isArray(saved.data) && saved.data.length > 0;

  if (hasSaved) {
    if (Date.now() - (saved.at || 0) > FRESH_MS) {
      const bg = refresh(client, key, ticker).catch(() => {});
      if (ctx && ctx.waitUntil) ctx.waitUntil(bg); else await bg;
    }
    return json(saved.data, 200, CORS);
  }

  try {
    const data = await refresh(client, key, ticker);
    if (data) return json(data, 200, CORS);
  } catch (e) {}
  return json({ error: 'Failed to fetch history' }, 502, { ...CORS, 'Cache-Control': 'no-store' });
}

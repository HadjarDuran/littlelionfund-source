import { json } from '../lib/http.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=3600', // cache 1 hour at the edge
};

export async function handleHist(request, env) {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!ticker) return new Response('Missing ticker', { status: 400 });

  // Try Stooq first
  try {
    const r = await fetch(`https://stooq.com/q/d/l/?s=${ticker}.US&i=d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const text = await r.text();
    const lines = text.trim().split('\n');
    if (lines.length > 5) {
      const data = lines.slice(1).map(l => {
        const [date, , , , close] = l.split(',');
        return date && close ? { date: date.trim(), close: parseFloat(close) } : null;
      }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
      if (data.length > 20) return json(data, 200, CORS);
    }
  } catch (e) {}

  // Fall back to Yahoo Finance. Explicit period1/period2 rather than
  // range=max: Yahoo's chart API silently collapses to coarser-than-daily
  // candles (monthly/quarterly) for range=max on tickers with a long
  // history, even with interval=1d set — range=max lets the server pick
  // "appropriate" granularity for the full span instead of honoring the
  // requested interval. An explicit bounded window is reliably daily.
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 20 * 365 * 86400; // 20 years back — plenty for 5 Year / All Time
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${from}&period2=${to}&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const body = await r.json();
    const result = body.chart.result[0];
    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const data = timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      close: closes[i] ? +closes[i].toFixed(4) : null,
    })).filter(d => d.close !== null);
    return json(data, 200, CORS);
  } catch (e) {
    return json({ error: 'Failed to fetch history' }, 502, CORS);
  }
}

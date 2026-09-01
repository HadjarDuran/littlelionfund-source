export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get('ticker') || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!ticker) return new Response('Missing ticker', { status: 400 });

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 's-maxage=3600', // cache 1 hour at the edge
  };

  // Try Stooq first
  try {
    const r = await fetch(`https://stooq.com/q/d/l/?s=${ticker}.US&i=d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const text = await r.text();
    const lines = text.trim().split('\n');
    if (lines.length > 5) {
      const data = lines.slice(1).map(l => {
        const [date,,,,close] = l.split(',');
        return date && close ? { date: date.trim(), close: parseFloat(close) } : null;
      }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
      if (data.length > 20) return new Response(JSON.stringify(data), { headers });
    }
  } catch (e) {}

  // Fall back to Yahoo Finance — range=max instead of a fixed lookback window
  // so a ticker that misses Stooq still gets its full available history for
  // the 5 Year / All Time chart views, not just the last ~400 days.
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=max&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const json = await r.json();
    const result = json.chart.result[0];
    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const data = timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      close: closes[i] ? +closes[i].toFixed(4) : null,
    })).filter(d => d.close !== null);
    return new Response(JSON.stringify(data), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to fetch history' }), { status: 502, headers });
  }
}
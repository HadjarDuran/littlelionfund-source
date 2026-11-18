export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  // Letters plus . and - so class shares (BRK.B / BRK-B) work.
  const ticker = (searchParams.get('ticker') || '').toUpperCase().replace(/[^A-Z.\-]/g, '').slice(0, 10);
  const key = process.env.FINNHUB_KEY; // stored in Vercel env vars — never in your HTML

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 's-maxage=60',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker.replace('-', '.')}&token=${key}`);
    const data = await r.json();
    return new Response(JSON.stringify(data), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'quote failed' }), { status: 502, headers });
  }
}
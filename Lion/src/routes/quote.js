import { json } from '../lib/http.js';
import { cleanTicker } from '../lib/transactions.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 's-maxage=60',
};

export async function handleQuote(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const url = new URL(request.url);
  // Finnhub spells class shares with a dot (BRK.B).
  const ticker = cleanTicker(url.searchParams.get('ticker')).replace('-', '.');
  const key = env.FINNHUB_KEY; // stored as a Worker secret — never in your HTML

  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${key}`);
    const data = await r.json();
    return json(data, 200, CORS);
  } catch (e) {
    return json({ error: 'quote failed' }, 502, CORS);
  }
}

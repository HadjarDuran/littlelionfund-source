export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  // The credits string lives in this env var on Vercel — never in client code
  const text = process.env.CREDITS_TEXT ||
    'Made by Maximus Weeseman for Luke Alexander and the Little Lion Fund';

  return new Response(JSON.stringify({ text }), { headers });
}

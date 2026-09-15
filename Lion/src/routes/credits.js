import { json } from '../lib/http.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
};

export async function handleCredits(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // The credits string lives in this env var — never in client code.
  const text = env.CREDITS_TEXT || 'Made by Maximus Weeseman for Luke Alexander and the Little Lion Fund';
  return json({ text }, 200, CORS);
}

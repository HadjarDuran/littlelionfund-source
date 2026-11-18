import { sign } from '../lib/auth.js';
import { json } from '../lib/http.js';

export async function handleAuth(request, env) {
  // The dashboard sends the password in a POST body so it never lands in a
  // URL (URLs end up in logs, history and proxies). GET with ?pwd= still
  // works for the verify-deploy workflow and any old cached page.
  const url = new URL(request.url);
  let src = { pwd: url.searchParams.get('pwd'), type: url.searchParams.get('type') };
  if (request.method === 'POST') src = await request.json().catch(() => ({}));
  const pwd = String(src.pwd || '');
  const type = String(src.type || 'holdings');
  const scope = type === 'weightings' ? 'weightings' : 'holdings';

  // Separate env vars for separate locks. No hardcoded fallback: if the
  // env var isn't set, serverPwd is undefined and no submitted password
  // can match it, so auth fails closed instead of accepting a guessable default.
  const serverPwd = scope === 'weightings' ? env.WEIGHTINGS_PWD : env.HOLDINGS_PWD;

  if (pwd && serverPwd && pwd === serverPwd) {
    return json({ ok: true, token: await sign(scope, env) }, 200, { 'Cache-Control': 'no-store' });
  }
  return json({ ok: false }, 401, { 'Cache-Control': 'no-store' });
}

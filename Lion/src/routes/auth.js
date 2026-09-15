import { sign } from '../lib/auth.js';
import { json } from '../lib/http.js';

export async function handleAuth(request, env) {
  const url = new URL(request.url);
  const pwd = url.searchParams.get('pwd') || '';
  const type = url.searchParams.get('type') || 'holdings';
  const scope = type === 'weightings' ? 'weightings' : 'holdings';

  // Separate env vars for separate locks. No hardcoded fallback: if the
  // env var isn't set, serverPwd is undefined and no submitted password
  // can match it, so auth fails closed instead of accepting a guessable default.
  const serverPwd = scope === 'weightings' ? env.WEIGHTINGS_PWD : env.HOLDINGS_PWD;

  if (pwd && serverPwd && pwd === serverPwd) {
    return json({ ok: true, token: await sign(scope, env) });
  }
  return json({ ok: false }, 401);
}

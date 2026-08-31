export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const pwd = searchParams.get('pwd') || '';
  const type = searchParams.get('type') || 'holdings';
  
  // Separate env vars for separate locks. No hardcoded fallback: if the
  // env var isn't set, serverPwd is undefined and no submitted password
  // can match it, so auth fails closed instead of accepting a guessable default.
  const serverPwd = type === 'weightings'
    ? process.env.WEIGHTINGS_PWD
    : process.env.HOLDINGS_PWD;

  if (pwd && serverPwd && pwd === serverPwd) {
    return new Response(JSON.stringify({ ok: true }));
  } else {
    return new Response(JSON.stringify({ ok: false }), { status: 401 });
  }
}

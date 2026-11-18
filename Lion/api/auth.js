const { sign } = require('./_lib/authToken');

module.exports = async function handler(req, res) {
  // The password now arrives in a POST body so it never lands in a URL
  // (URLs end up in server logs, browser history and proxies). GET with
  // ?pwd= still works for any old cached copy of the page.
  const src = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const pwd = String(src.pwd || '');
  const type = String(src.type || 'holdings');
  const scope = type === 'weightings' ? 'weightings' : 'holdings';

  // Separate env vars for separate locks. No hardcoded fallback: if the
  // env var isn't set, serverPwd is undefined and no submitted password
  // can match it, so auth fails closed instead of accepting a guessable default.
  const serverPwd = scope === 'weightings' ? process.env.WEIGHTINGS_PWD : process.env.HOLDINGS_PWD;

  res.setHeader('Cache-Control', 'no-store');
  if (pwd && serverPwd && pwd === serverPwd) {
    res.status(200).json({ ok: true, token: sign(scope) });
  } else {
    res.status(401).json({ ok: false });
  }
};

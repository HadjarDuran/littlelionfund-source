const { sign } = require('./_lib/authToken');

module.exports = async function handler(req, res) {
  const pwd = (req.query.pwd || '');
  const type = (req.query.type || 'holdings');
  const scope = type === 'weightings' ? 'weightings' : 'holdings';

  // Separate env vars for separate locks. No hardcoded fallback: if the
  // env var isn't set, serverPwd is undefined and no submitted password
  // can match it, so auth fails closed instead of accepting a guessable default.
  const serverPwd = scope === 'weightings' ? process.env.WEIGHTINGS_PWD : process.env.HOLDINGS_PWD;

  if (pwd && serverPwd && pwd === serverPwd) {
    res.status(200).json({ ok: true, token: sign(scope) });
  } else {
    res.status(401).json({ ok: false });
  }
};

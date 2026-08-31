// Shared HMAC session tokens for the password-gated write endpoints.
// Not itself a route: files/folders under api/ prefixed with "_" are
// excluded from Vercel's automatic API routing.
const crypto = require('crypto');

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function getSecret() {
  // Prefer a dedicated secret. Falls back to the two tab passwords so
  // existing deployments keep working without a new env var, but a real
  // SESSION_SECRET is recommended once one is set.
  return process.env.SESSION_SECRET || `${process.env.HOLDINGS_PWD || ''}:${process.env.WEIGHTINGS_PWD || ''}`;
}

function sign(scope) {
  const payload = Buffer.from(JSON.stringify({ scope, exp: Date.now() + TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verify(token, requiredScope) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (e) { return false; }
  if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return false;
  return data.scope === requiredScope;
}

function bearerFrom(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'] || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

module.exports = { sign, verify, bearerFrom };

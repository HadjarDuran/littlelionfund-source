// Shared HMAC session tokens for the password-gated write endpoints.
// Ported from Node's `crypto` module (Vercel) to the Web Crypto API
// (`crypto.subtle`), which is a global in the Workers runtime — this avoids
// needing the `nodejs_compat` compatibility flag entirely. Same scheme as
// before: sign a {scope, exp} payload, verify it hasn't expired and matches
// the required scope.
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function getSecret(env) {
  // Prefer a dedicated secret. Falls back to the two tab passwords so
  // existing deployments keep working without a new env var, but a real
  // SESSION_SECRET is recommended once one is set.
  return env.SESSION_SECRET || `${env.HOLDINGS_PWD || ''}:${env.WEIGHTINGS_PWD || ''}`;
}

function toBase64Url(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function sign(scope, env) {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ scope, exp: Date.now() + TTL_MS })));
  const key = await hmacKey(getSecret(env));
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sig = toBase64Url(new Uint8Array(sigBuf));
  return `${payload}.${sig}`;
}

export async function verify(token, requiredScope, env) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const key = await hmacKey(getSecret(env));
  let sigBytes;
  try {
    sigBytes = fromBase64Url(sig);
  } catch (e) {
    return false;
  }
  // crypto.subtle.verify does a constant-time comparison internally —
  // same protection Node's timingSafeEqual gave the old implementation.
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
  if (!valid) return false;

  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch (e) {
    return false;
  }
  if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return false;
  return data.scope === requiredScope;
}

export function bearerFrom(request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

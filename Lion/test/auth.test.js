import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../src/lib/auth.js';

const env = { HOLDINGS_PWD: 'test-holdings-pwd', WEIGHTINGS_PWD: 'test-weightings-pwd' };

test('a freshly signed token verifies for its own scope', async () => {
  const token = await sign('holdings', env);
  assert.equal(await verify(token, 'holdings', env), true);
});

test('a token does not verify for a different scope', async () => {
  const token = await sign('holdings', env);
  assert.equal(await verify(token, 'weightings', env), false);
});

test('an empty or malformed token never verifies', async () => {
  assert.equal(await verify('', 'holdings', env), false);
  assert.equal(await verify('not-a-real-token', 'holdings', env), false);
  assert.equal(await verify(null, 'holdings', env), false);
  assert.equal(await verify(undefined, 'holdings', env), false);
});

test('tampering with the signature invalidates the token', async () => {
  const token = await sign('holdings', env);
  const [payload, sig] = token.split('.');
  const tampered = `${payload}.${sig.slice(0, -1)}${sig.at(-1) === 'A' ? 'B' : 'A'}`;
  assert.equal(await verify(tampered, 'holdings', env), false);
});

test('tampering with the payload invalidates the token even if scope looks right', async () => {
  const token = await sign('weightings', env);
  const [, sig] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ scope: 'holdings', exp: Date.now() + 1000000 }))
    .toString('base64url');
  assert.equal(await verify(`${forgedPayload}.${sig}`, 'holdings', env), false);
});

test('a token signed with different secrets does not verify against the current ones', async () => {
  const otherEnv = { HOLDINGS_PWD: 'different-pwd', WEIGHTINGS_PWD: 'test-weightings-pwd' };
  const token = await sign('holdings', otherEnv);
  assert.equal(await verify(token, 'holdings', env), false);
});

test('an expired token does not verify', async () => {
  // Build an already-expired payload by hand, signed with the real secret,
  // to test the expiry check without waiting 12 hours.
  const { createHmac } = await import('node:crypto');
  const payload = Buffer.from(JSON.stringify({ scope: 'holdings', exp: Date.now() - 1000 }))
    .toString('base64url');
  const secret = env.SESSION_SECRET || `${env.HOLDINGS_PWD || ''}:${env.WEIGHTINGS_PWD || ''}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  assert.equal(await verify(`${payload}.${sig}`, 'holdings', env), false);
});

// Same Upstash Redis database the app has always used — @vercel/kv was just
// a thin Vercel-branded wrapper around this same REST API. Moving to
// Cloudflare needs zero data migration: same URL, same token, same data.
// The /cloudflare entrypoint is Upstash's build made for the Workers
// runtime (fetch-based, no Node dependencies).
import { Redis } from '@upstash/redis/cloudflare';

export function kv(env) {
  return new Redis({
    url: env.LION_REST_API_URL || env.KV_REST_API_URL,
    token: env.LION_REST_API_TOKEN || env.KV_REST_API_TOKEN,
  });
}

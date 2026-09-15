# Setting up Cloudflare for the Little Lion Fund

The code in this repo (`src/worker.js`, `src/routes/*`, `src/lib/*`, `wrangler.toml`,
`public/*`) is a complete, tested Cloudflare Workers port of the app that used to run on
Vercel. No further code changes should be needed — everything below is account/dashboard
setup, done once.

## 0. What you'll need

- A free Cloudflare account (cloudflare.com → Sign up)
- The values currently sitting in the Vercel project's environment variables:
  `HOLDINGS_PWD`, `WEIGHTINGS_PWD`, `SESSION_SECRET` (if set), `FINNHUB_KEY`,
  and the Upstash Redis URL/token (`LION_REST_API_URL`/`KV_REST_API_URL` and
  `LION_REST_API_TOKEN`/`KV_REST_API_TOKEN`) — copy these from the Vercel
  dashboard before starting, you'll paste them into Cloudflare unchanged.
- Node.js installed locally (for the one-time `wrangler login` and first deploy)

## 1. Log in to Cloudflare from the CLI

```bash
cd Lion
npm install
npx wrangler login
```

This opens a browser tab to authorize Wrangler (Cloudflare's CLI) against your account.

## 2. Set the secrets

Run each of these once, pasting in the same value that's in the Vercel dashboard today
(you'll be prompted to paste it after running each command):

```bash
npx wrangler secret put HOLDINGS_PWD
npx wrangler secret put WEIGHTINGS_PWD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put FINNHUB_KEY
npx wrangler secret put LION_REST_API_URL
npx wrangler secret put LION_REST_API_TOKEN
```

Notes:
- If you don't currently have a `SESSION_SECRET` set on Vercel, generate one now
  (anything long/random, e.g. `openssl rand -hex 32`) rather than leaving it unset.
- `CREDITS_TEXT` does **not** need to be set — it's already in `wrangler.toml` as a plain
  (non-secret) variable, and will deploy as-is.
- There is **no `CRON_SECRET` to set** — the old Vercel version needed one because its
  cron job was triggered over HTTP; Cloudflare's Cron Trigger calls the Worker directly,
  so that whole mechanism is gone.

## 3. First deploy

```bash
npx wrangler deploy
```

This publishes the Worker to a free `*.workers.dev` URL, which Wrangler prints when the
deploy finishes (something like `little-lion-fund.<your-subdomain>.workers.dev`).

## 4. Test on the workers.dev URL before touching any domain

Open the printed URL and go through the whole app for real:

- [ ] Dashboard loads with live prices and history
- [ ] Sectors / Performance / Unit Value tabs all render
- [ ] Holdings password unlocks correctly (and a wrong password is rejected)
- [ ] Edit a holding, confirm it saves and persists after a refresh
- [ ] The new "remove shares" flow works
- [ ] Weightings password/save works
- [ ] Unit Value entries save
- [ ] Sector detail view, drag-to-measure, mobile layout — spot check a few

Since this is reading/writing the **same live Upstash database** the Vercel deployment
uses, anything you save here is real — treat it like production, because it is.

To test the daily NAV snapshot without waiting for the actual scheduled time, trigger it
manually from the Cloudflare dashboard (Worker → Triggers → Cron Triggers → "Trigger
event"), or locally via `npx wrangler dev --test-scheduled` and hitting
`http://localhost:8787/__scheduled?cron=0+21+*+*+1-5`.

## 5. Connect GitHub for auto-deploy (optional but recommended)

To get the same "push to `main` → auto-deploys" workflow Vercel gave you:

1. Cloudflare dashboard → Workers & Pages → your Worker → Settings → Builds
2. Connect the GitHub repository (`littlelionfund-source`)
3. Set the root directory to `Lion` (this repo has the Worker nested inside `Lion/`,
   same as it was nested for Vercel)
4. Cloudflare will now build and deploy automatically on every push to `main`, with
   preview deployments for other branches/PRs

## 6. Buy the domain (optional — the app works fine on the free workers.dev URL)

1. Cloudflare dashboard → Domain Registration → Register a Domain
2. Search `littlelionfund.org`
3. **Confirm it's actually available before purchasing** — I couldn't run a live
   availability check from my end (see the cost analysis document); this is the moment
   to find out for certain.
4. Complete the purchase (~$9-10/year at Cloudflare's at-cost pricing, no markup, and no
   renewal price increase — this is the number in the cost analysis PDF)

## 7. Attach the domain to the Worker

1. Workers & Pages → your Worker → Settings → Domains & Routes → Add → Custom Domain
2. Enter `littlelionfund.org` (and `www.littlelionfund.org` if you want that to work too)
3. Because the domain is registered *through* Cloudflare, DNS is already on Cloudflare —
   this step is closer to instant than it would be moving an externally-registered domain
4. Cloudflare provisions the SSL certificate automatically; give it a few minutes

## 8. Cut over

Once the custom domain resolves and you've re-tested against it (same checklist as step
4, now on the real domain), you're done. Leave the Vercel project in place, paused/idle,
for a rollback window — since both platforms would be reading the same Upstash database,
"rolling back" is just a DNS/domain change, not a data restore.

## Rollback

If anything looks wrong after cutover: repoint the domain back to Vercel (or just keep
using the `*.workers.dev` URL while you debug — it doesn't go away). No data is at risk
either direction since the database is shared and untouched by any of this.

<!-- trigger: confirming Cloudflare Git webhook builds this branch correctly -->

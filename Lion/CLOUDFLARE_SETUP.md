# Setting up Cloudflare for the Little Lion Fund

The code in this repo (`src/worker.js`, `src/routes/*`, `src/lib/*`, `wrangler.toml`,
`public/*`) is a complete, tested Cloudflare Workers port of the app that used to run on
Vercel. This doc reflects what actually worked when this was set up (dashboard-only, no
local CLI needed), including a couple of gotchas that cost real time — read the **Gotchas**
section before redoing any of this from scratch.

## Current status (as of this setup session)

- ✅ Worker created and deploying successfully from the `cloudflare-migration` branch
- ✅ Live at: `https://littlelionfunddashboard.dwu-4ce.workers.dev`
- ✅ Static site, all API routes, and the cron trigger are deployed and working
- ✅ 5 secrets added: `HOLDINGS_PWD`, `WEIGHTINGS_PWD`, `FINNHUB_KEY`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`
- ⚠️ **Holdings/Weightings password isn't unlocking yet** — see "Debugging the password" below.
  This does **not** block viewing the dashboard: every read-only route (Dashboard, Sectors,
  Performance, Unit Value, live prices) works with no login at all. Only *editing*
  Holdings/Weightings needs the password to work.
- ⬜ Domain not yet purchased/attached
- ⬜ Not yet cut over from Vercel (Vercel is still live and untouched — this is all safe to
  keep testing without any risk to the production site)

## 0. What you'll need

- A free Cloudflare account (cloudflare.com → Sign up) — done
- The values sitting in the Vercel project's Environment Variables page — copied over already,
  see the table below for exactly which ones matter
- No local Node.js/terminal needed — this was all done through the Cloudflare dashboard's
  Git integration, which builds and deploys automatically on every push

## 1. Create the Worker (already done)

Dashboard → Workers & Pages → Create → **Continue with GitHub** (not "Continue to Pages" —
that's a different, older product that can't run the scheduled cron job this app needs).
Connected to `HadjarDuran/littlelionfund-source`.

**Settings that matter** (Settings tab → Build configuration):
- **Branch: `cloudflare-migration`** — not `main`. `main` still has the old Vercel-style
  layout and will fail to build.
- **Root directory: `Lion`** — capital L, no leading slash. GitHub is case-sensitive; `lion`
  (lowercase) will fail with "root directory not found" even though it looks identical to
  a human eye.
- Deploy command: `npx wrangler deploy` (auto-detected, don't need to change it)

## 2. Secrets (already added)

Settings → Variables and Secrets → Add each as type **Secret**, using the **same names**
Vercel uses (no renaming needed, the code checks for these exact names):

| Vercel variable | Cloudflare secret | Status |
|---|---|---|
| `HOLDINGS_PWD` | `HOLDINGS_PWD` | ✅ added |
| `WEIGHTINGS_PWD` | `WEIGHTINGS_PWD` | ✅ added |
| `FINNHUB_KEY` | `FINNHUB_KEY` | ✅ added |
| `KV_REST_API_URL` | `KV_REST_API_URL` | ✅ added |
| `KV_REST_API_TOKEN` | `KV_REST_API_TOKEN` | ✅ added |
| *(not set on Vercel)* | `SESSION_SECRET` | intentionally skipped — see note |
| `CREDITS_TEXT` | *(already in `wrangler.toml`)* | no action needed unless customized |

`SESSION_SECRET` isn't set on Vercel either — the app falls back to combining
`HOLDINGS_PWD:WEIGHTINGS_PWD` into one when it's missing, so leaving it unset on Cloudflare
keeps behavior identical to today. Add a real one later if you want, no rush.

## 3. Debugging the password (pick this back up first)

Symptom: entering the Holdings password on the live site says it's wrong.

**Test it the right way first** — through the app's actual password field (Holdings tab →
type password → Unlock), not by typing it into the browser's address bar. The app's own
code properly encodes special characters before sending the password
(`encodeURIComponent(p)` in `checkTabPwd()`); typing a password with an `&`, `#`, `+`, `%`,
or space directly into a URL bar does **not** get encoded the same way and can silently
corrupt the password before it even reaches the server — producing a false "wrong password"
result even if the Cloudflare secret is set correctly. (This was used as a quick diagnostic
during setup and got `{"ok":false}` — that result is inconclusive if the real password has
any of those characters in it. Re-test via the real form.)

If the real form still rejects it, check these in order:
1. **Did a deploy happen *after* the secrets were added?** Cloudflare didn't seem to apply
   dashboard-added secrets to an already-running deployment — it needed a fresh deploy
   (see Gotcha #2 below) after the secrets existed. If you add/change a secret, always
   follow it with a real push to trigger a new deploy.
2. **Exact variable name** — re-open Settings → Variables and Secrets and check
   `HOLDINGS_PWD` character-by-character (capitalization, no trailing space in the *name*
   field). A typo'd name reads as completely unset, which fails the same way as a wrong
   password.
3. **Trailing whitespace in the *value*** — when copying the revealed value from Vercel,
   make sure the copy doesn't grab a trailing newline/space. If unsure, delete and re-add
   the secret, typing carefully rather than trusting a copy-paste.
4. If it's still stuck after that, compare against Vercel directly: does the *same*
   password work on the live Vercel site right now? If not, the password itself (as stored
   on Vercel) may not be what you think it is.

## 4. Gotchas discovered during this setup

1. **Root directory casing** — see step 1. `/lion` ≠ `Lion` to GitHub.
2. **The "New deployment" button in the dashboard doesn't use your configured branch** — it
   appeared to default to `main` regardless of what "Production branch" says in Settings,
   which caused several confusing failed builds (wrong `package.json`, wrong file layout,
   node_modules getting swept up as a 125MB "asset"). **Only trust a build if its tag in the
   Deployments list says `cloudflare-migration`** — those are the ones triggered by an
   actual `git push`, and they built correctly every time. If you need to force a rebuild
   (e.g. after changing a secret), push a trivial commit to `cloudflare-migration` rather
   than clicking "New deployment."
3. **Worker name mismatch warning** — Cloudflare named the Worker `littlelionfunddashboard`
   (whatever you typed when creating it) but `wrangler.toml` originally said
   `little-lion-fund`. This has been fixed in the repo (`wrangler.toml`'s `name` now matches
   `littlelionfunddashboard`) so the warning shouldn't reappear.
4. **Secrets don't apply retroactively** — adding/changing a secret in the dashboard didn't
   seem to affect an already-running deployment; it took a fresh deploy to pick it up.

## 5. Test on the workers.dev URL before touching any domain

- [ ] Dashboard loads with live prices and history
- [ ] Sectors / Performance / Unit Value tabs all render
- [ ] Holdings password unlocks correctly, via the real form (and a wrong password is rejected)
- [ ] Edit a holding, confirm it saves and persists after a refresh
- [ ] The "remove shares" flow works
- [ ] Weightings password/save works
- [ ] Unit Value entries save
- [ ] Sector detail view, drag-to-measure, mobile layout — spot check a few

Since this reads/writes the **same live Upstash database** the Vercel deployment uses,
anything you save here is real — treat it like production, because it is. This also means
there's no separate "import the holdings" step: once the database secrets are correct, the
real holdings/prices/history already show up automatically, same data as Vercel.

To test the daily NAV snapshot without waiting for the actual scheduled time, trigger it
manually from the Cloudflare dashboard (Worker → Triggers → Cron Triggers → "Trigger
event").

## 6. Buy the domain (optional — the app works fine on the free workers.dev URL)

1. Cloudflare dashboard → Domain Registration → Register a Domain
2. Search `littlelionfund.org`
3. **Confirm it's actually available before purchasing** — this couldn't be verified from
   outside Cloudflare's own search (see the cost analysis document); this is the moment to
   find out for certain.
4. Complete the purchase (~$9-10/year at Cloudflare's at-cost pricing, no markup, and no
   renewal price increase — this is the number in the cost analysis PDF)

## 7. Attach the domain to the Worker

1. Workers & Pages → your Worker → Settings → Domains & Routes → Add → Custom Domain
2. Enter `littlelionfund.org` (and `www.littlelionfund.org` if you want that to work too)
3. Because the domain is registered *through* Cloudflare, DNS is already on Cloudflare —
   this step is closer to instant than it would be moving an externally-registered domain
4. Cloudflare provisions the SSL certificate automatically; give it a few minutes

## 8. Cut over

Once the custom domain resolves and you've re-tested against it (same checklist as step 5,
now on the real domain), you're done. Leave the Vercel project in place, paused/idle, for a
rollback window — since both platforms would be reading the same Upstash database, "rolling
back" is just a DNS/domain change, not a data restore.

## Rollback

If anything looks wrong after cutover: repoint the domain back to Vercel (or just keep using
the `*.workers.dev` URL while you debug — it doesn't go away). No data is at risk either
direction since the database is shared and untouched by any of this.

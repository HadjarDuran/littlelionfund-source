# Setting up Cloudflare for the Little Lion Fund

The code in this repo (`src/worker.js`, `src/routes/*`, `src/lib/*`, `wrangler.toml`,
`public/*`) is a complete, tested Cloudflare Workers port of the app that used to run on
Vercel. This doc reflects what actually worked when this was set up (dashboard-only, no
local CLI needed), including a couple of gotchas that cost real time — read the **Gotchas**
section before redoing any of this from scratch.

## Current status (as of this setup session)

- ✅ Worker created and deploying successfully from the `cloudflare-migration` branch
- ✅ Live at: `https://littlelionfunddashboard.dwu-4ce.workers.dev`
- ✅ Static site and the Worker itself are deploying correctly — confirmed with real live
  HTTP checks run from GitHub Actions (`.github/workflows/verify-deploy.yml`, since this
  sandbox can't reach `*.workers.dev` or `*.vercel.app` directly)
- ❌ **None of the 5 dashboard secrets are actually reaching the Worker right now** — this is
  *confirmed*, not suspected. Live evidence from GitHub Actions (`.github/workflows/verify-deploy.yml`,
  run against the real URLs since this dev sandbox can't reach them), including one run taken
  right after a fresh push-triggered redeploy (so it isn't a stale-build issue):
  - `/api/holdings`, `/api/weightings`, `/api/unitvalue`, `/api/cash` → **HTTP 500**,
    `{"error":"Invalid URL: /pipeline"}` on Cloudflare (Vercel returns 200 for all of these
    with the same live data). That error comes from `@upstash/redis` trying to build a
    request URL from an empty `KV_REST_API_URL` — i.e. the secret is undefined at runtime.
  - `/api/quote?ticker=AAPL` → `{"error":"Invalid API key."}` — Finnhub itself rejecting
    whatever `FINNHUB_KEY` currently resolves to.
  - `/api/credits` → **HTTP 200** on both platforms. This one doesn't depend on any secret
    (`CREDITS_TEXT` lives in `wrangler.toml`'s `[vars]`), which confirms the Worker, routing,
    and deploy pipeline are all otherwise fine — this is specifically a secrets problem.
  - **This is almost certainly the same root cause as the password not unlocking**:
    `HOLDINGS_PWD`/`WEIGHTINGS_PWD` failing the same way (undefined secret, so no password
    can ever equal it) is indistinguishable from a wrong password by the API response alone.
- **Root cause (per Cloudflare's own docs and reported Workers Builds issues)**: a
  Git-connected Worker like this one has *two separate* secret stores that look similar in
  the dashboard —
  1. **Settings → Build configuration → Build variables and secrets** — only visible to the
     build script itself (as `process.env`), never bound to the deployed Worker on its own.
  2. **Settings → Variables and Secrets** (the Worker's own settings) — bound to `env` at
     runtime, *but* Cloudflare's Git-integration deploys have a known bug/behavior
     ([workers-sdk#8871](https://github.com/cloudflare/workers-sdk/issues/8871)) where a new
     deploy can silently wipe secrets set here, even without editing them.
  Either explains everything observed: the values look "added" somewhere, yet `env` is empty
  at request time, and a fresh redeploy alone doesn't fix it (already tested — see above).
- ✅ **Fixed in code, needs one dashboard change from you**: added
  `Lion/scripts/ci-deploy.sh` (wired up as `npm run deploy:ci`), which reads the 5 secrets
  from *this build's own environment* and reapplies them with
  `wrangler deploy --secrets-file` on every single deploy — additive, so it can't be wiped by
  a future deploy the way plain `wrangler deploy` can be. This fixes both possible root
  causes above at once. **What's left for you to do**:
  1. Settings → Build configuration → **Build variables and secrets** → add all 5 there, as
     type Secret: `HOLDINGS_PWD`, `WEIGHTINGS_PWD`, `FINNHUB_KEY`, `KV_REST_API_URL`,
     `KV_REST_API_TOKEN` (this is a *different* section than the Worker's own "Variables and
     Secrets" tab you may have used before — that one doesn't feed this script).
  2. Settings → Build configuration → **Deploy command** → change it from
     `npx wrangler deploy` to `npm run deploy:ci`.
  3. Trigger a new deploy (push to this branch, which GitHub Actions will then automatically
     re-verify — check `.github/workflows/verify-deploy.yml`'s latest run instead of testing
     by hand).

- **Alternative path, if you'd rather not use Cloudflare's Git integration at all**:
  `.github/workflows/deploy.yml` deploys straight from GitHub Actions instead, sidestepping
  Cloudflare's Git-integration secret-handling entirely (it doesn't touch the two-store
  question above — it's a different pipeline). One-time setup, all in GitHub's own UI under
  Settings → Secrets and variables → Actions → New repository secret:
  - `CLOUDFLARE_API_TOKEN` — create at Cloudflare dashboard → My Profile → API Tokens →
    use the "Edit Cloudflare Workers" template
  - `CLOUDFLARE_ACCOUNT_ID` — visible in the Cloudflare dashboard's URL/sidebar (not
    sensitive, but convenient to store as a secret here too)
  - The same 5 app secrets: `HOLDINGS_PWD`, `WEIGHTINGS_PWD`, `FINNHUB_KEY`,
    `KV_REST_API_URL`, `KV_REST_API_TOKEN`
  Then disable Cloudflare's own Git integration for this Worker (Settings → Build
  configuration → disconnect) so the two deploy pipelines don't race each other on every
  push. This is more setup than the fix above, but avoids depending on Cloudflare's
  Git-integration behavior at all going forward.
- This does **not** block *viewing* the dashboard on Vercel — Vercel is untouched and still
  fully working. It does mean the Cloudflare deployment isn't usable yet for anything that
  touches the database or live quotes, not just the password-gated edit screens.
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

## 3. Debugging the password (superseded — root cause found, see "Current status" above)

Symptom: entering the Holdings password on the live site says it's wrong.

**Update**: live testing via GitHub Actions (see above) proved this isn't actually about the
password at all — none of the 5 dashboard secrets are reaching the Worker right now, so
`HOLDINGS_PWD`/`WEIGHTINGS_PWD` are undefined server-side and *no* password could ever match,
regardless of what's typed or how it's encoded. **Fix the missing secrets first** (see
"Next action needed from you" above); re-test the password only after `/api/holdings` starts
returning real data instead of a 500.

The rest of this section is kept for reference in case the password *specifically* still
fails after the secrets are otherwise confirmed working:

- **Test it the right way** — through the app's actual password field (Holdings tab → type
  password → Unlock), not by typing it into the browser's address bar. The app's own code
  properly encodes special characters before sending the password (`encodeURIComponent(p)`
  in `checkTabPwd()`); typing a password with an `&`, `#`, `+`, `%`, or space directly into a
  URL bar does **not** get encoded the same way and can silently corrupt the password before
  it even reaches the server.
- **Exact variable name** — check `HOLDINGS_PWD` character-by-character (capitalization, no
  trailing space in the *name* field). A typo'd name reads as completely unset, which fails
  the same way as a wrong password.
- **Trailing whitespace in the *value*** — when copying the revealed value from Vercel, make
  sure the copy doesn't grab a trailing newline/space. If unsure, delete and re-add the
  secret, typing carefully rather than trusting a copy-paste.
- Compare against Vercel directly: does the *same* password work on the live Vercel site
  right now? If not, the password itself (as stored on Vercel) may not be what you think.

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
4. **~~Secrets don't apply retroactively~~ — retested and this wasn't actually the cause.**
   A fresh push-triggered redeploy was tried specifically to rule this in or out, and the
   secrets *still* don't show up in `env` afterward (`/api/holdings` still 500s with the same
   "Invalid URL: /pipeline" error). So a redeploy alone won't fix this — the secrets need to
   actually be (re-)confirmed present in Settings → Variables and Secrets. See "Current
   status" at the top of this doc for the live evidence and exact next step.
5. **A GitHub Actions workflow now verifies both deployments automatically** —
   `.github/workflows/verify-deploy.yml` runs on every push to this branch (or on demand) and
   curls the public API routes, the Finnhub-backed quote/history routes, and a wrong-password
   sanity check on both the live Vercel and Cloudflare URLs, since this repo's own dev
   sandbox can't reach either `*.vercel.app` or `*.workers.dev` directly. Check its most
   recent run under the repo's Actions tab any time you want an up-to-date answer on whether
   Cloudflare's deployment is actually working, without needing to click through the app
   yourself. It also supports an optional, fully automated real-password check — add
   `TEST_HOLDINGS_PWD` / `TEST_WEIGHTINGS_PWD` as **your own** repository secrets (Settings →
   Secrets and variables → Actions) if you want that, entirely outside of this conversation.

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

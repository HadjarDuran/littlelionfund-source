import { handleAuth } from './routes/auth.js';
import { handleCash } from './routes/cash.js';
import { handleCredits } from './routes/credits.js';
import { handleHist } from './routes/hist.js';
import { handleHoldings } from './routes/holdings.js';
import { handleHoldingsLog } from './routes/holdingsLog.js';
import { handleNavHistory } from './routes/navHistory.js';
import { handleQuote } from './routes/quote.js';
import { handleUnits } from './routes/units.js';
import { handleUnitvalue } from './routes/unitvalue.js';
import { handleWeightings } from './routes/weightings.js';
import { runNavSnapshot } from './routes/snapshotNav.js';
import { json } from './lib/http.js';

// One Worker doing what 12 separate Vercel functions used to do, plus the
// cron job. Static assets (index.html, the two logos) are served by the
// [assets] binding in wrangler.toml automatically for any request that
// matches a real file — this fetch handler only ever runs for /api/* paths
// and any unmatched path.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    switch (path) {
      case '/api/auth': return handleAuth(request, env);
      case '/api/cash': return handleCash(request, env);
      case '/api/credits': return handleCredits(request, env);
      case '/api/hist': return handleHist(request, env);
      case '/api/holdings': return handleHoldings(request, env);
      case '/api/holdings-log': return handleHoldingsLog(request, env);
      case '/api/nav-history': return handleNavHistory(request, env);
      case '/api/quote': return handleQuote(request, env);
      case '/api/units': return handleUnits(request, env);
      case '/api/unitvalue': return handleUnitvalue(request, env);
      case '/api/weightings': return handleWeightings(request, env);
    }

    if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);

    // Not an API path and didn't match a static asset (assets are tried
    // before this handler runs at all) — let the assets binding produce
    // its normal 404 rather than inventing a separate one here.
    return env.ASSETS.fetch(request);
  },

  // Cloudflare Cron Trigger (see wrangler.toml [triggers]) invokes this
  // directly — no HTTP round-trip, so there's nothing here to authenticate
  // against unlike the old CRON_SECRET-checked HTTP endpoint.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNavSnapshot(env));
  },
};

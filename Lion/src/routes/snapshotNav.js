import { kv } from '../lib/kv.js';

const DEFAULT_UNITS = 4111.03;

async function fetchQuote(ticker, finnhubKey) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}`);
    const d = await r.json();
    return (d && d.c > 0) ? d.c : null;
  } catch (e) {
    return null;
  }
}

// Runs once a day (see the [triggers] cron in wrangler.toml) after market
// close and appends today's real unit value to nav_daily — the automatic,
// going-forward counterpart to the hand-entered monthly "unitvalue" series.
// Idempotent: re-running it the same day overwrites that day's entry
// instead of duplicating it, so a retry is safe.
//
// Unlike the old Vercel version, this is invoked directly by Cloudflare's
// scheduler (see worker.js's `scheduled` export) rather than over HTTP, so
// there's no CRON_SECRET to check — nothing external can reach this at all,
// which is strictly safer than the header-check the HTTP version needed.
export async function runNavSnapshot(env) {
  const client = kv(env);
  try {
    const [holdings, cash, unitsRaw] = await Promise.all([
      client.get('holdings'),
      client.get('cash'),
      client.get('fund_units'),
    ]);
    const HOLD = holdings || [];
    const CASH = cash || { bank: 0, brokerage: 0 };
    const units = (typeof unitsRaw === 'number' && unitsRaw > 0) ? unitsRaw : DEFAULT_UNITS;
    const finnhubKey = env.FINNHUB_KEY;

    // Sequential, not parallel — keeps this well inside a free-tier
    // Finnhub key's rate limit even as the holdings list grows.
    let equity = 0;
    const missing = [];
    for (const h of HOLD) {
      const price = await fetchQuote(h.t, finnhubKey);
      if (price == null) { missing.push(h.t); continue; }
      equity += price * h.sh;
    }
    if (HOLD.length > 0 && missing.length === HOLD.length) {
      console.error('NAV snapshot: all quote lookups failed — skipped writing a snapshot rather than recording a wrong number', missing);
      return;
    }

    const totalEquity = equity + (CASH.bank || 0) + (CASH.brokerage || 0);
    const unitValue = +(totalEquity / units).toFixed(4);
    const spy = await fetchQuote('SPY', finnhubKey);

    const today = new Date().toISOString().split('T')[0];
    const nav = (await client.get('nav_daily')) || [];
    const entry = { date: today, unitValue, totalEquity: +totalEquity.toFixed(2), spy, missingQuotes: missing };
    const idx = nav.findIndex(r => r.date === today);
    if (idx >= 0) nav[idx] = entry; else nav.push(entry);
    await client.set('nav_daily', nav);
    console.log('NAV snapshot written:', JSON.stringify(entry));
  } catch (error) {
    console.error('NAV snapshot error:', error);
  }
}

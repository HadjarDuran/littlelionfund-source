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
// Also keeps the current calendar month's row in "unitvalue" itself (the
// series the Unit Value tab actually displays) up to date with this same
// number, dated at that month's last calendar day to match the existing
// hand-entered rows. It only ever touches the *current* month's row, so
// past months stay exactly as entered; the S&P field is left untouched
// since this doesn't track the index value, only the fund's own price.
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

    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const monthKey = `${monthEnd.getMonth() + 1}/${monthEnd.getDate()}/${monthEnd.getFullYear()}`;
    const unitvalue = (await client.get('unitvalue')) || [];
    const uvIdx = unitvalue.findIndex(r => r.d === monthKey);
    if (uvIdx >= 0) unitvalue[uvIdx] = { ...unitvalue[uvIdx], u: unitValue };
    else unitvalue.push({ d: monthKey, u: unitValue, sp: null });
    await client.set('unitvalue', unitvalue);
    console.log('Unit value month row updated:', monthKey, unitValue);
  } catch (error) {
    console.error('NAV snapshot error:', error);
  }
}

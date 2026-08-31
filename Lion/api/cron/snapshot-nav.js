const { createClient } = require('@vercel/kv');
const kv = createClient({
  url: process.env.LION_REST_API_URL || process.env.KV_REST_API_URL,
  token: process.env.LION_REST_API_TOKEN || process.env.KV_REST_API_TOKEN
});

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

// Runs once a day (see vercel.json crons) after market close and appends
// today's real unit value to nav_daily — the automatic, going-forward
// counterpart to the hand-entered monthly "unitvalue" series. Idempotent:
// re-running it the same day overwrites that day's entry instead of
// duplicating it, so a retry or a manual trigger is safe.
module.exports = async function handler(req, res) {
  // Vercel signs its own cron invocations with this header when CRON_SECRET
  // is set. Reject everything else so this can't be hit by anyone else to
  // spam/pollute nav_daily.
  const auth = req.headers['authorization'] || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [holdings, cash, unitsRaw] = await Promise.all([
      kv.get('holdings'),
      kv.get('cash'),
      kv.get('fund_units'),
    ]);
    const HOLD = holdings || [];
    const CASH = cash || { bank: 0, brokerage: 0 };
    const units = (typeof unitsRaw === 'number' && unitsRaw > 0) ? unitsRaw : DEFAULT_UNITS;
    const finnhubKey = process.env.FINNHUB_KEY;

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
      return res.status(502).json({ error: 'All quote lookups failed — skipped writing a snapshot rather than recording a wrong number', missing });
    }

    const totalEquity = equity + (CASH.bank || 0) + (CASH.brokerage || 0);
    const unitValue = +(totalEquity / units).toFixed(4);
    const spy = await fetchQuote('SPY', finnhubKey);

    const today = new Date().toISOString().split('T')[0];
    const nav = (await kv.get('nav_daily')) || [];
    const entry = { date: today, unitValue, totalEquity: +totalEquity.toFixed(2), spy, missingQuotes: missing };
    const idx = nav.findIndex(r => r.date === today);
    if (idx >= 0) nav[idx] = entry; else nav.push(entry);
    await kv.set('nav_daily', nav);

    res.status(200).json({ success: true, entry });
  } catch (error) {
    console.error('NAV snapshot error:', error);
    res.status(500).json({ error: error.message });
  }
};

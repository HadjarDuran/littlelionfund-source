const { createClient } = require('@vercel/kv');
const { verify, bearerFrom } = require('./_lib/authToken');
const kv = createClient({
  url: process.env.LION_REST_API_URL || process.env.KV_REST_API_URL,
  token: process.env.LION_REST_API_TOKEN || process.env.KV_REST_API_TOKEN
});

// Units outstanding used to be a hardcoded constant in the frontend. Moved
// here so it can change (new investor contributions/redemptions) without a
// code deploy, and so the NAV snapshot cron can read the same number the
// app displays.
const DEFAULT_UNITS = 4111.03;

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const units = await kv.get('fund_units');
      res.status(200).json({ units: typeof units === 'number' && units > 0 ? units : DEFAULT_UNITS });
    } else if (req.method === 'POST') {
      if (!verify(bearerFrom(req), 'holdings')) return res.status(401).json({ error: 'Unauthorized' });
      const units = Number(req.body && req.body.units);
      if (!(units > 0)) return res.status(400).json({ error: 'units must be a positive number' });
      await kv.set('fund_units', units);
      res.status(200).json({ success: true, units });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('KV Error:', error);
    res.status(500).json({ error: error.message });
  }
};

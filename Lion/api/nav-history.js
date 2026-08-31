const { createClient } = require('@vercel/kv');
const kv = createClient({
  url: process.env.LION_REST_API_URL || process.env.KV_REST_API_URL,
  token: process.env.LION_REST_API_TOKEN || process.env.KV_REST_API_TOKEN
});

// Read-only: entries are written once a day by api/cron/snapshot-nav.js,
// not by anyone posting here directly. Separate from the existing
// hand-entered monthly "unitvalue" series (api/unitvalue.js) — that one is
// the fund's real historical record going back to 2018 and isn't touched
// by this. This is the new, automatic, daily-going-forward series.
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const nav = await kv.get('nav_daily') || [];
    res.status(200).json(nav);
  } catch (error) {
    console.error('KV Error:', error);
    res.status(500).json({ error: error.message });
  }
};

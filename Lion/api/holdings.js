const { createClient } = require('@vercel/kv');
const { verify, bearerFrom } = require('./_lib/authToken');
const { diffHoldings } = require('./_lib/holdingsDiff');
const kv = createClient({
  url: process.env.LION_REST_API_URL || process.env.KV_REST_API_URL,
  token: process.env.LION_REST_API_TOKEN || process.env.KV_REST_API_TOKEN
});

const MAX_LOG_ENTRIES = 5000;

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const holdings = await kv.get('holdings') || [];
      res.status(200).json(holdings);
    } else if (req.method === 'POST') {
      if (!verify(bearerFrom(req), 'holdings')) return res.status(401).json({ error: 'Unauthorized' });
      const holdings = req.body;

      const prevHoldings = await kv.get('holdings') || [];
      const events = diffHoldings(prevHoldings, holdings);
      if (events.length) {
        const now = new Date().toISOString();
        const log = await kv.get('holdings_log') || [];
        const dated = events.map(e => ({ ...e, at: now }));
        const next = log.concat(dated).slice(-MAX_LOG_ENTRIES);
        await kv.set('holdings_log', next);
      }

      await kv.set('holdings', holdings);
      res.status(200).json({ success: true });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('KV Error:', error);
    res.status(500).json({ error: error.message });
  }
};
const { createClient } = require('@vercel/kv');
const { verify, bearerFrom } = require('./_lib/authToken');
const kv = createClient({
  url: process.env.LION_REST_API_URL || process.env.KV_REST_API_URL,
  token: process.env.LION_REST_API_TOKEN || process.env.KV_REST_API_TOKEN
});

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const cash = await kv.get('cash') || { bank: 0, brokerage: 0 };
      res.status(200).json(cash);
    } else if (req.method === 'POST') {
      if (!verify(bearerFrom(req), 'holdings')) return res.status(401).json({ error: 'Unauthorized' });
      const cash = req.body;
      await kv.set('cash', cash);
      res.status(200).json({ success: true });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('KV Error:', error);
    res.status(500).json({ error: error.message });
  }
};
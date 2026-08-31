const { createClient } = require('@vercel/kv');
const { verify, bearerFrom } = require('./_lib/authToken');
const kv = createClient({
  url: process.env.LION_REST_API_URL || process.env.KV_REST_API_URL,
  token: process.env.LION_REST_API_TOKEN || process.env.KV_REST_API_TOKEN
});

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const weightings = await kv.get('weightings');
      res.status(200).json(weightings || []);
    } else if (req.method === 'POST') {
      if (!verify(bearerFrom(req), 'weightings')) return res.status(401).json({ error: 'Unauthorized' });
      const weightings = req.body;
      await kv.set('weightings', weightings);
      res.status(200).json({ success: true });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('KV Error:', error);
    res.status(500).json({ error: error.message });
  }
};

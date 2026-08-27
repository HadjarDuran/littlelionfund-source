const { createClient } = require('@vercel/kv');
const kv = createClient({
  url: process.env.LION_REST_API_URL || process.env.KV_REST_API_URL,
  token: process.env.LION_REST_API_TOKEN || process.env.KV_REST_API_TOKEN
});

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const unitvalue = await kv.get('unitvalue');
      res.status(200).json(unitvalue || []);
    } else if (req.method === 'POST') {
      const unitvalue = req.body;
      await kv.set('unitvalue', unitvalue);
      res.status(200).json({ success: true });
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('KV Error:', error);
    res.status(500).json({ error: error.message });
  }
};
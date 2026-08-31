const { createClient } = require('@vercel/kv');
const kv = createClient({
  url: process.env.LION_REST_API_URL || process.env.KV_REST_API_URL,
  token: process.env.LION_REST_API_TOKEN || process.env.KV_REST_API_TOKEN
});

// Read-only: entries are written by api/holdings.js whenever a save changes
// the holdings array, not by anyone posting here directly.
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const log = await kv.get('holdings_log') || [];
    res.status(200).json(log);
  } catch (error) {
    console.error('KV Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const pwd = searchParams.get('pwd') || '';
  const type = searchParams.get('type') || 'holdings';
  
  // Separate env vars for separate locks
  const serverPwd = type === 'weightings' 
    ? (process.env.WEIGHTINGS_PWD || 'lion123')
    : (process.env.HOLDINGS_PWD || 'lion123');
  
  if (pwd === serverPwd) {
    return new Response(JSON.stringify({ ok: true }));
  } else {
    return new Response(JSON.stringify({ ok: false }), { status: 401 });
  }
}

// Validation for trades recorded in the app (Holdings → "Add transaction").
// Kept separate from the route so it can be unit-tested without a database.
// Returns a cleaned record, or null if the input isn't a usable trade.
export function cleanTxn(t) {
  if (!t || typeof t !== 'object') return null;
  const type = t.type === 'sell' ? 'sell' : t.type === 'buy' ? 'buy' : null;
  const sh = Number(t.sh), px = Number(t.px), fee = Number(t.fee) || 0;
  const ticker = String(t.t || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10);
  const d = String(t.d || '');
  if (!type || !ticker || !(sh > 0) || !(px > 0) || fee < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const out = { d, t: ticker, type, sh: +sh.toFixed(6), px: +px.toFixed(4), fee: +fee.toFixed(2) };
  out.amt = type === 'buy' ? +(sh * px + fee).toFixed(2) : +(sh * px - fee).toFixed(2);
  if (type === 'sell' && t.basis != null && Number.isFinite(Number(t.basis))) {
    out.basis = +Number(t.basis).toFixed(2);
    out.gain = +(out.amt - out.basis).toFixed(2);
  }
  if (t.memo) out.memo = String(t.memo).slice(0, 200);
  return out;
}

// Ticker clean-up shared by /api/quote and /api/hist: letters plus "." and
// "-" so class shares (BRK.B / BRK-B) work.
export function cleanTicker(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z.\-]/g, '').slice(0, 10);
}

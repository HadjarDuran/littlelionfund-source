// ---------------------------------------------------------------------------
// util.js — small helpers every other file uses: formatting, dates, safe
// HTML, local storage, and motion (count-up numbers, reduced-motion check).
// No app state lives here.
// ---------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Escape anything that came from data (tickers, names, memos) before it goes
// into an innerHTML template. Cheap insurance: holdings are typed in by hand.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- numbers ----
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MINUS = '−';
const fmt = {
  usd: (n, d = 2) => (n < 0 ? MINUS : '') + '$' + (d === 0 ? nf0 : nf2).format(Math.abs(n || 0)),
  usdSigned: n => (n >= 0 ? '+' : MINUS) + '$' + nf2.format(Math.abs(n || 0)),
  usdCompact: n => {
    const a = Math.abs(n), s = n < 0 ? MINUS : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return s + '$' + (a / 1e3).toFixed(1) + 'k';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(2) + 'k';
    return s + '$' + a.toFixed(a < 10 ? 2 : 0);
  },
  pct: (n, d = 2) => (n == null || !isFinite(n)) ? '—' : (n >= 0 ? '+' : MINUS) + Math.abs(n).toFixed(d) + '%',
  pctPlain: (n, d = 1) => (n == null || !isFinite(n)) ? '—' : Math.abs(n) < 0.05 && d <= 1 ? '0%' : n.toFixed(d) + '%',
  shares: n => {
    if (n == null) return '—';
    const a = Math.abs(n);
    return a >= 100 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  },
  int: n => nf0.format(n || 0),
};
const signCls = n => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const arrowIcon = n => icon(n >= 0 ? 'arrow-up-right' : 'arrow-down-right', 'sm');
// A colour-independent gain/loss chip: sign + arrow + colour (never colour alone).
const chgPill = (n, txt) => `<span class="pill ${n >= 0 ? 'pos' : 'neg'}">${arrowIcon(n)}${txt}</span>`;

// ---- dates (all app dates are 'YYYY-MM-DD' strings in UTC) ----
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dt = {
  today: () => new Date().toISOString().slice(0, 10),
  parse: s => new Date(s + 'T00:00:00Z'),
  iso: d => d.toISOString().slice(0, 10),
  addMonths(s, m) { const d = dt.parse(s); d.setUTCMonth(d.getUTCMonth() + m); return dt.iso(d); },
  addDays(s, n) { const d = dt.parse(s); d.setUTCDate(d.getUTCDate() + n); return dt.iso(d); },
  days: (a, b) => Math.round((dt.parse(b) - dt.parse(a)) / 86400000),
  long(s) { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; },
  short(s) { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; },
  monYr(s) { if (!s) return ''; const [y, m] = s.split('-').map(Number); return `${MONTHS[m - 1]} '${String(y).slice(2)}`; },
  // Unit value history stores dates as "M/D/YYYY" (how they were typed in).
  fromMDY(s) { const [m, d, y] = String(s).split('/').map(Number); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; },
  toMDY(s) { const [y, m, d] = s.split('-').map(Number); return `${m}/${d}/${y}`; },
  span(a, b) {
    const days = dt.days(a, b);
    if (days < 60) return days + ' days';
    const mo = Math.round(days / 30.44);
    if (mo < 24) return mo + ' mo';
    return (days / 365.25).toFixed(1) + ' yrs';
  },
  ago(date) {
    if (!date) return '—';
    const s = Math.round((Date.now() - date.getTime()) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (new Date().toDateString() === date.toDateString()) return 'today ' + time;
    return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${time}`;
  },
};

// Binary search: index of the last point with date <= d (or -1).
function bisectDate(points, d, key = 'd') {
  let lo = 0, hi = points.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][key] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// ---- storage (never throws: private browsing / full quota just no-ops) ----
const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
};

// ---- motion ----
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Animate a number from its last shown value to `to`. The element remembers
// what it showed, so live refreshes tick from old → new instead of from 0.
function countUp(el, to, format, ms = 900) {
  if (!el) return;
  const from = el._v == null ? to * 0.94 : el._v;
  el._v = to;
  if (reducedMotion() || from === to || !isFinite(from)) { el.textContent = format(to); return; }
  const t0 = performance.now();
  cancelAnimationFrame(el._raf);
  const step = now => {
    const p = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - p, 4); // ease-out quart
    el.textContent = format(from + (to - from) * e);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

// Brief green/red wash on an element whose value just changed.
function flash(el, up) {
  if (!el || reducedMotion()) return;
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(up ? 'flash-up' : 'flash-down');
}

// Deterministic colour per ticker for the little logo squares.
const LOGO_COLORS = ['#2a78d6', '#6250d6', '#0e8f6a', '#c2410c', '#be185d', '#0369a1', '#7c3aed', '#b45309', '#0f766e', '#4338ca', '#9d174d', '#15803d'];
function tickerColor(t) {
  let h = 0; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return LOGO_COLORS[h % LOGO_COLORS.length];
}
const tkLogo = (t, size) => `<span class="tk-logo" style="background:${tickerColor(t)}${size ? `;width:${size}px;height:${size}px;border-radius:${Math.round(size * .28)}px;font-size:${Math.max(9, Math.round(size * .27))}px` : ''}">${esc(String(t).slice(0, 4))}</span>`;

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

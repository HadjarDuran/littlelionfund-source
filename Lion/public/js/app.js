// ---------------------------------------------------------------------------
// app.js — the shell: routing (#/performance, #/stock/AAPL …), the left-
// hand navigation rail, mobile tab bar, theme, search palette, keyboard
// shortcuts, boot sequence and the quiet background refresh.
// Each view file registers itself in VIEWS; this file decides which one runs.
// ---------------------------------------------------------------------------


const NAV = [
  { id: 'dashboard', label: 'Overview', icon: 'layout-dashboard', key: '1' },
  { id: 'performance', label: 'Performance', icon: 'chart-line', key: '2' },
  { id: 'sectors', label: 'Sectors', icon: 'layers', key: '3' },
  { id: 'activity', label: 'Activity', icon: 'history', key: '4' },
  { id: 'holdings', label: 'Holdings', icon: 'briefcase', key: '5', manage: 'holdings' },
  { id: 'weightings', label: 'Weightings', icon: 'scale', key: '6', manage: 'weightings' },
  { id: 'unitvalue', label: 'Unit Value', icon: 'coins', key: '7', manage: 'holdings' },
];
const REFRESH_SECONDS = 120;
let route = { view: 'dashboard', params: [] };
let currentCleanup = null;

// ------------------------------------------------------------------ routing
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const view = VIEWS[parts[0]] ? parts[0] : parts[0] === 'stock' ? 'stock' : 'dashboard';
  return { view, params: parts.slice(1) };
}
function go(path) {
  const h = '#/' + path;
  // Slide the sidebar highlight right away, before the page itself changes.
  setActiveNav(true, navId(path.split('/')[0] || 'dashboard'));
  if (location.hash === h) render(); else location.hash = h;
}
function navId(v) { return v === 'stock' ? 'performance' : v; }

function render({ quiet = false } = {}) {
  const el = $('#content');
  const v = VIEWS[route.view];
  if (!v) return;
  window.__quiet = quiet;
  const run = () => {
    if (currentCleanup) { try { currentCleanup(); } catch (e) { } currentCleanup = null; }
    closePop();
    el.classList.toggle('quiet', quiet);
    const scrollY = window.scrollY;
    const head = v.head ? v.head(route.params) : { title: v.title };
    renderCrumbs(head);
    currentCleanup = v.render(el, route.params) || null;
    if (quiet) window.scrollTo(0, scrollY);
    window.__quiet = false;
  };
  run();
  setActiveNav();
  if (!quiet) afterRenderMotion(el);
}
function navigate() {
  const next = parseHash();
  const changed = next.view !== route.view || next.params.join('/') !== route.params.join('/');
  const prev = route;
  route = next;
  closeSheet();
  if (!changed && $('#content').childElementCount) return render();
  // Only the content area animates: it fades out briefly, then the new page
  // rises in from the direction of travel (down the menu → from below). The
  // sidebar is never snapshotted, so its highlight slides live the whole time.
  setActiveNav(true);
  const el = $('#content');
  const order = v => NAV.findIndex(n => n.id === navId(v));
  const dir = next.view === 'stock' || (next.view === 'sectors' && next.params.length) ? 'in'
    : prev.view === 'stock' || (prev.view === 'sectors' && prev.params.length) ? 'out'
    : order(next.view) >= order(prev.view) ? 'down' : 'up';
  const token = (navigate._t = (navigate._t || 0) + 1);
  const swap = () => {
    if (token !== navigate._t) return; // a newer click already won
    el.classList.remove('leaving');
    el.dataset.dir = dir;
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  if (reducedMotion() || !el.childElementCount) return swap();
  el.classList.add('leaving');
  setTimeout(swap, 120);
}

function renderCrumbs({ title, sub, back }) {
  // Only animate the title when it actually changes (not on background refreshes).
  $('#crumbs').classList.toggle('still', renderCrumbs._last === title);
  renderCrumbs._last = title;
  $('#crumbs').innerHTML = `${back ? `<button class="back" aria-label="Back">${icon('arrow-left')}</button>` : ''}
    <h1></h1>${sub ? '<span class="crumb-sub"></span>' : ''}`;
  $('#crumbs h1').textContent = title;
  if (sub) $('#crumbs .crumb-sub').textContent = sub;
  if (back) $('#crumbs .back').onclick = () => (history.length > 1 ? history.back() : go(back));
  document.title = title === 'Overview' ? 'Little Lion Fund' : `${title} · Little Lion Fund`;
}

// ---------------------------------------------------------------- the rail
function renderRail() {
  const t = totals();
  const theme = store.get('llf_theme_choice', 'light');
  const anyUnlocked = S.auth.holdings || S.auth.weightings;
  const item = n => `<button class="nav-item" data-nav="${n.id}" title="${esc(n.label)} (${n.key})">${icon(n.icon)}<span>${esc(n.label)}</span>
      ${n.manage ? `<span class="lock">${icon(isUnlocked(n.manage) ? 'lock-open' : 'lock')}</span>` : ''}</button>`;
  $('#rail').innerHTML = `
    <div class="rail-head">
      <a class="rail-logo" href="#/" aria-label="Little Lion Fund home"><img src="/sq-logo.png" alt=""/><span>Little Lion Fund<small>State College Area HS</small></span></a>
      <button class="icon-btn rail-collapse" id="rail-collapse" aria-label="Collapse navigation" title="Collapse  ([)">${icon($('#shell').classList.contains('collapsed') ? 'panel-left-open' : 'panel-left-close')}</button>
    </div>
    <div class="nav" id="nav-main"><div class="nav-indicator" id="nav-ind"></div>
      <div class="nav-label">Fund</div>${NAV.filter(n => !n.manage).map(item).join('')}
      <div class="nav-label">Manage</div>${NAV.filter(n => n.manage).map(item).join('')}
    </div>
    <div class="rail-foot">
      <a class="snap" href="#/performance" style="color:inherit">
        <div class="snap-label"><span>Fund value</span><span class="${signCls(t.day)}">${t.count ? fmt.pct(t.dayPct) : ''}</span></div>
        <div class="snap-value tabular" id="snap-v">${fmt.usd(t.total)}</div>
        <div class="snap-spark" id="snap-spark"></div>
      </a>
      ${seg('theme', [['light', icon('sun', 'sm'), 'Light'], ['system', icon('monitor', 'sm'), 'Match device'], ['dark', icon('moon', 'sm'), 'Dark']], theme, 'theme-seg')}
      <button class="icon-btn theme-mini" id="theme-mini" aria-label="Toggle theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</button>
      <div class="rail-meta">${anyUnlocked ? `<button class="chip" id="lock-all" style="height:26px;margin-bottom:8px">${icon('log-out', 'xs')}Lock manager tools</button><br>` : ''}
        </div>
    </div>`;
  $$('#rail [data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));
  $('#rail-collapse').onclick = toggleCollapse;
  onSeg($('#rail'), 'theme', v => setTheme(v, true));
  $('#theme-mini').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  const la = $('#lock-all'); if (la) la.onclick = () => { lockAll(); toast('Manager tools locked', 'info'); renderRail(); render(); };
  const fs = fundSeries();
  sparkline($('#snap-spark'), fs.slice(-13), 'var(--s1)', { height: 34 });
  renderTabbar();
  setActiveNav(false);
}
function setActiveNav(animate = true, id = navId(route.view)) {
  $$('[data-nav]').forEach(b => { b.classList.toggle('active', b.dataset.nav === id); b.setAttribute('aria-current', b.dataset.nav === id ? 'page' : 'false'); });
  const ind = $('#nav-ind'), act = $(`#nav-main [data-nav="${id}"]`);
  if (ind && act) {
    if (!animate) ind.style.transition = 'none';
    ind.style.transform = `translateY(${act.offsetTop}px)`;
    ind.style.opacity = 1;
    if (!animate) requestAnimationFrame(() => (ind.style.transition = ''));
  }
  // mobile tab bar pill
  const pill = $('#tab-pill'), tab = $(`#tabbar [data-nav="${id}"]`);
  if (pill) {
    if (!tab) { pill.style.opacity = 0; return; }
    if (!animate) pill.style.transition = 'none';
    pill.style.opacity = 1;
    pill.style.width = tab.offsetWidth + 'px';
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    if (!animate) requestAnimationFrame(() => (pill.style.transition = ''));
  }
}
function toggleCollapse() {
  const sh = $('#shell');
  const collapsing = !sh.classList.contains('collapsed');
  const apply = () => {
    sh.classList.toggle('collapsed', collapsing);
    sh.classList.remove('rail-fading');
    store.set('llf_rail_collapsed', collapsing);
    renderRail();
    if (!collapsing && !reducedMotion()) { sh.classList.add('rail-appearing'); setTimeout(() => sh.classList.remove('rail-appearing'), 700); }
    setTimeout(() => setActiveNav(false), 450); // re-measure once the width transition settles
  };
  if (collapsing && !reducedMotion()) { sh.classList.add('rail-fading'); setTimeout(apply, 140); } else apply();
}

// Mobile: bottom bar for the four investor views + "More" opens the rail as a sheet.
function renderTabbar() {
  const items = NAV.filter(n => !n.manage).slice(0, 4);
  $('#tabbar').innerHTML = '<span class="tab-pill" id="tab-pill" aria-hidden="true"></span>' + items.map(n => `<button data-nav="${n.id}">${icon(n.icon)}<span>${esc(n.label)}</span></button>`).join('')
    + `<button id="tab-more">${icon('menu')}<span>More</span></button>`;
  $$('#tabbar [data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));
  $('#tab-more').onclick = openSheet;
}
function openSheet() { $('#rail').classList.add('open'); $('#scrim').classList.add('on'); setTimeout(() => setActiveNav(false), 10); }
function closeSheet() { $('#rail').classList.remove('open'); $('#scrim').classList.remove('on'); }

// ------------------------------------------------------------------- theme
// Light is the default. Dark (or "match device") only applies once someone
// picks it, and that choice is remembered on this device.
function setTheme(pref, chosen = false) {
  if (chosen) store.set('llf_theme_choice', pref);
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const eff = pref === 'system' ? (sysDark ? 'dark' : 'light') : pref === 'dark' ? 'dark' : 'light';
  const apply = () => {
    document.documentElement.dataset.theme = eff;
    document.documentElement.dataset.eff = eff;
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = eff === 'dark' ? '#0a0e16' : '#f3f5f9';
  };
  if (document.startViewTransition && !reducedMotion()) document.startViewTransition(apply); else apply();
  const mini = $('#theme-mini'); if (mini) mini.innerHTML = icon(eff === 'dark' ? 'sun' : 'moon');
}

// ------------------------------------------------------- top bar & status
function renderTop() {
  $('#search-btn').innerHTML = `${icon('search', 'sm')}<span>Search holdings, pages…</span><kbd>⌘K</kbd>`;
  $('#refresh-btn').innerHTML = icon('refresh-cw');
  $('#menu-btn').innerHTML = icon('menu');
  $('#search-btn').onclick = openPalette;
  $('#refresh-btn').onclick = () => refresh(true);
  $('#menu-btn').onclick = openSheet;
  $('#scrim').onclick = closeSheet;
  renderAsOf();
}
function renderAsOf() {
  const el = $('#asof'); if (!el) return;
  const off = S.offline || !navigator.onLine;
  el.classList.toggle('offline', off);
  el.innerHTML = `<span class="dot"></span><span class="asof-text">${off ? 'Offline · showing ' : 'Prices '}${S.lastUpdate ? dt.ago(S.lastUpdate) : 'loading…'}</span>`;
  el.title = S.lastUpdate ? `Prices last refreshed ${S.lastUpdate.toLocaleString()}` : '';
}

// --------------------------------------------------------- search palette
function openPalette() {
  if ($('.palette')) return;
  const root = document.createElement('div');
  root.className = 'palette';
  root.innerHTML = `<div class="modal-scrim"></div><div class="palette-box" role="dialog" aria-label="Search">
    <div class="palette-in">${icon('search')}<input placeholder="Search holdings, past trades, pages, actions…" aria-label="Search"/><span class="kbd">esc</span></div>
    <div class="palette-list"></div></div>`;
  document.body.appendChild(root);
  const inp = root.querySelector('input'), list = root.querySelector('.palette-list');
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey, true); };
  const past = pastHoldings();
  const all = [
    ...NAV.map(n => ({ sec: 'Pages', label: n.label, sub: n.manage ? 'Manager' : '', ic: n.icon, run: () => go(n.id), q: n.label })),
    ...S.hold.map(h => ({ sec: 'Holdings', label: h.t, sub: h.n || '', logo: h.t, run: () => go('stock/' + h.t), q: h.t + ' ' + (h.n || '') })),
    ...past.map(p => ({ sec: 'Past holdings', label: p.t, sub: `Sold ${dt.monYr(p.last)} · ${fmt.usdSigned(p.gain)}`, logo: p.t, run: () => go('stock/' + p.t), q: p.t })),
    { sec: 'Actions', label: 'Add a transaction', ic: 'plus', run: () => { go('holdings'); setTimeout(() => window.openAddTxn && openAddTxn(), 200); }, q: 'add buy sell transaction trade' },
    { sec: 'Actions', label: 'Toggle dark mode', ic: 'moon', run: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true), q: 'theme dark light mode' },
    { sec: 'Actions', label: 'Refresh prices', ic: 'refresh-cw', run: () => refresh(true), q: 'refresh reload prices' },
  ];
  let sel = 0, shown = [];
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    shown = (q ? all.filter(x => x.q.toLowerCase().includes(q)).sort((a, b) => (b.label.toLowerCase().startsWith(q) ? 1 : 0) - (a.label.toLowerCase().startsWith(q) ? 1 : 0)) : all.filter(x => x.sec !== 'Past holdings')).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    let lastSec = '', html = '';
    shown.forEach((x, i) => {
      if (x.sec !== lastSec) { html += `<div class="palette-sec">${esc(x.sec)}</div>`; lastSec = x.sec; }
      html += `<button class="pop-item ${i === sel ? 'kb' : ''}" data-i="${i}">${x.logo ? tkLogo(x.logo, 28) : `<span class="ic-circle ev" style="width:28px;height:28px">${icon(x.ic, 'sm')}</span>`}
        <span><span class="pl"></span> <small class="ps"></small></span><span class="chk" style="opacity:${i === sel ? .6 : 0}">${icon('arrow-right', 'sm')}</span></button>`;
    });
    list.innerHTML = html || `<div class="palette-empty">No matches</div>`;
    $$('.pop-item', list).forEach(b => {
      const x = shown[+b.dataset.i];
      b.querySelector('.pl').textContent = x.label; b.querySelector('.ps').textContent = x.sub || '';
      b.onclick = () => { close(); x.run(); };
      b.onmousemove = () => { if (sel !== +b.dataset.i) { sel = +b.dataset.i; draw(); } };
    });
    const k = list.querySelector('.kb'); if (k) k.scrollIntoView({ block: 'nearest' });
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); const x = shown[sel]; close(); x.run(); }
  };
  document.addEventListener('keydown', onKey, true);
  root.querySelector('.modal-scrim').onclick = close;
  inp.oninput = () => { sel = 0; draw(); };
  draw();
  inp.focus();
}

// --------------------------------------------------------------- keyboard
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || $('.modal-root') || $('.palette')) return;
  if (e.key === '/') { e.preventDefault(); openPalette(); }
  else if (e.key === '[') toggleCollapse();
  else { const n = NAV.find(n => n.key === e.key); if (n) go(n.id); }
});

// ------------------------------------------------------- refresh & boot
let refreshing = false;
async function refresh(manual = false) {
  if (refreshing) return;
  refreshing = true;
  const btn = $('#refresh-btn'); btn && btn.classList.add('spinning');
  const before = totals().total;
  try {
    S.offline = false;
    await loadCore();
    await loadQuotes();
    if (!S.offline) { S.lastUpdate = new Date(); saveSnapshot(); }
    if (manual) toast(S.offline ? 'Could not reach the server' : 'Prices refreshed', S.offline ? 'err' : 'ok');
  } catch (e) { S.offline = true; }
  refreshing = false;
  btn && btn.classList.remove('spinning');
  renderAsOf();
  const after = totals().total;
  const v = $('#snap-v'); if (v) { countUp(v, after, fmt.usd); if (Math.abs(after - before) > 0.005) flash(v, after > before); }
  // Never re-render a manager's half-filled form out from under them.
  if (!$('.modal-root') && !document.activeElement?.matches('input,select,textarea')) render({ quiet: true });
  renderRail();
}

function bootProgress(pct, msg, detail = '') {
  $('#boot-fill').style.width = pct + '%';
  if (msg) $('#boot-msg').textContent = msg;
  $('#boot-detail').textContent = detail;
}
function showApp() {
  $('#shell').hidden = false; $('#tabbar').hidden = false;
  renderTop(); renderRail();
  route = parseHash(); render();
  requestAnimationFrame(() => $('#boot').classList.add('gone'));
  setTimeout(() => $('#boot').remove(), 700);
}

(async function boot() {
  if (store.get('llf_rail_collapsed')) $('#shell').classList.add('collapsed');
  setTheme(store.get('llf_theme_choice', 'light'));

  const hadSnapshot = loadSnapshot();
  if (hadSnapshot) {
    // Paint instantly from the last visit, then refresh for real underneath.
    showApp();
    refresh().then(afterLoad);
  } else {
    try {
      bootProgress(8, 'Loading fund data…');
      await loadCore();
      bootProgress(35, 'Fetching live prices…');
      await loadQuotes((d, n) => bootProgress(35 + d / n * 60, 'Fetching live prices…', `${d} of ${n} holdings`));
      if (!S.offline) { S.lastUpdate = new Date(); saveSnapshot(); }
      bootProgress(100, 'Ready');
      await sleep(180);
      showApp();
      afterLoad();
    } catch (e) {
      const err = $('#boot-err'); err.style.display = 'block'; err.textContent = 'Could not load the fund data. ' + e.message;
      bootProgress(100, 'Something went wrong');
    }
  }
  setInterval(() => { renderAsOf(); }, 30000);
  setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) refresh(); }, REFRESH_SECONDS * 1000);
})();

// Price histories stream in after first paint; charts redraw as each arrives.
async function afterLoad() {
  await loadAllHist();
  invalidate();
  if (!$('.modal-root') && !document.activeElement?.matches('input,select,textarea')) render({ quiet: true });
}

window.addEventListener('hashchange', navigate);
window.addEventListener('online', () => { S.offline = false; renderAsOf(); refresh(); });
window.addEventListener('offline', () => { S.offline = true; renderAsOf(); });
window.addEventListener('scroll', () => $('#topbar')?.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (store.get('llf_theme_choice', 'light') === 'system') setTheme('system'); });
window.addEventListener('resize', debounce(() => setActiveNav(false), 100));

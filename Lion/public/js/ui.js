// ---------------------------------------------------------------------------
// ui.js — shared UI pieces: toast, modal, popover, command palette, lock
// screen, sortable-table helper, and chartCard() — the full-featured chart
// panel (range presets, $/% mode, axis settings, compare, table view) used
// by Dashboard, Performance, stock detail and sector detail.
// ---------------------------------------------------------------------------

// View registry: each views/*.js file adds itself here; app.js routes to them.
const VIEWS = {};

// ---- toast ----
function toast(msg, kind = 'ok', ms = 2600) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = icon(kind === 'err' ? 'triangle-alert' : kind === 'info' ? 'info' : 'circle-check') + '<span></span>';
  el.querySelector('span').textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}

// ---- modal ----
// openModal({ title, icon, iconCls, body, actions:[{label, cls, onClick(close)}], wide, onOpen(el) })
function openModal({ title, icon: ic, iconCls = '', body = '', actions = [], wide = false, onOpen } = {}) {
  const root = document.createElement('div');
  root.className = 'modal-root';
  root.innerHTML = `<div class="modal-scrim"></div>
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-h">${ic ? `<div class="modal-icon ${iconCls}">${icon(ic)}</div>` : ''}<h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-b">${body}</div>
      ${actions.length ? `<div class="modal-f">${actions.map((a, i) => `<button class="btn ${a.cls || 'ghost'}" data-a="${i}">${a.icon ? icon(a.icon, 'sm') : ''}${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>`;
  const prevFocus = document.activeElement;
  const close = () => {
    if (root.classList.contains('closing')) return;
    root.classList.add('closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { root.remove(); prevFocus && prevFocus.focus && prevFocus.focus(); }, reducedMotion() ? 0 : 200);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelector('.modal-scrim').onclick = close;
  root.querySelector('[data-close]').onclick = close;
  $$('[data-a]', root).forEach(b => b.onclick = () => actions[+b.dataset.a].onClick?.(close, b, root));
  document.body.appendChild(root);
  onOpen && onOpen(root, close);
  setTimeout(() => { const f = root.querySelector('input:not([type=hidden]),select,textarea') || root.querySelector('.modal-f .btn:last-child'); f && f.focus(); }, 30);
  return { root, close };
}
function confirmModal({ title, text, confirm = 'Confirm', danger = false, icon: ic = danger ? 'trash-2' : 'info' }) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title, icon: ic, iconCls: danger ? 'danger' : '',
      body: `<p class="text-2" style="font-size:14px;line-height:1.55"></p>`,
      actions: [
        { label: 'Cancel', onClick: c => { done = true; resolve(false); c(); } },
        { label: confirm, cls: danger ? 'danger' : 'primary', onClick: c => { done = true; resolve(true); c(); } },
      ],
      onOpen: r => { r.querySelector('.modal-b p').textContent = text; },
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.root)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}
// Button feedback: spinner → ✓ / ✕, then restore.
async function withBusy(btn, fn, { ok = 'Saved', fail = 'Failed' } = {}) {
  if (!btn) return fn();
  const html = btn.innerHTML; btn.disabled = true;
  btn.innerHTML = icon('refresh-cw', 'sm spin') + 'Saving…';
  btn.querySelector('.i').style.animation = 'spin .8s linear infinite';
  let res;
  try { res = await fn(); } catch (e) { res = false; }
  btn.classList.add(res ? 'ok' : 'fail');
  btn.innerHTML = icon(res ? 'check' : 'x', 'sm') + (res ? ok : fail);
  setTimeout(() => { btn.classList.remove('ok', 'fail'); btn.innerHTML = html; btn.disabled = false; }, 1600);
  return res;
}

// ---- popover anchored to a button ----
let _pop = null;
function closePop() { if (_pop) { _pop.el.remove(); document.removeEventListener('pointerdown', _pop.out, true); document.removeEventListener('keydown', _pop.key); _pop = null; } }
function openPop(anchor, html, onOpen, { align = 'end' } = {}) {
  if (_pop && _pop.anchor === anchor) { closePop(); return null; }
  closePop();
  const el = document.createElement('div');
  el.className = 'pop';
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = align === 'end' ? r.right - w : r.left;
  left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  el.style.left = left + 'px'; el.style.top = top + 'px';
  const out = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePop(); };
  const key = e => { if (e.key === 'Escape') closePop(); };
  setTimeout(() => document.addEventListener('pointerdown', out, true), 0);
  document.addEventListener('keydown', key);
  _pop = { el, anchor, out, key };
  onOpen && onOpen(el);
  return el;
}

// ---- lock screen (manager-only tabs) ----
function lockGate(el, type, label, onUnlocked) {
  el.innerHTML = `<div class="card lock-card view">
    <div class="modal-icon">${icon('lock')}</div>
    <h2>${esc(label)} is for fund managers</h2>
    <p>Enter the manager password to make changes. Investors can see everything on the other pages.</p>
    <form class="stack" style="gap:10px" autocomplete="off">
      <input class="input" type="password" placeholder="Password" autocomplete="current-password" aria-label="Password" style="text-align:center"/>
      <button class="btn primary block" type="submit">${icon('lock-open', 'sm')}Unlock</button>
      <div class="hint err-msg" style="color:var(--neg);min-height:18px"></div>
    </form></div>`;
  const form = el.querySelector('form'), inp = form.querySelector('input'), btn = form.querySelector('button'), msg = form.querySelector('.err-msg');
  setTimeout(() => inp.focus(), 50);
  form.onsubmit = async e => {
    e.preventDefault();
    btn.disabled = true; msg.textContent = '';
    const ok = await unlock(type, inp.value);
    btn.disabled = false;
    if (ok) { toast(`${label} unlocked`); onUnlocked(); renderRail(); }
    else { msg.textContent = 'Incorrect password'; inp.classList.add('err'); form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); inp.select(); }
  };
}

// ---- sortable tables ----
function sortBy(rows, key, dir) {
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = typeof key === 'function' ? key(a) : a[key], y = typeof key === 'function' ? key(b) : b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1; if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * m;
  });
}
const thSort = (label, key, sort, cls = '') =>
  `<th class="sortable ${cls} ${sort.key === key ? 'sorted ' + sort.dir : ''}" data-sort="${key}" aria-sort="${sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${label}<span class="sort-ic">${icon('chevron-down', 'xs')}</span></th>`;
function wireSort(root, sort, rerender) {
  $$('th[data-sort]', root).forEach(th => th.onclick = () => {
    const k = th.dataset.sort;
    if (sort.key === k) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; else { sort.key = k; sort.dir = k === 't' || k === 'n' || k === 's' ? 'asc' : 'desc'; }
    rerender();
  });
}

// ---- segmented control ----
const seg = (name, opts, cur, cls = '') =>
  `<div class="seg ${cls}" role="group" data-seg="${name}"><span class="seg-thumb" aria-hidden="true"></span>${opts.map(o => {
    const [v, label, title] = Array.isArray(o) ? o : [o, o];
    return `<button type="button" data-v="${esc(v)}" class="${String(cur) === String(v) ? 'on' : ''}" ${title ? `title="${esc(title)}"` : ''} aria-pressed="${String(cur) === String(v)}">${label}</button>`;
  }).join('')}</div>`;
function onSeg(root, name, fn) {
  $$(`[data-seg="${name}"]`, root).forEach(s => placeThumb(s));
  $$(`[data-seg="${name}"] button`, root).forEach(b => b.onclick = () => {
    const segEl = b.closest('.seg');
    $$(`[data-seg="${name}"] button`, root).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    // Run the change first. If it re-draws this control, the new one glides
    // from the remembered position; if not, slide this one.
    fn(b.dataset.v, b);
    if (document.body.contains(segEl)) placeThumb(segEl);
  });
}

// ---- motion helpers ------------------------------------------------------
// Segmented controls get a pill ("thumb") that slides to the selected option.
// Its last position is remembered per control, so when a re-render replaces
// the control, the new thumb glides from where the old one was.
const _thumbMem = {};
function placeThumb(segEl) {
  if (!segEl) return;
  const thumb = segEl.querySelector('.seg-thumb'), on = segEl.querySelector('button.on');
  if (!thumb || !on || !on.offsetWidth) return; // not laid out yet: the plain .on style still shows
  const key = (segEl.parentElement?.closest('[id]')?.id || '') + ':' + segEl.dataset.seg;
  const to = { x: on.offsetLeft, w: on.offsetWidth };
  const from = _thumbMem[key];
  segEl.classList.add('has-thumb');
  if (from && (from.x !== to.x || from.w !== to.w) && !thumb._placed && !reducedMotion() && !window.__quiet) {
    thumb.style.transition = 'none';
    thumb.style.width = from.w + 'px'; thumb.style.transform = `translateX(${from.x}px)`;
    void thumb.offsetWidth;
    thumb.style.transition = '';
  } else if (!thumb._placed) thumb.style.transition = 'none';
  requestAnimationFrame(() => {
    thumb.style.width = to.w + 'px'; thumb.style.transform = `translateX(${to.x}px)`;
    if (thumb.style.transition === 'none') requestAnimationFrame(() => (thumb.style.transition = ''));
  });
  thumb._placed = true;
  _thumbMem[key] = to;
}
window.addEventListener('resize', debounce(() => $$('.seg.has-thumb').forEach(s => { s.querySelector('.seg-thumb')._placed = false; placeThumb(s); }), 120));

// A number that counts up when its page opens: cu(1234.5, 'usd').
const cu = (v, f = 'usd', d) => `<span class="cu tabular" data-v="${v}" data-f="${f}"${d != null ? ` data-d="${d}"` : ''}>${d != null ? fmt[f](v, d) : fmt[f](v)}</span>`;

// Runs after every non-background render: count-ups, and reveal-on-scroll
// for cards below the fold (with their charts and bars re-drawn as they
// appear, so the draw-in animation isn't spent while off-screen).
let _revealObs = null;
function afterRenderMotion(root) {
  if (reducedMotion()) return;
  $$('.cu', root).forEach(n => {
    const v = +n.dataset.v, f = fmt[n.dataset.f], d = n.dataset.d != null ? +n.dataset.d : undefined;
    if (!isFinite(v) || !f) return;
    n._v = n.dataset.f === 'usd' || n.dataset.f === 'int' ? v * 0.82 : 0;
    countUp(n, v, x => (d != null ? f(x, d) : f(x)), 1000);
  });
  if (_revealObs) _revealObs.disconnect();
  _revealObs = new IntersectionObserver(entries => entries.forEach(e => {
    if (!e.isIntersecting) return;
    const c = e.target;
    c.classList.add('rv-in');
    $$('.chart-line.draw, .chart-area, .mini-bar > i, .alloc-track > i, .stagger > *', c).forEach(x => { x.style.animation = 'none'; void x.offsetWidth; x.style.animation = ''; });
    _revealObs.unobserve(c);
  }), { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });
  const fold = window.innerHeight;
  $$('.view .card', root).forEach(c => {
    if (c.closest('.stagger') || c.closest('.rv')) return;
    if (c.getBoundingClientRect().top > fold - 20) { c.classList.add('rv'); _revealObs.observe(c); }
  });
}

// ---------------------------------------------------------------------------
// chartCard: the pro chart panel.
//
// opts = {
//   id: 'perf'                         saved preferences key
//   title, subtitle, height
//   sources: [[key,label,title]]       optional data-source switch
//   defaults: { range, mode, scale, yMode, compare:[], source }
//   build(ctx) → { series:[{key,name,color,points,primary}], markers, note, empty }
//      ctx = { range, from, to, mode, source, compare:[tickers] }
//   compareOptions: true               show the Compare picker
//   allowValue: true                   offer the $ mode
//   onState(ctx)                       called after each render (to sync other UI)
// }
// ---------------------------------------------------------------------------
const SERIES_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
const MAX_COMPARE = 4;

function chartCard(host, opts) {
  const key = 'llf_chart_' + opts.id;
  const saved = store.get(key, {});
  const st = {
    range: '1Y', mode: 'pct', scale: 'linear', yMode: 'auto', yMin: null, yMax: null, compare: [], source: null, table: false, custom: null,
    ...opts.defaults, ...saved,
  };
  if (opts.allowValue === false) st.mode = 'pct';
  if (opts.sources && !opts.sources.some(s => s[0] === st.source)) st.source = opts.sources[0][0];
  const save = () => store.set(key, { range: st.range, mode: st.mode, scale: st.scale, yMode: st.yMode, yMin: st.yMin, yMax: st.yMax, compare: st.compare, source: st.source, table: st.table });

  host.innerHTML = `<div class="card chart-card">
    <div class="card-h">
      <div><div class="card-t">${opts.titleIcon ? icon(opts.titleIcon) : ''}<span class="cc-title"></span></div><div class="card-sub cc-sub"></div></div>
      <div class="spacer"></div>
      <div class="cc-src"></div>
    </div>
    <div class="chart-toolbar">
      <div class="cc-ranges"></div>
      <button class="chip cc-custom" title="Custom date range">${icon('calendar-days', 'sm')}<span>Custom</span></button>
      <div class="tb-right">
      <div class="cc-mode"></div>
      <button class="icon-btn cc-axis" title="Axis settings" aria-label="Axis settings">${icon('sliders-horizontal')}</button>
      ${opts.compareOptions !== false ? `<button class="btn ghost sm cc-cmp">${icon('git-compare', 'sm')}Compare</button>` : ''}
      <button class="icon-btn cc-tbl" title="Show data table" aria-label="Show data table">${icon('list')}</button>
      </div>
    </div>
    <div class="chart-legend cc-legend"></div>
    <div class="cc-chart"></div>
    <div class="chart-foot"><span class="cc-note"></span><span class="spacer"></span><span class="cc-help">${icon('ruler')} Drag to measure · double-click to clear</span></div>
    <div class="cc-table" hidden></div>
  </div>`;
  const $c = s => host.querySelector(s);
  $c('.cc-title').textContent = opts.title || '';
  $c('.cc-sub').textContent = opts.subtitle || '';
  if (matchMedia('(pointer: coarse)').matches) $c('.cc-help').innerHTML = icon('ruler') + ' Touch and drag to scrub';

  let chart = null, last = null;

  function ctx() {
    let to = null, from = null;
    if (st.range === 'CUSTOM' && st.custom) { from = st.custom[0]; to = st.custom[1]; }
    return { range: st.range, from, to, mode: st.mode, source: st.source, compare: st.compare };
  }

  function draw(animate = true) {
    const c = ctx();
    const out = opts.build(c) || {};
    last = { ...out, ctx: c };
    const series = (out.series || []).map((s, i) => ({ ...s, color: s.color || SERIES_COLORS[i % SERIES_COLORS.length] }));
    // controls
    $c('.cc-ranges').innerHTML = seg('range', (opts.ranges || RANGES).map(r => [r, r === 'MAX' ? 'Max' : r, RANGE_LABEL[r]]), st.range);
    onSeg(host, 'range', v => { st.range = v; st.custom = null; save(); draw(); });
    $c('.cc-custom').classList.toggle('on', st.range === 'CUSTOM');
    $c('.cc-custom span').textContent = st.range === 'CUSTOM' && st.custom ? `${dt.monYr(st.custom[0])} – ${dt.monYr(st.custom[1])}` : 'Custom';
    $c('.cc-mode').innerHTML = opts.allowValue === false ? '' : seg('mode', [['value', '$', 'Dollar value'], ['pct', '%', 'Percent change']], st.mode);
    onSeg(host, 'mode', v => { st.mode = v; save(); draw(false); });
    if (opts.sources) {
      $c('.cc-src').innerHTML = seg('src', opts.sources, st.source);
      onSeg(host, 'src', v => { st.source = v; save(); draw(); });
    }
    $c('.cc-axis').classList.toggle('on', st.scale === 'log' || st.yMode !== 'auto');
    $c('.cc-tbl').classList.toggle('on', st.table);

    // legend with each series' return over the visible window
    // A compared line whose data source stopped updating ends early; say so
    // instead of letting it silently stop short of the main line.
    const mainEnd = (series.find(s => s.primary) || series[0])?.points?.slice(-1)[0]?.d;
    $c('.cc-legend').innerHTML = series.filter(s => s.points && s.points.length > 1).map((s, i) => {
      const r = (s.points[s.points.length - 1].v / s.points[0].v - 1) * 100;
      const end = s.points[s.points.length - 1].d;
      const short = !s.primary && mainEnd && dt.days(end, mainEnd) > 5;
      return `<span class="lg" data-k="${esc(s.key)}"><span class="key ${s.dashed ? 'dash' : ''}" style="background:${s.color};color:${s.color}"></span><span class="nm"></span>
        <span class="v ${signCls(r)}">${fmt.pct(r)}</span>${short ? `<span class="badge warn" title="The price source hasn't sent anything newer. The return shown is up to this date.">thru ${dt.short(end)}</span>` : ''}${s.removable ? `<button aria-label="Remove">${icon('x', 'xs')}</button>` : ''}</span>`;
    }).join('') + (out.legendExtra || '');
    $$('.cc-legend .lg', host).forEach(l => {
      const s = series.find(x => x.key === l.dataset.k);
      l.querySelector('.nm').textContent = s.name;
      const b = l.querySelector('button');
      if (b) b.onclick = () => { st.compare = st.compare.filter(t => t !== s.key); save(); draw(false); };
    });
    $c('.cc-note').textContent = out.note || '';

    const cfg = {
      series, mode: st.mode, scale: st.scale, yMode: st.yMode, yMin: st.yMin, yMax: st.yMax,
      markers: out.markers, height: opts.height || 340, emptyText: out.empty || 'Loading price history…',
      fmt: out.fmt, ariaLabel: opts.title,
    };
    if (!chart) chart = lineChart($c('.cc-chart'), cfg);
    else chart.update(cfg, animate);
    if (st.table) renderTable(series); else $c('.cc-table').hidden = true;
    opts.onState && opts.onState({ ...c, series });
  }

  function renderTable(series) {
    const box = $c('.cc-table');
    box.hidden = false;
    const valid = series.filter(s => s.points && s.points.length);
    if (!valid.length) { box.innerHTML = ''; return; }
    const primary = valid.find(s => s.primary) || valid[0];
    let rows = primary.points;
    // Long daily ranges → one row per month (last trading day) to stay readable.
    if (rows.length > 260) { const m = {}; rows.forEach(p => { m[p.d.slice(0, 7)] = p; }); rows = Object.values(m); }
    const base = valid.map(s => s.points[0].v);
    const cell = (s, k, d) => {
      const i = bisectDate(s.points, d); if (i < 0) return '<td class="muted">—</td>';
      const v = s.points[i].v;
      return st.mode === 'pct' ? `<td class="${signCls(v - base[k])}">${fmt.pct((v / base[k] - 1) * 100)}</td>`
        : `<td>${s.primary && !s.indexed ? fmt.usd(v) : (v / base[k]).toFixed(3) + '×'}</td>`;
    };
    box.innerHTML = `<div class="table-wrap" style="max-height:360px;border-top:1px solid var(--border)"><table class="t"><thead><tr><th class="left">Date</th>${valid.map(s => `<th>${esc(s.name)}</th>`).join('')}</tr></thead>
      <tbody>${[...rows].reverse().map(p => `<tr><td class="left muted">${dt.long(p.d)}</td>${valid.map((s, k) => cell(s, k, p.d)).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  // custom range
  $c('.cc-custom').onclick = e => {
    const end = last?.series?.find(s => s.primary)?.points?.slice(-1)[0]?.d || dt.today();
    const [f, t] = st.custom || [dt.addMonths(end, -12), end];
    openPop(e.currentTarget, `<div class="pop-sec"><div class="pop-title">Custom range</div>
      <div class="form-grid"><div class="field"><label>From</label><input class="input sm" type="date" value="${f}" data-f/></div>
      <div class="field"><label>To</label><input class="input sm" type="date" value="${t}" data-t/></div></div>
      <button class="btn primary sm block">Apply</button></div>`, pop => {
      pop.querySelector('.btn').onclick = () => {
        const a = pop.querySelector('[data-f]').value, b = pop.querySelector('[data-t]').value;
        if (!a || !b || a >= b) { pop.querySelector('[data-f]').classList.add('err'); return; }
        st.custom = [a, b]; st.range = 'CUSTOM'; closePop(); draw();
      };
    }, { align: 'start' });
  };

  // axis settings popover
  $c('.cc-axis').onclick = e => {
    const unit = st.mode === 'pct' ? '%' : '$';
    openPop(e.currentTarget, `
      <div class="pop-sec"><div class="pop-title">Scale</div>${seg('scale', [['linear', 'Linear'], ['log', 'Logarithmic']], st.scale)}
        <div class="hint">Log scale shows equal % moves as equal heights. Useful for long ranges.</div></div>
      <div class="pop-sec"><div class="pop-title">Y-axis range</div>${seg('ymode', [['auto', 'Auto-fit'], ['zero', 'From zero'], ['manual', 'Manual']], st.yMode)}
        <div class="form-grid manual" ${st.yMode === 'manual' ? '' : 'hidden'}>
          <div class="field"><label>Min (${unit})</label><input class="input sm" type="number" step="any" data-min value="${st.yMin ?? ''}"/></div>
          <div class="field"><label>Max (${unit})</label><input class="input sm" type="number" step="any" data-max value="${st.yMax ?? ''}"/></div>
        </div></div>
      <div class="pop-sec"><button class="btn ghost sm block" data-reset>${icon('rotate-ccw', 'sm')}Reset axis</button></div>`, pop => {
      const zeroBtn = pop.querySelector('[data-seg="ymode"] [data-v="zero"]');
      const syncZero = () => { zeroBtn.disabled = st.scale === 'log'; zeroBtn.title = st.scale === 'log' ? 'Not available on a log scale' : ''; };
      syncZero();
      onSeg(pop, 'scale', v => { st.scale = v; if (v === 'log' && st.yMode === 'zero') st.yMode = 'auto'; syncZero(); save(); draw(false); });
      onSeg(pop, 'ymode', v => {
        st.yMode = v; pop.querySelector('.manual').hidden = v !== 'manual';
        if (v === 'manual' && st.yMin == null && chart?.geom) {
          const G = chart.geom; st.yMin = +G.inv(G.lo).toFixed(2); st.yMax = +G.inv(G.hi).toFixed(2);
          pop.querySelector('[data-min]').value = st.yMin; pop.querySelector('[data-max]').value = st.yMax;
        }
        save(); draw(false);
      });
      const apply = debounce(() => {
        const a = parseFloat(pop.querySelector('[data-min]').value), b = parseFloat(pop.querySelector('[data-max]').value);
        st.yMin = isFinite(a) ? a : null; st.yMax = isFinite(b) ? b : null; save(); draw(false);
      }, 350);
      pop.querySelector('[data-min]').oninput = apply; pop.querySelector('[data-max]').oninput = apply;
      pop.querySelector('[data-reset]').onclick = () => { Object.assign(st, { scale: 'linear', yMode: 'auto', yMin: null, yMax: null }); save(); closePop(); draw(false); };
    });
  };

  // compare picker: benchmarks, holdings, or any ticker
  const cmpBtn = $c('.cc-cmp');
  if (cmpBtn) cmpBtn.onclick = e => {
    const row = (t, name, sub) => `<button class="pop-item ${st.compare.includes(t) ? 'on' : ''}" data-t="${esc(t)}"><span class="badge">${esc(t)}</span><span>${esc(name)}${sub ? ` <small>${esc(sub)}</small>` : ''}</span><span class="chk">${icon('check', 'sm')}</span></button>`;
    const market = Object.entries(BENCHMARKS).filter(([, b]) => b.group === 'Market');
    const sector = Object.entries(BENCHMARKS).filter(([, b]) => b.group === 'Sector');
    openPop(e.currentTarget, `
      <div class="pop-sec"><div class="input-wrap">${icon('search', 'sm')}<input class="input sm" placeholder="Any ticker, e.g. VOO" data-q maxlength="10" style="text-transform:uppercase"/></div>
        <div class="hint">Up to ${MAX_COMPARE} at once. Benchmarks are price return (no dividends).</div></div>
      <div class="pop-sec" style="max-height:340px;overflow:auto;gap:2px">
        <div class="pop-title">Market</div>${market.map(([t, b]) => row(t, b.name)).join('')}
        <div class="pop-title" style="margin-top:8px">Sectors</div>${sector.map(([t, b]) => row(t, b.name)).join('')}
        ${S.hold.length ? `<div class="pop-title" style="margin-top:8px">Holdings</div>${S.hold.map(h => row(h.t, h.n || h.t)).join('')}` : ''}
      </div>`, pop => {
      const toggle = t => {
        t = t.toUpperCase().replace(/[^A-Z.\-]/g, '');
        if (!t) return;
        if (st.compare.includes(t)) st.compare = st.compare.filter(x => x !== t);
        else {
          if (st.compare.length >= MAX_COMPARE) { toast(`Compare up to ${MAX_COMPARE} at a time`, 'info'); return; }
          st.compare = [...st.compare, t];
          getHist(t).then(h => { if (!h) toast(`No price history found for ${t}`, 'err'); draw(false); });
        }
        $$('.pop-item', pop).forEach(b => b.classList.toggle('on', st.compare.includes(b.dataset.t)));
        save(); draw(false);
      };
      $$('.pop-item', pop).forEach(b => b.onclick = () => toggle(b.dataset.t));
      const q = pop.querySelector('[data-q]');
      q.onkeydown = ev => { if (ev.key === 'Enter') { toggle(q.value); q.value = ''; } };
      setTimeout(() => q.focus(), 20);
    });
  };

  $c('.cc-tbl').onclick = () => { st.table = !st.table; save(); draw(false); };

  // Pull any compare histories we need, then redraw as they arrive.
  st.compare.forEach(t => getHist(t).then(() => draw(false)));
  const onHist = debounce(() => { if (document.body.contains(host)) draw(false); }, 120);
  histListeners.add(onHist);
  draw();
  return {
    redraw: (animate = false) => draw(animate),
    state: st,
    destroy() { histListeners.delete(onHist); chart && chart.destroy(); },
  };
}

// Compare series built from the card's ctx: rebased & windowed like the main one.
const FIXED_COLORS = { SPY: 'var(--s2)', QQQ: 'var(--s3)', DIA: 'var(--s4)', IWM: 'var(--s5)', VTI: 'var(--s6)' };
function compareColor(t, k) { return FIXED_COLORS[t] || ['var(--s6)', 'var(--s5)', 'var(--s4)', 'var(--s3)'][k % 4]; }
function compareSeries(ctx, from, to, sampleDates) {
  return ctx.compare.map((t, k) => {
    let pts = priceSeries(t);
    if (!pts) return { key: t, name: benchName(t), points: [], removable: true, color: compareColor(t, k) };
    if (sampleDates) pts = sampleDates.map(d => { const i = bisectDate(pts, d); return i >= 0 ? { d, v: pts[i].v } : null; }).filter(Boolean);
    return { key: t, name: benchName(t), points: sliceSeries(pts, from, to), removable: true, color: compareColor(t, k) };
  });
}

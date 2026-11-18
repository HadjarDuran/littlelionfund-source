// ---------------------------------------------------------------------------
// views/dashboard.js — "Overview": the 30-second answer to "how is the fund
// doing?" Hero value, KPIs, performance vs S&P, returns table, positions,
// allocation, today's movers and recent activity.
// ---------------------------------------------------------------------------

const posSort = store.get('llf_pos_sort', { key: 'val', dir: 'desc' });
let posGrouped = store.get('llf_pos_grouped', true);

VIEWS.dashboard = {
  head: () => ({ title: 'Overview', sub: dt.long(dt.today()) }),
  render(el) {
    const t = totals(), rz = realized(), fs = fundSeries();
    const fundItd = fs.length > 1 ? (fs[fs.length - 1].v / fs[0].v - 1) * 100 : null;
    el.innerHTML = `<div class="view">
      <div class="grid g-main balance" id="dash-grid">
        <div class="stack" id="dash-left">
          <div class="card hero">
            <div class="hero-top">
              <div style="flex:1;min-width:240px">
                <div class="hero-label">${icon('wallet', 'sm')}Total fund value</div>
                <div class="hero-value tabular" id="hero-v">${fmt.usd(t.total)}</div>
                <div class="hero-chg">${t.priced ? chgPill(t.day, `${fmt.usd(Math.abs(t.day))} (${fmt.pct(t.dayPct)})`) + '<span class="muted" style="font-weight:500">today</span>' : '<span class="muted">Waiting for prices…</span>'}</div>
              </div>
              <div class="row wrap" style="gap:28px;padding-top:6px">
                <div><div class="kpi-label">${icon('coins', 'sm')}Unit value</div><div class="kpi-value tabular" style="font-size:20px">${cu(t.unit)}</div><div class="kpi-foot">${fmt.shares(S.units)} units</div></div>
                ${fundItd != null ? `<div><div class="kpi-label">${icon('trending-up', 'sm')}Since ${fs[0].d.slice(0, 4)}</div><div class="kpi-value tabular ${signCls(fundItd)}" style="font-size:20px">${cu(fundItd, 'pct', 1)}</div><div class="kpi-foot">${fmt.pct(annualize(fundItd, fs[0].d, fs[fs.length - 1].d), 1)} / yr</div></div>` : ''}
              </div>
            </div>
            <div class="grid g-4 stagger" style="margin:20px 0 16px">
              ${kpi('briefcase', 'Invested', cu(t.equity), `${t.count} positions`)}
              ${kpi('landmark', 'Cash', cu(t.cash), `${t.total ? (t.cash / t.total * 100).toFixed(1) : 0}% of fund`)}
              ${kpi('trending-up', 'Unrealized gain', `<span class="${signCls(t.pnl)}">${cu(t.pnl, 'usdSigned')}</span>`, `${fmt.pct(t.pnlPct)} on ${fmt.usdCompact(t.cost)} cost`)}
              ${kpi('receipt', `Realized ${dt.today().slice(0, 4)}`, `<span class="${signCls(rz.ytd)}">${cu(rz.ytd, 'usdSigned')}</span>`, `${fmt.usdCompact(rz.all)} since 2012`)}
            </div>
          </div>
          <div id="dash-chart"></div>
          <div class="card"><div class="card-h"><div class="card-t">${icon('trophy')}Returns vs. benchmarks</div><div class="spacer"></div><a class="chip" href="#/performance">Details ${icon('arrow-right', 'xs')}</a></div>
            <div id="dash-bench" style="padding-top:8px"></div></div>
        </div>
        <div class="stack" id="dash-right">
          <div class="card"><div class="card-h"><div class="card-t">${icon('chart-pie')}Allocation</div><div class="spacer"></div><div id="alloc-seg"></div></div>
            <div class="card-b" id="alloc"></div></div>
          <div class="card"><div class="card-h"><div class="card-t">${icon('activity')}Today's movers</div></div><div id="movers" style="padding-top:6px"></div></div>
        </div>
      </div>
      <div class="card mt" id="pos-card"></div>
      <div class="card mt"><div class="card-h"><div class="card-t">${icon('history')}Recent activity</div><div class="spacer"></div><a class="chip" href="#/activity">All activity ${icon('arrow-right', 'xs')}</a></div><div id="recent" style="padding-top:6px"></div></div></div>`;
    const hv = $('#hero-v'); hv._v = this._lastTotal; countUp(hv, t.total, fmt.usd, 1100); this._lastTotal = t.total;

    const card = chartCard($('#dash-chart'), {
      id: 'dash', title: 'Performance', titleIcon: 'chart-line', height: 300,
      sources: PORTFOLIO_SOURCES, defaults: { range: '1Y', mode: 'pct', compare: ['SPY'], source: 'holdings' },
      build: portfolioBuild,
    });
    benchReturns($('#dash-bench'), { tickers: ['SPY', 'QQQ'], periods: BENCH_PERIODS.filter(p => p[0] !== '1M') });
    drawPositions();
    drawAlloc();
    drawRecent($('#recent'), allTxns().filter(x => !x.drip && (x.type === 'buy' || x.type === 'sell')).slice(0, 8), true);
    balanceDash();
    // Re-balance when the layout can shift: web font arriving, window resize.
    document.fonts && document.fonts.ready.then(() => balanceDash());
    const onResize = debounce(balanceDash, 150);
    window.addEventListener('resize', onResize);
    return () => { card.destroy(); window.removeEventListener('resize', onResize); };
  },
};

function kpi(ic, label, value, foot) {
  return `<div class="kpi" style="padding:0"><div class="kpi-label">${icon(ic)}${label}</div><div class="kpi-value tabular">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}

// Last price shown per ticker, so a background refresh can flash what changed.
const _pxSeen = {};
function drawPositions() {
  const host = $('#pos-card'); if (!host) return;
  const pos = positions(), t = totals();
  const cols = [
    ['Holding', 't', 'left'], ['Shares', 'sh'], ['Avg cost', 'ac'], ['Price', 'price'], ['Today', 'dayPct'],
    ['Value', 'val'], ['Gain / loss', 'pnl'], ['Weight', 'weight'], ['Annual %', 'annual'], ['1-yr price', 'ttm'],
  ];
  const flashCls = p => {
    const prev = _pxSeen[p.t]; _pxSeen[p.t] = p.price;
    return window.__quiet && prev && p.price && prev !== p.price ? (p.price > prev ? 'flash-up' : 'flash-down') : '';
  };
  const row = p => `<tr class="click" data-t="${esc(p.t)}">
      <td class="left"><div class="tk">${tkLogo(p.t)}<div style="min-width:0"><div class="tk-name">${esc(p.t)}</div><div class="tk-sub">${esc(p.n || '')}</div></div></div></td>
      <td class="muted">${fmt.shares(p.sh)}</td><td class="muted">${fmt.usd(p.ac)}</td>
      <td class="strong ${flashCls(p)}">${p.hasPrice ? fmt.usd(p.price) : '—'}</td>
      <td class="${signCls(p.dayPct)}">${p.hasPrice ? fmt.pct(p.dayPct) : '—'}</td>
      <td class="strong">${p.hasPrice ? fmt.usd(p.val) : '—'}</td>
      <td class="${signCls(p.pnl)}">${p.hasPrice ? `${fmt.usdSigned(p.pnl)}<div style="font-size:11.5px;opacity:.85">${fmt.pct(p.pnlPct)}</div>` : '—'}</td>
      <td><div class="bar-cell"><span class="muted">${p.weight.toFixed(2)}%</span><span class="mini-bar"><i style="width:${Math.min(100, p.weight / Math.max(...pos.map(x => x.weight), 1) * 100)}%;background:${sectorColor(p.s)}"></i></span></div></td>
      <td class="${signCls(p.annual)}" title="Total % gain ÷ years held, the same formula as the fund spreadsheet">${p.annual != null ? fmt.pct(p.annual, 1) : '—'}</td>
      <td class="${signCls(p.ttm)}">${p.ttm != null ? fmt.pct(p.ttm) : '<span class="muted">—</span>'}</td></tr>`;
  let body = '';
  if (posGrouped) {
    for (const g of bySector()) {
      body += `<tr class="group"><td class="left"><span class="row" style="gap:8px"><span class="dot" style="background:${sectorColor(g.s)}"></span>${esc(g.s)}</span></td>
        <td colspan="4"></td><td>${fmt.usd(g.val)}</td><td class="${signCls(g.pnl)}">${fmt.usdSigned(g.pnl)}<div style="font-size:11.5px;opacity:.85">${fmt.pct(g.pnlPct)}</div></td><td>${g.weight.toFixed(2)}%</td><td colspan="2"></td></tr>`;
      body += sortBy(g.pos, posSort.key, posSort.dir).map(row).join('');
    }
  } else body = sortBy(pos, posSort.key, posSort.dir).map(row).join('');
  host.innerHTML = `<div class="card-h bordered"><div class="card-t">${icon('table')}Positions</div><div class="card-sub">${pos.length} holdings · click a column to sort</div><div class="spacer"></div>
      ${seg('pgroup', [['1', 'By sector'], ['0', 'All']], posGrouped ? '1' : '0')}</div>
    <div class="table-wrap"><table class="t"><thead><tr>${cols.map(([l, k, c]) => thSort(l, k, posSort, c || '')).join('')}</tr></thead><tbody>${body}</tbody>
    <tfoot><tr><td class="left">Equity total</td><td colspan="2"></td><td class="muted" style="font-weight:600">${fmt.usd(t.cost)} cost</td><td></td><td>${fmt.usd(t.equity)}</td><td class="${signCls(t.pnl)}">${fmt.usdSigned(t.pnl)}<div style="font-size:11.5px;opacity:.85">${fmt.pct(t.pnlPct)}</div></td><td>100%</td><td colspan="2"></td></tr>
    <tr><td class="left muted" style="font-weight:600">Cash · bank + brokerage</td><td colspan="4"></td><td class="muted" style="font-weight:600">${fmt.usd(t.cash)}</td><td colspan="4"></td></tr>
    <tr><td class="left">Market value of portfolio</td><td colspan="4"></td><td>${fmt.usd(t.total)}</td><td colspan="4" class="muted" style="text-align:left;font-weight:600">${fmt.usd(t.unit)} per unit · ${fmt.shares(S.units)} units</td></tr></tfoot></table></div>`;
  wireSort(host, posSort, () => { store.set('llf_pos_sort', posSort); drawPositions(); });
  onSeg(host, 'pgroup', v => { posGrouped = v === '1'; store.set('llf_pos_grouped', posGrouped); drawPositions(); });
  $$('tr[data-t]', host).forEach(r => r.onclick = () => go('stock/' + r.dataset.t));
}

let allocView = store.get('llf_alloc_view', 'sector');
function drawAlloc() {
  const host = $('#alloc'); if (!host) return;
  $('#alloc-seg').innerHTML = seg('aview', [['sector', 'Sectors'], ['stock', 'Stocks']], allocView);
  onSeg(document, 'aview', v => { allocView = v; store.set('llf_alloc_view', v); drawAlloc(); });
  const t = totals();
  const targets = Object.fromEntries((S.weightings || []).map(w => [w.s, +w.p]));
  let slices;
  if (allocView === 'sector') {
    slices = bySector().map(g => ({ name: g.s, value: g.val, color: sectorColor(g.s), target: targets[g.s] }));
  } else {
    // Top 8 by value, the rest folded into "Other" (never more colours than you can tell apart).
    const pos = sortBy(positions().filter(p => p.val > 0), 'val', 'desc');
    slices = pos.slice(0, 8).map(p => ({ name: p.t, value: p.val, color: sectorColor(p.s), t: p.t }));
    const rest = pos.slice(8).reduce((s, p) => s + p.val, 0);
    if (rest > 0) slices.push({ name: `Other (${pos.length - 8})`, value: rest, color: '#94a3b8' });
  }
  // Shares of invested money (cash excluded), matching the fund spreadsheet's
  // portfolio weights and the sector targets on the Weightings page.
  host.innerHTML = `<div id="donut"></div><div class="list" style="margin-top:8px">${slices.map(s => {
    const pct = s.value / (t.equity || 1) * 100;
    return `<div class="alloc-row" ${s.target != null ? `title="Target ${s.target}% · actual ${pct.toFixed(1)}%"` : ''}>
      <div class="alloc-name"><span class="sq" style="background:${s.color}"></span><span>${esc(s.name)}</span></div>
      <div class="alloc-pct tabular">${pct.toFixed(1)}%</div>
      <div class="alloc-track"><i style="width:${Math.min(100, pct)}%;background:${s.color}"></i>${s.target != null ? `<b style="left:${Math.min(99, s.target)}%"></b>` : ''}</div></div>`;
  }).join('')}
    <div class="alloc-row" style="border-top:1px solid var(--border);margin-top:4px;padding-top:10px"><div class="alloc-name"><span class="sq" style="background:var(--border-strong)"></span><span>Cash (excluded from weights)</span></div><div class="alloc-pct tabular">${fmt.usd(t.cash, 0)}</div></div></div>
  ${allocView === 'sector' && Object.keys(targets).length ? `<div class="hint" style="margin-top:8px;display:flex;gap:6px;align-items:center"><span style="width:2px;height:12px;background:var(--text);opacity:.55;display:inline-block;border-radius:2px"></span>Tick = target weight</div>` : ''}`;
  donut($('#donut'), slices, { size: 164, thickness: 22, centerLabel: allocView === 'sector' ? `${bySector().length} sectors · invested` : `${positions().length} stocks · invested`, centerValue: fmt.usdCompact(t.equity) });
}

// Overview's two columns end on the same line: the right column shows as
// many movers as fit beside the left column (at least 1 up / 1 down), and the
// last card in each column stretches to absorb what's left (less than a row).
function balanceDash() {
  const grid = $('#dash-grid'), L = $('#dash-left'), R = $('#dash-right');
  if (!grid || !L || !R) return;
  const twoCol = getComputedStyle(grid).gridTemplateColumns.split(' ').length > 1;
  if (!twoCol) { drawMovers(3); return; }
  grid.classList.add('measuring');
  const natural = col => [...col.children].reduce((s, c) => s + c.offsetHeight, 0) + 16 * (col.children.length - 1);
  const left = natural(L);
  let k = 6;
  for (; k > 1; k--) { drawMovers(k); if (natural(R) <= left + 12) break; }
  if (k === 1) drawMovers(1);
  grid.classList.remove('measuring');
}

function drawMovers(k = 3) {
  const host = $('#movers'); if (!host) return;
  const pos = positions().filter(p => p.hasPrice && p.pc);
  if (!pos.length) { host.innerHTML = '<div class="empty">Waiting for prices…</div>'; return; }
  const sorted = sortBy(pos, 'dayPct', 'desc');
  k = Math.max(1, Math.min(k, Math.floor(sorted.length / 2)));
  const up = sorted.slice(0, k), down = sorted.slice(-k).reverse().filter(p => !up.includes(p));
  const li = p => `<a class="li click" href="#/stock/${encodeURIComponent(p.t)}" style="color:inherit">${tkLogo(p.t)}
    <div class="li-main"><div class="li-title">${esc(p.t)}</div><div class="li-sub">${fmt.usd(p.price)}</div></div>
    <div class="li-end"><div class="${signCls(p.dayPct)} strong tabular">${fmt.pct(p.dayPct)}</div><div class="li-sub ${signCls(p.dayChg)}">${fmt.usdSigned(p.dayChg)}</div></div></a>`;
  host.innerHTML = `<div class="list">${up.map(li).join('')}${down.length ? `<div class="nav-label" style="padding:10px 20px 4px">Lagging</div>` + down.map(li).join('') : ''}</div>`;
}

function txnLine(x) {
  const verb = x.type === 'buy' ? (x.drip ? 'Reinvested in' : 'Bought') : x.type === 'sell' ? 'Sold' : x.type === 'split' ? 'Stock split' : x.type === 'spinoff' ? 'Spinoff' : 'Note';
  const ic = x.type === 'buy' ? (x.drip ? 'rotate-ccw' : 'arrow-down-to-line') : x.type === 'sell' ? 'arrow-up-from-line' : x.type === 'split' ? 'split' : 'info';
  const cls = x.type === 'buy' ? 'buy' : x.type === 'sell' ? 'sell' : 'ev';
  const title = x.type === 'buy' || x.type === 'sell' ? `${verb} ${fmt.shares(x.sh)} ${x.t}` : `${verb} · ${x.t || ''}`;
  const sub = [x.d ? dt.long(x.d) : null, x.px ? '@ ' + fmt.usd(x.px) : null, x.memo && x.type !== 'buy' ? x.memo : null, x.src === 'app' ? 'recorded in app' : null].filter(Boolean).join(' · ');
  const end = x.type === 'sell'
    ? `<div class="strong tabular">${x.amt != null ? fmt.usd(x.amt) : '—'}</div>${x.gain != null ? `<div class="li-sub ${signCls(x.gain)}">${fmt.usdSigned(x.gain)}</div>` : '<div class="li-sub">price not recorded</div>'}`
    : x.type === 'buy' ? `<div class="strong tabular">${x.amt != null ? fmt.usd(x.amt) : '—'}</div>` : '';
  return `<a class="li click" href="#/stock/${encodeURIComponent(x.t || '')}" style="color:inherit"><span class="ic-circle ${cls}">${icon(ic, 'sm')}</span>
    <div class="li-main"><div class="li-title"></div><div class="li-sub"></div></div><div class="li-end">${end}</div></a>`;
}
// Text from the ledger goes in via textContent.
function fillTxnText(host, list) {
  $$('.li', host).forEach((li, i) => {
    const x = list[i]; if (!x) return;
    const verb = x.type === 'buy' ? (x.drip ? 'Dividend reinvested ·' : 'Bought') : x.type === 'sell' ? 'Sold' : x.type === 'split' ? 'Stock split ·' : x.type === 'spinoff' ? 'Spinoff ·' : 'Note ·';
    li.querySelector('.li-title').textContent = `${verb} ${x.t || ''}${x.ratio ? ' ' + x.ratio : ''}`;
    const qty = x.sh != null && (x.type === 'buy' || x.type === 'sell') ? `${fmt.shares(x.sh)} sh${x.px ? ' @ ' + fmt.usd(x.px) : ''}` : null;
    li.querySelector('.li-main .li-sub').textContent = [x.d ? dt.long(x.d) : 'Undated', qty, x.type !== 'buy' && x.type !== 'sell' && x.memo ? x.memo : null, x.est ? 'date estimated' : null, x.src === 'app' ? 'recorded in app' : null].filter(Boolean).join(' · ');
  });
}
function drawRecent(host, list, twoCol) {
  if (!host) return;
  if (!list.length) { host.innerHTML = '<div class="empty">No trades recorded yet.</div>'; return; }
  host.innerHTML = `<div class="list ${twoCol ? 'two-col' : ''}">${list.map(txnLine).join('')}</div>`;
  fillTxnText(host, list);
}

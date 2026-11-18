// ---------------------------------------------------------------------------
// views/activity.js — the fund's full trade history: every buy, sale, split
// and spinoff since 2012 (imported from the Master File ledger) plus trades
// recorded in the app since. Realized gains by year, past holdings, and an
// honest list of gaps found in the source spreadsheet.
// ---------------------------------------------------------------------------

// shown: how many feed rows are on screen. "auto" = as many as fit beside
// the side cards (so the page has no empty gap), until "Show more" is used.
const actState = { q: '', type: 'all', year: 'all', shown: 30, auto: true };
const pastSort = { key: 'last', dir: 'desc' };

VIEWS.activity = {
  head: () => ({ title: 'Activity', sub: S.ledger ? `Trade history ${S.ledger.range[0].slice(0, 4)}–${dt.today().slice(0, 4)}` : '' }),
  render(el) {
    const rz = realized(), all = allTxns(), past = pastHoldings();
    const trades = all.filter(x => x.type === 'buy' || x.type === 'sell');
    const years = [...new Set(all.map(x => (x.d || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const warnings = S.ledger?.warnings?.filter(w => !/no ticker in scope|Unrecognised label/.test(w.msg)) || [];

    el.innerHTML = `<div class="view stack">
      <div class="grid g-4 stagger">
        <div class="card kpi"><div class="kpi-label">${icon('receipt')}Realized gains, all time</div><div class="kpi-value tabular ${signCls(rz.all)}">${cu(rz.all, 'usdSigned')}</div><div class="kpi-foot">${fmt.usdSigned(rz.lt)} long-term · ${fmt.usdSigned(rz.st)} short-term</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('calendar')}Realized in ${dt.today().slice(0, 4)}</div><div class="kpi-value tabular ${signCls(rz.ytd)}">${cu(rz.ytd, 'usdSigned')}</div><div class="kpi-foot">${all.filter(x => x.type === 'sell' && x.d?.startsWith(dt.today().slice(0, 4))).length} sales this year</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('list')}Trades recorded</div><div class="kpi-value tabular">${cu(trades.length, 'int')}</div><div class="kpi-foot">${fmt.int(trades.filter(x => x.drip).length)} of them dividend reinvestments</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('history')}Past holdings</div><div class="kpi-value tabular">${cu(past.length, 'int')}</div><div class="kpi-foot">companies owned and fully sold</div></div>
      </div>
      <div class="card"><div class="card-h"><div><div class="card-t">${icon('chart-column')}Realized gains by year</div><div class="card-sub">Gain or loss locked in by sales each calendar year. Hover a bar for the short/long-term split</div></div></div>
        <div id="rz-bars" style="padding:8px 14px 10px"></div></div>
      <div class="grid g-main" style="align-items:start" id="act-grid">
        <div class="card" id="act-feed"></div>
        <div class="stack sticky-col" id="act-side">
          <div class="card"><div class="card-h"><div class="card-t">${icon('trophy')}Best &amp; worst exits</div></div><div id="exits" style="padding-top:6px"></div></div>
          ${warnings.length ? `<div class="card"><div class="card-h"><div class="card-t">${icon('triangle-alert')}Gaps in the source ledger</div></div>
            <div class="card-b"><div class="note warn">${icon('info')}<span>The import flagged ${warnings.length} rows in the Master File that need a human look. Nothing was guessed silently. Fix them in the spreadsheet and re-run the import.</span></div>
            <details style="margin-top:10px"><summary class="hint" style="cursor:pointer">Show details</summary><ul class="hint" style="margin:8px 0 0 16px;display:grid;gap:6px" id="warn-list"></ul></details></div></div>` : ''}
        </div>
      </div>
      <div class="card" id="past-card"></div>
    </div>`;

    barChart($('#rz-bars'), rz.years.map(y => ({
      label: "'" + y.y.slice(2), v: y.gain,
      tip: `<div class="tip-row"><span class="nm">Long-term</span><b>${fmt.usdSigned(y.lt)}</b></div><div class="tip-row"><span class="nm">Short-term</span><b>${fmt.usdSigned(y.st)}</b></div><div class="tip-row"><span class="nm">Sales</span><b>${y.n}</b></div>`,
    })), { height: 230, color: 'var(--s1)' });
    const wl = $('#warn-list'); if (wl) warnings.forEach(w => { const li = document.createElement('li'); li.textContent = (w.row ? `Row ${w.row}: ` : '') + w.msg; wl.appendChild(li); });

    // best & worst completed exits by realized gain
    const ranked = sortBy(past.filter(p => p.sells && !p.missing), 'gain', 'desc');
    const exitLi = p => `<a class="li click" href="#/stock/${encodeURIComponent(p.t)}" style="color:inherit">${tkLogo(p.t)}<div class="li-main"><div class="li-title">${esc(p.t)}</div><div class="li-sub">${dt.monYr(p.first)} – ${dt.monYr(p.last)}</div></div>
      <div class="li-end"><div class="strong tabular ${signCls(p.gain)}">${fmt.usdSigned(p.gain)}</div><div class="li-sub">${p.ret != null ? fmt.pct(p.ret, 0) : ''}</div></div></a>`;
    $('#exits').innerHTML = ranked.length ? `<div class="list">${ranked.slice(0, 4).map(exitLi).join('')}<div class="nav-label" style="padding:10px 20px 4px">Biggest losses</div>${ranked.slice(-3).reverse().map(exitLi).join('')}</div>` : '<div class="empty">No completed exits yet.</div>';

    fitFeed(el, years);
    drawPast();
  },
};

function drawFeed(el, years) {
  const host = $('#act-feed'); if (!host) return;
  const q = actState.q.trim().toUpperCase();
  const list = allTxns().filter(x => {
    if (actState.type === 'buy' && !(x.type === 'buy' && !x.drip)) return false;
    if (actState.type === 'sell' && x.type !== 'sell') return false;
    if (actState.type === 'drip' && !x.drip) return false;
    if (actState.type === 'event' && (x.type === 'buy' || x.type === 'sell')) return false;
    if (actState.year !== 'all' && !(x.d || '').startsWith(actState.year)) return false;
    if (q && !(x.t || '').includes(q)) return false;
    return true;
  });
  const shown = list.slice(0, actState.shown);
  // group rows under month headings
  let html = '', lastM = null;
  shown.forEach((x, i) => {
    const m = (x.d || '').slice(0, 7);
    if (m !== lastM) { html += `<div class="nav-label" style="padding:14px 20px 6px">${x.d ? MONTHS[+m.slice(5) - 1] + ' ' + m.slice(0, 4) : 'Undated'}</div>`; lastM = m; }
    html += `<div data-i="${i}">${txnLine(x)}</div>`;
  });
  const totals = list.reduce((a, x) => { if (x.type === 'buy') a.b += x.amt || 0; if (x.type === 'sell') { a.s += x.amt || 0; a.g += x.gain || 0; } return a; }, { b: 0, s: 0, g: 0 });
  host.innerHTML = `<div class="card-h bordered" style="row-gap:10px">
      <div class="card-t">${icon('history')}All activity</div><div class="card-sub">${fmt.int(list.length)} entries</div><div class="spacer"></div>
      <div class="input-wrap" style="width:150px">${icon('search', 'sm')}<input class="input sm" placeholder="Ticker" id="act-q" value="${esc(actState.q)}" style="text-transform:uppercase"/></div>
      <select class="select input sm" id="act-year" style="width:110px"><option value="all">All years</option>${years.map(y => `<option ${actState.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select>
    </div>
    <div class="row wrap" style="padding:12px 20px 4px;gap:6px">${[['all', 'All'], ['buy', 'Buys'], ['sell', 'Sales'], ['drip', 'Dividend reinvest'], ['event', 'Splits & events']].map(([v, l]) => `<button class="chip ${actState.type === v ? 'on' : ''}" data-type="${v}">${l}</button>`).join('')}
      <span class="spacer"></span><span class="hint">Bought ${fmt.usdCompact(totals.b)} · Sold ${fmt.usdCompact(totals.s)}${totals.g ? ` · <span class="${signCls(totals.g)}">${fmt.usdSigned(totals.g)}</span>` : ''}</span></div>
    <div class="list" id="act-list">${html || `<div class="empty">${icon('search')}<div>No matching activity.</div></div>`}</div>
    ${list.length > shown.length ? `<div style="padding:12px 20px 18px"><button class="btn ghost block" id="act-more">Show ${Math.min(100, list.length - shown.length)} more <span class="muted" style="font-weight:500">· ${fmt.int(list.length - shown.length)} left</span></button></div>` : ''}`;
  $$('#act-list > [data-i]', host).forEach(w => fillTxnText(w, [shown[+w.dataset.i]]));
  $$('[data-type]', host).forEach(b => b.onclick = () => { actState.type = b.dataset.type; actState.auto = true; fitFeed(el, years); });
  $('#act-year').onchange = e => { actState.year = e.target.value; actState.auto = true; fitFeed(el, years); };
  const qi = $('#act-q');
  qi.oninput = debounce(() => { actState.q = qi.value; actState.auto = true; fitFeed(el, years); const n = $('#act-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200);
  const more = $('#act-more'); if (more) more.onclick = () => { actState.auto = false; actState.shown += 100; drawFeed(el, years); };
}

// Shows as many feed rows as fit beside the side cards, so the two columns
// end together. On a phone (one column) it just shows the first 20.
function fitFeed(el, years) {
  const grid = $('#act-grid'), side = $('#act-side'), feed = $('#act-feed');
  const twoCol = grid && getComputedStyle(grid).gridTemplateColumns.split(' ').length > 1;
  if (!actState.auto || !twoCol || !side) { if (actState.auto) actState.shown = 20; drawFeed(el, years); return; }
  const target = side.offsetHeight;
  actState.shown = 40;
  drawFeed(el, years);
  while (actState.shown > 6 && feed.offsetHeight > target + 8) { actState.shown -= 2; drawFeed(el, years); }
}

function drawPast() {
  const host = $('#past-card'); if (!host) return;
  const list = sortBy(pastHoldings(), pastSort.key === 'held' ? p => dt.days(p.first, p.last) : pastSort.key, pastSort.dir);
  host.innerHTML = `<div class="card-h bordered"><div class="card-t">${icon('history')}Past holdings</div><div class="card-sub">Every company the fund has owned and since sold</div></div>
    <div class="table-wrap" style="max-height:560px"><table class="t"><thead><tr>
      ${thSort('Company', 't', pastSort, 'left')}${thSort('First bought', 'first', pastSort)}${thSort('Last sold', 'last', pastSort)}${thSort('Held', 'held', pastSort)}
      ${thSort('Invested', 'invested', pastSort)}${thSort('Proceeds', 'proceeds', pastSort)}${thSort('Realized gain', 'gain', pastSort)}${thSort('Return', 'ret', pastSort)}</tr></thead>
    <tbody>${list.map(p => `<tr class="click" data-t="${esc(p.t)}"><td class="left"><div class="tk">${tkLogo(p.t)}<span class="tk-name">${esc(p.t)}</span>${p.missing ? ' <span class="badge warn" title="A sale in the ledger has no price recorded">incomplete</span>' : ''}</div></td>
      <td class="muted">${dt.monYr(p.first)}</td><td class="muted">${dt.monYr(p.last)}</td><td class="muted">${dt.span(p.first, p.last)}</td>
      <td>${fmt.usd(p.invested, 0)}</td><td>${fmt.usd(p.proceeds, 0)}</td><td class="${signCls(p.gain)} strong">${fmt.usdSigned(p.gain)}</td><td class="${signCls(p.ret)}">${p.ret != null ? fmt.pct(p.ret, 1) : '—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="chart-foot">${icon('info')}Invested includes reinvested dividends. Return = realized gain ÷ invested. A rough measure that ignores how long the money was in.</div>`;
  wireSort(host, pastSort, drawPast);
  $$('tr[data-t]', host).forEach(r => r.onclick = () => go('stock/' + r.dataset.t));
}

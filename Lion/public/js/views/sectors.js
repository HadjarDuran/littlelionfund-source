// ---------------------------------------------------------------------------
// views/sectors.js — sector overview (each LLF sector vs. its SPDR sector
// ETF and vs. its target weight) and the per-sector detail page.
// ---------------------------------------------------------------------------

let secRange = store.get('llf_sec_range', '1Y');

function sectorBench(s) { return (SECTORS[s]?.etf) || ['SPY']; }
function sectorBenchSeries(s) { return blendIndex(sectorBench(s)); }
function sectorBenchName(s) { const e = sectorBench(s); return e.length > 1 ? e.join(' + ') + ' (blend)' : benchName(e[0]); }

VIEWS.sectors = {
  head(params) {
    return params[0] ? { title: params[0], sub: 'Sector', back: 'sectors' } : { title: 'Sectors', sub: `${bySector().length} sectors` };
  },
  render(el, params) {
    if (params[0]) return renderSectorDetail(el, params[0]);
    const groups = bySector();
    const targets = Object.fromEntries((S.weightings || []).map(w => [w.s, w]));
    // load every sector benchmark once
    const need = [...new Set(groups.flatMap(g => sectorBench(g.s)))].filter(t => !histOf(t) && !S.histErr[t]);
    need.forEach(t => getHist(t));

    el.innerHTML = `<div class="view stack">
      <div class="card"><div class="card-h"><div><div class="card-t">${icon('target')}Sector returns vs. sector benchmarks</div>
        <div class="card-sub">Time-weighted return of each sector's current holdings vs. its SPDR sector ETF (price return)</div></div><div class="spacer"></div><div id="sec-range"></div></div>
        <div id="sec-table" style="padding-top:10px"></div></div>
      <div class="stk-grid stagger" id="sec-cards" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))"></div>
    </div>`;
    $('#sec-range').innerHTML = seg('srange', ['1M', '3M', 'YTD', '1Y', '3Y', '5Y'], secRange);
    onSeg(el, 'srange', v => { secRange = v; store.set('llf_sec_range', v); drawTable(); });

    function drawTable() {
      const rows = groups.map(g => {
        const idx = holdingsReturnIndex(g.pos.filter(p => histOf(p.t)));
        const end = idx.length ? idx[idx.length - 1].d : null;
        const from = end ? rangeStart(secRange, end) : null;
        // Younger than the window? Measure both sides from the first purchase instead.
        const since = idx.length && from && idx[0].d > from ? idx[0].d : null;
        const r = periodReturn(idx, since || from, end);
        const b = sectorBenchSeries(g.s);
        const bStale = b && end && dt.days(b[b.length - 1].d, end) > 5;
        const br = b && end && !bStale ? periodReturn(b, since || from, end) : null;
        const tw = targets[g.s];
        return { ...g, r, br, since, loading: !idx.length, diff: r != null && br != null ? r - br : null, target: tw ? +tw.p : null, sp: tw ? +tw.sp : null };
      });
      $('#sec-table').innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th class="left">Sector</th><th>LLF return</th><th>Benchmark</th><th>Difference</th><th>Weight</th><th>Target</th><th>S&amp;P 500 weight</th><th>Value</th></tr></thead><tbody>
        ${rows.map(r => `<tr class="click" data-s="${esc(r.s)}"><td class="left"><span class="row" style="gap:9px"><span class="dot" style="background:${sectorColor(r.s)}"></span><span class="strong">${esc(r.s)}</span></span></td>
          <td class="${signCls(r.r)} strong">${r.r != null ? fmt.pct(r.r, 1) + (r.since ? ` <span class="badge" title="Holdings in this sector were bought less than ${RANGE_LABEL[secRange].toLowerCase()} ago. Both sides are measured from the first purchase">since ${dt.monYr(r.since)}</span>` : '') : r.loading ? '<span class="skel" style="display:inline-block;width:40px;height:12px"></span>' : '<span class="muted">—</span>'}</td>
          <td class="${signCls(r.br)}" title="${esc(sectorBenchName(r.s))}">${r.br != null ? fmt.pct(r.br, 1) : '<span class="muted">—</span>'} <span class="badge" style="margin-left:4px">${esc(sectorBench(r.s).join('+'))}</span></td>
          <td>${r.diff != null ? `<span class="pill ${r.diff >= 0 ? 'pos' : 'neg'}">${arrowIcon(r.diff)}${Math.abs(r.diff).toFixed(1)} pts</span>` : '—'}</td>
          <td>${r.weight.toFixed(1)}%</td><td class="muted">${r.target != null ? r.target + '%' : '—'}</td><td class="muted">${r.sp != null ? r.sp + '%' : '—'}</td><td class="strong">${fmt.usd(r.val, 0)}</td></tr>`).join('')}
      </tbody></table></div><div class="chart-foot">${icon('info')}Weight = share of invested money (excludes cash). Targets and S&amp;P weights come from the Weightings page.</div>`;
      $$('tr[data-s]', el).forEach(tr => tr.onclick = () => go('sectors/' + encodeURIComponent(tr.dataset.s)));
    }

    function drawCards() {
      $('#sec-cards').innerHTML = groups.map(g => `<a class="card stk interactive" href="#/sectors/${encodeURIComponent(g.s)}" style="color:inherit;padding:16px 18px 12px">
        <div class="row"><span class="sq" style="background:${sectorColor(g.s)};width:12px;height:12px"></span><span class="strong" style="font-size:15px">${esc(g.s)}</span><span class="spacer"></span><span class="badge">${g.n} holding${g.n > 1 ? 's' : ''}</span></div>
        <div class="row" style="align-items:flex-end;margin-top:6px"><div><div class="kpi-value tabular" style="font-size:20px">${fmt.usd(g.val, 0)}</div>
          <div class="kpi-foot"><span class="${signCls(g.pnl)} strong">${fmt.usdSigned(g.pnl)} (${fmt.pct(g.pnlPct, 1)})</span> total</div></div>
          <span class="spacer"></span><div style="text-align:right"><div class="kpi-label" style="justify-content:flex-end">Today</div><div class="${signCls(g.day)} strong tabular">${fmt.usdSigned(g.day)}</div></div></div>
        <div class="stk-spark" data-sec="${esc(g.s)}" style="height:54px"></div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${sortBy(g.pos, 'val', 'desc').slice(0, 6).map(p => `<span class="badge">${esc(p.t)}</span>`).join('')}</div></a>`).join('');
      $$('[data-sec]', el).forEach(s => {
        const g = groups.find(x => x.s === s.dataset.sec);
        const idx = holdingsReturnIndex(g.pos.filter(p => histOf(p.t)));
        if (idx.length < 2) { s.innerHTML = '<div class="skel" style="height:54px"></div>'; return; }
        sparkline(s, sliceSeries(idx, dt.addMonths(idx[idx.length - 1].d, -3)), sectorColor(g.s), { height: 54, baseline: true });
      });
    }
    drawTable(); drawCards();
    const onHist = debounce(() => { if (document.body.contains(el.firstChild)) { drawTable(); } }, 200);
    histListeners.add(onHist);
    return () => histListeners.delete(onHist);
  },
};

function renderSectorDetail(el, sector) {
  const g = bySector().find(x => x.s === sector);
  if (!g) { el.innerHTML = `<div class="view card empty">${icon('layers')}<div>No holdings in ${esc(sector)}.</div></div>`; return; }
  sectorBench(sector).forEach(t => getHist(t));
  const tw = (S.weightings || []).find(w => w.s === sector);
  el.innerHTML = `<div class="view stack">
    <div class="grid g-4 stagger">
      <div class="card kpi"><div class="kpi-label">${icon('wallet')}Market value</div><div class="kpi-value tabular">${cu(g.val)}</div><div class="kpi-foot">${g.weight.toFixed(1)}% of invested${tw ? ` · target ${tw.p}%` : ''}</div></div>
      <div class="card kpi"><div class="kpi-label">${icon('trending-up')}Unrealized gain</div><div class="kpi-value tabular ${signCls(g.pnl)}">${cu(g.pnl, 'usdSigned')}</div><div class="kpi-foot">${fmt.pct(g.pnlPct)} on ${fmt.usd(g.cost, 0)} cost</div></div>
      <div class="card kpi"><div class="kpi-label">${icon('calendar')}Today</div><div class="kpi-value tabular ${signCls(g.day)}">${cu(g.day, 'usdSigned')}</div><div class="kpi-foot">${g.n} holdings</div></div>
      <div class="card kpi"><div class="kpi-label">${icon('target')}Benchmark</div><div class="kpi-value" style="font-size:18px">${esc(sectorBench(sector).join(' + '))}</div><div class="kpi-foot">${esc(sectorBenchName(sector))}</div></div>
    </div>
    <div id="sec-chart"></div>
    <div class="card"><div class="card-h bordered"><div class="card-t">${icon('briefcase')}Holdings in ${esc(sector)}</div></div>
      <div class="table-wrap"><table class="t"><thead><tr><th class="left">Holding</th><th>Price</th><th>Today</th><th>Value</th><th>Gain / loss</th><th>Share of sector</th></tr></thead><tbody>
      ${sortBy(g.pos, 'val', 'desc').map(p => `<tr class="click" data-t="${esc(p.t)}"><td class="left"><div class="tk">${tkLogo(p.t)}<div><div class="tk-name">${esc(p.t)}</div><div class="tk-sub">${esc(p.n || '')}</div></div></div></td>
        <td>${fmt.usd(p.price)}</td><td class="${signCls(p.dayPct)}">${fmt.pct(p.dayPct)}</td><td class="strong">${fmt.usd(p.val)}</td><td class="${signCls(p.pnl)}">${fmt.usdSigned(p.pnl)} <small>(${fmt.pct(p.pnlPct, 1)})</small></td>
        <td><div class="bar-cell"><span class="muted">${(p.val / g.val * 100).toFixed(1)}%</span><span class="mini-bar"><i style="width:${p.val / g.val * 100}%;background:${sectorColor(sector)}"></i></span></div></td></tr>`).join('')}
      </tbody></table></div></div>
  </div>`;
  $$('tr[data-t]', el).forEach(r => r.onclick = () => go('stock/' + r.dataset.t));
  const benchKey = 'SECTOR_BENCH';
  const card = chartCard($('#sec-chart'), {
    id: 'sector', title: `${sector} vs. benchmark`, titleIcon: 'chart-line', height: 360,
    defaults: { range: '1Y', mode: 'pct', compare: [] },
    extraCompare: [{ t: benchKey, name: `This sector: ${sectorBenchName(sector)}` }],
    build(ctx) {
      const idx = ctx.mode === 'pct' ? holdingsReturnIndex(g.pos.filter(p => histOf(p.t))) : holdingsValueSeries(g.pos.filter(p => histOf(p.t)));
      if (idx.length < 2) return { series: [], empty: 'Loading price history…' };
      const end = ctx.to || idx[idx.length - 1].d;
      const from = ctx.from || rangeStart(ctx.range, end);
      const b = sectorBenchSeries(sector);
      return {
        series: [
          { key: 'sec', name: `LLF ${SECTORS[sector]?.short || sector}`, color: sectorColor(sector), points: sliceSeries(idx, from, ctx.to), primary: true },
          ...(b && ctx.compare.includes(benchKey) ? [{ key: benchKey, name: sectorBenchName(sector), points: sliceSeries(b, from, ctx.to), dashed: true, color: 'var(--text-2)', removable: true }] : []),
          ...compareSeries({ ...ctx, compare: ctx.compare.filter(t => t !== benchKey && !sectorBench(sector).includes(t)) }, from, ctx.to),
        ],
        note: ctx.mode === 'pct' ? `Time-weighted return of this sector's current holdings. Compare → "This sector" adds ${sectorBenchName(sector)} (price return).` : 'Market value of this sector\'s current holdings from each purchase date.',
      };
    },
  });
  return () => card.destroy();
}

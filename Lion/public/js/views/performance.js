// ---------------------------------------------------------------------------
// views/performance.js — Performance page, stock detail page (#/stock/T),
// and two pieces the Overview reuses: portfolioBuild() (the fund/holdings
// chart series) and benchReturns() (the fund-vs-benchmarks returns table).
// ---------------------------------------------------------------------------

// "Unit value" is the fund's actual record and the default. "Today's
// holdings" re-prices the current portfolio back in time: useful for 1D/1W
// and for seeing how today's picks have done, but over long ranges it's a
// what-if that leaves out every stock the fund sold along the way and the
// cash it held, so it reads far better than the fund really did.
const PORTFOLIO_SOURCES = [
  ['fund', 'Unit value', 'The fund\'s actual return: recorded month-end unit value since 2012, plus today\'s live value'],
  ['holdings', 'Today\'s holdings', 'What-if: today\'s holdings priced back to when each position was bought. Not the fund\'s actual return'],
];
RANGE_LABEL.BUY = 'Since first buy';

function portfolioBuild(ctx) {
  if (isIntraRange(ctx.range)) {
    // The unit value is monthly, so 1D/1W always show today's holdings.
    const out = intradayBuild(positions(), ctx, 'LLF holdings');
    if (ctx.source === 'fund' && out.series?.length) out.note = 'The unit value is recorded monthly, so 1D and 1W show today\'s holdings. ' + (out.note || '');
    return out;
  }
  if (ctx.source === 'fund') {
    const base = fundSeries();
    if (base.length < 2) return { series: [], empty: 'No unit value history recorded yet' };
    const end = ctx.to || base[base.length - 1].d;
    const from = ctx.from || rangeStart(ctx.range, end);
    const pts = sliceSeries(base, from, ctx.to);
    const dates = pts.map(p => p.d);
    return {
      series: [{ key: 'fund', name: 'LLF unit value', points: pts, primary: true }, ...compareSeries(ctx, from, ctx.to, dates)],
      fmt: v => '$' + v.toFixed(v < 100 ? 2 : 0),
      note: 'Month-end unit value as recorded by the fund (includes cash and every past holding). Benchmarks are sampled on the same dates, price return only.',
    };
  }
  const pos = positions().filter(p => histOf(p.t));
  const raw = ctx.mode === 'pct' ? holdingsReturnIndex(pos) : holdingsValueSeries(pos);
  if (!raw.length) return { series: [], empty: S.hold.length ? 'Loading price history…' : 'No holdings yet' };
  const end = ctx.to || raw[raw.length - 1].d;
  const from = ctx.from || rangeStart(ctx.range, end);
  // Beyond a year this line is mostly hindsight: a stock bought in 2012 and
  // still held counts its whole run, while the ones sold at a loss vanish.
  const long = !from || dt.days(from, end) > 400;
  return {
    series: [{ key: 'hold', name: 'Today\'s holdings (what-if)', points: sliceSeries(raw, from, ctx.to), primary: true }, ...compareSeries(ctx, from, ctx.to)],
    warn: long ? 'What-if, not the fund\'s return' : null,
    note: long ? 'Only the stocks the fund owns today, priced back to when each was bought. It leaves out every stock that was sold (including the losers) and the cash, so over long periods it looks far better than the fund did. For the fund\'s actual return, switch to Unit value.'
      : ctx.mode === 'pct'
      ? 'Time-weighted return of today\'s holdings: buying a new position adds value but doesn\'t count as a gain. Excludes cash. Benchmarks are price return.'
      : 'Market value of today\'s holdings from each purchase date. Steps up where a new position was bought. Compared lines show the same starting amount invested in each benchmark.',
  };
}

// Fund vs benchmark returns over standard periods, measured on the fund's own
// month-end unit value dates so every row covers exactly the same window.
const BENCH_PERIODS = [['1M', 1], ['3M', 3], ['YTD', 'ytd'], ['1Y', 12], ['3Y', 36], ['5Y', 60], ['ITD', null]];
function benchReturns(el, { tickers = ['SPY', 'QQQ', 'DIA'], periods = BENCH_PERIODS } = {}) {
  const fs = fundSeries();
  if (fs.length < 2) { el.innerHTML = '<div class="empty">No unit value history yet.</div>'; return; }
  tickers.forEach(t => { if (!histOf(t) && !S.histErr[t]) getHist(t).then(() => { if (document.body.contains(el)) benchReturns(el, { tickers, periods }); }); });
  const end = fs[fs.length - 1].d, start = fs[0].d;
  // Start point for each period: the last recorded month at/before the target
  // date, but only if it's within 40 days of it. A gap in the record must
  // show "—", not quietly turn "1M" into a nine-month return.
  // (If the month before is missing or left out as a typo, the month after
  // is used instead when it's just as close; the cell's tooltip gives the date.)
  const near = target => {
    const i = bisectDate(fs, target);
    const c = [fs[i], fs[i + 1]].filter(x => x && Math.abs(dt.days(x.d, target)) <= 40 && !x.live);
    c.sort((a, b) => Math.abs(dt.days(a.d, target)) - Math.abs(dt.days(b.d, target)) || (a.d < b.d ? -1 : 1));
    return c.length ? c[0].d : null;
  };
  const win = p => p === null ? start : p === 'ytd' ? near(dt.addDays(end.slice(0, 4) + '-01-01', -1)) : near(dt.addMonths(end, -p));
  const froms = periods.map(([, p]) => win(p));
  const row = (name, series, primary, tk) => {
    // A benchmark whose prices stopped updating can't be measured "to today".
    const staleEnd = !primary && series && dt.days(series[series.length - 1].d, end) > 5 ? series[series.length - 1].d : null;
    const cells = periods.map(([lbl, p], k) => {
      if (staleEnd) return '<td class="muted">—</td>';
      const f = froms[k];
      if (!series && S.histErr[tk]) return '<td class="muted">—</td>';
      if (!series) return `<td><span class="skel" style="display:inline-block;width:44px;height:12px"></span></td>`;
      if (!f || (p !== null && f < start)) return '<td class="muted">—</td>';
      const r = periodReturn(series, f, end);
      if (r == null) return '<td class="muted">—</td>';
      // Total return, plus the compounded rate per year for longer periods,
      // so "5Y" can't be misread (+6.3% a year is +36% in total).
      const yrs = dt.days(f, end) / 365.25;
      const py = yrs > 1.05 ? annualize(r, f, end) : null;
      return `<td class="${signCls(r)} ${primary ? 'strong' : ''}" title="${p === null ? 'Since ' + dt.long(f) : 'From ' + dt.long(f)}">${fmt.pct(r, 1)}${py != null ? `<div class="ret-py">${fmt.pct(py, 1)}/yr</div>` : ''}</td>`;
    }).join('');
    return `<tr><td class="left"><span class="row" style="gap:8px">${primary ? `<span class="sq" style="background:var(--s1)"></span>` : '<span class="sq" style="background:var(--border-strong)"></span>'}<span class="${primary ? 'strong' : ''}">${esc(name)}</span>${staleEnd ? ` <span class="badge warn" title="The price source hasn't sent anything newer, so returns to today can't be measured yet">prices thru ${dt.short(staleEnd)}</span>` : ''}</span></td>${cells}</tr>`;
  };
  el.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th class="left">As of ${fs[fs.length - 1].live ? 'today (live)' : dt.long(end)}</th>${periods.map(([l, p]) => `<th title="${p === null ? 'Since inception (' + dt.monYr(start) + ')' : ''}">${l}</th>`).join('')}</tr></thead>
    <tbody>${row('Little Lion Fund', fs, true)}${tickers.map(t => row(benchName(t), priceSeries(t), false, t)).join('')}</tbody></table></div>
    <div class="chart-foot">${icon('info')}<span>Total return over each period; under it, the same return per year (compounded) for periods over a year. Fund = month-end unit value, plus today's live value; it includes dividends. Benchmarks = ETF price only, on the same dates (dividends would add roughly 1.5–2% a year).${uvSpikes().length ? ` Left out as likely typos: ${uvSpikes().map(r => `${dt.monYr(r.d)} (${fmt.usd(r.u)})`).join(', ')}. <a href="#/unitvalue">Check on Unit Value</a>.` : ''}</span></div>`;
}

// ------------------------------------------------------------- Performance
VIEWS.performance = {
  head: () => ({ title: 'Performance', sub: S.hold.length ? `${S.hold.length} holdings` : '' }),
  render(el) {
    el.innerHTML = `<div class="view stack">
      <div id="perf-chart"></div>
      <div class="card"><div class="card-h"><div class="card-t">${icon('trophy')}Returns vs. benchmarks</div></div>
        <div id="perf-bench" style="padding-top:8px"></div></div>
      <div class="card"><div class="card-h"><div class="card-t">${icon('briefcase')}Holdings</div><div class="spacer"></div>
        <div id="perf-sort"></div></div>
        <div class="card-b"><div class="stk-grid stagger" id="perf-grid"></div></div></div>
    </div>`;
    const card = chartCard($('#perf-chart'), {
      id: 'perf', title: 'Fund performance', titleIcon: 'chart-line', height: 420,
      sources: PORTFOLIO_SOURCES, defaults: { range: '5Y', mode: 'pct', compare: ['SPY'], source: 'fund' },
      build: portfolioBuild, intraday: true, version: 3,
    });
    benchReturns($('#perf-bench'), { tickers: ['SPY', 'QQQ', 'DIA', 'IWM'] });
    const sortState = store.get('llf_perf_sort', 'weight');
    const drawGrid = by => {
      const pos = sortBy(positions(), by === 'day' ? 'dayPct' : by === 'ret' ? 'pnlPct' : by === 't' ? 't' : 'val', by === 't' ? 'asc' : 'desc');
      $('#perf-grid').innerHTML = pos.map(p => `<a class="card stk interactive" href="#/stock/${encodeURIComponent(p.t)}" style="color:inherit">
        <div class="stk-top">${tkLogo(p.t)}<div style="min-width:0"><div class="tk-name">${esc(p.t)}</div><div class="tk-sub">${esc(p.n || '')}</div></div>
          <div class="stk-price"><div class="strong tabular">${p.hasPrice ? fmt.usd(p.price) : '—'}</div><div class="${signCls(p.dayPct)} tabular" style="font-size:12px;font-weight:700">${p.hasPrice ? fmt.pct(p.dayPct) : ''}</div></div></div>
        <div class="stk-spark" data-spark="${esc(p.t)}"></div>
        <div class="row" style="justify-content:space-between;font-size:12px"><span class="muted">Total return</span><span class="${signCls(p.pnl)} strong tabular">${fmt.pct(p.pnlPct)}</span></div>
      </a>`).join('');
      $$('[data-spark]').forEach(s => {
        const ser = priceSeries(s.dataset.spark);
        const pts = ser ? sliceSeries(ser, dt.addMonths(ser[ser.length - 1].d, -3)) : null;
        const up = pts && pts.length > 1 && pts[pts.length - 1].v >= pts[0].v;
        if (pts) sparkline(s, pts, up ? 'var(--pos)' : 'var(--neg)', { height: 46, baseline: true });
        else s.innerHTML = '<div class="skel" style="height:46px"></div>';
      });
    };
    $('#perf-sort').innerHTML = seg('psort', [['weight', 'Value'], ['day', 'Today'], ['ret', 'Return'], ['t', 'A–Z']], sortState);
    onSeg(el, 'psort', v => { store.set('llf_perf_sort', v); drawGrid(v); });
    drawGrid(sortState);
    return () => card.destroy();
  },
};

// ------------------------------------------------------------ Stock detail
VIEWS.stock = {
  head(params) {
    const t = params[0] || '';
    const h = S.hold.find(x => x.t === t);
    return { title: t, sub: h ? h.n : 'Past holding', back: 'performance' };
  },
  render(el, params) {
    const t = (params[0] || '').toUpperCase();
    const p = positions().find(x => x.t === t);
    const trades = txnsFor(t);
    if (!p && !trades.length) { el.innerHTML = `<div class="view card empty">${icon('search')}<div>No holding or trade history for ${esc(t)}.</div></div>`; return; }
    if (!histOf(t) && !S.histErr[TICKER_ALIASES[t] || t]) getHist(t).then(h => { if (h && route.view === 'stock' && route.params[0] === t) render({ quiet: true }); });
    const firstBuy = [...trades].reverse().find(x => x.type === 'buy')?.d || p?.d;
    const sector = p?.s;
    const stat = (label, value, cls = '') => `<div><div class="kpi-label">${label}</div><div class="strong tabular ${cls}" style="font-size:16px;margin-top:2px">${value}</div></div>`;
    const sold = trades.filter(x => x.type === 'sell');
    const realizedT = sold.reduce((s, x) => s + (x.gain || 0), 0);
    const ser = priceSeries(t);
    const lastPx = p?.price || (ser ? ser[ser.length - 1].v : null);

    el.innerHTML = `<div class="view stack">
      <div class="card hero">
        <div class="hero-top">
          ${tkLogo(t, 52)}
          <div style="min-width:0;flex:1">
            <div class="hero-label">${p ? esc(p.n || t) : sold[0] ? `Sold ${dt.long(sold[0].d)}` : ''} ${sector ? `<span class="badge"><span class="dot" style="background:${sectorColor(sector)};width:7px;height:7px"></span>${esc(sector)}</span>` : '<span class="badge">No longer held</span>'}</div>
            <div class="hero-value tabular" id="stk-px">${lastPx ? cu(lastPx) : '—'}</div>
            <div class="hero-chg">${p && p.hasPrice ? chgPill(p.dayPct, `${fmt.usdSigned(p.price - p.pc).replace('+', '')} (${fmt.pct(p.dayPct)})`) + '<span class="muted" style="font-weight:500">today</span>' : ser ? `<span class="muted" style="font-weight:500">Last close ${dt.long(ser[ser.length - 1].d)}</span>` : ''}</div>
          </div>
        </div>
        <div class="grid g-4" style="margin:18px 0 14px;gap:16px 24px">
          ${p ? stat('Shares', fmt.shares(p.sh)) + stat('Avg. cost', fmt.usd(p.ac)) + stat('Market value', fmt.usd(p.val)) + stat('Unrealized', `${fmt.usdSigned(p.pnl)} <small>(${fmt.pct(p.pnlPct)})</small>`, signCls(p.pnl))
              + stat('Portfolio weight', fmt.pctPlain(p.weight, 2)) + stat('Held since', p.since ? dt.long(p.since) : '—') + stat('<span title="Total % gain ÷ years held (360-day years), as on the fund spreadsheet. In brackets: compounded per year, after a full year held">Annual %</span>', p.annual != null ? `${fmt.pct(p.annual, 1)}${p.cagr != null ? ` <small class="muted">(${fmt.pct(p.cagr, 1)} cmpd.)</small>` : ''}` : '—', signCls(p.annual)) + stat('1-year price change', p.ttm != null ? fmt.pct(p.ttm) : '—', signCls(p.ttm))
            : stat('First bought', firstBuy ? dt.long(firstBuy) : '—') + stat('Last sold', sold[0] ? dt.long(sold[0].d) : '—') + stat('Realized gain', fmt.usdSigned(realizedT), signCls(realizedT)) + stat('Trades', trades.length)}
        </div>
        ${p && (p.vlSafety || p.vlTimeliness) ? `<div class="row wrap" style="margin-bottom:12px">${p.vlSafety ? `<span class="badge">${icon('shield', 'xs')}Value Line Safety ${p.vlSafety}</span>` : ''}${p.vlTimeliness ? `<span class="badge">${icon('clock', 'xs')}Value Line Timeliness ${p.vlTimeliness}</span>` : ''}</div>` : ''}
      </div>
      <div id="stk-chart"></div>
      <div class="card"><div class="card-h bordered"><div class="card-t">${icon('history')}Trade history</div><div class="card-sub">${trades.length} entries${realizedT ? ` · realized ${fmt.usdSigned(realizedT)}` : ''}</div>
        <div class="spacer"></div><label class="row hint" style="gap:6px;cursor:pointer"><input type="checkbox" id="stk-drip" ${store.get('llf_show_drip') ? 'checked' : ''}/> Show dividend reinvestments</label></div>
        <div id="stk-trades"></div></div>
    </div>`;

    const showDrip = () => !!store.get('llf_show_drip');
    const markers = () => trades.filter(x => (x.type === 'buy' && (!x.drip || showDrip())) || x.type === 'sell').map(x => ({
      d: x.d, type: x.type,
      text: `${x.type === 'buy' ? (x.drip ? 'Reinvested' : 'Bought') : 'Sold'} ${fmt.shares(x.sh)} sh${x.px ? ' @ ' + fmt.usd(x.px) : ''}${x.gain != null && x.type === 'sell' ? ` · ${fmt.usdSigned(x.gain)} gain` : ''}`,
    }));
    const etf = sector ? SECTORS[sector]?.etf?.[0] : null;
    const ranges = [...RANGES, ...(firstBuy ? ['BUY'] : [])];
    const card = chartCard($('#stk-chart'), {
      id: p ? 'stock' : 'stock-past', title: `${t} price`, titleIcon: 'chart-line', height: 380, ranges,
      defaults: { range: p ? '1Y' : 'BUY', mode: 'value', compare: [] },
      intraday: true,
      build(ctx) {
        if (isIntraRange(ctx.range)) {
          const r = intradayBuild([{ t, sh: 1 }], ctx, t);
          return { ...r, fmt: v => '$' + (v >= 1000 ? fmt.int(v) : v.toFixed(2)) };
        }
        const s = priceSeries(t);
        if (!s) return { series: [], empty: S.histErr[TICKER_ALIASES[t] || t] ? `No price history available for ${esc(t)}` : 'Loading price history…' };
        const end = ctx.to || s[s.length - 1].d;
        const from = ctx.range === 'BUY' ? dt.addDays(firstBuy, -1) : ctx.from || rangeStart(ctx.range, end);
        return {
          series: [{ key: t, name: t, points: sliceSeries(s, from, ctx.to), primary: true }, ...compareSeries(ctx, from, ctx.to)],
          markers: markers(), fmt: v => '$' + (v >= 1000 ? fmt.int(v) : v.toFixed(2)),
          note: `B / S markers are the fund's trades from the activity ledger${etf ? `. Sector benchmark: ${benchName(etf)}` : ''}.`,
        };
      },
    });

    const drawTrades = () => {
      const list = trades.filter(x => showDrip() || !x.drip);
      $('#stk-trades').innerHTML = list.length ? `<div class="table-wrap" style="max-height:480px"><table class="t"><thead><tr><th class="left">Date</th><th class="left">Type</th><th>Shares</th><th>Price</th><th>Amount</th><th>Realized gain</th></tr></thead><tbody>
        ${list.map(x => `<tr><td class="left muted">${x.d ? dt.long(x.d) : '—'}${x.est ? ' <span class="badge warn" title="The ledger row had no date; the previous lot\'s date is used">est.</span>' : ''}</td>
          <td class="left">${txnBadge(x)}</td><td>${x.sh != null ? fmt.shares(x.sh) : '—'}</td><td>${x.px ? fmt.usd(x.px) : '—'}</td><td>${x.amt != null ? fmt.usd(x.amt) : x.noPx ? '<span class="muted" title="Not recorded in the ledger">not recorded</span>' : '—'}</td>
          <td class="${signCls(x.gain)}">${x.type === 'sell' && x.gain != null ? fmt.usdSigned(x.gain) : ''}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">${icon('history')}<div>No trades recorded for ${esc(t)}.</div></div>`;
    };
    drawTrades();
    $('#stk-drip').onchange = e => { store.set('llf_show_drip', e.target.checked); drawTrades(); card.redraw(); };
    return () => card.destroy();
  },
};

function txnBadge(x) {
  if (x.type === 'buy') return `<span class="badge buy">${icon(x.drip ? 'rotate-ccw' : 'arrow-down-to-line', 'xs')}${x.drip ? 'Reinvest' : 'Buy'}</span>${x.src === 'app' ? ' <span class="badge" title="Recorded in this app">app</span>' : ''}`;
  if (x.type === 'sell') return `<span class="badge sell">${icon('arrow-up-from-line', 'xs')}Sell</span>${x.src === 'app' ? ' <span class="badge" title="Recorded in this app">app</span>' : ''}`;
  if (x.type === 'split') return `<span class="badge">${icon('split', 'xs')}Split${x.ratio ? ' ' + esc(x.ratio) : ''}</span>`;
  if (x.type === 'spinoff') return `<span class="badge">${icon('git-compare', 'xs')}Spinoff</span>`;
  if (x.type === 'basis_adj') return `<span class="badge">${icon('receipt', 'xs')}Basis adj.</span>`;
  return `<span class="badge">${icon('info', 'xs')}Note</span>`;
}

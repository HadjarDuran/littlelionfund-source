// ---------------------------------------------------------------------------
// views/debrief.js — Sector debrief, for the morning meeting.
//
//   #/debrief/<sector>/<ticker>
//
// A sector manager steps through every stock in their sector (left) while
// the whole sector stays on screen (right): its value, today's move, its
// weight vs. target vs. the S&P, and a composition bar where each stock's
// width is its actual share of the sector. The focused stock's chart is
// drawn against the sector as a whole, weighted by what the fund holds.
//
// Keys: ↑ / ↓ (or K / J) previous / next stock, ← / → previous / next sector.
// Switching stocks updates the page in place (no reload, URL kept current).
// ---------------------------------------------------------------------------

const DEBRIEF_ETF = 'SECTOR_ETF';

VIEWS.debrief = {
  head(params) {
    const s = debriefSector(params);
    return { title: 'Sector debrief', sub: s ? s : '' };
  },
  render(el, params) {
    const groups = bySector();
    if (!groups.length) { el.innerHTML = `<div class="view card empty">${icon('layers')}<div>No holdings yet.</div></div>`; return; }
    const sector = debriefSector(params);
    const g = groups.find(x => x.s === sector);
    const stocks = sortBy(g.pos, 'val', 'desc');
    let focusT = stocks.some(p => p.t === params[1]) ? params[1] : stocks[0].t;
    store.set('llf_debrief_sector', sector);
    sectorBench(sector).forEach(t => getHist(t));
    const si = groups.findIndex(x => x.s === sector);
    const color = sectorColor(sector);

    el.innerHTML = `<div class="view">
      <div class="card db-bar">
        <button class="icon-btn" data-sec-step="-1" aria-label="Previous sector" title="Previous sector (←)">${icon('chevron-left')}</button>
        <div class="db-sectors">${groups.map(x => `<button class="chip ${x.s === sector ? 'on' : ''}" data-sec="${esc(x.s)}" title="${esc(x.s)}">
          <span class="dot" style="background:${sectorColor(x.s)};width:8px;height:8px"></span>${esc(SECTORS[x.s]?.short || x.s)}<span class="muted" style="font-weight:600">${x.weight.toFixed(0)}%</span></button>`).join('')}</div>
        <button class="icon-btn" data-sec-step="1" aria-label="Next sector" title="Next sector (→)">${icon('chevron-right')}</button>
        <div class="spacer"></div>
        <span class="hint db-keys">${icon('keyboard', 'sm')} ↑↓ stocks · ←→ sectors</span>
        <button class="btn ghost sm" id="db-present" title="Full screen for the meeting">${icon('maximize', 'sm')}Present</button>
      </div>
      <div class="grid g-main mt db-grid">
        <div class="stack" id="db-left">
          <div class="card" id="db-focus"></div>
          <div id="db-chart"></div>
          <div class="card" id="db-trades"></div>
        </div>
        <div class="stack sticky-col" id="db-right">
          <div class="card" id="db-sector"></div>
          <div class="card" id="db-comp"></div>
        </div>
      </div></div>`;

    // ---- right: the sector, always in view ----
    function drawSector() {
      const t = totals(), tw = (S.weightings || []).find(w => w.s === sector);
      const prevVal = g.val - g.day, dayPct = prevVal ? g.day / prevVal * 100 : 0;
      const target = tw ? +tw.p : null, sp = tw ? +tw.sp : null;
      const toTarget = target != null ? target / 100 * t.equity - g.val : null;
      const mx = Math.max(g.weight, target || 0, sp || 0, 1) * 1.15;
      const bar = (label, v, c) => v == null ? '' : `<div class="db-wbar"><span class="muted">${label}</span><span class="db-track"><i style="width:${v / mx * 100}%;background:${c}"></i></span><b class="tabular">${v.toFixed(1)}%</b></div>`;
      // sector vs. its ETF over standard windows (daily history)
      const idx = holdingsReturnIndex(g.pos.filter(p => histOf(p.t)));
      const b = sectorBenchSeries(sector);
      const end = idx.length ? idx[idx.length - 1].d : null;
      const ret = (s, r) => { if (!s || !end) return null; const f = rangeStart(r, end); const since = s[0].d > f ? s[0].d : f; return periodReturn(s, since, end); };
      const rows = ['1M', 'YTD', '1Y'].map(r => {
        const a = ret(idx, r), e = b && end && dt.days(b[b.length - 1].d, end) <= 5 ? ret(b, r) : null;
        return `<tr><td class="left muted">${r}</td><td class="${signCls(a)} strong">${a != null ? fmt.pct(a, 1) : '—'}</td><td class="${signCls(e)}">${e != null ? fmt.pct(e, 1) : '—'}</td><td>${a != null && e != null ? `<span class="pill ${a - e >= 0 ? 'pos' : 'neg'}">${arrowIcon(a - e)}${Math.abs(a - e).toFixed(1)} pts</span>` : ''}</td></tr>`;
      }).join('');
      $('#db-sector').innerHTML = `<div class="card-h"><div class="card-t"><span class="sq" style="background:${color};width:12px;height:12px"></span>${esc(sector)}</div><div class="spacer"></div><span class="badge">${g.n} stock${g.n > 1 ? 's' : ''}</span></div>
        <div class="card-b" style="padding-top:10px">
          <div class="row" style="align-items:flex-end;gap:16px">
            <div><div class="kpi-label">Sector value</div><div class="kpi-value">${cu(g.val)}</div></div>
            <div class="spacer"></div>
            <div style="text-align:right"><div class="kpi-label" style="justify-content:flex-end">Today</div>${chgPill(g.day, `${fmt.usd(Math.abs(g.day))} (${fmt.pct(dayPct)})`)}</div>
          </div>
          <div class="db-weights">${bar('Now', g.weight, color)}${bar('Target', target, 'var(--s4)')}${bar('S&P 500', sp, 'var(--axis)')}</div>
          ${toTarget != null ? `<div class="hint">${Math.abs(toTarget) < 50 ? 'On target.' : `${toTarget > 0 ? 'Buy' : 'Trim'} about <b class="${toTarget > 0 ? 'pos' : 'neg'}">${fmt.usd(Math.abs(toTarget), 0)}</b> to reach the ${target}% target.`} Weights are shares of invested money.</div>` : ''}
          <table class="t db-ret"><thead><tr><th class="left"></th><th>Sector</th><th>${esc(sectorBench(sector).join('+'))}</th><th>Diff.</th></tr></thead><tbody>${rows}</tbody></table>
        </div>`;
    }

    function drawComp() {
      const segs = stocks.map(p => {
        const w = g.val ? p.val / g.val * 100 : 0;
        const a = Math.min(1, Math.abs(p.dayPct) / 3) * 0.75 + 0.15;
        const bg = p.dayPct >= 0 ? `color-mix(in srgb, var(--pos) ${Math.round(a * 100)}%, var(--surface))` : `color-mix(in srgb, var(--neg) ${Math.round(a * 100)}%, var(--surface))`;
        return `<button class="db-seg ${p.t === focusT ? 'on' : ''}" data-t="${esc(p.t)}" style="flex:${Math.max(w, 0.4)} 1 0;background:${bg}" title="${esc(p.t)}: ${w.toFixed(1)}% of sector · ${fmt.pct(p.dayPct)} today"><span>${w >= 10 ? esc(p.t) : ''}</span></button>`;
      }).join('');
      $('#db-comp').innerHTML = `<div class="card-h"><div><div class="card-t">${icon('chart-pie')}Inside the sector</div><div class="card-sub">Width = share of the sector by value · colour = today's move</div></div></div>
        <div class="card-b" style="padding-top:12px"><div class="db-treemap">${segs}</div></div>
        <div class="list db-list">${stocks.map((p, i) => {
          const w = g.val ? p.val / g.val * 100 : 0;
          return `<button class="li click db-row ${p.t === focusT ? 'on' : ''}" data-t="${esc(p.t)}"><span class="db-rank muted tabular">${i + 1}</span>${tkLogo(p.t, 30)}
            <div class="li-main"><div class="li-title">${esc(p.t)} <span class="muted" style="font-weight:500">${esc(p.n || '')}</span></div>
              <div class="db-mini"><span class="db-track"><i style="width:${w}%;background:${color}"></i></span><span class="tabular muted">${w.toFixed(1)}%</span></div></div>
            <div class="li-end"><div class="${signCls(p.dayPct)} strong tabular">${p.hasPrice ? fmt.pct(p.dayPct) : '—'}</div><div class="li-sub ${signCls(p.dayChg)}">${p.hasPrice ? fmt.usdSigned(p.dayChg) : ''}</div></div></button>`;
        }).join('')}</div>`;
      $$('#db-comp [data-t]').forEach(b => b.onclick = () => focus(b.dataset.t));
    }

    // ---- left: the stock being discussed ----
    function drawFocus() {
      const p = stocks.find(x => x.t === focusT);
      const i = stocks.indexOf(p);
      const prevVal = g.val - g.day;
      const impact = prevVal ? p.dayChg / prevVal * 100 : 0; // percentage points of the sector's move
      const trades = txnsFor(p.t).filter(x => !x.drip && (x.type === 'buy' || x.type === 'sell'));
      const last = trades[0];
      const stat = (label, value, cls = '', title = '') => `<div ${title ? `title="${esc(title)}"` : ''}><div class="kpi-label">${label}</div><div class="strong tabular ${cls}" style="font-size:16px;margin-top:2px">${value}</div></div>`;
      $('#db-focus').innerHTML = `<div class="db-focus-in">
        <div class="hero-top" style="align-items:center">
          ${tkLogo(p.t, 52)}
          <div style="flex:1;min-width:0">
            <div class="hero-label">${esc(p.n || p.t)} <span class="badge">${i + 1} of ${stocks.length} in ${esc(SECTORS[sector]?.short || sector)}</span>
              ${p.vlSafety ? `<span class="badge">${icon('shield', 'xs')}VL Safety ${p.vlSafety}</span>` : ''}${p.vlTimeliness ? `<span class="badge">${icon('clock', 'xs')}VL Timely ${p.vlTimeliness}</span>` : ''}</div>
            <div class="row" style="gap:14px;align-items:baseline;flex-wrap:wrap">
              <div class="hero-value tabular" style="font-size:34px">${p.hasPrice ? cu(p.price) : '—'}</div>
              ${p.hasPrice ? chgPill(p.dayPct, `${fmt.usd(Math.abs(p.price - p.pc))} (${fmt.pct(p.dayPct)})`) + '<span class="muted" style="font-weight:500">today</span>' : ''}
            </div>
          </div>
          <div class="row db-steps" style="gap:6px">
            <button class="icon-btn" data-step="-1" aria-label="Previous stock" title="Previous stock (↑)" ${i === 0 ? 'disabled' : ''}>${icon('chevron-up')}</button>
            <button class="btn primary sm" data-step="1" title="Next stock (↓)" ${i === stocks.length - 1 ? 'disabled' : ''}>Next ${icon('chevron-down', 'sm')}</button>
          </div>
        </div>
        <div class="grid g-4 db-stats">
          ${stat('Share of sector', fmt.pctPlain(g.val ? p.val / g.val * 100 : 0, 1))}
          ${stat('Share of fund', fmt.pctPlain(p.weight, 2), '', 'Market value ÷ invested total')}
          ${stat('Moved the sector', `${impact >= 0 ? '+' : MINUS}${Math.abs(impact).toFixed(2)} pts`, signCls(impact), "This stock's dollar change today as a share of the sector's value: its contribution to the sector's move")}
          ${stat('Market value', fmt.usd(p.val))}
          ${stat('Unrealized', `${fmt.usdSigned(p.pnl)} <small>(${fmt.pct(p.pnlPct, 1)})</small>`, signCls(p.pnl))}
          ${stat('Annual %', p.annual != null ? fmt.pct(p.annual, 1) : '—', signCls(p.annual), 'Total % gain ÷ years held, as on the fund spreadsheet')}
          ${stat('1-year price', p.ttm != null ? fmt.pct(p.ttm, 1) : '—', signCls(p.ttm))}
          ${stat('Held since', p.d ? dt.monYr(p.d) : '—')}
        </div>
        ${last ? `<div class="hint" style="margin-top:4px">${icon(last.type === 'buy' ? 'arrow-down-to-line' : 'arrow-up-from-line', 'xs')} Last trade: ${last.type === 'buy' ? 'bought' : 'sold'} ${fmt.shares(last.sh)} sh${last.px ? ' @ ' + fmt.usd(last.px) : ''} on ${dt.long(last.d)}</div>` : ''}
      </div>`;
      $$('#db-focus [data-step]').forEach(b => b.onclick = () => step(+b.dataset.step));
      // recent trades for this stock
      $('#db-trades').innerHTML = `<div class="card-h"><div class="card-t">${icon('history')}${esc(p.t)} trade history</div><div class="spacer"></div><a class="chip" href="#/stock/${encodeURIComponent(p.t)}">Stock page ${icon('arrow-right', 'xs')}</a></div>
        <div id="db-trade-list" style="padding-top:6px"></div>`;
      drawRecent($('#db-trade-list'), trades.slice(0, 4));
      if (!trades.length) $('#db-trade-list').innerHTML = '<div class="empty" style="padding:18px">No trades recorded for this stock.</div>';
    }

    // chart: the stock vs. the whole sector (weighted by value), optional ETF
    const etf = sectorBench(sector)[0];
    const short = SECTORS[sector]?.short || sector;
    const card = chartCard($('#db-chart'), {
      id: 'debrief', title: '', titleIcon: 'chart-line', height: 320, intraday: true,
      defaults: { range: '1W', mode: 'pct', compare: [] },
      extraCompare: [{ t: DEBRIEF_ETF, name: `Sector ETF: ${sectorBenchName(sector)}` }],
      build(ctx) {
        const t = focusT;
        const others = ctx.compare.filter(x => x !== DEBRIEF_ETF);
        const wantEtf = ctx.compare.includes(DEBRIEF_ETF);
        const secName = `${short} sector (weighted)`;
        if (isIntraRange(ctx.range)) {
          ensureIntraday([t, ...g.pos.map(p => p.t), ...(wantEtf ? [etf] : [])], ctx.range);
          const sp = intradaySeries(t, ctx.range);
          if (sp.length < 2) {
            const st = intradayStatus([t], ctx.range);
            return { series: [], empty: st.done ? 'Short-term prices aren\'t available right now. Pick a longer range.' : 'Loading short-term prices…' };
          }
          return {
            series: [
              { key: t, name: t, color: 'var(--text)', points: sp, primary: true },
              ...(g.pos.length > 1 ? [{ key: 'SEC', name: secName, color, points: holdingsIntraday(g.pos, ctx.range).points }] : []),
              ...(wantEtf ? [{ key: DEBRIEF_ETF, name: benchName(etf), points: intradaySeries(etf, ctx.range), dashed: true, color: 'var(--text-2)', removable: true }] : []),
              ...compareIntraday({ ...ctx, compare: others }),
            ],
            xIndex: true,
            note: `${ctx.range === '1D' ? '5-minute' : '15-minute'} prices, New York time. The sector line is every ${short} holding combined by what the fund owns of each.`,
          };
        }
        const s = priceSeries(t);
        if (!s) return { series: [], empty: S.histErr[TICKER_ALIASES[t] || t] ? `No price history for ${t}` : 'Loading price history…' };
        const end = ctx.to || s[s.length - 1].d;
        const from = ctx.from || rangeStart(ctx.range, end);
        const idx = holdingsReturnIndex(g.pos.filter(p => histOf(p.t)));
        const b = wantEtf ? sectorBenchSeries(sector) : null;
        return {
          series: [
            { key: t, name: t, color: 'var(--text)', points: sliceSeries(s, from, ctx.to), primary: true },
            ...(g.pos.length > 1 && idx.length ? [{ key: 'SEC', name: secName, color, points: sliceSeries(idx, from, ctx.to) }] : []),
            ...(b ? [{ key: DEBRIEF_ETF, name: sectorBenchName(sector), points: sliceSeries(b, from, ctx.to), dashed: true, color: 'var(--text-2)', removable: true }] : []),
            ...compareSeries({ ...ctx, compare: others }, from, ctx.to),
          ],
          markers: txnsFor(t).filter(x => (x.type === 'buy' && !x.drip) || x.type === 'sell').map(x => ({ d: x.d, type: x.type, text: `${x.type === 'buy' ? 'Bought' : 'Sold'} ${fmt.shares(x.sh)} sh${x.px ? ' @ ' + fmt.usd(x.px) : ''}` })),
          note: `The sector line is every ${short} holding combined by what the fund owns of each (time-weighted). Compare → "Sector ETF" adds ${sectorBenchName(sector)}.`,
        };
      },
    });
    const setChartTitle = () => { const tt = el.querySelector('#db-chart .cc-title'); if (tt) tt.textContent = `${focusT} vs. the ${short} sector`; };
    setChartTitle();

    // ---- stepping ----
    function focus(t, animate = true) {
      if (t === focusT || !stocks.some(p => p.t === t)) return;
      focusT = t;
      route.params = [sector, t];
      history.replaceState(null, '', `#/debrief/${encodeURIComponent(sector)}/${encodeURIComponent(t)}`);
      drawFocus(); drawComp(); setChartTitle(); card.redraw(true);
      if (animate && !reducedMotion()) { const f = $('#db-focus'); f.classList.remove('db-swap'); void f.offsetWidth; f.classList.add('db-swap'); }
      // keep the focused row visible by scrolling the list only, never the page
      const list = $('#db-comp .db-list'), row = $(`#db-comp .db-row[data-t="${CSS.escape(t)}"]`);
      if (list && row) {
        const top = row.offsetTop - list.offsetTop, bottom = top + row.offsetHeight;
        if (top < list.scrollTop) list.scrollTo({ top, behavior: 'smooth' });
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTo({ top: bottom - list.clientHeight, behavior: 'smooth' });
      }
    }
    function step(d) { const i = stocks.findIndex(p => p.t === focusT) + d; if (i >= 0 && i < stocks.length) focus(stocks[i].t); }
    function stepSector(d) { const n = groups[(si + d + groups.length) % groups.length]; go('debrief/' + encodeURIComponent(n.s)); }

    $$('[data-sec]', el).forEach(b => b.onclick = () => go('debrief/' + encodeURIComponent(b.dataset.sec)));
    $$('[data-sec-step]', el).forEach(b => b.onclick = () => stepSector(+b.dataset.secStep));
    $('#db-present').onclick = togglePresent;
    const onKey = e => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || $('.modal-root') || $('.palette') || $('.pop') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepSector(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepSector(-1); }
    };
    document.addEventListener('keydown', onKey);

    drawSector(); drawComp(); drawFocus();
    // bring the active sector chip into view inside the chip strip (not the page)
    const strip = el.querySelector('.db-sectors'), activeChip = el.querySelector('.db-sectors .chip.on');
    if (strip && activeChip) strip.scrollLeft = activeChip.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + activeChip.offsetWidth / 2;
    // sector returns fill in as price histories arrive
    const onHist = debounce(() => { if (document.body.contains(el.firstChild)) drawSector(); }, 250);
    histListeners.add(onHist);
    return () => { card.destroy(); histListeners.delete(onHist); document.removeEventListener('keydown', onKey); };
  },
};

function debriefSector(params) {
  const groups = bySector();
  if (!groups.length) return null;
  const want = params && params[0] ? params[0] : store.get('llf_debrief_sector');
  return (groups.find(x => x.s === want) || groups[0]).s;
}

// Full screen for presenting: hides the browser chrome and narrows the sidebar.
function togglePresent() {
  const sh = $('#shell');
  if (!document.fullscreenElement) {
    sh._wasCollapsed = sh.classList.contains('collapsed');
    if (!sh._wasCollapsed) toggleCollapse();
    (document.documentElement.requestFullscreen?.() || Promise.resolve()).catch(() => { });
  } else {
    document.exitFullscreen?.();
    if (!sh._wasCollapsed && sh.classList.contains('collapsed')) toggleCollapse();
  }
}

// ---------------------------------------------------------------------------
// views/sources.js — "Data": the raw numbers behind every chart, so anyone can
// check them against the spreadsheets (and download them as CSV). Read-only.
//   How it's calculated · Unit value · Daily snapshots · Trades · Holdings · Checks
// ---------------------------------------------------------------------------

const dataState = { tab: 'how', q: '' };
let _navDaily = null;

const DATA_TABS = [
  ['how', 'How it\'s calculated'], ['uv', 'Unit value'], ['daily', 'Daily snapshots'],
  ['trades', 'Trades'], ['holdings', 'Holdings'], ['checks', 'Checks'],
];

// Column definitions: [header, value(row) for CSV, html(row) for the table (optional), align]
function dataTable(tab) {
  const num = (n, d = 2) => (n == null || !isFinite(n) ? '' : +(+n).toFixed(d));
  if (tab === 'uv') {
    const spike = new Set(uvSpikes().map(r => r.d));
    const rows = S.uv.map(r => ({ d: dt.fromMDY(r.d), u: +r.u, sp: r.sp })).filter(r => r.u > 0).sort((a, b) => b.d.localeCompare(a.d));
    rows.forEach((r, i) => { const p = rows[i + 1]; r.chg = p ? (r.u / p.u - 1) * 100 : null; r.used = !spike.has(r.d); });
    return {
      title: 'Month-end unit value', file: 'llf-unit-value',
      sub: 'The official record, typed in each month (Unit Value page). This is what the returns table and the default performance chart use.',
      rows, cols: [
        ['Month-end', r => r.d, r => dt.long(r.d), 'left'],
        ['Unit value', r => num(r.u, 4), r => fmt.usd(r.u)],
        ['Change vs. prior month (%)', r => num(r.chg), r => `<span class="${signCls(r.chg)}">${fmt.pct(r.chg, 1)}</span>`],
        ['S&P 500 as recorded', r => r.sp ?? '', r => (r.sp ? fmt.int(r.sp) : '<span class="muted">—</span>')],
        ['Used in returns', r => (r.used ? 'yes' : 'no: likely typo'), r => (r.used ? '<span class="muted">yes</span>' : '<span class="badge warn">no · likely typo</span>')],
      ],
    };
  }
  if (tab === 'daily') {
    const rows = (_navDaily || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    return {
      title: 'Daily snapshots', file: 'llf-daily-snapshots',
      sub: 'Written automatically after each market close: holdings × closing prices + cash, ÷ units. Feeds the daily points of the unit value.',
      loading: !_navDaily, rows, cols: [
        ['Date', r => r.date, r => dt.long(r.date), 'left'],
        ['Unit value', r => num(r.unitValue, 4), r => fmt.usd(r.unitValue)],
        ['Fund value (holdings + cash)', r => num(r.totalEquity), r => fmt.usd(r.totalEquity, 0)],
        ['SPY close', r => num(r.spy), r => (r.spy ? fmt.usd(r.spy) : '—')],
        ['Prices missing that day', r => (r.missingQuotes || []).join(' '), r => ((r.missingQuotes || []).length ? `<span class="badge warn">${esc(r.missingQuotes.join(', '))}</span>` : '<span class="muted">none</span>')],
      ],
    };
  }
  if (tab === 'trades') {
    const rows = allTxns().filter(x => x.type === 'buy' || x.type === 'sell');
    const src = x => (x.src === 'app' ? 'Added in the app' : x.row ? `Master File row ${x.row}` : x.rows ? `Master File rows ${x.rows.join(', ')}` : 'Master File');
    const flags = x => [x.est && 'date missing in the Master File (estimated)', x.noPx && 'sale price missing', x.drip && 'dividend reinvestment'].filter(Boolean);
    return {
      title: 'Every buy and sale', file: 'llf-trades',
      sub: 'From the "LLF Inventory" sheet of the Master File (one sale here can combine several lots sold the same day), plus trades recorded in the app since.',
      rows, search: x => x.t, cols: [
        ['Date', x => x.d, x => dt.long(x.d), 'left'],
        ['Ticker', x => x.t, x => `<a href="#/stock/${encodeURIComponent(x.t)}" class="strong">${esc(x.t)}</a>`, 'left'],
        ['Type', x => x.type, x => (x.type === 'buy' ? (x.drip ? 'Dividend reinvest' : 'Buy') : 'Sell'), 'left'],
        ['Shares', x => num(x.sh, 4), x => fmt.shares(x.sh)],
        ['Price', x => num(x.px, 4), x => (x.px ? fmt.usd(x.px) : '—')],
        ['Amount', x => num(x.amt), x => (x.amt != null ? fmt.usd(x.amt) : '—')],
        ['Realized gain', x => (x.type === 'sell' ? num(x.gain) : ''), x => (x.type === 'sell' && x.gain != null ? `<span class="${signCls(x.gain)}">${fmt.usdSigned(x.gain)}</span>` : '')],
        ['Source', src, x => `<span class="muted">${esc(src(x))}</span>`, 'left'],
        ['Notes', x => flags(x).join('; '), x => flags(x).filter(f => f !== 'dividend reinvestment').map(f => `<span class="badge warn">${esc(f)}</span>`).join(' '), 'left'],
      ],
    };
  }
  if (tab === 'holdings') {
    const lp = S.ledger ? ledgerPositions() : {};
    const rows = positions().map(p => {
      const o = lp[TICKER_ALIASES[p.t] || p.t];
      return { ...p, lOpen: o ? o.open : null, lSince: o ? o.since : null };
    });
    return {
      title: 'Current holdings', file: 'llf-holdings',
      sub: 'What the Holdings page says the fund owns now, next to what the trade history adds up to. Prices are the latest quotes.',
      rows, search: p => p.t, cols: [
        ['Ticker', p => p.t, p => `<a href="#/stock/${encodeURIComponent(p.t)}" class="strong">${esc(p.t)}</a>`, 'left'],
        ['Sector', p => p.s, p => `<span class="muted">${esc(p.s || '')}</span>`, 'left'],
        ['Shares (Holdings)', p => num(p.sh, 4), p => fmt.shares(p.sh)],
        ['Shares (trade history)', p => num(p.lOpen, 4), p => (p.lOpen == null ? '<span class="badge warn">not in history</span>' : Math.abs(p.lOpen - p.sh) > 0.01 ? `<span class="badge warn">${fmt.shares(p.lOpen)}</span>` : fmt.shares(p.lOpen))],
        ['Avg cost', p => num(p.ac, 4), p => fmt.usd(p.ac)],
        ['Purchase date (Holdings)', p => p.d || '', p => (p.d ? dt.long(p.d) : '—')],
        ['Position started (trade history)', p => p.lSince || '', p => (p.lSince ? (p.d && Math.abs(dt.days(p.d, p.lSince)) > 31 ? `<span class="badge warn">${dt.long(p.lSince)}</span>` : dt.long(p.lSince)) : '—')],
        ['Price', p => num(p.price), p => (p.hasPrice ? fmt.usd(p.price) : '—')],
        ['Market value', p => num(p.val), p => fmt.usd(p.val, 0)],
      ],
    };
  }
  if (tab === 'checks') {
    const rows = holdingChecks().map(c => ({ kind: c.kind === 'not-held' ? 'Bought, never sold, not in Holdings' : c.kind === 'date' ? 'Different purchase dates' : c.kind === 'shares' ? 'Different share counts' : 'Not in trade history', msg: c.msg }))
      .concat((S.ledger?.warnings || []).filter(w => !/no ticker in scope|Unrecognised label/.test(w.msg)).map(w => ({ kind: 'Master File import', msg: (w.row ? `Row ${w.row}: ` : '') + w.msg })));
    return {
      title: 'Things that don\'t add up', file: 'llf-data-checks',
      sub: 'Found automatically by comparing Holdings, the trade history and the unit value record. Nothing here changes any number on its own; a person needs to look.',
      rows: uvSpikes().map(r => ({ kind: 'Unit value', msg: `${dt.long(r.d)}: ${fmt.usd(r.u)} jumps more than 10% and comes back the next month. Probably a typo, so it's left out of returns until corrected.` })).concat(rows),
      cols: [['What', r => r.kind, r => `<span class="strong">${esc(r.kind)}</span>`, 'left'], ['Detail', r => r.msg, r => `<span style="white-space:normal">${esc(r.msg)}</span>`, 'left']],
    };
  }
  return null;
}

function toCSV(cols, rows) {
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.map(c => q(c[0])).join(','), ...rows.map(r => cols.map(c => q(c[1](r))).join(','))].join('\n');
}
function downloadCSV(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = `${name}-${dt.today()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const HOW_ROWS = [
  ['Fund value, today', 'Holdings (shares × latest price) + bank and brokerage cash', 'Holdings page; prices from Finnhub'],
  ['Unit value, today', 'Fund value ÷ units outstanding', 'Units ({units}) are set on the Holdings page. If money was added or paid out without changing the units, the unit value moves for a reason that isn\'t performance'],
  ['Returns table (1M … since 2012)', 'Change in the month-end unit value over each period, ending at today\'s live unit value', 'Unit value tab. Doesn\'t use trade dates at all, so a wrong trade date can\'t affect it'],
  ['Performance chart, "Unit value" (default)', 'The same month-end unit value, plotted', 'The fund\'s actual record'],
  ['Performance chart, "Today\'s holdings"', 'Today\'s holdings, each priced back to when the current position was bought', 'A what-if. It leaves out everything sold earlier and the cash, so over long ranges it looks much better than the fund really did'],
  ['Benchmarks (S&P 500 etc.)', 'ETF closing prices (SPY, QQQ …) on the same dates', 'Price only; dividends not included'],
  ['Activity, realized gains, past holdings', 'The trade history (Master File) plus trades added in the app', 'Trades tab, with the Master File row for each'],
  ['Sector returns', 'Each sector\'s current holdings, time-weighted, vs. its SPDR sector ETF', 'Current holdings only'],
];

VIEWS.data = {
  head: () => ({ title: 'Data', sub: 'The numbers behind every chart' }),
  render(el) {
    el.innerHTML = `<div class="view stack">
      <div class="card"><div class="card-h" style="row-gap:10px"><div id="data-tabs" style="max-width:100%;overflow-x:auto"></div><div class="spacer"></div><span id="data-tools" class="row" style="gap:8px"></span></div>
        <div id="data-body"></div></div>
    </div>`;
    const draw = () => {
      $('#data-tabs').innerHTML = seg('dtab', DATA_TABS, dataState.tab);
      onSeg(el, 'dtab', v => { dataState.tab = v; dataState.q = ''; draw(); });
      const body = $('#data-body'), tools = $('#data-tools');
      if (dataState.tab === 'how') {
        tools.innerHTML = '';
        body.innerHTML = `<div class="table-wrap"><table class="t how-t"><thead><tr><th class="left">Number or chart</th><th class="left">How it's calculated</th><th class="left">Where to check it</th></tr></thead><tbody>
          ${HOW_ROWS.map(([a, b, c]) => `<tr><td class="left strong" style="white-space:normal;min-width:200px">${esc(a)}</td><td class="left" style="white-space:normal">${esc(b)}</td><td class="left muted" style="white-space:normal">${esc(c.replace('{units}', fmt.shares(S.units)))}</td></tr>`).join('')}
          </tbody></table></div>
          <div class="chart-foot">${icon('info')}<span>Every tab here can be downloaded as a CSV and opened in Excel or Google Sheets. Nothing on this page can change the data.</span></div>`;
        return;
      }
      if (dataState.tab === 'daily' && !_navDaily) {
        fetchJSON('/api/nav-history').then(d => { _navDaily = Array.isArray(d) ? d : []; if (route.view === 'data' && dataState.tab === 'daily') draw(); })
          .catch(() => { _navDaily = []; if (route.view === 'data') draw(); });
      }
      const T = dataTable(dataState.tab);
      const q = dataState.q.trim().toUpperCase();
      const rows = q && T.search ? T.rows.filter(r => (T.search(r) || '').toUpperCase().includes(q)) : T.rows;
      const LIMIT = 400;
      tools.innerHTML = `${T.search ? `<div class="input-wrap" style="width:140px">${icon('search', 'sm')}<input class="input sm" id="data-q" placeholder="Ticker" value="${esc(dataState.q)}" style="text-transform:uppercase"/></div>` : ''}
        <button class="btn ghost sm" id="data-csv" ${T.rows.length ? '' : 'disabled'}>${icon('download', 'sm')}Download CSV</button>`;
      body.innerHTML = `<div class="card-b" style="padding-top:4px;padding-bottom:10px"><div class="strong">${esc(T.title)} <span class="muted" style="font-weight:500">· ${fmt.int(rows.length)} row${rows.length === 1 ? '' : 's'}</span></div><div class="hint" style="margin-top:2px">${esc(T.sub)}</div></div>
        ${T.loading ? '<div class="card-b"><div class="skel" style="height:200px"></div></div>' : rows.length ? `<div class="table-wrap" style="max-height:620px"><table class="t"><thead><tr>${T.cols.map(c => `<th class="${c[3] || ''}">${esc(c[0])}</th>`).join('')}</tr></thead><tbody>
          ${rows.slice(0, LIMIT).map(r => `<tr>${T.cols.map(c => `<td class="${c[3] || ''}">${(c[2] || (x => esc(String(c[1](x) ?? ''))))(r)}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div>${rows.length > LIMIT ? `<div class="chart-foot">${icon('info')}Showing the first ${LIMIT} of ${fmt.int(rows.length)}. The CSV has all of them.</div>` : ''}`
        : `<div class="empty">${icon('circle-check')}<div>Nothing to show.</div></div>`}`;
      $('#data-csv').onclick = () => downloadCSV(T.file, toCSV(T.cols, rows));
      const qi = $('#data-q');
      if (qi) qi.oninput = debounce(() => { dataState.q = qi.value; draw(); const n = $('#data-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200);
    };
    draw();
  },
};

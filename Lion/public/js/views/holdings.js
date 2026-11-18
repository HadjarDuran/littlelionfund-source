// ---------------------------------------------------------------------------
// views/holdings.js — manager tools (password-gated): record a buy/sell
// (Google-Finance-style), edit or remove a position, cash and units.
// Every save here is an explicit button press. Nothing writes in the background.
// ---------------------------------------------------------------------------

const holdSort = { key: 'val', dir: 'desc' };

VIEWS.holdings = {
  head: () => ({ title: 'Holdings', sub: isUnlocked('holdings') ? 'Manager tools' : 'Locked' }),
  render(el) {
    if (!isUnlocked('holdings')) return lockGate(el, 'holdings', 'Holdings', () => render());
    const t = totals();
    const recent = (S.added || []).slice().reverse();
    el.innerHTML = `<div class="view stack">
      <div class="card pad row wrap" style="gap:14px">
        <div class="ic-circle buy" style="width:44px;height:44px;border-radius:13px">${icon('plus')}</div>
        <div style="flex:1;min-width:200px"><div class="strong" style="font-size:15px">Record a trade</div><div class="hint">Buy or sell. Updates the position, average cost, activity history and (optionally) brokerage cash in one step.</div></div>
        <button class="btn primary" id="add-txn">${icon('plus', 'sm')}Add transaction</button>
        <button class="btn ghost" id="add-pos" title="Add or correct a position directly without recording a trade">${icon('pencil', 'sm')}Edit position directly</button>
      </div>
      <div class="grid g-main g-main-sm" style="align-items:start">
        <div class="card" id="hold-table"></div>
        <div class="stack">
          <div class="card"><div class="card-h"><div class="card-t">${icon('landmark')}Cash &amp; units</div></div>
            <form class="card-b stack" id="cash-form" style="gap:12px">
              <div class="field"><label for="c-bank">Bank balance</label><input class="input" id="c-bank" type="number" step="0.01" value="${S.cashBank}"/></div>
              <div class="field"><label for="c-brok">Brokerage cash</label><input class="input" id="c-brok" type="number" step="0.01" value="${S.cashBrok}"/></div>
              <div class="field"><label for="c-units">Units outstanding</label><input class="input" id="c-units" type="number" step="0.0001" value="${S.units}"/>
                <div class="hint">Changes when investors add or withdraw money. Unit value = fund value ÷ units.</div></div>
              <div class="summary-box"><div class="r"><span class="muted">Total cash</span><b class="tabular" id="c-total">${fmt.usd(t.cash)}</b></div><div class="r"><span class="muted">Unit value</span><b class="tabular" id="c-unit">${fmt.usd(t.unit)}</b></div></div>
              <button class="btn primary block" type="submit">${icon('save', 'sm')}Save cash &amp; units</button>
            </form></div>
          <div class="card"><div class="card-h"><div class="card-t">${icon('history')}Recorded in the app</div><div class="card-sub">${recent.length}</div></div>
            <div id="app-txns" style="padding-top:6px">${recent.length ? '' : '<div class="empty" style="padding:20px">Trades you add here show up in Activity too.</div>'}</div></div>
        </div>
      </div></div>`;
    $('#add-txn').onclick = () => openAddTxn();
    $('#add-pos').onclick = () => openEditPosition(null);
    drawHoldTable();

    const form = $('#cash-form');
    const live = () => {
      const b = parseFloat($('#c-bank').value) || 0, br = parseFloat($('#c-brok').value) || 0, u = parseFloat($('#c-units').value) || 0;
      $('#c-total').textContent = fmt.usd(b + br);
      $('#c-unit').textContent = u > 0 ? fmt.usd((t.equity + b + br) / u) : '—';
    };
    $$('input', form).forEach(i => i.oninput = live);
    form.onsubmit = async e => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      const u = parseFloat($('#c-units').value);
      if (!(u > 0)) { $('#c-units').classList.add('err'); return; }
      S.cashBank = parseFloat($('#c-bank').value) || 0; S.cashBrok = parseFloat($('#c-brok').value) || 0; S.units = u;
      invalidate();
      const ok = await withBusy(btn, async () => !!(await api.saveCash()) && !!(await api.saveUnits()));
      if (ok) { saveSnapshot(); renderRail(); }
      else toast(saveError(), 'err', 5000);
    };

    if (recent.length) {
      const host = $('#app-txns');
      host.innerHTML = `<div class="list">${recent.slice(0, 12).map(x => `<div class="li"><span class="ic-circle ${x.type}">${icon(x.type === 'buy' ? 'arrow-down-to-line' : 'arrow-up-from-line', 'sm')}</span>
        <div class="li-main"><div class="li-title"></div><div class="li-sub">${dt.long(x.d)} · ${fmt.usd(x.px)}</div></div>
        <button class="icon-btn" data-del="${esc(x.id)}" title="Delete this record (does not change the position)" aria-label="Delete record">${icon('trash-2', 'sm')}</button></div>`).join('')}</div>`;
      $$('.li-title', host).forEach((n, i) => { const x = recent[i]; n.textContent = `${x.type === 'buy' ? 'Bought' : 'Sold'} ${fmt.shares(x.sh)} ${x.t}`; });
      $$('[data-del]', host).forEach(b => b.onclick = async () => {
        if (!await confirmModal({ title: 'Delete this record?', text: 'This removes the entry from the activity history only. It does not change the position. Edit the position separately if needed.', confirm: 'Delete', danger: true })) return;
        if (await api.deleteTxn(b.dataset.del)) { S.added = S.added.filter(x => x.id !== b.dataset.del); invalidate(); toast('Record deleted'); render(); }
        else toast(saveError(), 'err', 5000);
      });
    }
  },
};

function drawHoldTable() {
  const host = $('#hold-table'); if (!host) return;
  const pos = sortBy(positions(), holdSort.key, holdSort.dir), t = totals();
  host.innerHTML = `<div class="card-h bordered"><div class="card-t">${icon('briefcase')}${pos.length} positions</div><div class="card-sub">${fmt.usd(t.cost)} cost basis</div></div>
    <div class="table-wrap"><table class="t"><thead><tr>${thSort('Holding', 't', holdSort, 'left')}${thSort('Sector', 's', holdSort, 'left')}${thSort('Shares', 'sh', holdSort)}${thSort('Avg cost', 'ac', holdSort)}${thSort('Value', 'val', holdSort)}${thSort('Bought', 'd', holdSort)}<th></th></tr></thead>
    <tbody>${pos.map(p => `<tr><td class="left"><div class="tk">${tkLogo(p.t)}<div><div class="tk-name">${esc(p.t)}</div><div class="tk-sub">${esc(p.n || '')}</div></div></div></td>
      <td class="left"><span class="row" style="gap:7px"><span class="dot" style="background:${sectorColor(p.s)};width:7px;height:7px"></span><span class="muted">${esc(SECTORS[p.s]?.short || p.s)}</span></span></td>
      <td>${fmt.shares(p.sh)}</td><td>${fmt.usd(p.ac)}</td><td class="strong">${p.hasPrice ? fmt.usd(p.val) : '—'}</td><td class="muted">${p.d ? dt.monYr(p.d) : '<span class="badge warn">not set</span>'}</td>
      <td><div class="row" style="justify-content:flex-end;gap:4px">
        <button class="icon-btn sm" data-act="sell" data-t="${esc(p.t)}" title="Record a sale" aria-label="Sell ${esc(p.t)}">${icon('minus', 'sm')}</button>
        <button class="icon-btn sm" data-act="edit" data-t="${esc(p.t)}" title="Edit position" aria-label="Edit ${esc(p.t)}">${icon('pencil', 'sm')}</button>
        <button class="icon-btn sm" data-act="del" data-t="${esc(p.t)}" title="Remove position" aria-label="Remove ${esc(p.t)}">${icon('trash-2', 'sm')}</button></div></td></tr>`).join('')}</tbody></table></div>`;
  wireSort(host, holdSort, drawHoldTable);
  $$('[data-act]', host).forEach(b => b.onclick = async () => {
    const tk = b.dataset.t;
    if (b.dataset.act === 'sell') openAddTxn({ type: 'sell', t: tk });
    else if (b.dataset.act === 'edit') openEditPosition(tk);
    else {
      if (!await confirmModal({ title: `Remove ${tk}?`, text: `This deletes the ${tk} position without recording a sale. To record that it was sold, use "Record a sale" instead.`, confirm: 'Remove', danger: true })) return;
      S.hold = S.hold.filter(h => h.t !== tk); invalidate();
      if (await api.saveHoldings()) { toast(`${tk} removed`); saveSnapshot(); } else toast(saveError(), 'err', 5000);
      render(); renderRail();
    }
  });
}

// ---- Add transaction (Google Finance style) ----
function openAddTxn(pre = {}) {
  if (!isUnlocked('holdings')) { go('holdings'); return; }
  const st = { type: pre.type || 'buy', t: pre.t || '', d: dt.today(), sh: '', px: '', fee: '', autoPx: true, adjCash: store.get('llf_adj_cash', true) };
  const sectorOpts = Object.keys(SECTORS).map(s => `<option>${esc(s)}</option>`).join('');
  const m = openModal({
    title: 'Add transaction', icon: 'plus', wide: true,
    body: `${seg('ttype', [['buy', icon('arrow-down-to-line', 'sm') + 'Buy'], ['sell', icon('arrow-up-from-line', 'sm') + 'Sell']], st.type, 'theme-seg')}
      <div class="form-grid">
        <div class="field"><label for="tx-t">Ticker</label><input class="input" id="tx-t" list="tx-list" autocomplete="off" placeholder="e.g. AAPL" style="text-transform:uppercase" value="${esc(st.t)}"/>
          <datalist id="tx-list">${S.hold.map(h => `<option value="${esc(h.t)}">${esc(h.n || '')}</option>`).join('')}</datalist></div>
        <div class="field"><label for="tx-d">Trade date</label><input class="input" id="tx-d" type="date" max="${dt.today()}" value="${st.d}"/></div>
        <div class="field"><label for="tx-sh">Shares</label><input class="input" id="tx-sh" type="number" step="any" min="0" placeholder="0"/><div class="hint" id="tx-held"></div></div>
        <div class="field"><label for="tx-px">Price per share</label><input class="input" id="tx-px" type="number" step="any" min="0" placeholder="0.00"/><div class="hint" id="tx-pxhint"></div></div>
        <div class="field"><label for="tx-fee">Fees / commission</label><input class="input" id="tx-fee" type="number" step="0.01" min="0" placeholder="0.00"/></div>
        <div class="field" id="tx-new" hidden><label for="tx-sec">Sector (new holding)</label><select class="select input" id="tx-sec">${sectorOpts}</select></div>
        <div class="field full" id="tx-name-f" hidden><label for="tx-n">Company name (new holding)</label><input class="input" id="tx-n" placeholder="e.g. Apple Inc."/></div>
      </div>
      <label class="row hint" style="gap:8px;cursor:pointer"><input type="checkbox" id="tx-cash" ${st.adjCash ? 'checked' : ''}/> Adjust brokerage cash (currently ${fmt.usd(S.cashBrok)})</label>
      <div class="summary-box" id="tx-sum"></div>`,
    actions: [{ label: 'Cancel', onClick: c => c() }, { label: 'Save transaction', cls: 'primary', icon: 'check', onClick: (c, b) => save(c, b) }],
  });
  const R = m.root, q = s => R.querySelector(s);
  const holding = () => S.hold.find(h => h.t === st.t);

  async function fillPrice() {
    if (!st.t || !st.d || !st.autoPx) return;
    const hint = q('#tx-pxhint');
    hint.textContent = 'Looking up close…';
    const h = await getHist(st.t);
    if (!document.body.contains(R)) return;
    if (!h) { hint.textContent = 'No price history found. Enter the price you paid.'; return; }
    const i = bisectDate(h, st.d, 'date');
    if (i < 0) { hint.textContent = 'No price that far back.'; return; }
    st.px = h[i].close; q('#tx-px').value = st.px;
    hint.textContent = `Close on ${dt.short(h[i].date)}: ${fmt.usd(h[i].close)}. Edit if you paid a different price.`;
    update();
  }
  function update() {
    st.type = R.querySelector('[data-seg="ttype"] .on').dataset.v;
    st.t = q('#tx-t').value.toUpperCase().trim().replace(/[^A-Z.\-]/g, '');
    st.d = q('#tx-d').value; st.sh = parseFloat(q('#tx-sh').value); st.px = parseFloat(q('#tx-px').value); st.fee = parseFloat(q('#tx-fee').value) || 0;
    st.adjCash = q('#tx-cash').checked;
    const h = holding();
    const isNew = st.type === 'buy' && st.t && !h;
    q('#tx-new').hidden = !isNew; q('#tx-name-f').hidden = !isNew;
    q('#tx-held').textContent = h ? `Fund holds ${fmt.shares(h.sh)} sh @ ${fmt.usd(h.ac)} avg` : st.t && st.type === 'sell' ? 'The fund doesn\'t hold this ticker' : '';
    if (h && st.type === 'sell') q('#tx-held').innerHTML += ` · <a href="#" id="tx-all">sell all</a>`;
    const all = q('#tx-all'); if (all) all.onclick = e => { e.preventDefault(); q('#tx-sh').value = h.sh; update(); };
    const ok = st.t && st.d && st.sh > 0 && st.px > 0 && !(st.type === 'sell' && (!h || st.sh > h.sh + 1e-6));
    q('.modal-f .btn.primary').disabled = !ok;
    const gross = (st.sh || 0) * (st.px || 0);
    let rows = '';
    if (st.type === 'buy') {
      const total = gross + st.fee;
      const newSh = (h?.sh || 0) + (st.sh || 0);
      const newAc = newSh ? ((h ? h.sh * h.ac : 0) + total) / newSh : 0;
      rows = `<div class="r"><span class="muted">Total cost</span><b>${fmt.usd(total)}</b></div>
        <div class="r"><span class="muted">Position after</span><b>${fmt.shares(newSh)} sh @ ${fmt.usd(newAc)} avg</b></div>`;
      if (st.adjCash) rows += `<div class="r"><span class="muted">Brokerage cash after</span><b class="${S.cashBrok - total < 0 ? 'neg' : ''}">${fmt.usd(S.cashBrok - total)}</b></div>`;
    } else if (h) {
      const proceeds = gross - st.fee, basis = (st.sh || 0) * h.ac, gain = proceeds - basis;
      rows = `<div class="r"><span class="muted">Proceeds</span><b>${fmt.usd(proceeds)}</b></div>
        <div class="r"><span class="muted">Cost basis sold (avg cost)</span><b>${fmt.usd(basis)}</b></div>
        <div class="r"><span class="muted">Realized gain</span><b class="${signCls(gain)}">${fmt.usdSigned(gain)}</b></div>
        <div class="r"><span class="muted">Position after</span><b>${h.sh - (st.sh || 0) <= 1e-6 ? 'Fully sold' : fmt.shares(h.sh - (st.sh || 0)) + ' sh'}</b></div>`;
      if (st.adjCash) rows += `<div class="r"><span class="muted">Brokerage cash after</span><b>${fmt.usd(S.cashBrok + proceeds)}</b></div>`;
    }
    q('#tx-sum').innerHTML = rows || '<span class="muted">Fill in the trade to see a summary.</span>';
  }
  async function save(close, btn) {
    update();
    const h = holding();
    const total = st.sh * st.px + (st.type === 'buy' ? st.fee : -st.fee);
    const txn = { d: st.d, t: st.t, type: st.type, sh: st.sh, px: st.px, fee: st.fee };
    const prevHold = JSON.parse(JSON.stringify(S.hold)), prevBrok = S.cashBrok;
    if (st.type === 'buy') {
      if (h) {
        const newSh = h.sh + st.sh;
        h.ac = +(((h.sh * h.ac) + total) / newSh).toFixed(4);
        h.sh = +newSh.toFixed(6);
        if (!h.d || st.d < h.d) h.d = st.d;
      } else {
        S.hold.unshift({ t: st.t, n: q('#tx-n').value.trim() || st.t, s: q('#tx-sec').value, sh: +st.sh.toFixed(6), ac: +(total / st.sh).toFixed(4), d: st.d });
      }
      if (st.adjCash) S.cashBrok = +(S.cashBrok - total).toFixed(2);
    } else {
      txn.basis = +(st.sh * h.ac).toFixed(2);
      const left = h.sh - st.sh;
      if (left <= 1e-6) S.hold = S.hold.filter(x => x !== h); else h.sh = +left.toFixed(6);
      if (st.adjCash) S.cashBrok = +(S.cashBrok + total).toFixed(2);
    }
    store.set('llf_adj_cash', st.adjCash);
    invalidate();
    const ok = await withBusy(btn, async () => {
      const a = await api.saveHoldings(); if (!a) return false;
      const b = await api.addTxn(txn); if (b && b.txn) S.added.push(b.txn);
      if (st.adjCash) await api.saveCash();
      return true;
    });
    if (!ok) { S.hold = prevHold; S.cashBrok = prevBrok; invalidate(); toast(saveError(), 'err', 5000); return; }
    invalidate(); saveSnapshot();
    toast(`${st.type === 'buy' ? 'Bought' : 'Sold'} ${fmt.shares(st.sh)} ${st.t}`);
    setTimeout(close, 450);
    if (!S.prices[st.t]) await loadQuote(st.t);
    getHist(st.t);
    invalidate(); render(); renderRail();
  }
  onSeg(R, 'ttype', () => update());
  q('#tx-t').addEventListener('change', () => { update(); fillPrice(); });
  q('#tx-t').addEventListener('input', update);
  q('#tx-d').addEventListener('change', () => { update(); fillPrice(); });
  q('#tx-px').addEventListener('input', () => { st.autoPx = false; q('#tx-pxhint').textContent = ''; update(); });
  ['#tx-sh', '#tx-fee'].forEach(s => q(s).addEventListener('input', update));
  q('#tx-cash').addEventListener('change', update);
  R.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !q('.modal-f .btn.primary').disabled) q('.modal-f .btn.primary').click(); });
  update();
  if (st.t) fillPrice();
}
window.openAddTxn = openAddTxn;

// ---- Edit / add a position directly (corrections, no trade recorded) ----
function openEditPosition(tk) {
  const h = tk ? S.hold.find(x => x.t === tk) : null;
  const sectorOpts = Object.keys(SECTORS).map(s => `<option ${h?.s === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
  openModal({
    title: h ? `Edit ${h.t}` : 'Add position directly', icon: 'pencil',
    body: `<div class="note">${icon('info')}<span>For corrections. This changes the position as-is and does <b>not</b> record a trade in Activity. To record a real buy or sale, use Add transaction.</span></div>
      <div class="form-grid">
        <div class="field"><label>Ticker</label><input class="input" id="ep-t" value="${esc(h?.t || '')}" ${h ? 'disabled' : ''} style="text-transform:uppercase"/></div>
        <div class="field"><label>Company name</label><input class="input" id="ep-n" value="${esc(h?.n || '')}"/></div>
        <div class="field"><label>Shares</label><input class="input" id="ep-sh" type="number" step="any" value="${h?.sh ?? ''}"/></div>
        <div class="field"><label>Average cost</label><input class="input" id="ep-ac" type="number" step="any" value="${h?.ac ?? ''}"/></div>
        <div class="field"><label>First purchase date</label><input class="input" id="ep-d" type="date" value="${h?.d || ''}"/></div>
        <div class="field"><label>Sector</label><select class="select input" id="ep-s">${sectorOpts}</select></div>
        <div class="field"><label>Value Line Safety (1–5)</label><input class="input" id="ep-vs" type="number" min="1" max="5" step="1" value="${h?.vlSafety || ''}"/></div>
        <div class="field"><label>Value Line Timeliness (1–5)</label><input class="input" id="ep-vt" type="number" min="1" max="5" step="1" value="${h?.vlTimeliness || ''}"/></div>
      </div>`,
    actions: [{ label: 'Cancel', onClick: c => c() }, {
      label: 'Save', cls: 'primary', icon: 'check', onClick: async (close, btn, R) => {
        const v = id => R.querySelector(id).value.trim();
        const t = (h?.t || v('#ep-t')).toUpperCase().replace(/[^A-Z.\-]/g, '');
        const sh = parseFloat(v('#ep-sh')), ac = parseFloat(v('#ep-ac'));
        if (!t || !(sh > 0) || !(ac > 0)) { R.querySelector('.modal').classList.add('shake'); setTimeout(() => R.querySelector('.modal')?.classList.remove('shake'), 500); return; }
        if (!h && S.hold.some(x => x.t === t)) { toast(`${t} is already a holding. Edit it instead`, 'err'); return; }
        const rank = x => { const n = parseInt(x, 10); return n >= 1 && n <= 5 ? n : null; };
        const rec = { t, n: v('#ep-n') || t, s: v('#ep-s'), sh, ac, d: v('#ep-d') || null, vlSafety: rank(v('#ep-vs')), vlTimeliness: rank(v('#ep-vt')) };
        const prev = JSON.parse(JSON.stringify(S.hold));
        if (h) Object.assign(h, rec); else S.hold.unshift(rec);
        invalidate();
        const ok = await withBusy(btn, async () => !!(await api.saveHoldings()));
        if (!ok) { S.hold = prev; invalidate(); toast(saveError(), 'err', 5000); return; }
        saveSnapshot(); setTimeout(close, 400);
        if (!S.prices[t]) await loadQuote(t);
        getHist(t); invalidate(); render(); renderRail();
      },
    }],
  });
}

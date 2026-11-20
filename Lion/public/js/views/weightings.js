// ---------------------------------------------------------------------------
// views/weightings.js — target sector weights (manager-set) vs. what the
// fund actually holds vs. the S&P 500's sector weights.
// ---------------------------------------------------------------------------

VIEWS.weightings = {
  head: () => ({ title: 'Weightings', sub: targetsSet() ? 'Sector targets' : 'Sector weights vs. the S&P 500 · targets not set' }),
  render(el) {
    // Everyone sees the targets; inputs, add/remove and Save only appear
    // after the weightings password (and the server re-checks it on save).
    const edit = isUnlocked('weightings');
    const W = S.weightings.map(w => ({ s: w.s, p: targetOf(w), sp: +w.sp || 0 }));
    let dirty = false;

    el.innerHTML = `<div class="view stack">
      <div class="card" id="w-table"></div>
      <div class="card"><div class="card-h"><div class="card-t">${icon('chart-column')}${targetsSet() ? 'Current vs. target vs. S&amp;P 500' : 'Current vs. S&amp;P 500'}</div><div class="spacer"></div>
        <div class="row" style="gap:14px;font-size:12px;font-weight:600"><span class="row" style="gap:6px"><span class="sq" style="background:var(--s1)"></span>LLF now</span>${targetsSet() ? '<span class="row" style="gap:6px"><span class="sq" style="background:var(--s4)"></span>Target</span>' : ''}<span class="row" style="gap:6px"><span class="sq" style="background:var(--axis)"></span>S&amp;P 500</span></div></div>
        <div class="card-b" id="w-bars"></div></div>
    </div>`;

    const current = () => {
      const eq = totals().equity || 1, m = {};
      positions().forEach(p => { m[p.s] = (m[p.s] || 0) + p.val; });
      return s => ((m[s] || 0) / eq) * 100;
    };
    function draw() {
      const cur = current();
      const eqTotal = totals().equity;
      const paused = W.every(w => w.p == null);
      const sumP = W.reduce((s, w) => s + (w.p || 0), 0), sumSp = W.reduce((s, w) => s + w.sp, 0);
      const used = new Set(W.map(w => w.s));
      $('#w-table').innerHTML = `<div class="card-h bordered"><div class="card-t">${icon('scale')}Sector targets</div>
        <div class="card-sub">${paused ? 'No sector targets are set right now. The class sets them; until then this compares the fund with the S&amp;P 500 only.' : 'Target and S&amp;P weights are set by the fund managers.'} "Now" is calculated live from holdings (share of invested money).</div><div class="spacer"></div>
        ${edit ? `<button class="btn ghost sm" id="w-clear" ${paused ? 'disabled' : ''} title="Blank every target (S&amp;P weights stay). Targets are hidden across the site until new ones are entered.">${icon('x', 'sm')}Clear all targets</button>
        <button class="btn ghost sm" id="w-add" ${used.size >= Object.keys(SECTORS).length ? 'disabled' : ''}>${icon('plus', 'sm')}Add sector</button>
        <button class="btn primary sm" id="w-save" ${dirty ? '' : 'disabled'}>${icon('save', 'sm')}Save</button>` : editBtn('weightings', 'Edit targets')}</div>
      <div class="table-wrap"><table class="t"><thead><tr><th class="left">Sector</th><th>Now</th><th style="width:120px">Target %</th><th style="width:120px">S&amp;P 500 %</th><th>${paused ? 'Now vs. S&amp;P' : 'Target vs. S&amp;P'}</th><th>Drift from target</th><th title="Target % × invested total, the spreadsheet's Proposed $">Target $</th><th title="Buy (+) or trim (−) to reach the target, the spreadsheet's Change $">To rebalance</th>${edit ? '<th></th>' : ''}</tr></thead><tbody>
        ${W.map((w, i) => {
          const now = cur(w.s), drift = w.p == null ? null : now - w.p, none = '<span class="muted">—</span>';
          return `<tr><td class="left"><div class="row" style="gap:8px"><span class="dot" style="background:${sectorColor(w.s)}"></span>
              ${edit ? `<select class="select input sm" data-i="${i}" data-f="s" style="width:220px">${Object.keys(SECTORS).filter(s => s === w.s || !used.has(s)).map(s => `<option ${s === w.s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : `<span class="strong">${esc(w.s)}</span>`}</div></td>
            <td class="strong">${now.toFixed(1)}%</td>
            <td>${edit ? `<input class="input sm" type="number" step="0.1" min="0" data-i="${i}" data-f="p" value="${w.p ?? ''}" placeholder="not set" style="text-align:right"/>` : w.p == null ? '<span class="muted">not set</span>' : `${w.p}%`}</td>
            <td>${edit ? `<input class="input sm" type="number" step="0.1" min="0" data-i="${i}" data-f="sp" value="${w.sp}" style="text-align:right"/>` : `<span class="muted">${w.sp}%</span>`}</td>
            <td class="${signCls((w.p ?? now) - w.sp)}">${fmt.pct((w.p ?? now) - w.sp, 1).replace('%', ' pts')}</td>
            <td>${drift == null ? none : Math.abs(drift) < 0.05 ? '<span class="muted">on target</span>' : `<span class="pill ${Math.abs(drift) > 3 ? 'neg' : 'neu'}" title="${drift > 0 ? 'Overweight' : 'Underweight'} vs. target">${drift > 0 ? 'Over' : 'Under'} ${Math.abs(drift).toFixed(1)} pts</span>`}</td>
            <td class="muted">${w.p == null ? '—' : fmt.usd(w.p / 100 * eqTotal, 0)}</td>
            <td class="${w.p == null ? '' : signCls(w.p / 100 * eqTotal - now / 100 * eqTotal)} strong">${w.p == null ? none : fmt.usdSigned(w.p / 100 * eqTotal - now / 100 * eqTotal).replace('.00', '')}</td>
            ${edit ? `<td><button class="icon-btn" data-rm="${i}" aria-label="Remove ${esc(w.s)}">${icon('trash-2', 'sm')}</button></td>` : ''}</tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td class="left">Total</td><td>${W.reduce((s, w) => s + cur(w.s), 0).toFixed(1)}%</td><td class="${!paused && Math.abs(sumP - 100) > 0.5 ? 'neg' : ''}">${paused ? '—' : sumP.toFixed(1) + '%'}</td><td class="${Math.abs(sumSp - 100) > 0.5 ? 'neg' : ''}">${sumSp.toFixed(1)}%</td><td colspan="2" class="hint" style="text-align:left">${!paused && Math.abs(sumP - 100) > 0.5 ? 'Targets should add up to 100%' : ''}</td><td>${paused ? '—' : fmt.usd(sumP / 100 * eqTotal, 0)}</td><td colspan="${edit ? 2 : 1}"></td></tr></tfoot></table></div>`;
      const eb = el.querySelector('[data-edit]');
      if (eb) eb.onclick = async () => { if (await unlockModal('weightings', 'Weightings')) render(); };
      if (!edit) { drawBars(cur); return; }
      $$('[data-f]', el).forEach(inp => inp.onchange = () => {
        const w = W[+inp.dataset.i];
        w[inp.dataset.f] = inp.dataset.f === 's' ? inp.value
          : inp.dataset.f === 'p' && inp.value.trim() === '' ? null // blank = no target
          : Math.max(0, +parseFloat(inp.value).toFixed(2) || 0);
        dirty = true; draw();
      });
      $$('[data-rm]', el).forEach(b => b.onclick = async () => {
        const w = W[+b.dataset.rm];
        if (!await confirmModal({ title: `Remove ${w.s}?`, text: 'Removes this sector\'s target. You still need to press Save.', confirm: 'Remove', danger: true })) return;
        W.splice(+b.dataset.rm, 1); dirty = true; draw();
      });
      $('#w-clear').onclick = async () => {
        if (!await confirmModal({ title: 'Clear all sector targets?', text: 'Every target is blanked (S&P weights stay). The site then shows actual vs. S&P weights only, until new targets are entered. You still need to press Save.', confirm: 'Clear targets', danger: true })) return;
        W.forEach(w => { w.p = null; }); dirty = true; draw();
      };
      $('#w-add').onclick = () => { const s = Object.keys(SECTORS).find(x => !used.has(x)); if (s) { W.push({ s, p: null, sp: 0 }); dirty = true; draw(); } };
      $('#w-save').onclick = async e => {
        const prev = S.weightings; S.weightings = W.map(w => ({ ...w }));
        const ok = await withBusy(e.currentTarget, async () => !!(await api.saveWeightings()));
        if (ok) { dirty = false; saveSnapshot(); setTimeout(draw, 1700); } else { S.weightings = prev; toast(saveError(), 'err', 5000); }
      };
      drawBars(cur);
    }
    function drawBars(cur) {
      const mx = Math.max(1, ...W.flatMap(w => [cur(w.s), w.p || 0, w.sp])) * 1.08;
      const bar = (v, c, d) => `<div class="row" style="gap:8px;height:12px"><span style="flex:1;height:8px;border-radius:5px;background:var(--surface-3);overflow:hidden"><i style="display:block;height:100%;width:${v / mx * 100}%;background:${c};border-radius:5px;transform-origin:left;animation:growX .7s ${d}ms var(--ease-out) both"></i></span><span class="tabular" style="width:44px;text-align:right;font-size:12px;font-weight:600">${v.toFixed(1)}%</span></div>`;
      $('#w-bars').innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px 28px">${W.map((w, i) => `<div>
        <div class="row" style="gap:8px;margin-bottom:8px;font-weight:700;font-size:13px"><span class="dot" style="background:${sectorColor(w.s)}"></span>${esc(w.s)}</div>
        <div class="stack" style="gap:5px">${bar(cur(w.s), 'var(--s1)', i * 30)}${w.p == null ? '' : bar(w.p, 'var(--s4)', i * 30 + 60)}${bar(w.sp, 'var(--axis)', i * 30 + 120)}</div></div>`).join('')}</div>`;
    }
    draw();
  },
};

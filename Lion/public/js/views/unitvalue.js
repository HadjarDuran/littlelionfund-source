// ---------------------------------------------------------------------------
// views/unitvalue.js — the fund's official month-end unit value record since
// 2012 (hand-entered). Chart vs. benchmarks, stats, and add/edit/delete rows.
// ---------------------------------------------------------------------------

VIEWS.unitvalue = {
  head: () => ({ title: 'Unit Value', sub: isUnlocked('holdings') ? `${S.uv.length} months recorded` : 'Locked' }),
  render(el) {
    if (!isUnlocked('holdings')) return lockGate(el, 'unitvalue', 'Unit Value', () => render());
    const fs = fundSeries();
    const rows = S.uv.map((r, i) => ({ ...r, i, iso: dt.fromMDY(r.d) })).sort((a, b) => a.iso.localeCompare(b.iso));
    let editIdx = null;
    const latest = rows[rows.length - 1], prev = rows[rows.length - 2], first = rows[0];
    const mChg = latest && prev ? (latest.u / prev.u - 1) * 100 : null;
    const live = totals().unit;
    const liveOk = totals().count && totals().priced === totals().count;
    const itd = first ? ((liveOk ? live : latest.u) / first.u - 1) * 100 : null;
    // Month-ends between the last recorded month and today with no entry yet.
    const missing = [];
    if (latest) { let m = nextMonthEnd(latest.iso); while (m < dt.today()) { missing.push(m); m = nextMonthEnd(m); } }
    // A month that jumps >10% and reverses >10% the next month is probably a typo.
    const spikes = new Set();
    rows.forEach((r, k) => { const a = rows[k - 1], b = rows[k + 1]; if (a && b) { const up = r.u / a.u - 1, back = b.u / r.u - 1; if (Math.abs(up) > 0.1 && Math.abs(back) > 0.1 && Math.sign(up) !== Math.sign(back)) spikes.add(r.i); } });

    el.innerHTML = `<div class="view stack">
      <div class="grid g-4 stagger">
        <div class="card kpi"><div class="kpi-label">${icon('coins')}Latest recorded</div><div class="kpi-value tabular">${latest ? fmt.usd(latest.u) : '—'}</div><div class="kpi-foot">${latest ? dt.long(latest.iso) : ''}${mChg != null ? ` · <span class="${signCls(mChg)}">${fmt.pct(mChg)}</span> vs. prior` : ''}</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('activity')}Live estimate</div><div class="kpi-value tabular">${fmt.usd(live)}</div><div class="kpi-foot">Fund value ÷ ${fmt.shares(S.units)} units, right now</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('trending-up')}Since ${first ? dt.monYr(first.iso) : '—'}${liveOk ? ' (live)' : ''}</div><div class="kpi-value tabular ${signCls(itd)}">${itd != null ? fmt.pct(itd, 1) : '—'}</div><div class="kpi-foot">${itd != null ? fmt.pct(annualize(itd, first.iso, liveOk ? dt.today() : latest.iso), 1) + ' per year, compounded' : ''}</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('calendar-days')}Next entry due</div><div class="kpi-value" style="font-size:18px">${latest ? dt.long(nextMonthEnd(latest.iso)) : '—'}</div><div class="kpi-foot">${missing.length ? `<span class="badge warn">${icon('triangle-alert', 'xs')}${missing.length} month${missing.length > 1 ? 's' : ''} not recorded yet</span>` : 'Month-end, after the statement'}</div></div>
      </div>
      <div id="uv-chart"></div>
      <div class="grid g-main" style="align-items:start">
        <div class="card" id="uv-table"></div>
        <div class="card"><div class="card-h"><div class="card-t" id="uv-form-t">${icon('plus')}Add month</div></div>
          <form class="card-b stack" id="uv-form" style="gap:12px">
            <div class="field"><label for="uv-d">Month-end date</label><input class="input" id="uv-d" type="date" value="${latest ? nextMonthEnd(latest.iso) : ''}"/></div>
            <div class="field"><label for="uv-u">Unit value ($)</label><input class="input" id="uv-u" type="number" step="0.0001" placeholder="e.g. ${live.toFixed(2)}"/>
              <div class="hint"><a href="#" id="uv-use-live">Use live estimate (${fmt.usd(live)})</a></div></div>
            <div class="field"><label for="uv-sp">S&amp;P 500 index level (optional)</label><input class="input" id="uv-sp" type="number" step="0.01" placeholder="e.g. 6800.00"/></div>
            <div class="row"><button class="btn primary" type="submit" style="flex:1">${icon('check', 'sm')}<span id="uv-btn-l">Add month</span></button><button class="btn ghost" type="button" id="uv-cancel" hidden>Cancel</button></div>
          </form></div>
      </div></div>`;

    const card = chartCard($('#uv-chart'), {
      id: 'uv', title: 'Unit value history', titleIcon: 'chart-line', height: 340,
      defaults: { range: 'MAX', mode: 'value', compare: ['SPY'] },
      build: ctx => portfolioBuild({ ...ctx, source: 'fund' }),
    });

    function drawTable() {
      const list = [...rows].reverse();
      $('#uv-table').innerHTML = `<div class="card-h bordered"><div class="card-t">${icon('table')}Monthly record</div><div class="card-sub">${rows.length} months · click a row to edit</div></div>
        <div class="table-wrap" style="max-height:520px"><table class="t"><thead><tr><th class="left">Month-end</th><th>Unit value</th><th>Month change</th><th>Since start</th><th>S&amp;P 500</th><th></th></tr></thead><tbody>
        ${list.map((r, k) => {
          const p = list[k + 1];
          const mc = p ? (r.u / p.u - 1) * 100 : null;
          const yearBreak = p && p.iso.slice(0, 4) !== r.iso.slice(0, 4);
          return `<tr class="click" data-i="${r.i}" style="${yearBreak ? 'box-shadow:inset 0 -2px 0 var(--border-strong)' : ''}${editIdx === r.i ? ';background:var(--accent-soft)' : ''}">
            <td class="left muted">${dt.long(r.iso)}${spikes.has(r.i) ? ' <span class="badge warn" title="Jumps more than 10% and reverses the next month. Worth checking this entry for a typo.">check</span>' : ''}</td><td class="strong">${fmt.usd(r.u)}</td>
            <td class="${signCls(mc)}">${mc != null ? fmt.pct(mc) : '—'}</td><td class="${signCls(r.u - first.u)}">${fmt.pct((r.u / first.u - 1) * 100, 1)}</td>
            <td class="muted">${r.sp ? r.sp.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</td>
            <td><button class="icon-btn" data-del="${r.i}" aria-label="Delete ${dt.long(r.iso)}">${icon('trash-2', 'sm')}</button></td></tr>`;
        }).join('')}</tbody></table></div>`;
      $$('tr[data-i]', el).forEach(tr => tr.onclick = e => { if (!e.target.closest('[data-del]')) startEdit(+tr.dataset.i); });
      $$('[data-del]', el).forEach(b => b.onclick = async e => {
        e.stopPropagation();
        const r = S.uv[+b.dataset.del];
        if (!await confirmModal({ title: 'Delete this month?', text: `Remove the ${r.d} entry (${fmt.usd(r.u)})? This can't be undone.`, confirm: 'Delete', danger: true })) return;
        const prevUv = S.uv.slice(); S.uv.splice(+b.dataset.del, 1); invalidate();
        if (await api.saveUV()) { toast('Entry deleted'); saveSnapshot(); render(); } else { S.uv = prevUv; invalidate(); toast(saveError(), 'err', 5000); }
      });
    }
    function startEdit(i) {
      editIdx = i; const r = S.uv[i];
      $('#uv-d').value = dt.fromMDY(r.d); $('#uv-u').value = r.u; $('#uv-sp').value = r.sp ?? '';
      $('#uv-form-t').innerHTML = icon('pencil') + 'Edit ' + dt.long(dt.fromMDY(r.d));
      $('#uv-btn-l').textContent = 'Update'; $('#uv-cancel').hidden = false;
      drawTable(); $('#uv-u').focus();
    }
    $('#uv-cancel').onclick = () => { editIdx = null; render(); };
    $('#uv-use-live').onclick = e => { e.preventDefault(); $('#uv-u').value = live.toFixed(2); };
    $('#uv-form').onsubmit = async e => {
      e.preventDefault();
      const d = $('#uv-d').value, u = parseFloat($('#uv-u').value), spRaw = $('#uv-sp').value.trim();
      if (!d) { $('#uv-d').classList.add('err'); return; }
      if (!(u > 0)) { $('#uv-u').classList.add('err'); return; }
      const rec = { d: dt.toMDY(d), u, sp: spRaw ? parseFloat(spRaw) : null };
      const dup = S.uv.findIndex((r, i) => dt.fromMDY(r.d) === d && i !== editIdx);
      if (dup >= 0) { toast('There is already an entry for that date. Edit it instead', 'err'); return; }
      const prevUv = S.uv.slice();
      if (editIdx != null) S.uv[editIdx] = rec; else S.uv.push(rec);
      S.uv.sort((a, b) => dt.fromMDY(a.d).localeCompare(dt.fromMDY(b.d)));
      invalidate();
      const ok = await withBusy(e.submitter || $('#uv-form button[type=submit]'), async () => !!(await api.saveUV()));
      if (!ok) { S.uv = prevUv; invalidate(); toast(saveError(), 'err', 5000); return; }
      saveSnapshot(); editIdx = null; setTimeout(() => { render(); renderRail(); }, 600);
    };
    drawTable();
    return () => card.destroy();
  },
};

function nextMonthEnd(iso) {
  const d = dt.parse(iso); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 2); d.setUTCDate(0);
  return dt.iso(d);
}

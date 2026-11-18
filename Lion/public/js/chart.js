// ---------------------------------------------------------------------------
// chart.js — the app's chart engine (plain SVG, no library).
//
//   const c = lineChart(el, cfg);  c.update(cfg);  c.destroy();
//
// cfg = {
//   series:  [{ key, name, color, points:[{d,v}], primary?, dashed? }],
//   mode:    'value' | 'pct'      $ values, or % change from the first point
//   scale:   'linear' | 'log'
//   yMode:   'auto' | 'zero' | 'manual', yMin, yMax  (manual bounds in $ or %)
//   height, fmt (formats a $ value), markers:[{d, type:'buy'|'sell', text}],
//   measure: true (drag to measure, desktop), animate: true, area: true
//   xIndex: true    space points evenly (intraday: nights/weekends squeezed out)
//   refLine: { v, label }   dashed reference line in $ (e.g. previous close)
// }
//
// One y-axis only. When comparing series in 'value' mode, every non-primary
// series is rebased to start at the primary's first value ("what the same
// money would have done"); in 'pct' mode all series start at 0%.
// The x-axis is real calendar time, so gaps (weekends, a monthly series next
// to a daily one) are drawn to scale.
// ---------------------------------------------------------------------------

const SVGNS = 'http://www.w3.org/2000/svg';
const ms = d => (d.length > 10 ? Date.parse(d) : Date.parse(d + 'T00:00:00Z'));

function niceStep(range, target) {
  const raw = range / Math.max(target, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 3.5 ? 2.5 : n < 7 ? 5 : 10) * mag;
}
function round2sig(v) {
  if (v === 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1);
  return Math.round(v / p) * p;
}

// Keep the shape, drop the excess: at most ~2 points (min & max) per pixel.
function downsample(pts, width) {
  const budget = Math.max(200, Math.floor(width * 1.5));
  if (pts.length <= budget) return pts;
  const per = pts.length / (budget / 2);
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i += per) {
    const chunk = pts.slice(Math.floor(i), Math.min(pts.length - 1, Math.floor(i + per)));
    if (!chunk.length) continue;
    let lo = chunk[0], hi = chunk[0];
    for (const p of chunk) { if (p.y < lo.y) lo = p; if (p.y > hi.y) hi = p; }
    if (lo.t <= hi.t) out.push(lo, hi); else out.push(hi, lo);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function timeTicks(t0, t1, width) {
  const spanDays = (t1 - t0) / 864e5;
  const maxTicks = Math.max(2, Math.floor(width / 92));
  const out = [];
  if (spanDays <= 70) {
    const stepDays = [1, 2, 7, 14].find(s => spanDays / s <= maxTicks) || 14;
    const d = new Date(t0); d.setUTCHours(0, 0, 0, 0);
    while (d.getTime() <= t1) {
      if (d.getTime() >= t0) out.push({ t: d.getTime(), label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` });
      d.setUTCDate(d.getUTCDate() + stepDays);
    }
    return out;
  }
  const stepM = [1, 2, 3, 6, 12, 24, 36, 60].find(s => spanDays / 30.44 / s <= maxTicks) || 60;
  const d = new Date(t0); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
  if (stepM >= 12) d.setUTCMonth(0);
  else d.setUTCMonth(Math.ceil(d.getUTCMonth() / stepM) * stepM);
  while (d.getTime() <= t1) {
    if (d.getTime() >= t0) {
      const m = d.getUTCMonth(), y = d.getUTCFullYear();
      const label = stepM >= 12 ? String(y) : m === 0 ? String(y) : MONTHS[m] + (spanDays > 400 ? ` '${String(y).slice(2)}` : '');
      out.push({ t: d.getTime(), label, strong: m === 0 });
    }
    d.setUTCMonth(d.getUTCMonth() + stepM);
  }
  return out;
}

// x-axis labels for intraday (index-mode) charts: one per market day when
// the window spans several days ("Mon 17"), otherwise one per hour ("10 AM").
function intradayTicks(TS, xp, width) {
  const keys = TS.map(t => dt.etKey(new Date(t).toISOString()));
  const multi = keys[0] !== keys[keys.length - 1];
  const out = [];
  if (multi) {
    TS.forEach((t, i) => { if (i === 0 || keys[i] !== keys[i - 1]) out.push({ t, label: (() => { const parts = ET.wd.formatToParts(new Date(t)); const g = k => (parts.find(x => x.type === k) || {}).value || ''; return `${g('weekday')} ${g('day')}`; })(), strong: true }); });
  } else {
    let last = null;
    TS.forEach(t => { const h = ET.hour.format(new Date(t)); if (h !== last) { if (last !== null) out.push({ t, label: h }); last = h; } });
  }
  // keep labels at least ~70px apart
  const kept = []; let lx = -1e9;
  out.forEach(o => { const x = xp(o.t); if (x - lx >= 70) { kept.push(o); lx = x; } });
  return kept;
}

function lineChart(el, cfg) {
  el.classList.add('chart-box');
  const st = { cfg, w: 0, drawn: false, sel: null };
  const tip = document.createElement('div'); tip.className = 'chart-tip';
  const mtip = document.createElement('div'); mtip.className = 'measure-tip'; mtip.hidden = true;

  function render(animate) {
    const c = st.cfg;
    const W = el.clientWidth - 18; // .chart-box horizontal padding
    if (W < 40) return;
    st.w = W;
    const H = c.height || 320;
    const fmtV = c.fmt || fmt.usdCompact;
    const valid = (c.series || []).filter(s => s.points && s.points.length >= 2);
    if (!valid.length) {
      el.innerHTML = `<div class="chart-empty" style="height:${H}px">${c.emptyText || 'No chart data yet'}</div>`;
      el.append(tip, mtip);
      return;
    }
    const primary = valid.find(s => s.primary) || valid[0];
    const p0 = primary.points[0].v;
    const pct = c.mode === 'pct';
    const log = c.scale === 'log';

    // display value (what labels show): $ or %
    const series = valid.map(s => {
      const base = s.points[0].v;
      const k = pct ? null : (s === primary ? 1 : p0 / base);
      const pts = s.points.map(p => {
        const disp = pct ? (p.v / base - 1) * 100 : p.v * k;
        return { d: p.d, t: ms(p.d), v: p.v, disp };
      });
      return { ...s, pts, rebased: !pct && s !== primary };
    });

    // y transform (log needs positive numbers: $ value, or growth factor 1+r)
    const fwd = v => log ? Math.log(pct ? 1 + v / 100 : Math.max(v, 1e-9)) : v;
    const inv = y => log ? (pct ? (Math.exp(y) - 1) * 100 : Math.exp(y)) : y;
    let lo = Infinity, hi = -Infinity;
    series.forEach(s => s.pts.forEach(p => { const y = fwd(p.disp); if (y < lo) lo = y; if (y > hi) hi = y; }));
    const prim0 = series.find(s => s.primary) || series[0];
    const refDisp = c.refLine && c.refLine.v > 0 ? (pct ? (c.refLine.v / prim0.points[0].v - 1) * 100 : c.refLine.v) : null;
    if (refDisp != null && c.yMode !== 'manual') { const y = fwd(refDisp); if (isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); } }
    if (c.yMode === 'zero' && !log) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (c.yMode === 'manual') {
      if (c.yMin != null && isFinite(c.yMin) && (!log || (pct ? c.yMin > -100 : c.yMin > 0))) lo = fwd(c.yMin);
      if (c.yMax != null && isFinite(c.yMax)) hi = fwd(c.yMax);
      if (hi <= lo) hi = lo + 1;
    } else {
      const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.08;
      if (!(c.yMode === 'zero' && lo === 0)) lo -= pad;
      hi += pad;
    }

    const compact = !!c.compact;
    const PL = 6, PR = compact ? 6 : 62, PT = 14, PB = compact ? 8 : 28;
    const CW = W - PL - PR, CH = H - PT - PB;
    let t0 = Infinity, t1 = -Infinity;
    series.forEach(s => { t0 = Math.min(t0, s.pts[0].t); t1 = Math.max(t1, s.pts[s.pts.length - 1].t); });
    if (t1 === t0) t1 = t0 + 864e5;
    let xp = t => PL + (t - t0) / (t1 - t0) * CW;
    let xInv = x => t0 + Math.max(0, Math.min(1, (x - PL) / CW)) * (t1 - t0);
    // Index mode: the primary series' points are evenly spaced, so the hours
    // the market is closed take no room. Other series map onto the same scale.
    const TS = c.xIndex ? prim0.pts.map(p => p.t) : null;
    if (TS && TS.length > 1) {
      const n = TS.length;
      t0 = TS[0]; t1 = TS[n - 1];
      xp = t => {
        if (t <= TS[0]) return PL;
        if (t >= TS[n - 1]) return PL + CW;
        let a = 0, b = n - 1;
        while (b - a > 1) { const m = (a + b) >> 1; if (TS[m] <= t) a = m; else b = m; }
        const f = (t - TS[a]) / ((TS[b] - TS[a]) || 1);
        return PL + (a + Math.min(1, f)) / (n - 1) * CW;
      };
      xInv = x => {
        const f = Math.max(0, Math.min(1, (x - PL) / CW)) * (n - 1);
        const a = Math.floor(f), b = Math.min(n - 1, a + 1);
        return TS[a] + (f - a) * (TS[b] - TS[a]);
      };
      // drop compared points that fall outside the primary's window
      series.forEach(s => { if (!s.primary) s.pts = s.pts.filter(p => p.t >= t0 && p.t <= t1); });
    }
    const yp = y => PT + (1 - (y - lo) / (hi - lo)) * CH;
    st.geom = { PL, PR, PT, PB, CW, CH, W, H, t0, t1, xp, xInv, yp, fwd, inv, lo, hi, series, primary: series.find(s => s.primary) || series[0], pct, fmtV };

    // y ticks
    const yticks = [];
    if (log) {
      // Candidate "nice" values, then keep an evenly spread subset that fits.
      const cands = [];
      if (pct) [-90, -75, -50, -40, -30, -20, -10, -5, 0, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000].forEach(v => cands.push(v));
      else for (let e = -2; e <= 9; e++) [1, 1.5, 2, 2.5, 3, 4, 5, 7.5].forEach(m => cands.push(m * Math.pow(10, e)));
      const inside = cands.filter(v => { const y = fwd(v); return isFinite(y) && y >= lo && y <= hi; });
      const want = Math.max(3, Math.min(7, Math.floor(CH / 50)));
      let lastY = -Infinity;
      const minGap = (hi - lo) / (want + 1);
      inside.forEach(v => { const y = fwd(v); if (y - lastY >= minGap) { yticks.push({ y, disp: v }); lastY = y; } });
      if (yticks.length < 2) for (let i = 0; i <= 4; i++) { const disp = round2sig(inv(lo + (hi - lo) * i / 4)); yticks.push({ y: fwd(disp), disp }); }
    } else {
      const step = niceStep(hi - lo, Math.max(3, Math.floor(CH / 56)));
      for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) yticks.push({ y: v, disp: v });
    }
    const yLabel = d => pct ? (Math.abs(d) < 1e-9 ? '0%' : (d > 0 ? '+' : '') + (Math.abs(d) >= 100 ? d.toFixed(0) : Math.abs(d) >= 10 ? d.toFixed(0) : d.toFixed(1)) + '%') : fmtV(d);

    let g = '';
    if (!compact) {
      g += '<g class="grid">' + yticks.map(t => `<line x1="${PL}" x2="${PL + CW}" y1="${yp(t.y).toFixed(1)}" y2="${yp(t.y).toFixed(1)}"/>`).join('') + '</g>';
      const lastP = series.find(s => s.primary) || series[0];
      const tagY = yp(fwd(lastP.pts[lastP.pts.length - 1].disp));
      g += '<g class="axis">' + yticks.filter(t => Math.abs(yp(t.y) - tagY) > 15).map(t => `<text x="${PL + CW + 10}" y="${(yp(t.y) + 4).toFixed(1)}">${esc(yLabel(t.disp))}</text>`).join('');
      g += (TS ? intradayTicks(TS, xp, CW) : timeTicks(t0, t1, CW)).map((t, i, a) => {
        const x = xp(t.t);
        if (x < PL + 14 || x > PL + CW - 14) return '';
        return `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" ${t.strong ? 'font-weight="700"' : ''}>${esc(t.label)}</text>`;
      }).join('') + '</g>';
      if (refDisp != null) {
        const ry = yp(fwd(refDisp));
        if (ry >= PT && ry <= PT + CH) g += `<g class="refline"><line x1="${PL}" x2="${PL + CW}" y1="${ry.toFixed(1)}" y2="${ry.toFixed(1)}" stroke="var(--axis)" stroke-dasharray="2 4" stroke-width="1.25"/>
          <text x="${PL + 4}" y="${(ry - 6).toFixed(1)}" font-size="10.5" fill="var(--muted)" font-weight="600" paint-order="stroke" stroke="var(--surface)" stroke-width="4" stroke-linejoin="round">${esc(c.refLine.label || '')}</text></g>`;
      }
      if (pct && lo < 0 && hi > 0 && refDisp == null) g += `<g class="zero"><line x1="${PL}" x2="${PL + CW}" y1="${yp(fwd(0)).toFixed(1)}" y2="${yp(fwd(0)).toFixed(1)}"/></g>`;
    }

    // lines (secondary first so the primary sits on top)
    const ordered = [...series].sort((a, b) => (a.primary ? 1 : 0) - (b.primary ? 1 : 0));
    const gid = 'ga' + Math.random().toString(36).slice(2, 8);
    let lines = '', defs = '';
    for (const s of ordered) {
      const raw = s.pts.map(p => ({ t: p.t, x: xp(p.t), y: yp(fwd(p.disp)) }));
      const pts = downsample(raw, CW);
      const dpath = 'M' + pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join('L');
      if (s.primary && c.area !== false && !compact) {
        defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${s.color}" stop-opacity=".20"/><stop offset="100%" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
        lines += `<path class="${animate ? 'chart-area' : ''}" d="${dpath}L${pts[pts.length - 1].x.toFixed(1)},${PT + CH}L${pts[0].x.toFixed(1)},${PT + CH}Z" fill="url(#${gid})"/>`;
      } else if (s.primary && compact && c.area !== false) {
        defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${s.color}" stop-opacity=".16"/><stop offset="100%" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
        lines += `<path d="${dpath}L${pts[pts.length - 1].x.toFixed(1)},${PT + CH + PB}L${pts[0].x.toFixed(1)},${PT + CH + PB}Z" fill="url(#${gid})"/>`;
      }
      lines += s.dashed
        ? `<path class="chart-line" d="${dpath}" stroke="${s.color}" stroke-dasharray="5 4" ${animate ? 'style="opacity:0;animation:fadeIn .6s .2s forwards"' : ''}/>`
        : `<path class="chart-line ${s.primary ? 'primary' : ''} ${animate ? 'draw' : ''}" pathLength="1" d="${dpath}" stroke="${s.color}"/>`;
      // end dot
      const last = pts[pts.length - 1];
      lines += `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="${s.primary ? 3.5 : 2.5}" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5" ${animate ? 'style="opacity:0;animation:fadeIn .3s .8s forwards"' : ''}/>`;
    }

    // last-value tag for the primary series on the y-axis
    let tag = '';
    if (!compact) {
      const lp = st.geom.primary.pts[st.geom.primary.pts.length - 1];
      const y = Math.max(PT + 8, Math.min(PT + CH - 8, yp(fwd(lp.disp))));
      const label = yLabel(lp.disp);
      const tw = Math.max(44, label.length * 6.6 + 12);
      tag = `<g><rect x="${PL + CW + 4}" y="${(y - 10).toFixed(1)}" width="${tw}" height="20" rx="6" fill="var(--surface)" stroke="${st.geom.primary.color}" stroke-width="1.5"/>
        <text x="${PL + CW + 10}" y="${(y + 4).toFixed(1)}" font-size="11" font-weight="700" fill="var(--text)" style="font-variant-numeric:tabular-nums">${esc(label)}</text></g>`;
    }

    // trade markers along the primary line
    let marks = '';
    if (c.markers && c.markers.length && !TS) {
      const pp = st.geom.primary.pts;
      const groups = {};
      for (const m of c.markers) {
        const t = ms(m.d);
        if (t < t0 || t > t1) continue;
        const key = m.d + m.type;
        (groups[key] = groups[key] || { ...m, t, items: [] }).items.push(m);
      }
      for (const gm of Object.values(groups)) {
        const i = Math.max(0, bisectDate(pp, gm.d));
        const y = yp(fwd(pp[i].disp));
        const x = xp(gm.t);
        const col = gm.type === 'sell' ? 'var(--sell)' : 'var(--buy)';
        const tipTxt = encodeURIComponent(gm.items.map(m => m.text).join('\n'));
        const dy = gm.type === 'sell' ? -14 : 14;
        marks += `<g class="chart-marker" data-tip="${tipTxt}" data-date="${gm.d}">
          <line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y.toFixed(1)}" y2="${(y + dy * .55).toFixed(1)}" stroke="${col}" stroke-width="1.5"/>
          <circle cx="${x.toFixed(1)}" cy="${(y + dy).toFixed(1)}" r="7" fill="${col}" stroke="var(--surface)" stroke-width="2"/>
          <text x="${x.toFixed(1)}" y="${(y + dy + 3.5).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="800" fill="#fff">${gm.type === 'sell' ? 'S' : 'B'}</text>
          <rect x="${(x - 11).toFixed(1)}" y="${(y + dy - 11).toFixed(1)}" width="22" height="22" fill="transparent"/></g>`;
      }
    }

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(c.ariaLabel || 'Line chart')}">
      <defs>${defs}</defs>${g}<g>${lines}</g>
      <rect class="chart-band" y="${PT}" height="${CH}" x="0" width="0" opacity="0"/>
      <line class="chart-band-edge a" y1="${PT}" y2="${PT + CH}" opacity="0"/><line class="chart-band-edge b" y1="${PT}" y2="${PT + CH}" opacity="0"/>
      <line class="chart-hair" y1="${PT}" y2="${PT + CH}" opacity="0"/>
      <g class="dots"></g>${tag}
      <rect class="hit" x="${PL}" y="0" width="${CW}" height="${H}" fill="transparent" style="cursor:crosshair"/>
      <g class="markers">${marks}</g>
    </svg>`;
    el.append(tip, mtip);
    wire();
    if (st.sel) paintSel(st.sel[0], st.sel[1]);
  }

  // ---- interaction --------------------------------------------------------
  function idxAt(s, t) {
    let lo = 0, hi = s.pts.length - 1;
    if (t <= s.pts[0].t) return 0;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s.pts[m].t <= t) lo = m; else hi = m - 1; }
    if (lo < s.pts.length - 1 && s.pts[lo + 1].t - t < t - s.pts[lo].t) return lo + 1;
    return lo;
  }
  function tFromEvent(e) {
    const svg = el.querySelector('svg'); const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) * (st.w / r.width);
    return st.geom.xInv(x);
  }
  function fmtDisp(s, p, G) {
    if (G.pct) return fmt.pct(p.disp);
    return s.rebased ? G.fmtV(p.disp) : fmt.usd(p.disp);
  }
  function showHover(e) {
    const G = st.geom; if (!G) return;
    const t = tFromEvent(e);
    const pr = G.primary, i = idxAt(pr, t), pt = pr.pts[i];
    const x = G.xp(pt.t);
    const hair = el.querySelector('.chart-hair');
    hair.setAttribute('x1', x); hair.setAttribute('x2', x); hair.setAttribute('opacity', 1);
    const rows = G.series.map(s => {
      const j = idxAt(s, pt.t); const p = s.pts[j];
      return { s, p, x: G.xp(p.t), y: G.yp(G.fwd(p.disp)) };
    });
    el.querySelector('.dots').innerHTML = rows.map(r => `<circle class="chart-dot" cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="${r.s.primary ? 5 : 4}" fill="${r.s.color}"/>`).join('');
    const sorted = [...rows].sort((a, b) => b.p.disp - a.p.disp);
    let html = `<div class="tip-date">${dt.long(pt.d)}</div>`;
    for (const r of sorted) {
      html += `<div class="tip-row"><span class="key" style="background:${r.s.color}"></span><span class="nm"></span><b>${esc(fmtDisp(r.s, r.p, G))}</b></div>`;
    }
    if (!G.pct && G.series.length === 1) {
      const chg = pt.disp - pr.pts[0].disp;
      html += `<div class="tip-row"><span class="nm">vs. start</span><b class="${signCls(chg)}">${fmt.pct(chg / pr.pts[0].disp * 100)}</b></div>`;
    }
    tip.innerHTML = html;
    // series names go in as text, never as HTML (they can come from data)
    $$('.tip-row .nm', tip).forEach((n, k) => { if (sorted[k]) n.textContent = sorted[k].s.name; });
    tip.classList.add('on');
    const box = el.getBoundingClientRect(), svgR = el.querySelector('svg').getBoundingClientRect();
    const px = (x / st.w) * svgR.width + (svgR.left - box.left);
    const tw = tip.offsetWidth;
    let left = px + 16;
    if (left + tw > box.width - 4) left = px - tw - 16;
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = '12px';
  }
  function hideHover() {
    tip.classList.remove('on');
    const hair = el.querySelector('.chart-hair'); if (hair) hair.setAttribute('opacity', 0);
    const dots = el.querySelector('.dots'); if (dots) dots.innerHTML = '';
  }
  function paintSel(ta, tb) {
    const G = st.geom; if (!G) return;
    const pr = G.primary;
    const ia = idxAt(pr, Math.min(ta, tb)), ib = idxAt(pr, Math.max(ta, tb));
    const a = pr.pts[ia], b = pr.pts[ib];
    const xa = G.xp(a.t), xb = G.xp(b.t);
    const band = el.querySelector('.chart-band');
    band.setAttribute('x', xa); band.setAttribute('width', Math.max(0, xb - xa)); band.setAttribute('opacity', ia === ib ? 0 : 1);
    $$('.chart-band-edge', el).forEach((l, k) => { const x = k ? xb : xa; l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('opacity', ia === ib ? 0 : 1); });
    if (ia === ib) { mtip.hidden = true; return; }
    const lines = G.series.map(s => {
      const pa = s.pts[idxAt(s, a.t)], pb = s.pts[idxAt(s, b.t)];
      const r = (pb.v / pa.v - 1) * 100;
      return { s, r, abs: pb.v - pa.v };
    });
    const main = lines.find(l => l.s === pr);
    let html = `<span class="${''}">${!G.pct && !pr.rebased && G.series.length === 1 ? fmt.usdSigned(main.abs) + ' · ' : ''}${fmt.pct(main.r)}</span>`;
    if (lines.length > 1) html += '<small>' + lines.filter(l => l !== main).map(l => `${esc(l.s.name)} ${fmt.pct(l.r)}`).join(' · ') + '</small>';
    html += `<small>${dt.long(a.d)} → ${dt.long(b.d)} · ${dt.span(a.d, b.d)}</small>`;
    mtip.innerHTML = html;
    mtip.hidden = false;
    const svgR = el.querySelector('svg').getBoundingClientRect(), box = el.getBoundingClientRect();
    const mid = ((xa + xb) / 2 / st.w) * svgR.width + (svgR.left - box.left);
    mtip.style.left = Math.max(4, Math.min(box.width - mtip.offsetWidth - 4, mid - mtip.offsetWidth / 2)) + 'px';
  }
  function clearSel() {
    st.sel = null; mtip.hidden = true;
    const band = el.querySelector('.chart-band'); if (band) band.setAttribute('opacity', 0);
    $$('.chart-band-edge', el).forEach(l => l.setAttribute('opacity', 0));
  }

  function wire() {
    const hit = el.querySelector('.hit'); if (!hit) return;
    let dragStart = null, moved = false;
    hit.addEventListener('pointermove', e => {
      if (dragStart != null && e.pointerType !== 'touch') {
        const t = tFromEvent(e);
        if (Math.abs(t - dragStart) > (st.geom.t1 - st.geom.t0) / 400) moved = true;
        st.sel = [dragStart, t]; paintSel(dragStart, t); hideHover(); return;
      }
      showHover(e);
    });
    hit.addEventListener('pointerleave', () => { if (dragStart == null) hideHover(); });
    hit.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') { showHover(e); return; } // touch = scrub (Robinhood-style)
      if (st.cfg.measure === false) return;
      dragStart = tFromEvent(e); moved = false; hit.setPointerCapture(e.pointerId); hideHover();
    });
    const end = () => { if (dragStart != null && !moved) clearSel(); dragStart = null; };
    hit.addEventListener('pointerup', end);
    hit.addEventListener('pointercancel', () => { dragStart = null; hideHover(); });
    hit.addEventListener('dblclick', clearSel);
    // marker tooltips
    $$('.chart-marker', el).forEach(m => {
      m.addEventListener('pointerenter', () => {
        tip.innerHTML = `<div class="tip-date">${dt.long(m.dataset.date)}</div>` + decodeURIComponent(m.dataset.tip).split('\n').map(l => `<div class="tip-row"><span class="nm" style="max-width:240px;white-space:normal"></span></div>`).join('');
        $$('.nm', tip).forEach((n, k) => { n.textContent = decodeURIComponent(m.dataset.tip).split('\n')[k]; });
        tip.classList.add('on');
        const box = el.getBoundingClientRect(), r = m.getBoundingClientRect();
        tip.style.left = Math.max(4, Math.min(box.width - tip.offsetWidth - 4, r.left - box.left - tip.offsetWidth / 2)) + 'px';
        tip.style.top = Math.max(4, r.top - box.top - tip.offsetHeight - 8) + 'px';
      });
      m.addEventListener('pointerleave', () => tip.classList.remove('on'));
    });
  }

  const ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - 18 - st.w) > 2) render(false); });
  ro.observe(el);
  render(cfg.animate !== false && !reducedMotion() && !window.__quiet);

  return {
    update(next, animate = true) { st.cfg = { ...st.cfg, ...next }; st.sel = null; mtip.hidden = true; render(animate && !reducedMotion() && !window.__quiet); },
    destroy() { ro.disconnect(); },
    get geom() { return st.geom; },
  };
}

// Small, non-interactive trend line (cards, rail snapshot).
function sparkline(el, points, color, { height = 40, area = true, baseline = false } = {}) {
  if (!el) return;
  if (!points || points.length < 2) { el.innerHTML = ''; return; }
  const W = Math.max(60, el.clientWidth || 200), H = height;
  let lo = Infinity, hi = -Infinity;
  points.forEach(p => { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); });
  const pad = (hi - lo || 1) * 0.1; lo -= pad; hi += pad;
  const t0 = ms(points[0].d), t1 = ms(points[points.length - 1].d) || t0 + 1;
  const pts = downsample(points.map(p => ({ t: ms(p.d), x: (ms(p.d) - t0) / (t1 - t0 || 1) * W, y: (1 - (p.v - lo) / (hi - lo)) * H })), W / 2);
  const d = 'M' + pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join('L');
  const id = 'sp' + Math.random().toString(36).slice(2, 7);
  const by = (1 - (points[0].v - lo) / (hi - lo)) * H;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block;overflow:visible">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".22"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${baseline ? `<line x1="0" x2="${W}" y1="${by.toFixed(1)}" y2="${by.toFixed(1)}" stroke="var(--border-strong)" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>` : ''}
    ${area ? `<path d="${d}L${W},${H}L0,${H}Z" fill="url(#${id})" class="${window.__quiet ? '' : 'chart-area'}"/>` : ''}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.75" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" class="chart-line ${window.__quiet ? '' : 'draw'}" pathLength="1"/>
  </svg>`;
}

// Donut with a hover readout in the middle. slices: [{name, value, color}]
function donut(el, slices, { size = 200, thickness = 26, centerLabel = '', centerValue = '' } = {}) {
  if (!el) return;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const R = size / 2 - 2, r = R - thickness, cx = size / 2, cy = size / 2;
  let a = -Math.PI / 2, paths = '';
  const gap = slices.length > 1 ? 0.012 : 0;
  slices.forEach((s, i) => {
    const sweep = s.value / total * Math.PI * 2;
    const a0 = a + gap / 2, a1 = a + sweep - gap / 2;
    a += sweep;
    if (a1 <= a0) return;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const P = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    const d = sweep >= Math.PI * 2 - 0.001
      ? `M${cx},${cy - R}A${R},${R} 0 1,1 ${cx - 0.01},${cy - R}ZM${cx},${cy - r}A${r},${r} 0 1,0 ${cx + 0.01},${cy - r}Z`
      : `M${P(R, a0)}A${R},${R} 0 ${large},1 ${P(R, a1)}L${P(r, a1)}A${r},${r} 0 ${large},0 ${P(r, a0)}Z`;
    paths += `<path d="${d}" fill="${s.color}" data-i="${i}" style="animation:fadeIn .5s ${i * 30}ms both"/>`;
  });
  el.innerHTML = `<div class="donut-wrap"><svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="animation:modalIn .6s var(--ease-out) both">${paths}</svg>
    <div class="donut-center"><div><b class="dc-v"></b><small class="dc-l"></small></div></div></div>`;
  const svg = el.querySelector('svg'), v = el.querySelector('.dc-v'), l = el.querySelector('.dc-l');
  const reset = () => { v.textContent = centerValue; l.textContent = centerLabel; svg.classList.remove('hovering'); };
  reset();
  $$('path', svg).forEach(p => {
    p.addEventListener('pointerenter', () => {
      const s = slices[+p.dataset.i];
      svg.classList.add('hovering');
      v.textContent = (s.value / total * 100).toFixed(1) + '%';
      l.textContent = s.name;
    });
    p.addEventListener('pointerleave', reset);
  });
}

// Vertical bars around a zero line, one series. rows: [{label, v, tip}]
function barChart(el, rows, { height = 220, color = 'var(--s1)', fmtV = fmt.usdCompact } = {}) {
  if (!el) return;
  if (!rows.length) { el.innerHTML = `<div class="chart-empty" style="height:${height}px">No data</div>`; return; }
  const W = Math.max(200, el.clientWidth), H = height, PL = 4, PR = 56, PT = 12, PB = 26;
  const CW = W - PL - PR, CH = H - PT - PB;
  let lo = Math.min(0, ...rows.map(r => r.v)), hi = Math.max(0, ...rows.map(r => r.v));
  const step = niceStep(hi - lo || 1, 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step || step;
  const yp = v => PT + (1 - (v - lo) / (hi - lo)) * CH;
  const bw = CW / rows.length, barW = Math.max(4, Math.min(34, bw - 6));
  let g = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    g += `<line x1="${PL}" x2="${PL + CW}" y1="${yp(v).toFixed(1)}" y2="${yp(v).toFixed(1)}" stroke="${Math.abs(v) < 1e-9 ? 'var(--border-strong)' : 'var(--grid)'}"/>`;
    g += `<text x="${PL + CW + 8}" y="${(yp(v) + 4).toFixed(1)}" font-size="11" fill="var(--axis)">${esc(fmtV(v))}</text>`;
  }
  const every = Math.ceil(rows.length / Math.max(1, Math.floor(CW / 44)));
  const y0 = yp(0);
  rows.forEach((r, i) => {
    const x = PL + i * bw + (bw - barW) / 2;
    const y = r.v >= 0 ? yp(r.v) : y0, h = Math.max(1, Math.abs(yp(r.v) - y0));
    const rad = Math.min(4, barW / 2, h);
    // rounded on the data end only, anchored flat on the zero line
    const d = r.v >= 0
      ? `M${x},${y + h}V${y + rad}Q${x},${y} ${x + rad},${y}H${x + barW - rad}Q${x + barW},${y} ${x + barW},${y + rad}V${y + h}Z`
      : `M${x},${y}V${y + h - rad}Q${x},${y + h} ${x + rad},${y + h}H${x + barW - rad}Q${x + barW},${y + h} ${x + barW},${y + h - rad}V${y}Z`;
    g += `<g class="bar" data-i="${i}"><path d="${d}" fill="${color}" style="transform-origin:${x}px ${y0}px;animation:barIn .6s ${i * 25}ms var(--ease-out) both"/>
      <rect x="${PL + i * bw}" y="${PT}" width="${bw}" height="${CH}" fill="transparent"/></g>`;
    if (i % every === 0) g += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--axis)">${esc(r.label)}</text>`;
  });
  el.classList.add('chart-box');
  el.style.padding = '4px 6px';
  el.innerHTML = `<style>@keyframes barIn{from{transform:scaleY(0)}to{transform:none}}.bar:hover path{filter:brightness(1.15)}</style>
    <svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Bar chart">${g}</svg><div class="chart-tip"></div>`;
  const tipEl = el.querySelector('.chart-tip');
  $$('.bar', el).forEach(b => {
    b.addEventListener('pointerenter', () => {
      const r = rows[+b.dataset.i];
      tipEl.innerHTML = `<div class="tip-date"></div><div class="tip-row"><span class="key" style="background:${color}"></span><span class="nm">Total</span><b>${esc(fmt.usdSigned(r.v))}</b></div>` + (r.tip || '');
      tipEl.querySelector('.tip-date').textContent = r.label;
      tipEl.classList.add('on');
      const box = el.getBoundingClientRect(), br = b.getBoundingClientRect();
      tipEl.style.left = Math.max(4, Math.min(box.width - tipEl.offsetWidth - 4, br.left - box.left + br.width / 2 - tipEl.offsetWidth / 2)) + 'px';
      tipEl.style.top = '6px';
    });
    b.addEventListener('pointerleave', () => tipEl.classList.remove('on'));
  });
}

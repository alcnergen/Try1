// Bağımlılıksız SVG çizgi grafik: tek eksen, artı imleçli ipucu, dokunmatik uyumlu.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

function niceTicks(min, max, n = 4) {
  if (min === max) { min -= Math.abs(min) * 0.01 || 1; max += Math.abs(max) * 0.01 || 1; }
  const step0 = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = [];
  for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
  return t;
}

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const fmtDateShort = (d) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;
const fmtDateAxis = (d, spanDays) => (spanDays > 400 ? `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(2, 4)}` : fmtDateShort(d));

/**
 * series: [{ name, color (css var), points: [[iso, v]], dashed?, area? }]
 * opts: { height, fmtY, fmtTip, baseline }
 */
export function lineChart(container, series, opts = {}) {
  container.innerHTML = '';
  const valid = series.filter((s) => s.points?.length);
  if (!valid.length) {
    container.innerHTML = '<div class="chart-empty">Grafik için yeterli veri yok</div>';
    return;
  }
  const W = Math.max(280, container.clientWidth || 320);
  const H = opts.height || 200;
  const pad = { l: 8, r: 52, t: 10, b: 22 };
  const allX = [...new Set(valid.flatMap((s) => s.points.map((p) => p[0])))].sort();
  const t0 = Date.parse(allX[0]), t1 = Date.parse(allX[allX.length - 1]);
  const span = Math.max(1, (t1 - t0) / 864e5);
  let ymin = Infinity, ymax = -Infinity;
  for (const s of valid) for (const [, v] of s.points) { if (v < ymin) ymin = v; if (v > ymax) ymax = v; }
  if (opts.baseline != null) { ymin = Math.min(ymin, opts.baseline); ymax = Math.max(ymax, opts.baseline); }
  const ticks = niceTicks(ymin, ymax);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (d) => pad.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const fmtY = opts.fmtY || ((v) => v.toLocaleString('tr-TR'));

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', class: 'chart-svg' });
  svg.setAttribute('aria-label', opts.label || valid.map((s) => s.name).join(', '));
  const grid = el('g', { class: 'grid' });
  for (const t of ticks) {
    grid.appendChild(el('line', { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t) }));
    const tx = el('text', { x: W - pad.r + 6, y: Y(t) + 4, class: 'tick' });
    tx.textContent = fmtY(t, ticks[1] - ticks[0]);
    grid.appendChild(tx);
  }
  if (opts.baseline != null) grid.appendChild(el('line', { x1: pad.l, x2: W - pad.r, y1: Y(opts.baseline), y2: Y(opts.baseline), class: 'baseline' }));
  const nx = Math.min(4, allX.length);
  for (let i = 0; i < nx; i++) {
    const d = allX[Math.round((i * (allX.length - 1)) / Math.max(1, nx - 1))];
    const tx = el('text', { x: X(d), y: H - 6, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle' });
    tx.textContent = fmtDateAxis(d, span);
    grid.appendChild(tx);
  }
  svg.appendChild(grid);

  for (const s of valid) {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    if (s.area && valid.length === 1) {
      const a = `${d}L${X(s.points[s.points.length - 1][0]).toFixed(1)},${Y(y0)}L${X(s.points[0][0]).toFixed(1)},${Y(y0)}Z`;
      svg.appendChild(el('path', { d: a, fill: s.color, class: 'area' }));
    }
    svg.appendChild(el('path', { d, stroke: s.color, class: 'line' + (s.dashed ? ' dashed' : '') }));
    if (s.points.length === 1) svg.appendChild(el('circle', { cx: X(s.points[0][0]), cy: Y(s.points[0][1]), r: 4, fill: s.color }));
  }

  const cross = el('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' });
  svg.appendChild(cross);
  const dots = valid.map((s) => { const c = el('circle', { r: 4, fill: s.color, class: 'dot', visibility: 'hidden' }); svg.appendChild(c); return c; });
  const hit = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' });
  svg.appendChild(hit);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  container.style.position = 'relative';
  container.append(svg, tip);

  const lookup = (s, d) => {
    let best = null;
    for (const p of s.points) { if (p[0] <= d) best = p; else break; }
    return best;
  };
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    let best = allX[0], bd = Infinity;
    for (const d of allX) { const dd = Math.abs(X(d) - x); if (dd < bd) { bd = dd; best = d; } }
    const cx = X(best);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    const rows = [];
    valid.forEach((s, i) => {
      const p = lookup(s, best);
      if (!p) { dots[i].setAttribute('visibility', 'hidden'); return; }
      dots[i].setAttribute('cx', X(p[0])); dots[i].setAttribute('cy', Y(p[1])); dots[i].setAttribute('visibility', 'visible');
      rows.push(`<div class="tip-row"><span class="sw" style="background:${s.color}"></span><span>${s.name}</span><b>${(opts.fmtTip || fmtY)(p[1])}</b></div>`);
    });
    tip.innerHTML = `<div class="tip-date">${best.split('-').reverse().join('.')}</div>${rows.join('')}`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const px = (cx / W) * r.width;
    tip.style.left = `${Math.min(Math.max(0, px - tw / 2), r.width - tw)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); };
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerdown', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', hide);
  svg.addEventListener('touchmove', (e) => { if (e.touches[0]) show(e.touches[0].clientX); }, { passive: true });
}

export function legend(series) {
  return `<div class="legend">${series.map((s) => `<span class="lg"><span class="sw" style="background:${s.color}"></span>${s.name}</span>`).join('')}</div>`;
}

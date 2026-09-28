// Hand-rolled SVG charts. No chart library, so the tool stays dependency-free.
// Colours come from CSS custom properties via inline style, so both themes work.

const NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
}

const c = (name) => `var(--${name})`;
const lerp = (a, b, k) => a + (b - a) * k;

/** Deterministic pseudo random, so blocks do not flicker between renders. */
function rng(seed) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * Top-surface illustration of one calibration block.
 * t in [-1, 1]: negative = under-extrusion (visible gaps), positive = over (ridges, bulges).
 */
export function surfacePattern(t, seed = 1) {
  const size = 60;
  const lines = 8;
  const pitch = size / lines;
  const width = Math.min(pitch * 1.25, Math.max(pitch * 0.45, pitch * (1 + 0.55 * t)));
  const rand = rng(seed + 7);
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' });

  const id = `g${seed}-${Math.round((t + 2) * 1000)}`;
  const grad = svg('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' }, [
    svg('stop', { offset: '0', style: `stop-color:${c('accent-2')}` }),
    svg('stop', { offset: '1', style: `stop-color:${c('accent')}` }),
  ]);
  root.append(svg('defs', {}, [grad]));
  root.append(svg('rect', { width: size, height: size, style: `fill:${t < 0 ? '#0b0e14' : c('accent')}` }));

  for (let i = 0; i < lines; i++) {
    const cy = pitch * (i + 0.5);
    const wobble = t > 0 ? t * 1.6 : 0;
    // Build a slightly wavy path for over-extruded lines.
    let d = `M 0 ${cy - width / 2}`;
    for (let x = 6; x <= size; x += 6) d += ` L ${x} ${cy - width / 2 + (rand() - 0.5) * wobble}`;
    d += ` L ${size} ${cy + width / 2}`;
    for (let x = size - 6; x >= 0; x -= 6) d += ` L ${x} ${cy + width / 2 + (rand() - 0.5) * wobble}`;
    d += ' Z';
    root.append(svg('path', { d, style: `fill:url(#${id})` }));
    root.append(svg('line', {
      x1: 0, x2: size, y1: cy - width / 4, y2: cy - width / 4,
      style: 'stroke:rgba(255,255,255,0.28);stroke-width:0.8',
    }));
    if (t > 0.3) {
      const bumps = Math.round(t * 3);
      for (let b = 0; b < bumps; b++) {
        root.append(svg('ellipse', {
          cx: rand() * size, cy: cy + (rand() - 0.5) * 2, rx: 2 + t * 2, ry: 1.2 + t,
          style: 'fill:rgba(255,255,255,0.35)',
        }));
      }
    }
  }
  return root;
}

/** Horizontal scale showing where the old and the new value sit. */
export function gauge(container, current, next) {
  const W = 400, H = 74, pad = 18;
  let lo = 0.85, hi = 1.1;
  for (const v of [current, next]) {
    if (Number.isFinite(v)) { lo = Math.min(lo, v - 0.02); hi = Math.max(hi, v + 0.02); }
  }
  const x = (v) => pad + ((v - lo) / (hi - lo)) * (W - 2 * pad);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const gid = 'gauge-grad';
  root.append(svg('defs', {}, [
    svg('linearGradient', { id: gid, x1: '0', x2: '1' }, [
      svg('stop', { offset: '0', style: `stop-color:${c('under')}` }),
      svg('stop', { offset: String((x(1) - pad) / (W - 2 * pad)), style: `stop-color:${c('good')}` }),
      svg('stop', { offset: '1', style: `stop-color:${c('over')}` }),
    ]),
  ]));
  root.append(svg('rect', { x: pad, y: 30, width: W - 2 * pad, height: 8, rx: 4, style: `fill:url(#${gid});opacity:0.55` }));
  for (let v = Math.ceil(lo * 20) / 20; v <= hi + 1e-9; v += 0.05) {
    root.append(svg('line', { x1: x(v), x2: x(v), y1: 40, y2: 46, class: 'axis' }));
    root.append(svg('text', { x: x(v), y: 60, 'text-anchor': 'middle', text: v.toFixed(2) }));
  }
  const cx = x(current);
  root.append(svg('circle', { cx, cy: 34, r: 7, style: `fill:${c('card')};stroke:${c('muted')};stroke-width:2.5` }));
  const close = Number.isFinite(next) && Math.abs(x(next) - cx) < 44;
  const curAnchor = !close ? 'middle' : next < current ? 'start' : 'end';
  root.append(svg('text', { x: cx + (close ? (next < current ? -4 : 4) : 0), y: 18, 'text-anchor': curAnchor, text: current.toFixed(3) }));
  if (Number.isFinite(next)) {
    const nx = x(next);
    if (Math.abs(nx - cx) > 10) {
      const dir = nx > cx ? 1 : -1;
      root.append(svg('path', {
        d: `M ${cx + dir * 9} 34 L ${nx - dir * 11} 34`,
        style: `stroke:${c('text')};stroke-width:2;fill:none`,
      }));
      root.append(svg('path', {
        d: `M ${nx - dir * 11} 29 L ${nx - dir * 4} 34 L ${nx - dir * 11} 39 Z`,
        style: `fill:${c('text')}`,
      }));
    }
    root.append(svg('circle', { cx: nx, cy: 34, r: 8, style: `fill:${c('accent')};stroke:${c('card')};stroke-width:2.5` }));
    const nextAnchor = !close ? 'middle' : next < current ? 'end' : 'start';
    const lbl = svg('text', { x: nx + (close ? (next < current ? 4 : -4) : 0), y: 18, 'text-anchor': nextAnchor, text: next.toFixed(3) });
    lbl.style.fill = 'var(--text)';
    lbl.style.fontWeight = '700';
    root.append(lbl);
  }
  container.replaceChildren(root);
}

/** Flow ratio over all calibration steps, with the 1.000 reference line. */
export function historyChart(el, start, rows, labels) {
  clear(el);
  const W = 720, H = 260, L = 56, R = 20, T = 24, B = 40;
  const values = [start, ...rows.map((r) => r.to)];
  let lo = Math.min(...values, 1), hi = Math.max(...values, 1);
  const padV = Math.max(0.01, (hi - lo) * 0.25);
  lo -= padV; hi += padV;
  const n = values.length;
  const x = (i) => (n === 1 ? L + (W - L - R) / 2 : L + (i / (n - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const gid = 'hist-area';
  el.append(svg('defs', {}, [
    svg('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' }, [
      svg('stop', { offset: '0', style: `stop-color:${c('accent')};stop-opacity:0.35` }),
      svg('stop', { offset: '1', style: `stop-color:${c('accent')};stop-opacity:0` }),
    ]),
  ]));

  // y grid
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = lo + ((hi - lo) * i) / ticks;
    el.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid-line' }));
    el.append(svg('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', text: v.toFixed(3) }));
  }
  // 1.000 reference
  el.append(svg('line', { x1: L, x2: W - R, y1: y(1), y2: y(1), style: `stroke:${c('good')};stroke-dasharray:6 5;opacity:0.7` }));
  el.append(svg('text', { x: W - R, y: y(1) - 6, 'text-anchor': 'end', text: '1.000', style: `fill:${c('good')}` }));

  if (n > 1) {
    const line = values.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ');
    el.append(svg('path', { d: `${line} L ${x(n - 1)} ${H - B} L ${x(0)} ${H - B} Z`, style: `fill:url(#${gid})` }));
    const path = svg('path', { d: line, style: `fill:none;stroke:${c('accent')};stroke-width:3;stroke-linejoin:round;stroke-linecap:round` });
    el.append(path);
    const len = path.getTotalLength?.() ?? 0;
    if (len && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      path.style.strokeDasharray = `${len}`;
      path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 700, easing: 'ease-out' });
    }
  }

  values.forEach((v, i) => {
    const isLast = i === n - 1;
    el.append(svg('circle', {
      cx: x(i), cy: y(v), r: isLast ? 7 : 5,
      style: `fill:${isLast ? c('accent') : c('card')};stroke:${c('accent')};stroke-width:2.5`,
    }));
    const label = svg('text', { x: x(i), y: y(v) - 12, 'text-anchor': 'middle', text: v.toFixed(3) });
    if (isLast) { label.style.fill = 'var(--text)'; label.style.fontWeight = '700'; }
    el.append(label);
    el.append(svg('text', { x: x(i), y: H - B + 18, 'text-anchor': 'middle', text: i === 0 ? labels.start : `#${i}` }));
    if (i > 0) {
      const pct = rows[i - 1].stepPct;
      const mid = svg('text', {
        x: (x(i) + x(i - 1)) / 2, y: (y(v) + y(values[i - 1])) / 2 + 16, 'text-anchor': 'middle',
        text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
        style: `fill:${pct > 0 ? c('over') : c('under')};font-size:10px`,
      });
      el.append(mid);
    }
  });
}

/** Wall cross-section: stacked layer lines, target width as a dashed outline. */
export function wallSection(el, nominal, measured, labels) {
  clear(el);
  const W = 320, H = 150;
  // Deviations are a few percent at most, so they are drawn 4x exaggerated.
  const EXAGGERATE = 4;
  const cx = W / 2;
  const layers = 7, lh = 13, top = 22;
  const nw = 96;
  const dev = measured === null ? 0 : measured / nominal - 1;
  const mw = Math.max(24, Math.min(200, nw * (1 + dev * EXAGGERATE)));
  const over = measured && measured > nominal;
  const tone = measured === null ? c('muted') : over ? c('over') : measured < nominal ? c('under') : c('good');

  for (let i = 0; i < layers; i++) {
    el.append(svg('rect', {
      x: cx - mw / 2, y: top + i * lh, width: mw, height: lh - 1.5, rx: (lh - 1.5) / 2,
      style: `fill:${tone};opacity:${measured === null ? 0.25 : 0.75}`,
    }));
  }
  el.append(svg('rect', {
    x: cx - nw / 2, y: top - 4, width: nw, height: layers * lh + 6, rx: 4,
    style: `fill:none;stroke:${c('good')};stroke-width:1.5;stroke-dasharray:5 4`,
  }));
  const yb = top + layers * lh + 16;
  el.append(svg('line', { x1: cx - nw / 2, x2: cx + nw / 2, y1: yb, y2: yb, style: `stroke:${c('good')};stroke-width:1.5` }));
  el.append(svg('text', { x: cx - nw / 2 - 8, y: yb + 4, 'text-anchor': 'end', text: `${labels.nominal} ${nominal.toFixed(2)}`, style: `fill:${c('good')}` }));
  if (measured !== null) {
    el.append(svg('text', {
      x: cx + Math.max(mw, nw) / 2 + 8, y: top + (layers * lh) / 2 + 4,
      text: `${labels.measured} ${measured.toFixed(3)}`, style: `fill:${tone};font-weight:700`,
    }));
  }
  el.append(svg('text', { x: W - 6, y: 12, 'text-anchor': 'end', text: `×${EXAGGERATE}`, style: 'font-size:10px;opacity:0.7' }));
}

/** Dot strip of all readings with mean and ±1σ band against the target. */
export function wallDots(el, nominal, readings, stats) {
  clear(el);
  const W = 320, H = 150, L = 16, R = 16;
  const vals = [nominal, ...readings];
  let lo = Math.min(...vals) - 0.02, hi = Math.max(...vals) + 0.02;
  const x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const mid = 78;

  el.append(svg('line', { x1: L, x2: W - R, y1: mid + 30, y2: mid + 30, class: 'axis' }));
  const step = (hi - lo) > 0.12 ? 0.05 : 0.02;
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    el.append(svg('line', { x1: x(v), x2: x(v), y1: mid + 30, y2: mid + 35, class: 'axis' }));
    el.append(svg('text', { x: x(v), y: mid + 48, 'text-anchor': 'middle', text: v.toFixed(2) }));
  }
  if (stats && stats.count > 1) {
    el.append(svg('rect', {
      x: x(stats.mean - stats.stdev), y: mid - 26, width: Math.max(1, x(stats.mean + stats.stdev) - x(stats.mean - stats.stdev)), height: 52, rx: 6,
      style: `fill:${c('accent')};opacity:0.14`,
    }));
  }
  el.append(svg('line', { x1: x(nominal), x2: x(nominal), y1: mid - 34, y2: mid + 30, style: `stroke:${c('good')};stroke-width:2;stroke-dasharray:5 4` }));
  el.append(svg('text', { x: x(nominal), y: mid - 40, 'text-anchor': 'middle', text: nominal.toFixed(2), style: `fill:${c('good')}` }));
  readings.forEach((v, i) => {
    el.append(svg('circle', {
      cx: x(v), cy: mid + [0, -11, 11, -5, 5][i % 5], r: 6,
      style: `fill:${v > nominal ? c('over') : v < nominal ? c('under') : c('good')};stroke:${c('card')};stroke-width:2`,
    }));
  });
  if (stats) {
    el.append(svg('line', { x1: x(stats.mean), x2: x(stats.mean), y1: mid - 30, y2: mid + 30, style: `stroke:${c('accent')};stroke-width:3` }));
    el.append(svg('text', { x: x(stats.mean), y: mid + 22 + 40, 'text-anchor': 'middle', text: `Ø ${stats.mean.toFixed(3)}`, style: `fill:${c('accent')};font-weight:700` }));
  }
  if (!readings.length) {
    el.append(svg('text', { x: W / 2, y: mid + 4, 'text-anchor': 'middle', text: '—' }));
  }
}

/** Same nominal correction, two readings: additive vs percent of the current base. */
export function explainChart(el, base, comp, labels) {
  clear(el);
  const W = 720, H = 200, L = 170, R = 90;
  const rows = [
    [labels.base, base, c('muted')],
    [labels.additive, comp.additive, c('accent')],
    [labels.relative, comp.relative, c('under')],
  ];
  const vals = rows.map((r) => r[1]);
  const lo = Math.min(...vals) - 0.04, hi = Math.max(...vals) + 0.02;
  const x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  rows.forEach(([name, v, col], i) => {
    const yy = 22 + i * 46;
    el.append(svg('text', { x: L - 12, y: yy + 19, 'text-anchor': 'end', text: name, style: 'font-size:12px' }));
    el.append(svg('rect', { x: L, y: yy, width: W - L - R, height: 28, rx: 8, style: `fill:${c('bg-2')}` }));
    const bar = svg('rect', { x: L, y: yy, width: Math.max(4, x(v) - L), height: 28, rx: 8, style: `fill:${col};opacity:0.85` });
    el.append(bar);
    el.append(svg('text', { x: x(v) + 8, y: yy + 19, text: v.toFixed(4), style: 'fill:var(--text);font-weight:700;font-size:13px' }));
  });
  // zoom marker between the two results
  const ya = 22 + 46 + 28, yr = 22 + 92;
  el.append(svg('line', { x1: x(comp.additive), x2: x(comp.additive), y1: ya, y2: yr + 28 + 16, style: `stroke:${c('accent')};stroke-dasharray:3 3` }));
  el.append(svg('line', { x1: x(comp.relative), x2: x(comp.relative), y1: yr + 28, y2: yr + 28 + 16, style: `stroke:${c('under')};stroke-dasharray:3 3` }));
  const diff = comp.difference;
  el.append(svg('text', {
    x: lerp(x(comp.additive), x(comp.relative), 0.5), y: yr + 28 + 30, 'text-anchor': 'middle',
    text: `${labels.diff}: ${diff === 0 ? '0' : (diff > 0 ? '+' : '−') + Math.abs(diff).toFixed(4)}`,
    style: `fill:var(--text);font-size:12px`,
  }));
}

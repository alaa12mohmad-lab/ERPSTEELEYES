// رسوم بيانية SVG خفيفة بدون مكتبات: خط، أعمدة رأسية، أعمدة أفقية، دائرة مجوّفة.
//   كل رسم يُرجع عناصر DOM، وتلميح (title) لكل عنصر، ومفتاح ألوان عند تعدد السلاسل.
//   الألوان من متغيرات CSS (الوضع الفاتح والداكن) — والفئات بترتيب ثابت لا يتغير.
import { h, fmt } from './ui.js';

export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
export const OTHER = '#9aa1ab';
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => { if (v !== undefined && v !== null) e.setAttribute(k, v); });
  kids.flat().forEach((k) => { if (k !== null && k !== undefined) e.append(k); });
  return e;
};
const tip = (text) => { const t = svgEl('title'); t.textContent = text; return t; };
const num = (v) => fmt.num(Number(v) || 0);
// اختصار الأرقام على المحاور: 1.2م / 350ألف
export const short = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + ' م';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + ' ألف';
  return String(Math.round(v));
};
const monthLabel = (ym) => { try { return new Intl.DateTimeFormat('ar-EG', { month: 'short' }).format(new Date(ym + '-01T00:00:00')); } catch { return ym; } };

export function legend(items) {
  return h('div', { class: 'ch-legend' }, items.map((it) => h('span', {}, h('i', { style: { background: it.color } }), it.label)));
}

// خط زمني: points = [{ label, value }] — من اليمين لليسار (الأحدث يسارًا كما في العربية؟ لا: الأقدم يمينًا)
export function lineChart(points, { label = '', color = PALETTE[0], fmtLabel = monthLabel } = {}) {
  if (!points.length) return h('div', { class: 'help' }, 'لا أرقام');
  const W = 640, H = 210, pl = 8, pr = 52, pt = 12, pb = 26;
  const vals = points.map((p) => Number(p.value) || 0);
  let max = Math.max(...vals), min = Math.min(0, ...vals);
  if (max === min) max = min + 1;
  const x = (i) => W - pr - (points.length === 1 ? (W - pl - pr) / 2 : (i / (points.length - 1)) * (W - pl - pr));
  const y = (v) => pt + ((max - v) / (max - min)) * (H - pt - pb);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch', role: 'img', 'aria-label': label });
  [0, 0.5, 1].forEach((f) => {
    const v = min + (max - min) * f;
    svg.append(svgEl('line', { x1: pl, x2: W - pr, y1: y(v), y2: y(v), class: 'grid' }));
    const t = svgEl('text', { x: W - pr + 6, y: y(v) + 4, class: 'ax' }); t.textContent = short(v); svg.append(t);
  });
  if (min < 0) svg.append(svgEl('line', { x1: pl, x2: W - pr, y1: y(0), y2: y(0), class: 'zero' }));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(p.value) || 0).toFixed(1)}`).join(' ');
  svg.append(svgEl('path', { d: `${d} L${x(points.length - 1)},${y(Math.max(min, 0))} L${x(0)},${y(Math.max(min, 0))} Z`, fill: color, opacity: 0.08 }));
  svg.append(svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  points.forEach((p, i) => {
    const v = Number(p.value) || 0;
    const g = svgEl('g', { class: 'pt' }, tip(`${p.label}: ${num(v)}`),
      svgEl('rect', { x: x(i) - (W / points.length) / 2, y: 0, width: W / points.length, height: H - pb, class: 'hit' }),
      svgEl('circle', { cx: x(i), cy: y(v), r: 4, fill: color, class: v < 0 ? 'neg' : '' }));
    if (points.length <= 14 || i % 2 === 0) { const t = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'ax' }); t.textContent = fmtLabel(p.label); g.append(t); }
    svg.append(g);
  });
  return svg;
}

// أعمدة رأسية لسلسلة أو أكثر: rows = [{ label, values: [..] }], series = [{ label, color }]
export function barChart(rows, series, { label = '', fmtLabel = (s) => s } = {}) {
  if (!rows.length) return h('div', { class: 'help' }, 'لا أرقام');
  const W = 640, H = 210, pl = 8, pr = 62, pt = 10, pb = 26;
  const vals = rows.flatMap((r) => r.values.map(Number));
  let max = Math.max(0, ...vals), min = Math.min(0, ...vals); if (max === min) max = 1;
  const slot = (W - pl - pr) / rows.length; const bw = Math.max(4, Math.min(26, (slot - 6) / series.length - 2));
  const y = (v) => pt + ((max - v) / (max - min)) * (H - pt - pb);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch', role: 'img', 'aria-label': label });
  [0, 0.5, 1].forEach((f) => {
    const v = min + (max - min) * f;
    svg.append(svgEl('line', { x1: pl, x2: W - pr, y1: y(v), y2: y(v), class: 'grid' }));
    const t = svgEl('text', { x: W - pr + 10, y: y(v) + 4, class: 'ax' }); t.textContent = short(v); svg.append(t);
  });
  svg.append(svgEl('line', { x1: pl, x2: W - pr, y1: y(0), y2: y(0), class: 'zero' }));
  rows.forEach((r, i) => {
    const cx = W - pr - (i + 0.5) * slot;
    const g = svgEl('g', { class: 'pt' }, tip(`${r.label}: ` + series.map((s, k) => `${s.label} ${num(r.values[k])}`).join(' — ')),
      svgEl('rect', { x: cx - slot / 2, y: 0, width: slot, height: H - pb, class: 'hit' }));
    const total = series.length * (bw + 2) - 2;
    series.forEach((s, k) => {
      const v = Number(r.values[k]) || 0;
      const bx = cx + total / 2 - (k + 1) * (bw + 2) + 2;
      g.append(svgEl('rect', { x: bx, y: Math.min(y(v), y(0)), width: bw, height: Math.max(1, Math.abs(y(v) - y(0))), rx: 3, fill: s.color }));
    });
    if (rows.length <= 14 || i % 2 === 0) { const t = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'ax' }); t.textContent = fmtLabel(r.label); g.append(t); }
    svg.append(g);
  });
  return svg;
}
export const monthBars = (rows, series, opts = {}) => barChart(rows, series, { fmtLabel: monthLabel, ...opts });

// أعمدة أفقية مرتبة: items = [{ label, value, color?, sub? }] — للقيم الموجبة والسالبة (الهامش)
export function hbars(items, { max: maxN = 8, color = PALETTE[0], negColor = 'var(--bad)' } = {}) {
  if (!items.length) return h('div', { class: 'help' }, 'لا أرقام');
  const rows = items.slice(0, maxN);
  const m = Math.max(1, ...rows.map((r) => Math.abs(Number(r.value) || 0)));
  return h('div', { class: 'ch-hbars' }, rows.map((r) => {
    const v = Number(r.value) || 0; const w = (Math.abs(v) / m) * 100;
    return h('div', { class: 'ch-hrow', title: `${r.label}: ${num(v)}${r.sub ? ' — ' + r.sub : ''}` },
      h('span', { class: 'ch-hlabel' }, r.label),
      h('span', { class: 'ch-htrack' }, h('span', { class: 'ch-hbar', style: { width: w.toFixed(1) + '%', background: v < 0 ? negColor : (r.color || color) } })),
      h('b', { class: 'ch-hval' + (v < 0 ? ' neg' : '') }, short(v)));
  }));
}

// دائرة مجوّفة: items = [{ label, value }] — أكبر 6 والباقي «أخرى»
export function donut(items, { total: totalLabel = 'الإجمالي', limit = 6 } = {}) {
  const pos = items.filter((x) => Number(x.value) > 0).sort((a, b) => b.value - a.value);
  if (!pos.length) return h('div', { class: 'help' }, 'لا أرقام');
  let parts = pos.slice(0, limit).map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] }));
  const rest = pos.slice(limit).reduce((s, x) => s + Number(x.value), 0);
  if (rest > 0) parts.push({ label: 'أخرى', value: rest, color: OTHER });
  const total = parts.reduce((s, x) => s + Number(x.value), 0);
  const R = 70, r = 44, C = 90;
  const svg = svgEl('svg', { viewBox: '0 0 180 180', class: 'ch-donut', role: 'img', 'aria-label': totalLabel });
  let a0 = -Math.PI / 2;
  parts.forEach((p) => {
    const frac = Number(p.value) / total; const a1 = a0 + frac * Math.PI * 2;
    const big = frac > 0.5 ? 1 : 0;
    const P = (rad, a) => `${(C + rad * Math.cos(a)).toFixed(2)},${(C + rad * Math.sin(a)).toFixed(2)}`;
    const d = frac >= 0.9999
      ? `M${C},${C - R} A${R},${R} 0 1 1 ${C - 0.01},${C - R} L${C - 0.01},${C - r} A${r},${r} 0 1 0 ${C},${C - r} Z`
      : `M${P(R, a0)} A${R},${R} 0 ${big} 1 ${P(R, a1)} L${P(r, a1)} A${r},${r} 0 ${big} 0 ${P(r, a0)} Z`;
    svg.append(svgEl('path', { d, fill: p.color, stroke: 'var(--surface)', 'stroke-width': 2 }, tip(`${p.label}: ${num(p.value)} (${((frac) * 100).toFixed(1)}%)`)));
    a0 = a1;
  });
  const t1 = svgEl('text', { x: C, y: C - 2, 'text-anchor': 'middle', class: 'ch-dt', direction: 'ltr' });
  t1.textContent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(total);
  const t2 = svgEl('text', { x: C, y: C + 16, 'text-anchor': 'middle', class: 'ax' }); t2.textContent = totalLabel;
  svg.append(t1, t2);
  return h('div', { class: 'ch-donut-wrap' }, svg, h('div', { class: 'ch-donut-legend' }, parts.map((p) => h('div', {},
    h('i', { style: { background: p.color } }), h('span', {}, p.label), h('b', {}, `${((Number(p.value) / total) * 100).toFixed(0)}%`)))));
}

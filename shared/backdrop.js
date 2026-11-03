// خلفية الصفحة الرئيسية المتحركة. الاختيار محفوظ لكل مستخدم في متصفحه (زي الثيم).
//   تشتغل في الرئيسية بس، وتقف لوحدها لما التبويب مش ظاهر أو الجهاز مفعّل عليه "تقليل الحركة".
//   إضافة خلفية جديدة = إضافة عنصر في SCENES بـ { name, desc, init(s, env), draw(s, env, t), trail? }
import { store } from './ui.js';

const KEY = 'erp-backdrop';
export const POWERS = [['0.6', 'هادية'], ['1', 'متوسطة'], ['1.6', 'قوية']];

export function getBackdrop() {
  const v = store.get(KEY, null) || {};
  return { scene: SCENES[v.scene] || v.scene === 'none' ? v.scene : 'wave', power: POWERS.some((p) => p[0] === String(v.power)) ? String(v.power) : '1' };
}
export function setBackdrop(patch) {
  const v = { ...getBackdrop(), ...patch };
  store.set(KEY, v);
  listeners.forEach((f) => f(v));
}
const listeners = new Set();

// ---------------------------------------------------------------------
const R = Math.random;
const AR = '٠١٢٣٤٥٦٧٨٩';
const CODES = ['1101', '1102', '1201', '2101', '2201', '3101', '4101', '5101', 'ر.س', '15%', 'Σ', 'Δ', '{ }', '</>', 'مدين', 'دائن', '=', '0.00',
  '345,000', 'VAT', 'Dr', 'Cr', 'f(x)', '2026', 'INV-1', 'SELECT', 'JOIN', 'SUM()', '∫', '≈', 'λ', 'رصيد', 'قيد', 'ميزان', '#', '&&', '=>', '[ ]'];
const A = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;

export const SCENES = {
  rain: {
    name: 'مطر الأرقام', desc: 'أعمدة أرقام وأكواد حسابات بتنزل زي شاشات الأنظمة', trail: true,
    init(s, e) { s.fs = 16; s.drops = Array.from({ length: Math.ceil(e.W / (s.fs * 1.1)) }, () => ({ y: R() * -e.H, v: 1.2 + R() * 2.4 })); },
    draw(s, e) {
      const { ctx, AC, P } = e;
      ctx.font = `600 ${s.fs}px ${e.font}`; ctx.textAlign = 'center';
      s.drops.forEach((d, i) => {
        if (R() > 0.35 * P + 0.3) return;
        const x = i * s.fs * 1.1 + s.fs / 2;
        const ch = R() < 0.12 ? CODES[(R() * CODES.length) | 0].slice(0, 2) : AR[(R() * 10) | 0];
        const near = Math.abs(x - e.mx) < 90;
        ctx.fillStyle = near ? A(e.dark ? [255, 255, 255] : e.INK, 0.9) : A(AC, e.dark ? 0.9 : 0.75); ctx.fillText(ch, x, d.y);
        ctx.fillStyle = A(AC, e.dark ? 0.35 : 0.3); ctx.fillText(AR[(R() * 10) | 0], x, d.y - s.fs);
        d.y += s.fs * d.v * 0.45 * P;
        if (d.y > e.H + 50 && R() > 0.97) d.y = R() * -200;
      });
    },
  },
  wave: {
    name: 'موجة جزيئات 3D', desc: 'سطح نقاط بيتموّج في عمق ثلاثي الأبعاد، والماوس بيعمل فيه موجات',
    init(s, e) { s.n = Math.round(46 * Math.min(1.4, e.P)); s.m = Math.round(26 * Math.min(1.4, e.P)); s.rip = []; },
    draw(s, e, t) {
      const { ctx, W, H, AC, INK } = e; const sec = t / 1000, cx = W * 0.5, cy = H * 0.62, fov = 520;
      if (e.mx > 0 && R() < 0.04) s.rip.push({ x: (e.mx - cx) / W * 2, y: 1 - e.my / H, t: sec });
      s.rip = s.rip.filter((r) => sec - r.t < 4);
      for (let j = 0; j < s.m; j++) for (let i = 0; i < s.n; i++) {
        const u = i / (s.n - 1) - 0.5, v = j / (s.m - 1), X = u * 1600, Z = 200 + v * 1300;
        let Y = Math.sin(u * 7 + sec * 1.1) * 45 + Math.cos(v * 9 - sec * 0.9) * 40 + Math.sin((u + v) * 5 + sec * 0.6) * 25;
        for (const r of s.rip) { const dd = Math.hypot(u * 2 - r.x, v - r.y), age = sec - r.t; Y += Math.sin(dd * 25 - age * 8) * 30 * Math.max(0, 1 - age / 4) * Math.max(0, 1 - dd * 1.5); }
        const sc = fov / (Z + fov), px = cx + X * sc, py = cy + (Y + 140) * sc - v * 120, glow = (Y + 90) / 180;
        ctx.fillStyle = A(glow > 0.6 ? AC : INK, (glow > 0.6 ? 1 : e.dark ? 0.7 : 0.5) * (1 - v * 0.55) * Math.min(1, e.P));
        const r = Math.max(1, 3.4 * sc * (glow > 0.6 ? 1.5 : 1)); ctx.fillRect(px - r / 2, py - r / 2, r, r);
      }
    },
  },
  blueprint: {
    name: 'مخطط هيكل حديد', desc: 'لوحة هندسية بتترسم عليها جمالونات وهياكل وكمرات بأطوالها',
    init(s) { s.items = []; s.next = 0; },
    draw(s, e, t) {
      const { ctx, W, H, INK } = e, g = 32;
      ctx.lineWidth = 1;
      for (let x = (t / 80) % g; x < W; x += g) { ctx.strokeStyle = A(INK, (Math.round(x / g) % 5 ? 0.04 : 0.08) * (e.dark ? 1.3 : 1)); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += g) { ctx.strokeStyle = A(INK, (Math.round(y / g) % 5 ? 0.04 : 0.08) * (e.dark ? 1.3 : 1)); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      if (t > s.next) { s.items.push(makeStruct(e, t)); s.next = t + 1500 / e.P; if (s.items.length > 7) s.items.shift(); }
      for (const it of s.items) drawStruct(it, e, t);
    },
  },
  orbit: {
    name: 'الشركات الثلاث', desc: 'عيون وريان والقيادة بيلفّوا حوالين النظام الموحد وبيانات بتجري بينهم',
    init(s, e) { s.parts = []; s.names = e.companies.length ? e.companies : ['عيون الحديد', 'ريان القرني', 'القيادة الذكية']; },
    draw(s, e, t) {
      const { ctx, W, H, AC, INK } = e; const sec = t / 1000, cx = W * 0.38, cy = H * 0.62, R0 = Math.min(W, H) * 0.3;
      const hubs = s.names.map((n, i) => { const a = sec * 0.12 + i * (6.283 / s.names.length); return { x: cx + Math.cos(a) * R0 * 1.35, y: cy + Math.sin(a) * R0 * 0.55, n }; });
      ctx.strokeStyle = A(INK, e.dark ? 0.08 : 0.07); ctx.setLineDash([3, 6]);
      ctx.beginPath(); ctx.ellipse(cx, cy, R0 * 1.35, R0 * 0.55, 0, 0, 6.29); ctx.stroke(); ctx.setLineDash([]);
      for (const hb of hubs) {
        const gr = ctx.createLinearGradient(hb.x, hb.y, cx, cy); gr.addColorStop(0, A(AC, 0.5)); gr.addColorStop(1, A(AC, 0.05));
        ctx.strokeStyle = gr; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(hb.x, hb.y); ctx.quadraticCurveTo((hb.x + cx) / 2, (hb.y + cy) / 2 - 80, cx, cy); ctx.stroke();
        if (R() < 0.25 * e.P) s.parts.push({ hb, k: 0, v: 0.004 + R() * 0.006, back: R() < 0.4 });
      }
      s.parts = s.parts.filter((p) => (p.k += p.v * e.P) < 1);
      for (const p of s.parts) {
        const k = p.back ? 1 - p.k : p.k, hb = p.hb, mx = (hb.x + cx) / 2, my = (hb.y + cy) / 2 - 80;
        const x = (1 - k) ** 2 * hb.x + 2 * (1 - k) * k * mx + k * k * cx, y = (1 - k) ** 2 * hb.y + 2 * (1 - k) * k * my + k * k * cy;
        ctx.fillStyle = A(p.back ? INK : AC, 0.9); ctx.beginPath(); ctx.arc(x, y, 2, 0, 6.29); ctx.fill();
      }
      const pulse = 1 + Math.sin(sec * 2) * 0.06;
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90 * pulse); rg.addColorStop(0, A(AC, 0.45)); rg.addColorStop(1, A(AC, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, 90 * pulse, 0, 6.29); ctx.fill();
      ctx.fillStyle = A(AC, 1); ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 6.29); ctx.fill();
      ctx.font = `700 15px ${e.font}`; ctx.textAlign = 'center'; ctx.fillStyle = A(INK, 0.8); ctx.fillText('النظام الموحد', cx, cy + 32);
      for (const hb of hubs) {
        const rg2 = ctx.createRadialGradient(hb.x, hb.y, 0, hb.x, hb.y, 40); rg2.addColorStop(0, A(AC, 0.3)); rg2.addColorStop(1, A(AC, 0));
        ctx.fillStyle = rg2; ctx.beginPath(); ctx.arc(hb.x, hb.y, 40, 0, 6.29); ctx.fill();
        ctx.fillStyle = A(INK, 0.9); ctx.beginPath(); ctx.arc(hb.x, hb.y, 5, 0, 6.29); ctx.fill();
        ctx.font = `600 13px ${e.font}`; ctx.fillStyle = A(INK, 0.7); ctx.fillText(hb.n, hb.x, hb.y - 16);
      }
    },
  },
  charts: {
    name: 'رسوم بيانية حية', desc: 'خطوط إيرادات وتكاليف بتتحرك باستمرار ومعاها مبالغ بالريال',
    init(s, e) { s.lines = [0, 1, 2].map((i) => ({ ph: R() * 100, amp: 50 + i * 25, base: e.H * (0.42 + i * 0.17) })); },
    draw(s, e, t) {
      const { ctx, W, H, AC, INK, P } = e; const sec = t / 1000 * P;
      ctx.strokeStyle = A(INK, 0.05); ctx.lineWidth = 1;
      for (let y = H * 0.3; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      s.lines.forEach((L, li) => {
        const f = (x) => L.base - (Math.sin(x * 0.004 + sec * 0.5 + L.ph) * L.amp + Math.sin(x * 0.011 + sec * 1.1 + L.ph) * L.amp * 0.35 + (x / W) * 60 * (li === 0 ? 1 : -0.3));
        const col = li === 0 ? AC : INK;
        const grd = ctx.createLinearGradient(0, L.base - L.amp, 0, H); grd.addColorStop(0, A(col, li === 0 ? 0.22 : 0.07)); grd.addColorStop(1, A(col, 0));
        ctx.beginPath(); ctx.moveTo(0, f(0)); for (let x = 0; x <= W; x += 8) ctx.lineTo(x, f(x));
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fillStyle = grd; ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, f(0)); for (let x = 0; x <= W; x += 8) ctx.lineTo(x, f(x));
        ctx.strokeStyle = A(col, li === 0 ? 0.85 : 0.3); ctx.lineWidth = li === 0 ? 2 : 1.3; ctx.stroke();
        const hx = (W * 0.15 + (t / 12 * P) % (W * 0.7) + li * 180) % W, hy = f(hx);
        ctx.fillStyle = A(col, 1); ctx.beginPath(); ctx.arc(hx, hy, li === 0 ? 4 : 3, 0, 6.29); ctx.fill();
        ctx.fillStyle = A(col, 0.15); ctx.beginPath(); ctx.arc(hx, hy, 14 + Math.sin(t / 200) * 3, 0, 6.29); ctx.fill();
        if (li === 0) { ctx.font = `600 12px ${e.font}`; ctx.fillStyle = A(AC, 0.9); ctx.textAlign = 'center'; ctx.fillText(Math.round(250000 + (H - hy) * 900).toLocaleString('en') + ' ر.س', hx, hy - 20); }
      });
    },
  },
  warp: {
    name: 'عبور النجوم', desc: 'نجوم وأرقام جاية ناحيتك من العمق، والاتجاه بيميل مع الماوس', trail: true,
    init(s, e) { s.s = Array.from({ length: Math.round(800 * e.P) }, () => ({ x: (R() - 0.5) * e.W * 2, y: (R() - 0.5) * e.H * 2, z: R() * 1000, t: R() < 0.12 ? AR[(R() * 10) | 0] : null })); },
    draw(s, e) {
      const { ctx, W, H, AC, INK, P } = e;
      const cx = W / 2 + (e.mx > 0 ? (e.mx - W / 2) * 0.08 : 0), cy = H / 2 + (e.my > 0 ? (e.my - H / 2) * 0.08 : 0);
      for (const p of s.s) {
        p.z -= 4 * P; if (p.z < 1) { p.z = 1000; p.x = (R() - 0.5) * W * 2; p.y = (R() - 0.5) * H * 2; }
        const k = 260 / p.z, x = cx + p.x * k, y = cy + p.y * k; if (x < 0 || x > W || y < 0 || y > H) continue;
        const a = Math.min(1, (1000 - p.z) / 700);
        if (p.t) { ctx.font = `600 ${Math.min(40, 8 + k * 6)}px ${e.font}`; ctx.fillStyle = A(AC, a * 0.8); ctx.fillText(p.t, x, y); }
        else { ctx.fillStyle = A(p.z < 300 ? AC : INK, a * (e.dark ? 1 : 0.75)); const r = Math.min(4, 0.8 + k * 1.4); ctx.fillRect(x, y, r, r); }
      }
    },
  },
  glyphs: {
    name: 'رموز متدفقة', desc: 'رموز محاسبية وبرمجية بتطفو بأحجام وعمق مختلف وبتنور حوالين الماوس',
    init(s, e) { s.g = Array.from({ length: Math.round(e.W * e.H / 9000 * e.P) }, () => ({ x: R() * e.W, y: R() * e.H, z: 0.3 + R() * 1.3, t: CODES[(R() * CODES.length) | 0], r: (R() - 0.5) * 0.5, ph: R() * 6.28 })); },
    draw(s, e, t) {
      const { ctx, AC, INK, P } = e;
      for (const p of s.g) {
        p.y -= 0.3 * p.z * P; p.x += Math.sin(t / 3000 + p.ph) * 0.15;
        const dx = p.x - e.mx, dy = p.y - e.my, dd = dx * dx + dy * dy;
        if (dd < 20000) { p.x += dx / 250; p.y += dy / 250; }
        if (p.y < -40) { p.y = e.H + 40; p.x = R() * e.W; }
        const near = dd < 50000 ? 1 - dd / 50000 : 0;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.font = `${p.z > 1.1 ? 700 : 500} ${Math.round(10 + p.z * 16)}px ${e.font}`;
        ctx.fillStyle = A(near > 0 || p.z > 1.2 ? AC : INK, (e.dark ? 0.14 : 0.1) * p.z + near * 0.7);
        ctx.fillText(p.t, 0, 0); ctx.restore();
      }
    },
  },
  hex: {
    name: 'خلايا سداسية', desc: 'شبكة خلايا بتنور موجات موجات وحوالين الماوس',
    init() {},
    draw(s, e, t) {
      const { ctx, W, H, AC, INK } = e, r = 26, w = r * Math.sqrt(3), sec = t / 1000 * e.P;
      for (let row = -1, y = 0; y < H + r * 2; row++, y = row * r * 1.5) for (let col = -1; col * w < W + w; col++) {
        const x = col * w + (row % 2 ? w / 2 : 0);
        const wave = (Math.sin(x * 0.006 + sec * 1.2) + Math.sin(y * 0.008 - sec * 0.9) + Math.sin((x + y) * 0.004 + sec * 0.5)) / 3;
        const md = Math.hypot(x - e.mx, y - e.my), near = md < 200 ? 1 - md / 200 : 0;
        const lit = Math.max(0, wave - 0.2) * 1.9 + near;
        ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2)); } ctx.closePath();
        ctx.strokeStyle = A(lit > 0.05 ? AC : INK, lit > 0.05 ? Math.min(0.9, lit) : e.dark ? 0.13 : 0.1); ctx.lineWidth = 1.2; ctx.stroke();
        if (lit > 0.25) { ctx.fillStyle = A(AC, lit * 0.14); ctx.fill(); }
      }
    },
  },
};

function makeStruct(e, t) {
  const kind = ['truss', 'frame', 'beam'][(R() * 3) | 0];
  const w = 220 + R() * 260, h = kind === 'beam' ? 40 : 90 + R() * 90;
  return { kind, x: R() * Math.max(10, e.W - w - 60) + 30, y: e.H * 0.25 + R() * Math.max(10, e.H * 0.6 - h), w, h, born: t };
}
function drawStruct(it, e, t) {
  const { ctx, AC, INK } = e;
  const age = (t - it.born) / 1800, k = Math.min(1, age), fade = age > 6 ? Math.max(0, 1 - (age - 6) / 2) : 1;
  if (fade <= 0) return;
  const { x, y, w, h } = it; const segs = [];
  if (it.kind === 'truss') {
    const n = 6, top = (i) => y + h - h * (1 - Math.abs(i / n - 0.5) * 2);
    segs.push([x, y + h, x + w, y + h], [x, y + h, x + w / 2, y], [x + w / 2, y, x + w, y + h]);
    for (let i = 1; i < n; i++) { const px = x + w * i / n; segs.push([px, y + h, px, top(i)]); const j = i < n / 2 ? i + 1 : i - 1; segs.push([px, y + h, x + w * j / n, top(j)]); }
  } else if (it.kind === 'frame') {
    segs.push([x, y + h, x, y + h * 0.25], [x + w, y + h, x + w, y + h * 0.25], [x, y + h * 0.25, x + w / 2, y], [x + w / 2, y, x + w, y + h * 0.25],
      [x, y + h * 0.45, x + w * 0.18, y + h * 0.25], [x + w, y + h * 0.45, x + w * 0.82, y + h * 0.25]);
  } else segs.push([x, y, x + w, y], [x, y + h, x + w, y + h], [x + w * 0.5, y, x + w * 0.5, y + h], [x, y, x, y + h], [x + w, y, x + w, y + h]);
  const shown = k * segs.length;
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  segs.forEach((sg, i) => {
    const p = Math.max(0, Math.min(1, shown - i)); if (!p) return;
    ctx.strokeStyle = A(AC, 0.95 * fade); ctx.shadowColor = A(AC, 0.6); ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(sg[0], sg[1]); ctx.lineTo(sg[0] + (sg[2] - sg[0]) * p, sg[1] + (sg[3] - sg[1]) * p); ctx.stroke(); ctx.shadowBlur = 0;
  });
  if (k >= 1) {
    ctx.strokeStyle = A(INK, 0.3 * fade); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + h + 18); ctx.lineTo(x + w, y + h + 18); ctx.stroke();
    ctx.font = `500 11px ${e.font}`; ctx.textAlign = 'center'; ctx.fillStyle = A(INK, 0.5 * fade);
    ctx.fillText((w / 20).toFixed(1) + ' م', x + w / 2, y + h + 32);
    ctx.fillText({ truss: 'جمالون', frame: 'هيكل بوابي', beam: 'كمرة IPE' }[it.kind], x + w / 2, y - 10);
  }
}

// ---------------------------------------------------------------------
// تركيب الخلفية في عنصر (الرئيسية). يرجّع دالة الإيقاف.
//   opts.companies: أسماء الشركات (لخلفية "الشركات الثلاث")
export function mountBackdrop(host, opts = {}) {
  const cv = document.createElement('canvas');
  cv.className = 'backdrop';
  cv.setAttribute('aria-hidden', 'true');
  host.prepend(cv);
  const ctx = cv.getContext('2d');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const env = { ctx, W: 0, H: 0, mx: -9999, my: -9999, tx: -9999, ty: -9999, P: 1, font: '', companies: opts.companies || [], AC: [180, 86, 31], INK: [24, 33, 44], dark: false };
  let s = {}; let scene = null; let raf = 0; let t0 = performance.now(); let frames = 0; let alive = true;

  const rgb = (v) => {
    const c = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    if (c.startsWith('#')) { const n = parseInt(c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    const m = c.match(/\d+/g); return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
  };
  const colors = () => {
    env.AC = rgb('--accent'); env.INK = rgb('--ink'); env.dark = document.documentElement.dataset.theme === 'dark';
    env.font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  };
  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    env.W = window.innerWidth; env.H = window.innerHeight;
    cv.width = env.W * dpr; cv.height = env.H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const start = () => {
    cancelAnimationFrame(raf);
    const b = getBackdrop();
    scene = SCENES[b.scene] || null; env.P = Number(b.power); s = {};
    cv.style.display = scene ? '' : 'none';
    ctx.clearRect(0, 0, env.W, env.H);
    if (!scene) return;
    colors(); scene.init(s, env);
    if (reduce) { scene.draw(s, env, 4000); return; }
    raf = requestAnimationFrame(loop);
  };
  const loop = (now) => {
    if (!alive) return;
    if (++frames % 60 === 0) colors();
    env.mx += (env.tx - env.mx) * 0.15; env.my += (env.ty - env.my) * 0.15;
    if (scene.trail) { ctx.fillStyle = env.dark ? 'rgba(15,20,27,.2)' : 'rgba(243,244,246,.24)'; ctx.fillRect(0, 0, env.W, env.H); }
    else ctx.clearRect(0, 0, env.W, env.H);
    scene.draw(s, env, now - t0);
    raf = requestAnimationFrame(loop);
  };
  const onMove = (e) => { env.tx = e.clientX; env.ty = e.clientY; };
  const onResize = () => { size(); start(); };
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else start(); };
  const onTheme = new MutationObserver(() => { colors(); ctx.clearRect(0, 0, env.W, env.H); });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVis);
  onTheme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
  listeners.add(start);
  size(); start();
  return () => {
    alive = false; cancelAnimationFrame(raf); listeners.delete(start); onTheme.disconnect();
    window.removeEventListener('pointermove', onMove); window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVis); cv.remove();
  };
}

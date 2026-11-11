// أدوات الواجهة المشتركة: بناء العناصر، الرسائل، النوافذ، التنسيق

// h('div', {class:'x', onclick}, child1, 'text', ...)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  const box = document.getElementById('toasts');
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3000);
}

// نافذة: ترجع {el, close, body, foot}
export function modal({ title, size = '', onClose } = {}) {
  const body = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal ' + size, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'x', onclick: close, 'aria-label': 'إغلاق' }, '×')),
    body, foot);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  return { el: box, body, foot, close };
}

export function confirmDialog(message, { ok = 'تأكيد', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title: 'تأكيد', size: 'narrow', onClose: () => { if (!done) resolve(false); } });
    m.body.append(h('p', { style: { margin: 0 } }, message));
    m.foot.append(
      h('button', { class: 'btn ' + (danger ? 'accent' : 'primary'), onclick: () => { done = true; m.close(); resolve(true); } }, ok),
      h('button', { class: 'btn', onclick: () => m.close() }, 'رجوع'));
  });
}

// طلب سبب (للإلغاء)
export function askReason(title = 'سبب الإلغاء', { ok = 'إلغاء السجل', note = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title, size: 'narrow', onClose: () => { if (!done) resolve(null); } });
    const ta = h('textarea', { class: 'input', placeholder: 'اكتب السبب…' });
    if (note) m.body.append(h('p', { class: 'notice', style: { marginBottom: '12px' } }, note));
    m.body.append(h('div', { class: 'field' }, h('label', {}, 'السبب', h('span', { class: 'req' }, '*')), ta));
    const go = () => {
      const v = ta.value.trim();
      if (!v) { ta.focus(); return; }
      done = true; m.close(); resolve(v);
    };
    m.foot.append(h('button', { class: 'btn accent', onclick: go }, ok), h('button', { class: 'btn', onclick: () => m.close() }, 'رجوع'));
    setTimeout(() => ta.focus(), 30);
  });
}

export const fmt = {
  num(v, d = 2) {
    if (v === null || v === undefined || v === '') return '';
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  date(v) { return v ? String(v).slice(0, 10) : ''; },
  datetime(v) {
    if (!v) return '';
    const d = new Date(v);
    return d.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false }).replace(',', '');
  },
  bool(v) { return v ? 'نعم' : 'لا'; },
};

export const STATUS = {
  active: { label: 'نشط', cls: 'ok' },
  archived: { label: 'مؤرشف', cls: '' },
  cancelled: { label: 'ملغي', cls: 'bad' },
};
export function statusBadge(s) {
  const st = STATUS[s] || { label: s, cls: '' };
  return h('span', { class: 'badge ' + st.cls }, st.label);
}

// تخزين محلي آمن (قد لا يكون متاحًا)
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export const ICONS = {
  transfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
  database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.3.2 4 1.8 4.5 4.5"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 6h11v10H2zM13 9h4l4 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.5 6.5a4 4 0 005 5L13 18l-3 3-4-4 3-3 6.5-6.5a4 4 0 01-1-1z"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 4h2l2.5 11h11L21 7H6.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
  page: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
  hash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/></svg>',
  columns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>',
};
export function icon(name) { return h('span', { class: 'ico', html: ICONS[name] || ICONS.database }); }

export const LEVELS = ['لا يرى', 'يرى', 'يضيف', 'يعدّل', 'يعتمد'];

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
export function askReason(title = 'سبب الإلغاء') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title, size: 'narrow', onClose: () => { if (!done) resolve(null); } });
    const ta = h('textarea', { class: 'input', placeholder: 'اكتب السبب…' });
    m.body.append(h('div', { class: 'field' }, h('label', {}, 'السبب', h('span', { class: 'req' }, '*')), ta));
    const go = () => {
      const v = ta.value.trim();
      if (!v) { ta.focus(); return; }
      done = true; m.close(); resolve(v);
    };
    m.foot.append(h('button', { class: 'btn accent', onclick: go }, 'إلغاء السجل'), h('button', { class: 'btn', onclick: () => m.close() }, 'رجوع'));
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
  database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.3.2 4 1.8 4.5 4.5"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 6h11v10H2zM13 9h4l4 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
  wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.5 6.5a4 4 0 005 5L13 18l-3 3-4-4 3-3 6.5-6.5a4 4 0 01-1-1z"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 4h2l2.5 11h11L21 7H6.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z"/></svg>',
};
export function icon(name) { return h('span', { class: 'ico', html: ICONS[name] || ICONS.database }); }

export const LEVELS = ['لا يرى', 'يرى', 'يضيف', 'يعدّل', 'يعتمد'];

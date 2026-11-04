// قائمة اختيار بالبحث (بديل datalist): قائمة عائمة تحت الخانة، مجموعات، تمييز الجزء المكتوب، آخر اختيارات، رصيد جنب الاسم.
//   الكتابة زي Excel: دخول الخانة يحدد النص كله فأي حرف يستبدله، Delete يفضّي الخانة، Esc يرجّع القيمة القديمة.
//   الخيار: { id, code, name, label, group?, kind?, special?, combo? }
//   combo({ options, listKey, value, placeholder, cls, onChange(o), onSpecial(o), meta(o) → نص جانبي, onOpen(), disabled })
//   يرجّع { el (الخانة نفسها), id, set(id), resolve(), setOptions(list, key), setDisabled(b), refresh() }
import { h } from './ui.js';

// تطبيع العربي للبحث: أ/إ/آ ← ا، ة ← ه، ى ← ي، ؤ ← و، ئ ← ي، بدون تشكيل أو تطويل، والأرقام الهندية ← عربية
export function norm(s) {
  return String(s ?? '').toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, ' ').trim();
}

const RECENT_MAX = 6;
const recentKey = (k) => 'erp-recent-' + k;
function recentGet(k) { try { return JSON.parse(localStorage.getItem(recentKey(k)) || '[]'); } catch { return []; } }
function recentPush(k, id) {
  try { localStorage.setItem(recentKey(k), JSON.stringify([id, ...recentGet(k).filter((x) => x !== id)].slice(0, RECENT_MAX))); } catch { /* التخزين مقفول */ }
}

// لوحة واحدة مشتركة لكل الخانات (واحدة مفتوحة في كل مرة)
let panel = null; let owner = null;
function getPanel() {
  if (!panel) {
    panel = h('div', { class: 'combo-panel', role: 'listbox' });
    panel.addEventListener('mousedown', (e) => e.preventDefault()); // الضغط على القائمة ما يشيلش التركيز من الخانة
    document.body.append(panel);
    const reposition = () => owner?.place();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
  }
  return panel;
}

function mark(text, q) {
  // تمييز أول ظهور للكلمة المكتوبة (المقارنة بعد التطبيع، والعرض بالنص الأصلي)
  if (!q) return [text];
  const t = String(text); const n = norm(t);
  const word = norm(q).split(' ').sort((a, b) => b.length - a.length)[0];
  const i = word ? n.indexOf(word) : -1;
  if (i < 0 || n.length !== t.toLowerCase().length) return [t];
  return [t.slice(0, i), h('mark', {}, t.slice(i, i + word.length)), t.slice(i + word.length)];
}

export function combo({ options, listKey = 'x', value = null, placeholder = '', cls = '', onChange, onSpecial, meta, onOpen, disabled = false }) {
  const input = h('input', { class: 'input cell-input combo ' + cls, placeholder, disabled, autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-autocomplete': 'list' });
  let opts = options; let key = listKey; let id = null; let committed = '';
  let open = false; let shown = []; let active = -1; let query = '';

  const find = (x) => (x ? opts.find((o) => o.id === x) : null);
  const set = (v) => {
    id = v || null;
    const o = find(id);
    input.value = o ? o.label : '';
    input.title = input.value;
    committed = input.value;
    input.classList.remove('invalid');
    input.dataset.id = id || '';
  };

  // البحث: كل كلمات النص لازم تظهر في الكود أو الاسم. الترتيب: الكود بالظبط ← الكود يبدأ بـ ← الاسم يبدأ بـ ← الباقي
  function search(q) {
    const nq = norm(q);
    const real = opts.filter((o) => !o.special);
    if (!nq) {
      const rec = recentGet(key).map(find).filter((o) => o && !o.special);
      const recSet = new Set(rec.map((o) => o.id));
      return [...rec.map((o) => ({ ...o, group: 'آخر استخدام' })), ...real.filter((o) => !recSet.has(o.id))];
    }
    const words = nq.split(' ');
    const scored = [];
    for (const o of real) {
      const c = norm(o.code); const n = norm(o.name); const all = c + ' ' + n + ' ' + norm(o.label);
      if (!words.every((w) => all.includes(w))) continue;
      const s = c === nq ? 0 : c.startsWith(nq) ? 1 : n.startsWith(nq) ? 2 : n.includes(' ' + nq) ? 3 : 4;
      scored.push([s, o]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    return scored.map((x) => x[1]);
  }

  function render() {
    const p = getPanel();
    const LIMIT = 80;
    const list = search(query);
    const specials = opts.filter((o) => o.special);
    shown = [...list.slice(0, LIMIT), ...specials];
    if (active >= shown.length) active = shown.length - 1;
    if (active < 0 && shown.length && query) active = 0;
    const kids = []; let lastGroup = null;
    shown.forEach((o, i) => {
      if (o.special && i === list.slice(0, LIMIT).length && i > 0) kids.push(h('div', { class: 'combo-sep' }));
      if (!o.special && (o.group || '') !== lastGroup) { lastGroup = o.group || ''; if (lastGroup) kids.push(h('div', { class: 'combo-group' }, lastGroup)); }
      const side = !o.special && meta ? meta(o) : '';
      kids.push(h('div', { class: 'combo-item' + (i === active ? ' on' : '') + (o.special ? ' special' : '') + (o.id === id ? ' cur' : ''), role: 'option',
        onmouseenter: () => { active = i; paintActive(); }, onclick: () => choose(o) },
        o.special ? h('span', { class: 'ci-name' }, o.label)
          : [h('span', { class: 'ci-code' }, ...mark(o.code, query)), h('span', { class: 'ci-name' }, ...mark(o.comboName || o.name, query)),
            side ? h('span', { class: 'ci-meta' }, side) : null, o.kind ? h('span', { class: 'ci-kind' }, o.kind) : null]));
    });
    if (!list.length) kids.unshift(h('div', { class: 'combo-empty' }, query ? 'لا يوجد نتائج لـ "' + query + '"' : 'لا توجد عناصر'));
    else if (list.length > LIMIT) kids.splice(kids.length - specials.length - (specials.length ? 1 : 0), 0, h('div', { class: 'combo-more' }, `و${list.length - LIMIT} كمان — اكتب أكتر عشان تضيّق البحث`));
    p.replaceChildren(...kids);
    paintActive();
  }
  function paintActive() {
    const items = getPanel().querySelectorAll('.combo-item');
    items.forEach((el, i) => el.classList.toggle('on', i === active));
    items[active]?.scrollIntoView({ block: 'nearest' });
  }
  function place() {
    if (!open) return;
    const p = getPanel(); const r = input.getBoundingClientRect();
    if (!r.width && !r.height) { close(); return; }
    const w = Math.min(Math.max(r.width, 380), window.innerWidth - 16, 560);
    p.style.width = w + 'px';
    let right = window.innerWidth - r.right; if (right + w > window.innerWidth - 8) right = window.innerWidth - w - 8;
    p.style.right = Math.max(8, right) + 'px'; p.style.left = 'auto';
    const below = window.innerHeight - r.bottom; const ph = Math.min(p.scrollHeight, 340);
    if (below < ph + 12 && r.top > below) { p.style.top = 'auto'; p.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
    else { p.style.bottom = 'auto'; p.style.top = (r.bottom + 4) + 'px'; }
  }
  function openList() {
    if (input.disabled) return;
    if (owner && owner !== api) owner.close();
    owner = api; open = true; active = -1;
    getPanel().classList.add('show');
    render(); place();
    if (onOpen) Promise.resolve(onOpen()).then((changed) => { if (changed && open && owner === api) { render(); place(); } }).catch(() => {});
  }
  function close() {
    if (owner === api) { getPanel().classList.remove('show'); owner = null; }
    open = false;
  }
  function commit(o, fire = true) {
    const before = id;
    if (o) { id = o.id; input.value = o.label; recentPush(key, o.id); } else { id = null; input.value = ''; }
    input.title = input.value; committed = input.value; input.dataset.id = id || ''; input.classList.remove('invalid');
    if (fire && before !== id) { onChange?.(o || null); input.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  function choose(o) {
    close();
    if (o.special) { const prev = id; set(prev); onSpecial?.(o, query); return; }
    commit(o);
  }
  // لما يسيب الخانة من غير ما يختار من القائمة: النص لازم يطابق عنصر واحد
  function resolve() {
    const t = input.value.trim();
    if (t === committed) return;
    if (!t) { commit(null); return; }
    const sp = opts.find((o) => o.special && o.label === t);
    if (sp) { set(id); onSpecial?.(sp, t); return; }
    const list = search(t);
    const nq = norm(t);
    const exact = list.find((o) => norm(o.label) === nq) || list.find((o) => norm(o.code) === nq && !o.combo) || list.find((o) => norm(o.code) === nq) || list.find((o) => norm(o.name) === nq);
    const o = exact || (list.length === 1 ? list[0] : null);
    if (o) commit(o);
    else { input.classList.add('invalid'); if (id !== null) { id = null; input.dataset.id = ''; committed = input.value; onChange?.(null); input.dispatchEvent(new Event('change', { bubbles: true })); } }
  }

  let justFocused = false;
  input.addEventListener('focus', () => { query = ''; justFocused = true; input.select(); setTimeout(() => { if (document.activeElement === input) openList(); }, 0); });
  input.addEventListener('mouseup', (e) => { if (justFocused) { e.preventDefault(); justFocused = false; } });
  input.addEventListener('mousedown', () => { if (document.activeElement === input && !open) setTimeout(openList, 0); });
  input.addEventListener('input', () => { justFocused = false; query = input.value.trim() === committed ? '' : input.value; active = -1; if (!open) openList(); else { render(); place(); } });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (!open) { openList(); return; }
      active = Math.max(0, Math.min(shown.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))); paintActive();
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && shown[active] && (query || shown[active].id !== id)) { const o = shown[active]; choose(o); if (o.special) { e.preventDefault(); e.stopPropagation(); } }
      else { close(); resolve(); }
    } else if (e.key === 'Tab') {
      if (open && active >= 0 && shown[active] && query) { if (shown[active].special) e.preventDefault(); choose(shown[active]); } else { close(); resolve(); }
    } else if (e.key === 'Escape') {
      if (open || input.value !== committed) { e.preventDefault(); e.stopPropagation(); close(); input.value = committed; input.classList.remove('invalid'); }
    } else if (e.key === 'Delete') {
      e.preventDefault(); input.value = ''; query = ''; active = -1; if (open) { render(); place(); } else openList();
    }
  });
  input.addEventListener('blur', () => { close(); resolve(); });
  // حدث change الأصلي للمتصفح: نحلّ النص، ولو ما اتغيرش شيء نمنعه عشان ما يتكررش
  input.addEventListener('change', (e) => { if (e.isTrusted) { e.stopImmediatePropagation(); resolve(); } });

  set(value);
  const api = {
    el: input,
    get id() { return id; },
    set, resolve, place, close,
    refresh() { if (open && owner === api) { render(); place(); } },
    setOptions(o, k) { const keep = id; opts = o; if (k) key = k; set(o.some((x) => x.id === keep) ? keep : null); if (open) render(); },
    setDisabled(d) { input.disabled = d; if (d) { set(null); close(); } },
  };
  return api;
}

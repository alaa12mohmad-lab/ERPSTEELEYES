// محرر القيود شبه Excel: يُستخدم في صفحة القيود الجديدة وفي نافذة تعديل قيد محفوظ
//   كل قيد: تاريخ، بيان، نوع، وأسطر. كل سطر: حساب، مدين/دائن، طرف، فاتورة، ضريبة، مشروع، مركز، معدة، بيان
import { rpc } from '../../shared/sb.js';
import { h, fmt, store, modal, icon, toast } from '../../shared/ui.js';
import { picker, ENTRY_TYPES, TAX_CATEGORIES, today, parseAcc, rememberPartyAccount } from './lookups.js';

export const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return isFinite(n) ? n : 0; };
export const round2 = (n) => Math.round(n * 100) / 100;
export const emptyLine = () => ({ account_id: null, debit: '', credit: '', party_id: null, employee_id: null, project_id: null, cost_center_id: null,
  equipment_id: null, description: '', invoice_no: '', invoice_date: '', due_date: '', tax_base: '', tax_category: '' });
export const emptyEntry = (date) => ({ entry_date: date || today(), description: '', entry_type: 'regular', lines: [emptyLine(), emptyLine()] });

export function entryDiff(e) {
  const d = e.lines.reduce((s, l) => s + num(l.debit), 0);
  const c = e.lines.reduce((s, l) => s + num(l.credit), 0);
  return { d: round2(d), c: round2(c), diff: round2(d - c) };
}

// تحويل سطر محفوظ (من v_lines) إلى سطر في المحرر
export function lineFromSaved(l) {
  return { account_id: l.account_id, debit: Number(l.debit) ? String(l.debit) : '', credit: Number(l.credit) ? String(l.credit) : '',
    party_id: l.party_id, employee_id: l.employee_id, project_id: l.project_id, cost_center_id: l.cost_center_id, equipment_id: l.equipment_id,
    description: l.line_description || '', invoice_no: l.invoice_no || '', invoice_date: l.invoice_date || '', due_date: l.due_date || '',
    tax_base: l.tax_base ? String(l.tax_base) : '', tax_category: l.tax_category && l.tax_category !== 'standard' ? l.tax_category : '' };
}

// أعمدة الصفحة. يمكن للمستخدم إخفاء الاختيارية منها، وتظهر تلقائيًا إذا احتوت بيانات أو تطلّبها حساب في الصفحة
export const OPT_COLS = [['party', 'الطرف'], ['inv', 'رقم الفاتورة'], ['invdate', 'تاريخ الفاتورة'], ['due', 'الاستحقاق'], ['tax', 'الضريبة'],
  ['project', 'المشروع'], ['cc', 'مركز التكلفة'], ['eq', 'المعدة'], ['note', 'بيان السطر']];
const COLS = [['no', 'القيد'], ['desc', 'البيان'], ['acc', 'الحساب'], ['dr', 'مدين'], ['cr', 'دائن'], ...OPT_COLS, ['del', '']];
const COLS_KEY = 'erp-je-hidden-cols';
export const hiddenCols = () => { const v = store.get(COLS_KEY, []); return Array.isArray(v) ? v : []; };

// نافذة اختيار الأعمدة الظاهرة
export function chooseColumns(onDone) {
  const hidden = new Set(hiddenCols());
  const m = modal({ title: 'الأعمدة الظاهرة', size: 'narrow' });
  m.body.append(h('p', { class: 'notice', style: { marginBottom: '12px' } }, 'العمود المخفي يظهر تلقائيًا إذا احتوى بيانات، أو إذا تطلّبه حساب في الصفحة.'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, OPT_COLS.map(([k, t]) => {
      const c = h('input', { type: 'checkbox', checked: !hidden.has(k) });
      c.addEventListener('change', () => { if (c.checked) hidden.delete(k); else hidden.add(k); });
      return h('label', { class: 'check' }, c, t);
    })));
  m.foot.append(h('button', { class: 'btn primary', onclick: () => { store.set(COLS_KEY, [...hidden]); m.close(); onDone?.(); } }, 'حفظ'),
    h('button', { class: 'btn', onclick: () => { store.set(COLS_KEY, []); m.close(); onDone?.(); } }, 'إظهار الكل'));
}

// إضافة طرف سريعة من داخل القيد: الاسم والنوع والرقم الضريبي، وتُنشأ له بطاقة في العملاء والموردين
export function quickAddParty(lk, { kind = 'supplier', name = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title: 'إضافة طرف جديد', size: 'narrow', onClose: () => { if (!done) resolve(null); } });
    const nm = h('input', { class: 'input', value: name, placeholder: 'اسم المورد أو العميل' });
    const type = h('select', { class: 'input' }, [['supplier', 'مورد'], ['customer', 'عميل'], ['both', 'مورد وعميل']].map(([v, t]) => h('option', { value: v, selected: v === kind }, t)));
    const tax = h('input', { class: 'input', dir: 'ltr', inputmode: 'numeric', maxlength: 15, placeholder: '15 رقمًا (اختياري)' });
    const err = h('p', { class: 'notice bad', style: { display: 'none', marginTop: '10px' } });
    m.body.append(h('div', { class: 'form-grid' },
      h('div', { class: 'field wide' }, h('label', {}, 'الاسم', h('span', { class: 'req' }, '*')), nm),
      h('div', { class: 'field' }, h('label', {}, 'النوع'), type),
      h('div', { class: 'field' }, h('label', {}, 'الرقم الضريبي'), tax)),
      h('p', { class: 'muted', style: { marginTop: '10px', fontSize: '12px' } }, 'يتولّد الكود تلقائيًا، وتُستكمل باقي البيانات لاحقًا من شاشة العملاء والموردين.'), err);
    const save = async () => {
      err.style.display = 'none';
      try {
        const t = type.value;
        const r = await rpc('quick_add_party', { p_name: nm.value, p_customer: t !== 'supplier', p_supplier: t !== 'customer', p_tax: tax.value || null }, 'accounting');
        const o = lk.addParty({ id: r.id, code: r.code, name: r.name, is_customer: t !== 'supplier', is_supplier: t !== 'customer', tax_number: tax.value || null });
        done = true; m.close(); toast(`أُضيف ${r.code} — ${r.name}`, 'ok'); resolve(o);
      } catch (x) { err.textContent = x.message; err.style.display = ''; }
    };
    [nm, tax].forEach((i) => i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } }));
    m.foot.append(h('button', { class: 'btn primary', onclick: save }, 'إضافة'), h('button', { class: 'btn', onclick: () => m.close() }, 'رجوع'));
    setTimeout(() => nm.focus(), 0);
  });
}

// opts: { lk, company, entries, single, excludeEntry, onChange }
export function createEditor(opts) {
  const { lk, company, single = false, excludeEntry = null } = opts;
  let entries = opts.entries;
  let errorAt = null;
  const el = h('div');
  const noticeBox = h('div');
  const ctrls = new Map();        // السطر ← عناصر التحكم (لتحديثها بدون إعادة رسم)
  const checkTimers = new Map();  // قيد ← مؤقت فحص الفواتير
  const rate = lk.vatRate || 0.15;
  let table = null;
  const changed = () => { refreshCols(); opts.onChange?.(entries); };

  // الأعمدة المخفية تظهر تلقائيًا إذا احتوت بيانات أو كانت مطلوبة
  function refreshCols() {
    if (!table) return;
    const hidden = hiddenCols();
    const forced = new Set();
    for (const e of entries) for (const l of e.lines) {
      const a = accRow(l.account_id);
      if (l.party_id || l.employee_id || a?.party_rule === 'required' || taxLine(l)) forced.add('party');
      if ((l.invoice_no || '').trim() || l.invoice_date || taxLine(l)) { forced.add('inv'); forced.add('invdate'); }
      if (isVat(l) || l.tax_category) forced.add('tax');
      if (l.project_id || a?.project_rule === 'required') forced.add('project');
      if (l.cost_center_id || a?.cost_center_rule === 'required') forced.add('cc');
      if (l.equipment_id || a?.equipment_rule === 'required') forced.add('eq');
      if ((l.description || '').trim()) forced.add('note');
      if (l.due_date) forced.add('due');
    }
    OPT_COLS.forEach(([k]) => table.classList.toggle('hide-' + k, hidden.includes(k) && !forced.has(k)));
  }

  const accRow = (id) => (id ? lk.byId('accounts', id)?.row : null);
  const isVat = (l) => (accRow(l.account_id)?.vat_role || 'none') !== 'none';
  const canCategory = (l) => { const a = accRow(l.account_id); return !!a && a.vat_role === 'none' && ['revenue', 'expense', 'asset'].includes(a.account_type); };
  const taxLine = (l) => isVat(l) || (canCategory(l) && ['zero', 'exempt'].includes(l.tax_category));

  // النقل التلقائي داخل القيد (القيمة المنقولة تتحدّث إذا تغيّر مصدرها، وإذا كتبها المستخدم بنفسه لا تُمَس):
  //   رقم الفاتورة: إذا كان في القيد رقم واحد يُنقل إلى كل الأسطر الفارغة (مرجع للتتبع)
  //   الطرف: إذا كان في القيد طرف واحد يُنقل إلى سطر الضريبة وإلى كل سطر لا يخص حسابه الأطراف (مرجع فقط، لا يدخل في أرصدة الأطراف)
  //   تاريخ الفاتورة: لأي سطر فيه رقم فاتورة = تاريخ الفاتورة الوحيد في القيد، وإلا فتاريخ القيد
  function autofill(e) {
    const src = (k) => [...new Set(e.lines.filter((l) => !l._auto?.[k]).map((l) => (typeof l[k] === 'string' ? l[k].trim() : l[k])).filter(Boolean))];
    const parties = src('party_id'), invs = src('invoice_no'), dates = src('invoice_date');
    e.lines.forEach((l) => {
      const c = ctrls.get(l); if (!c) return;
      const a = l._auto || (l._auto = {});
      const put = (k, v) => {
        v = v || (k === 'party_id' ? null : '');
        if ((l[k] || null) === (v || null)) { if (!v) a[k] = false; return; }
        l[k] = v; a[k] = !!v;
        if (k === 'party_id') c.partyP.set(v); else if (k === 'invoice_no') c.invNo.value = v; else c.invDate.value = v;
      };
      const row = accRow(l.account_id);
      const refOnly = !!row && (!row.party_kind || taxLine(l));
      if (!l.party_id || a.party_id) { if (refOnly && !l.employee_id) put('party_id', parties.length === 1 ? parties[0] : null); else if (a.party_id) put('party_id', null); }
      if (!l.invoice_no || a.invoice_no) put('invoice_no', l.account_id && invs.length === 1 ? invs[0] : '');
      if (!l.invoice_date || a.invoice_date) put('invoice_date', (l.invoice_no || '').trim() ? (dates.length === 1 ? dates[0] : e.entry_date) : '');
      c.refreshTax();
    });
  }
  const manual = (l, k) => { if (l._auto) l._auto[k] = false; };

  // فحص أرقام الفواتير في الخادم (تنبيه قبل الحفظ)
  function scheduleCheck(e) {
    clearTimeout(checkTimers.get(e));
    checkTimers.set(e, setTimeout(async () => {
      const relevant = e.lines.some((l) => l.party_id && (l.invoice_no || '').trim());
      e.lines.forEach((l) => ctrls.get(l)?.setInvStatus(null));
      if (!relevant) return;
      try {
        const res = await rpc('check_invoices', { p_company: company, p_entry_date: e.entry_date || today(), p_exclude: excludeEntry,
          p_lines: e.lines.map((l) => ({ account_id: l.account_id, party_id: l.party_id, debit: num(l.debit), credit: num(l.credit),
            invoice_no: (l.invoice_no || '').trim() || null, invoice_date: l.invoice_date || null })) }, 'accounting');
        (res || []).forEach((r) => ctrls.get(e.lines[r.line_index - 1])?.setInvStatus(r));
      } catch { /* التنبيه اختياري — الحفظ يفحص في كل الأحوال */ }
    }, 450));
  }

  function draw(notice, focus) {
    ctrls.clear();
    const tbody = h('tbody');
    entries.forEach((e, ei) => {
      const { d, c, diff } = entryDiff(e);
      const n = e.lines.length;
      e.lines.forEach((l, li) => {
        const tr = h('tr', { 'data-e': ei, 'data-l': li, class: 'je-row' + (ei % 2 ? ' alt' : '') + (li === 0 ? ' first' : '') + (errorAt && errorAt.e === ei && (errorAt.l === null || errorAt.l === li) ? ' err' : '') });
        if (li === 0) {
          const typeSel = h('select', { class: 'input cell-input', 'data-f': 'type', title: 'نوع القيد' },
            ['regular', 'opening', 'adjustment', 'vat_settlement'].map((t) => h('option', { value: t, selected: e.entry_type === t }, ENTRY_TYPES[t])));
          typeSel.addEventListener('change', () => { e.entry_type = typeSel.value; changed(); });
          const dateIn = h('input', { class: 'input cell-input', type: 'date', value: e.entry_date || '', 'data-f': 'date', title: 'تاريخ القيد' });
          dateIn.addEventListener('change', () => { e.entry_date = dateIn.value; autofill(e); changed(); scheduleCheck(e); });
          const descIn = h('textarea', { class: 'input cell-input je-desc', rows: 1, placeholder: 'بيان القيد', 'data-f': 'desc' }, e.description || '');
          descIn.addEventListener('input', () => { e.description = descIn.value; changed(); });
          tr.append(h('td', { rowspan: n, class: 'je-no c-no' },
            h('div', { class: 'je-head' }, h('span', { class: 'je-num' }, single ? '' : ei + 1),
              h('span', { class: 'badge ' + (diff === 0 && d > 0 ? 'ok' : d === 0 && c === 0 ? '' : 'bad'), 'data-diff': ei },
                diff === 0 && d > 0 ? 'متوازن' : d === 0 && c === 0 ? 'فارغ' : 'فرق ' + fmt.num(Math.abs(diff)))),
            dateIn, typeSel),
          h('td', { rowspan: n, class: 'je-desc-cell c-desc' }, descIn));
        }
        tr.append(...lineCells(e, ei, l, li));
        tbody.append(tr);
      });
    });

    const totals = entries.reduce((s, e) => { const x = entryDiff(e); s.d += x.d; s.c += x.c; return s; }, { d: 0, c: 0 });
    table = h('table', { class: 'grid je-grid' },
      h('thead', {}, h('tr', {}, COLS.map(([k, t]) => h('th', { class: 'c-' + k }, t)))),
      tbody,
      h('tfoot', {}, h('tr', {}, h('td', { colspan: 3, style: { fontWeight: 700 } }, single ? 'الإجمالي' : `${entries.length} قيد`),
        h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totals.d)), h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totals.c)),
        h('td', { colspan: COLS.length - 5 }))));
    table.addEventListener('keydown', onKey);
    refreshCols();

    noticeBox.replaceChildren(notice ? h('div', { class: 'notice warn', style: { marginBottom: '10px' } }, notice) : '');
    el.replaceChildren(noticeBox,
      h('div', { class: 'card' },
        h('div', { class: 'table-wrap je-wrap' }, table),
        h('div', { class: 'toolbar', style: { borderTop: '1px solid var(--line)', borderBottom: 0 } },
          h('button', { class: 'btn', onclick: () => { const e = entries[entries.length - 1]; e.lines.push(emptyLine()); redraw({ e: entries.length - 1, l: e.lines.length - 1, f: 'account' }); } }, '+ سطر'),
          single ? '' : h('button', { class: 'btn', onclick: addEntry }, '+ قيد جديد'),
          h('span', { class: 'help' }, single ? 'Enter: الخانة التالية • في آخر السطر: سطر جديد' : 'Enter: الخانة التالية • في آخر السطر: سطر جديد • Ctrl+Enter: قيد جديد'),
          h('div', { class: 'grow' }),
          h('button', { class: 'btn', title: 'اختيار الأعمدة الظاهرة', onclick: () => chooseColumns(refreshCols) }, icon('columns'), 'الأعمدة'),
          ...(opts.footExtras ? opts.footExtras() : []))));
    entries.forEach((e) => { if (e.lines.some((l) => l.party_id && l.invoice_no)) scheduleCheck(e); });
    if (focus) focusCell(focus);
  }

  function redraw(focus) { changed(); draw(null, focus); }

  function addEntry() {
    const last = entries[entries.length - 1];
    entries.push(emptyEntry(last?.entry_date));
    redraw({ e: entries.length - 1, l: 0, f: 'desc' });
  }

  function focusCell({ e, l, f }) {
    const sel = ['date', 'desc', 'type'].includes(f) ? `tr[data-e="${e}"][data-l="0"] [data-f="${f}"]` : `tr[data-e="${e}"][data-l="${l}"] [data-f="${f}"]`;
    setTimeout(() => el.querySelector(sel)?.focus(), 0);
  }

  function updateBadge(ei) {
    const b = el.querySelector(`[data-diff="${ei}"]`); if (!b) return;
    const { d, c, diff } = entryDiff(entries[ei]);
    b.className = 'badge ' + (diff === 0 && d > 0 ? 'ok' : d === 0 && c === 0 ? '' : 'bad');
    b.textContent = diff === 0 && d > 0 ? 'متوازن' : d === 0 && c === 0 ? 'فارغ' : 'فرق ' + fmt.num(Math.abs(diff));
    const totals = entries.reduce((s, x) => { const t = entryDiff(x); s.d += t.d; s.c += t.c; return s; }, { d: 0, c: 0 });
    const tf = el.querySelectorAll('tfoot td.num');
    if (tf[0]) tf[0].textContent = fmt.num(totals.d);
    if (tf[1]) tf[1].textContent = fmt.num(totals.c);
  }

  function lineCells(e, ei, l, li) {
    // خانة الحساب تقبل الحساب أو اسم المورد/العميل (فتختار حسابه وتسجّل الطرف)
    const accValue = () => (l.party_id && lk.isPartyAccount(l.account_id) ? lk.ensureCombo(l.party_id, l.account_id) : l.account_id);
    const accP = picker({ options: lk.accountOptions, listKey: 'accx-' + company, value: accValue(), placeholder: 'الحساب أو المورد/العميل', cls: 'acc', meta: lk.balText, onOpen: lk.loadBalances,
      onSpecial: async (_, typed) => {
        const o = await quickAddParty(lk, { name: '' });
        if (!o) return;
        const c = lk.accountOptions.find((x) => x.combo && x.party === o.id);
        if (!c) { toast('أُضيف الطرف، لكن لا يوجد في الشجرة حساب موردين/عملاء يقبله — اختر الحساب واكتب الطرف في خانته', 'warn'); return; }
        accP.set(c.id); onAcc();
      } });
    accP.el.dataset.f = 'account';
    const dr = h('input', { class: 'input cell-input num', inputmode: 'decimal', value: l.debit, 'data-f': 'debit' });
    const cr = h('input', { class: 'input cell-input num', inputmode: 'decimal', value: l.credit, 'data-f': 'credit' });
    const partyP = picker({ options: lk.partyLists.party, listKey: 'party+', value: l.party_id || l.employee_id, placeholder: 'الطرف', meta: lk.balText, onOpen: lk.loadBalances,
      onSpecial: async () => {
        const kind = accRow(l.account_id)?.party_kind === 'customer' || accRow(l.account_id)?.vat_role === 'output' ? 'customer' : 'supplier';
        const o = await quickAddParty(lk, { kind });
        if (o) { partyP.set(o.id); onParty(); }
      } });
    partyP.el.dataset.f = 'party';
    const invNo = h('input', { class: 'input cell-input inv', value: l.invoice_no || '', placeholder: 'رقم الفاتورة', 'data-f': 'inv', dir: 'ltr' });
    const invSt = h('span', { class: 'inv-st' });
    const invDate = h('input', { class: 'input cell-input', type: 'date', value: l.invoice_date || '', 'data-f': 'invdate' });
    const dueDate = h('input', { class: 'input cell-input', type: 'date', value: l.due_date || '', 'data-f': 'due', title: 'تاريخ استحقاق الفاتورة إذا اختلف عن مدة سداد الطرف' });
    dueDate.addEventListener('change', () => { l.due_date = dueDate.value; changed(); });
    const base = h('input', { class: 'input cell-input num', inputmode: 'decimal', value: l.tax_base || '', placeholder: 'المبلغ الخاضع', 'data-f': 'base', title: 'المبلغ الخاضع للضريبة (قبل الضريبة)' });
    const cat = h('select', { class: 'input cell-input', 'data-f': 'cat', title: 'الفئة الضريبية للإقرار' },
      h('option', { value: '' }, '—'), Object.entries(TAX_CATEGORIES).filter(([k]) => k !== 'standard').map(([k, v]) => h('option', { value: k, selected: l.tax_category === k }, v)));
    const projP = picker({ options: lk.projects, listKey: 'proj-' + company, value: l.project_id, placeholder: 'المشروع' }); projP.el.dataset.f = 'project';
    const ccP = picker({ options: lk.costCenters, listKey: 'cc-' + company, value: l.cost_center_id, placeholder: 'المركز' }); ccP.el.dataset.f = 'cc';
    const eqP = picker({ options: lk.equipment, listKey: 'eq-' + company, value: l.equipment_id, placeholder: 'المعدة' }); eqP.el.dataset.f = 'equipment';
    const note = h('input', { class: 'input cell-input', value: l.description || '', 'data-f': 'note' });

    // خانة الضريبة: مبلغ خاضع لسطر حساب الضريبة، أو فئة (صفري/معفى) لسطر إيراد أو مصروف
    const refreshTax = () => {
      const vat = isVat(l);
      base.style.display = vat ? '' : 'none';
      cat.style.display = vat ? 'none' : '';
      cat.disabled = !canCategory(l);
      if (cat.disabled && l.tax_category) { l.tax_category = ''; cat.value = ''; }
      const amt = num(l.debit) || num(l.credit);
      base.placeholder = vat && amt ? fmt.num(round2(amt / rate)) : 'المبلغ الخاضع';
      const b = num(l.tax_base);
      const off = vat && b && amt && Math.abs(round2(b * rate) - amt) > 0.1;
      base.classList.toggle('warnbox', !!off);
      base.title = off ? `الضريبة ${fmt.num(amt)} لا تساوي ${rate * 100}% من المبلغ الخاضع (${fmt.num(round2(b * rate))}) — راجع الفاتورة` : 'المبلغ الخاضع للضريبة (قبل الضريبة)';
      const t = taxLine(l);
      [invNo, invDate].forEach((x) => x.classList.toggle('req', t));
      partyP.el.classList.toggle('req', t || accRow(l.account_id)?.party_rule === 'required');
    };
    const setInvStatus = (r) => {
      invSt.className = 'inv-st' + (r ? ' ' + r.level : '');
      invSt.textContent = !r ? '' : r.level === 'error' ? '✗' : r.level === 'warn' ? '!' : '✓';
      invSt.title = r ? r.message : '';
      invNo.classList.toggle('invalid', r?.level === 'error');
      invNo.title = r ? r.message : '';
    };
    ctrls.set(l, { partyP, invNo, invDate, refreshTax, setInvStatus });

    // الطرف متاح في كل سطر (مرجع للتتبع). تُصفّى القائمة حسب نوع الحساب، ويُميَّز الإجباري
    const applyRules = (a) => {
      const r = a?.row;
      const setRule = (p, rule) => p.el.classList.toggle('req', rule === 'required');
      if (!r) { [partyP, projP, ccP, eqP].forEach((p) => p.el.classList.remove('req')); refreshTax(); return; }
      const kind = r.party_kind || (r.vat_role === 'input' ? 'supplier' : r.vat_role === 'output' ? 'customer' : null);
      const list = kind === 'employee' ? [lk.employees, 'emp-' + company] : kind === 'customer' ? [lk.partyLists.cust, 'cust+'] : kind === 'supplier' ? [lk.partyLists.supp, 'supp+'] : [lk.partyLists.party, 'party+'];
      partyP.setOptions(list[0], list[1]);
      setRule(partyP, r.party_rule);
      setRule(projP, r.project_rule); setRule(ccP, r.cost_center_rule); setRule(eqP, r.equipment_rule);
      partyP.el.placeholder = ({ employee: 'الموظف', customer: 'العميل', supplier: 'المورد' }[kind] || 'الطرف');
      syncParty();
      refreshTax();
    };
    const syncParty = () => {
      const kind = accRow(l.account_id)?.party_kind;
      if (kind === 'employee') { l.employee_id = partyP.id; l.party_id = null; } else { l.party_id = partyP.id; l.employee_id = null; }
    };

    const initialAcc = l.account_id ? lk.byId('accounts', l.account_id) : null;
    if (initialAcc) { applyRules(initialAcc); partyP.set(l.party_id || l.employee_id); } else refreshTax();

    const after = (fn) => () => setTimeout(() => { fn(); changed(); }, 0);
    // اختيار الحساب: إذا اختير طرف (مورد ← حسابه) يُسجَّل الحساب والطرف معًا ويُحفظ كحساب افتراضي للطرف
    const rememberDefault = () => {
      const r = accRow(l.account_id); const p = l.party_id && lk.byId('parties', l.party_id);
      if (!r || !p || !lk.isPartyAccount(l.account_id)) return;
      const role = ['customer', 'supplier'].includes(r.party_kind) ? r.party_kind : p.row.is_supplier ? 'supplier' : 'customer';
      rememberPartyAccount(company, l.party_id, role, l.account_id);
    };
    function onAcc() {
      const { account, party } = parseAcc(accP.id);
      const wasParty = lk.isPartyAccount(l.account_id);
      l.account_id = account;
      applyRules(lk.byId('accounts', account));
      if (party) { partyP.set(party); syncParty(); manual(l, 'party_id'); rememberDefault(); }
      else if (lk.isPartyAccount(account) && l.party_id) { accP.set(lk.ensureCombo(l.party_id, account)); rememberDefault(); }
      else if (wasParty && !lk.isPartyAccount(account) && l.party_id && !l._auto?.party_id) { partyP.set(null); syncParty(); }
      autofill(e); scheduleCheck(e);
    }
    function onParty() {
      syncParty(); manual(l, 'party_id');
      if (lk.isPartyAccount(l.account_id)) { accP.set(l.party_id ? lk.ensureCombo(l.party_id, l.account_id) : l.account_id); rememberDefault(); }
      autofill(e); scheduleCheck(e); changed();
    }
    accP.el.addEventListener('change', after(onAcc));
    dr.addEventListener('input', () => { l.debit = dr.value; if (dr.value.trim()) { cr.value = ''; l.credit = ''; } updateBadge(ei); refreshTax(); changed(); scheduleCheck(e); });
    cr.addEventListener('input', () => { l.credit = cr.value; if (cr.value.trim()) { dr.value = ''; l.debit = ''; } updateBadge(ei); refreshTax(); changed(); scheduleCheck(e); });
    partyP.el.addEventListener('change', () => setTimeout(onParty, 0));
    invNo.addEventListener('input', () => { l.invoice_no = invNo.value; manual(l, 'invoice_no'); changed(); });
    invNo.addEventListener('change', () => { autofill(e); changed(); scheduleCheck(e); });
    invDate.addEventListener('change', () => { l.invoice_date = invDate.value; manual(l, 'invoice_date'); autofill(e); changed(); scheduleCheck(e); });
    base.addEventListener('input', () => { l.tax_base = base.value; refreshTax(); changed(); });
    cat.addEventListener('change', () => { l.tax_category = cat.value; applyRules(lk.byId('accounts', l.account_id)); autofill(e); changed(); });
    projP.el.addEventListener('change', after(() => { l.project_id = projP.id; }));
    ccP.el.addEventListener('change', after(() => { l.cost_center_id = ccP.id; }));
    eqP.el.addEventListener('change', after(() => { l.equipment_id = eqP.id; }));
    note.addEventListener('input', () => { l.description = note.value; changed(); });

    // اقتراح المبلغ المتبقي للتوازن، والمبلغ الخاضع، عند الدخول إلى خانة فارغة
    const suggest = (input, side) => input.addEventListener('focus', () => {
      if (input.value || (side === 'debit' ? cr.value : dr.value)) return;
      const { diff } = entryDiff(e);
      if (side === 'credit' && diff > 0) input.placeholder = fmt.num(diff);
      else if (side === 'debit' && diff < 0) input.placeholder = fmt.num(-diff);
      else input.placeholder = '';
    });
    suggest(dr, 'debit'); suggest(cr, 'credit');
    [dr, cr, base].forEach((inp) => inp.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === 'Tab') && !inp.value && /[0-9]/.test(inp.placeholder)) {
        inp.value = inp.placeholder.replace(/,/g, ''); inp.dispatchEvent(new Event('input'));
      }
    }));

    const delBtn = h('button', { class: 'btn ghost sm', title: 'حذف السطر', tabindex: -1, onclick: () => {
      e.lines.splice(li, 1);
      if (e.lines.length === 0) { if (single) e.lines.push(emptyLine()); else entries.splice(ei, 1); }
      if (entries.length === 0) entries.push(emptyEntry());
      redraw();
    } }, '×');

    return [h('td', { class: 'acc-cell c-acc' }, accP.el), h('td', { class: 'c-dr' }, dr), h('td', { class: 'c-cr' }, cr), h('td', { class: 'c-party' }, partyP.el),
      h('td', { class: 'inv-cell c-inv' }, invNo, invSt), h('td', { class: 'c-invdate' }, invDate), h('td', { class: 'c-due' }, dueDate), h('td', { class: 'c-tax' }, base, cat),
      h('td', { class: 'c-project' }, projP.el), h('td', { class: 'c-cc' }, ccP.el), h('td', { class: 'c-eq' }, eqP.el), h('td', { class: 'c-note' }, note), h('td', { class: 'c-del' }, delBtn)];
  }

  function onKey(ev) {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement)) return;
    const tr = t.closest('tr'); if (!tr || tr.dataset.e === undefined) return;
    const ei = Number(tr.dataset.e), li = Number(tr.dataset.l);
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); if (!single) { t.blur(); addEntry(); } return; }
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    ev.preventDefault();
    setTimeout(() => {
      const inputs = [...tr.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea')].filter((x) => x.offsetParent !== null);
      const i = inputs.indexOf(t);
      if (i >= 0 && i < inputs.length - 1) { inputs[i + 1].focus(); inputs[i + 1].select?.(); return; }
      const e = entries[ei];
      if (li < e.lines.length - 1) focusCell({ e: ei, l: li + 1, f: 'account' });
      else { e.lines.push(emptyLine()); redraw({ e: ei, l: li + 1, f: 'account' }); }
    }, 0);
  }

  // تجميع القيود للحفظ مع فحص سريع في الشاشة. يُرجع {payload, clean} أو يرمي خطأً يحدد مكان السطر
  function collect() {
    const clean = entries.map((e, src) => ({ ...e, src, lines: e.lines.map((l, lsrc) => ({ ...l, lsrc })).filter((l) => l.account_id || num(l.debit) || num(l.credit)) }))
      .filter((e) => e.lines.length || (e.description || '').trim());
    if (!clean.length) throw Object.assign(new Error('الصفحة فارغة'), { at: null });
    for (let i = 0; i < clean.length; i++) {
      const e = clean[i]; const label = single ? 'القيد' : `القيد ${i + 1}`;
      const fail = (msg, j = null) => { throw Object.assign(new Error(`${label}: ${msg}`), { at: { e: e.src, l: j === null ? null : e.lines[j].lsrc } }); };
      if (!e.entry_date) fail('التاريخ مطلوب');
      if (!(e.description || '').trim()) fail('البيان مطلوب');
      if (e.lines.length < 2) fail('يحتاج إلى سطرين على الأقل');
      for (let j = 0; j < e.lines.length; j++) {
        const l = e.lines[j];
        if (!l.account_id) fail(`السطر ${j + 1}: الحساب مطلوب`, j);
        if (!num(l.debit) && !num(l.credit)) fail(`السطر ${j + 1}: المبلغ مطلوب`, j);
      }
      if (entryDiff(e).diff !== 0) fail('غير متوازن (فرق ' + fmt.num(Math.abs(entryDiff(e).diff)) + ')');
    }
    const payload = clean.map((e) => ({
      entry_date: e.entry_date, description: e.description.trim(), entry_type: e.entry_type || 'regular',
      lines: e.lines.map((l) => ({
        account_id: l.account_id, debit: num(l.debit) || 0, credit: num(l.credit) || 0,
        party_id: l.party_id, employee_id: l.employee_id, project_id: l.project_id, cost_center_id: l.cost_center_id,
        equipment_id: l.equipment_id, description: (l.description || '').trim() || null,
        invoice_no: (l.invoice_no || '').trim() || null, invoice_date: l.invoice_date || null, due_date: l.due_date || null,
        tax_base: isVat(l) && num(l.tax_base) ? num(l.tax_base) : null,
        tax_category: !isVat(l) && l.tax_category ? l.tax_category : null,
      })),
    }));
    return { payload, clean };
  }

  // تحديد مكان خطأ رسالة الخادم: "القيد 3، السطر 2: …" أو "القيد، السطر 2: …"
  function showServerError(message, clean) {
    const m = String(message).match(/القيد(?: (\d+))?(?:، السطر (\d+))?/);
    errorAt = null;
    if (m) {
      const target = clean[(m[1] ? Number(m[1]) : 1) - 1];
      if (target) errorAt = { e: target.src, l: m[2] ? target.lines[Number(m[2]) - 1]?.lsrc ?? null : null };
    }
    draw(message);
  }
  function showError(message, at) { errorAt = at || null; draw(message); }

  draw(opts.notice);
  return {
    el, collect, showServerError, showError,
    get entries() { return entries; },
    load(list, notice) { entries = list; errorAt = null; draw(notice); },
  };
}

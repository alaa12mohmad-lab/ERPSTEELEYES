// محرر القيود شبه Excel: يُستخدم في صفحة القيود الجديدة وفي نافذة تعديل قيد محفوظ
//   كل قيد: تاريخ، بيان، نوع، وأسطر. كل سطر: حساب، مدين/دائن، طرف، فاتورة، ضريبة، مشروع، مركز، معدة، بيان
import { rpc } from '../../shared/sb.js';
import { h, fmt } from '../../shared/ui.js';
import { picker, ENTRY_TYPES, TAX_CATEGORIES, today } from './lookups.js';

export const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return isFinite(n) ? n : 0; };
export const round2 = (n) => Math.round(n * 100) / 100;
export const emptyLine = () => ({ account_id: null, debit: '', credit: '', party_id: null, employee_id: null, project_id: null, cost_center_id: null,
  equipment_id: null, description: '', invoice_no: '', invoice_date: '', tax_base: '', tax_category: '' });
export const emptyEntry = (date) => ({ entry_date: date || today(), description: '', entry_type: 'regular', lines: [emptyLine(), emptyLine()] });

export function entryDiff(e) {
  const d = e.lines.reduce((s, l) => s + num(l.debit), 0);
  const c = e.lines.reduce((s, l) => s + num(l.credit), 0);
  return { d: round2(d), c: round2(c), diff: round2(d - c) };
}

// تحويل سطر محفوظ (من v_lines) لسطر في المحرر
export function lineFromSaved(l) {
  return { account_id: l.account_id, debit: Number(l.debit) ? String(l.debit) : '', credit: Number(l.credit) ? String(l.credit) : '',
    party_id: l.party_id, employee_id: l.employee_id, project_id: l.project_id, cost_center_id: l.cost_center_id, equipment_id: l.equipment_id,
    description: l.line_description || '', invoice_no: l.invoice_no || '', invoice_date: l.invoice_date || '',
    tax_base: l.tax_base ? String(l.tax_base) : '', tax_category: l.tax_category && l.tax_category !== 'standard' ? l.tax_category : '' };
}

const COLS = ['القيد', 'التاريخ', 'البيان', 'الحساب', 'مدين', 'دائن', 'الطرف', 'رقم الفاتورة', 'تاريخ الفاتورة', 'الضريبة', 'المشروع', 'مركز التكلفة', 'المعدة', 'بيان السطر', ''];

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
  const changed = () => opts.onChange?.(entries);

  const accRow = (id) => (id ? lk.byId('accounts', id)?.row : null);
  const isVat = (l) => (accRow(l.account_id)?.vat_role || 'none') !== 'none';
  const canCategory = (l) => { const a = accRow(l.account_id); return !!a && a.vat_role === 'none' && ['revenue', 'expense', 'asset'].includes(a.account_type); };
  const taxLine = (l) => isVat(l) || (canCategory(l) && ['zero', 'exempt'].includes(l.tax_category));

  // سطر الضريبة (أو الصفري/المعفى) يأخذ الطرف ورقم الفاتورة وتاريخها من باقي القيد لو قيمة واحدة.
  //   القيمة المنقولة تلقائيًا تتحدّث لو تغيّر مصدرها، ولو كتبها المستخدم بنفسه لا تُلمس.
  //   تاريخ الفاتورة الافتراضي = تاريخ القيد (حتى يكتب المستخدم تاريخًا آخر)
  function autofill(e) {
    const src = (k) => [...new Set(e.lines.filter((l) => !l._auto?.[k]).map((l) => (typeof l[k] === 'string' ? l[k].trim() : l[k])).filter(Boolean))];
    const parties = src('party_id'), invs = src('invoice_no'), dates = src('invoice_date');
    e.lines.forEach((l) => {
      const c = ctrls.get(l); if (!c) return;
      const a = l._auto || (l._auto = {});
      const put = (k, v) => {
        if (l[k] === v) return;
        l[k] = v; a[k] = true;
        if (k === 'party_id') c.partyP.set(v); else if (k === 'invoice_no') c.invNo.value = v; else c.invDate.value = v;
      };
      if (taxLine(l)) {
        if ((!l.party_id || a.party_id) && !l.employee_id && parties.length === 1) put('party_id', parties[0]);
        if ((!l.invoice_no || a.invoice_no) && invs.length === 1) put('invoice_no', invs[0]);
        if ((!l.invoice_date || a.invoice_date) && dates.length === 1) put('invoice_date', dates[0]);
      }
      if ((l.invoice_no || '').trim() && (!l.invoice_date || (a.invoice_date && !(taxLine(l) && dates.length === 1)))) put('invoice_date', e.entry_date || '');
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
      } catch { /* التنبيه اختياري — الحفظ يفحص على أي حال */ }
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
            ['regular', 'opening', 'adjustment'].map((t) => h('option', { value: t, selected: e.entry_type === t }, ENTRY_TYPES[t])));
          typeSel.addEventListener('change', () => { e.entry_type = typeSel.value; changed(); });
          tr.append(h('td', { rowspan: n, class: 'je-no' },
            h('div', { class: 'je-num' }, single ? '' : ei + 1),
            h('span', { class: 'badge ' + (diff === 0 && d > 0 ? 'ok' : d === 0 && c === 0 ? '' : 'bad'), 'data-diff': ei },
              diff === 0 && d > 0 ? 'متوازن' : d === 0 && c === 0 ? 'فارغ' : 'فرق ' + fmt.num(Math.abs(diff))),
            typeSel));
          const dateIn = h('input', { class: 'input cell-input', type: 'date', value: e.entry_date || '', 'data-f': 'date' });
          dateIn.addEventListener('change', () => { e.entry_date = dateIn.value; autofill(e); changed(); scheduleCheck(e); });
          const descIn = h('textarea', { class: 'input cell-input je-desc', rows: 1, placeholder: 'بيان القيد', 'data-f': 'desc' }, e.description || '');
          descIn.addEventListener('input', () => { e.description = descIn.value; changed(); });
          tr.append(h('td', { rowspan: n }, dateIn), h('td', { rowspan: n, class: 'je-desc-cell' }, descIn));
        }
        tr.append(...lineCells(e, ei, l, li));
        tbody.append(tr);
      });
    });

    const totals = entries.reduce((s, e) => { const x = entryDiff(e); s.d += x.d; s.c += x.c; return s; }, { d: 0, c: 0 });
    const table = h('table', { class: 'grid je-grid' },
      h('thead', {}, h('tr', {}, COLS.map((t) => h('th', {}, t)))),
      tbody,
      h('tfoot', {}, h('tr', {}, h('td', { colspan: 4, style: { fontWeight: 700 } }, single ? 'الإجمالي' : `${entries.length} قيد`),
        h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totals.d)), h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totals.c)),
        h('td', { colspan: COLS.length - 6 }))));
    table.addEventListener('keydown', onKey);

    noticeBox.replaceChildren(notice ? h('div', { class: 'notice warn', style: { marginBottom: '10px' } }, notice) : '');
    el.replaceChildren(noticeBox,
      h('div', { class: 'card' },
        h('div', { class: 'table-wrap je-wrap' }, table),
        h('div', { class: 'toolbar', style: { borderTop: '1px solid var(--line)', borderBottom: 0 } },
          h('button', { class: 'btn', onclick: () => { const e = entries[entries.length - 1]; e.lines.push(emptyLine()); redraw({ e: entries.length - 1, l: e.lines.length - 1, f: 'account' }); } }, '+ سطر'),
          single ? '' : h('button', { class: 'btn', onclick: addEntry }, '+ قيد جديد'),
          h('span', { class: 'help' }, single ? 'Enter: الخانة التالية • في آخر السطر: سطر جديد' : 'Enter: الخانة التالية • في آخر السطر: سطر جديد • Ctrl+Enter: قيد جديد'),
          h('div', { class: 'grow' }),
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
    const accP = picker({ options: lk.postable, listKey: 'acc-' + company, value: l.account_id, placeholder: 'الحساب', cls: 'acc' });
    accP.el.dataset.f = 'account';
    const dr = h('input', { class: 'input cell-input num', inputmode: 'decimal', value: l.debit, 'data-f': 'debit' });
    const cr = h('input', { class: 'input cell-input num', inputmode: 'decimal', value: l.credit, 'data-f': 'credit' });
    const partyP = picker({ options: lk.parties, listKey: 'party', value: l.party_id || l.employee_id, placeholder: 'الطرف' }); partyP.el.dataset.f = 'party';
    const invNo = h('input', { class: 'input cell-input inv', value: l.invoice_no || '', placeholder: 'رقم الفاتورة', 'data-f': 'inv', dir: 'ltr' });
    const invSt = h('span', { class: 'inv-st' });
    const invDate = h('input', { class: 'input cell-input', type: 'date', value: l.invoice_date || '', 'data-f': 'invdate' });
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
      if (t && !partyP.el.disabled) partyP.el.classList.add('req');
    };
    const setInvStatus = (r) => {
      invSt.className = 'inv-st' + (r ? ' ' + r.level : '');
      invSt.textContent = !r ? '' : r.level === 'error' ? '✗' : r.level === 'warn' ? '!' : '✓';
      invSt.title = r ? r.message : '';
      invNo.classList.toggle('invalid', r?.level === 'error');
      invNo.title = r ? r.message : '';
    };
    ctrls.set(l, { partyP, invNo, invDate, refreshTax, setInvStatus });

    const applyRules = (a) => {
      const r = a?.row;
      const setRule = (p, rule) => {
        p.el.classList.toggle('req', rule === 'required');
        if (rule === 'forbidden') p.setDisabled(true); else p.el.disabled = false;
      };
      if (!r) { [partyP, projP, ccP, eqP].forEach((p) => { p.el.disabled = false; p.el.classList.remove('req'); }); refreshTax(); return; }
      const kind = r.party_kind || (r.vat_role === 'input' ? 'supplier' : r.vat_role === 'output' ? 'customer' : null);
      const list = kind === 'employee' ? [lk.employees, 'emp-' + company] : kind === 'customer' ? [lk.customers, 'cust'] : kind === 'supplier' ? [lk.suppliers, 'supp'] : [lk.parties, 'party'];
      // سطر الضريبة يقبل الطرف دائمًا (للإقرار) حتى لو الحساب لا يقبل طرفًا عادةً
      const partyRule = r.vat_role !== 'none' && r.party_rule === 'forbidden' ? 'optional' : r.party_rule;
      if (partyRule !== 'forbidden' || canCategory(l)) partyP.setOptions(list[0], list[1]);
      setRule(partyP, partyRule === 'forbidden' && canCategory(l) && l.tax_category ? 'optional' : partyRule);
      setRule(projP, r.project_rule); setRule(ccP, r.cost_center_rule); setRule(eqP, r.equipment_rule);
      partyP.el.placeholder = partyP.el.disabled ? '' : ({ employee: 'الموظف', customer: 'العميل', supplier: 'المورد' }[kind] || 'الطرف');
      syncParty();
      refreshTax();
    };
    const syncParty = () => {
      const kind = accRow(accP.id)?.party_kind;
      if (kind === 'employee') { l.employee_id = partyP.id; l.party_id = null; } else { l.party_id = partyP.id; l.employee_id = null; }
    };

    const initialAcc = l.account_id ? lk.byId('accounts', l.account_id) : null;
    if (initialAcc) { applyRules(initialAcc); partyP.set(l.party_id || l.employee_id); } else refreshTax();

    const after = (fn) => () => setTimeout(() => { fn(); changed(); }, 0);
    accP.el.addEventListener('change', after(() => { l.account_id = accP.id; applyRules(lk.byId('accounts', accP.id)); autofill(e); scheduleCheck(e); }));
    dr.addEventListener('input', () => { l.debit = dr.value; if (dr.value.trim()) { cr.value = ''; l.credit = ''; } updateBadge(ei); refreshTax(); changed(); scheduleCheck(e); });
    cr.addEventListener('input', () => { l.credit = cr.value; if (cr.value.trim()) { dr.value = ''; l.debit = ''; } updateBadge(ei); refreshTax(); changed(); scheduleCheck(e); });
    partyP.el.addEventListener('change', after(() => { syncParty(); manual(l, 'party_id'); autofill(e); scheduleCheck(e); }));
    invNo.addEventListener('input', () => { l.invoice_no = invNo.value; manual(l, 'invoice_no'); changed(); });
    invNo.addEventListener('change', () => { autofill(e); changed(); scheduleCheck(e); });
    invDate.addEventListener('change', () => { l.invoice_date = invDate.value; manual(l, 'invoice_date'); autofill(e); changed(); scheduleCheck(e); });
    base.addEventListener('input', () => { l.tax_base = base.value; refreshTax(); changed(); });
    cat.addEventListener('change', () => { l.tax_category = cat.value; applyRules(lk.byId('accounts', accP.id)); autofill(e); changed(); });
    projP.el.addEventListener('change', after(() => { l.project_id = projP.id; }));
    ccP.el.addEventListener('change', after(() => { l.cost_center_id = ccP.id; }));
    eqP.el.addEventListener('change', after(() => { l.equipment_id = eqP.id; }));
    note.addEventListener('input', () => { l.description = note.value; changed(); });

    // اقتراح المبلغ المتبقي للتوازن، والمبلغ الخاضع، عند الدخول لخانة فاضية
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

    return [h('td', { class: 'acc-cell' }, accP.el), h('td', {}, dr), h('td', {}, cr), h('td', {}, partyP.el),
      h('td', { class: 'inv-cell' }, invNo, invSt), h('td', {}, invDate), h('td', {}, base, cat),
      h('td', {}, projP.el), h('td', {}, ccP.el), h('td', {}, eqP.el), h('td', {}, note), h('td', {}, delBtn)];
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

  // تجميع القيود للحفظ مع فحص سريع في الشاشة. يرجع {payload, clean} أو يرمي خطأ فيه مكان السطر
  function collect() {
    const clean = entries.map((e, src) => ({ ...e, src, lines: e.lines.map((l, lsrc) => ({ ...l, lsrc })).filter((l) => l.account_id || num(l.debit) || num(l.credit)) }))
      .filter((e) => e.lines.length || (e.description || '').trim());
    if (!clean.length) throw Object.assign(new Error('الصفحة فاضية'), { at: null });
    for (let i = 0; i < clean.length; i++) {
      const e = clean[i]; const label = single ? 'القيد' : `القيد ${i + 1}`;
      const fail = (msg, j = null) => { throw Object.assign(new Error(`${label}: ${msg}`), { at: { e: e.src, l: j === null ? null : e.lines[j].lsrc } }); };
      if (!e.entry_date) fail('التاريخ مطلوب');
      if (!(e.description || '').trim()) fail('البيان مطلوب');
      if (e.lines.length < 2) fail('يحتاج سطرين على الأقل');
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
        invoice_no: (l.invoice_no || '').trim() || null, invoice_date: l.invoice_date || null,
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

// سجل القيود + نافذة القيد (عكس، علامة المنارة)
import { acc, core, rpc, errMsg } from '../../shared/sb.js';
import { h, modal, toast, fmt, askReason } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { ENTRY_TYPES, SOURCES, TAX_CATEGORIES, yearStart, today, loadLookups } from './lookups.js';
import { createEditor, lineFromSaved } from './editor.js';
import { printEntries } from './print.js';

// شارات حالة القيد (تُستخدم في الصفحة والسجل)
export function entryBadges(e) {
  return [
    e.status === 'cancelled' && h('span', { class: 'badge bad', title: e.cancel_reason || '' }, 'ملغي'),
    e.entry_type !== 'regular' && h('span', { class: 'badge accent' }, ENTRY_TYPES[e.entry_type]),
    e.reversed_by_no && h('span', { class: 'badge bad' }, 'معكوس'),
    e.version > 1 && e.status !== 'cancelled' && h('span', { class: 'badge warn', title: `النسخة ${e.version}` }, 'معدّل'),
    e.in_manara && h('span', { class: 'badge ok' }, 'بالمنارة'),
    e.manara_review && h('span', { class: 'badge warn', title: 'عُدّل أو أُلغي بعد إدخاله في المنارة' }, 'راجع المنارة'),
  ].filter(Boolean);
}

const lineCols = ['الحساب', 'مدين', 'دائن', 'الطرف', 'الفاتورة', 'المشروع', 'المركز', 'المعدة', 'البيان'];
const invText = (l) => (l.invoice_no ? [l.invoice_no, l.invoice_date && fmt.date(l.invoice_date),
  l.tax_base ? 'خاضع ' + fmt.num(l.tax_base) : l.tax_category && l.tax_category !== 'standard' ? TAX_CATEGORIES[l.tax_category] : ''].filter(Boolean).join(' — ') : '');

export async function openEntry(id, { onChange } = {}) {
  const m = modal({ title: 'القيد', size: 'wide' });
  m.body.append(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  const [{ data: e, error }, { data: lines }, { data: users }] = await Promise.all([
    acc.from('v_entries').select('*').eq('id', id).single(),
    acc.from('v_lines').select('*').eq('entry_id', id).order('line_no'),
    core.from('v_user_names').select('id, full_name'),
  ]);
  if (error) { m.body.replaceChildren(h('div', { class: 'notice bad' }, errMsg(error))); return; }
  const name = (uid) => (users || []).find((u) => u.id === uid)?.full_name || '—';
  const cancelled = e.status === 'cancelled';
  const done = () => { m.close(); onChange?.(); };
  m.el.querySelector('h2').textContent = `القيد ${e.fiscal_year}-${e.entry_no} — ${state.companyName(e.company_id)}`;
  const totD = (lines || []).reduce((s, l) => s + Number(l.debit), 0);
  m.body.replaceChildren(
    cancelled ? h('div', { class: 'notice bad', style: { marginBottom: '12px' } }, 'قيد ملغي — لا يدخل في أي رصيد أو تقرير. السبب: ' + (e.cancel_reason || '')) : '',
    e.manara_review ? h('div', { class: 'notice warn', style: { marginBottom: '12px' } },
      cancelled ? 'القيد كان مُدخلًا في المنارة ثم أُلغي هنا — ألغِه في المنارة أيضًا.' : 'القيد عُدّل بعد إدخاله في المنارة — راجع القيد في المنارة ثم علّمه من جديد.') : '',
    h('dl', { class: 'kv', style: { marginBottom: '14px' } },
      h('dt', {}, 'التاريخ'), h('dd', {}, fmt.date(e.entry_date)),
      h('dt', {}, 'البيان'), h('dd', {}, e.description),
      h('dt', {}, 'النوع'), h('dd', {}, ENTRY_TYPES[e.entry_type], e.reverses_no ? ` — يعكس القيد ${e.reverses_no}` : ''),
      h('dt', {}, 'المصدر'), h('dd', {}, SOURCES[e.source] || e.source, e.batch_no ? ` — صفحة ${e.batch_no}` : ''),
      e.reversed_by_no ? [h('dt', {}, 'معكوس'), h('dd', {}, h('span', { class: 'badge bad' }, `عُكس بالقيد ${e.reversed_by_no}`))] : '',
      h('dt', {}, 'أدخله'), h('dd', {}, `${name(e.created_by)} — ${fmt.datetime(e.created_at)}`),
      e.version > 1 ? [h('dt', {}, cancelled ? 'ألغاه' : 'آخر تعديل'), h('dd', {}, `${name(e.updated_by)} — ${fmt.datetime(e.updated_at)} (النسخة ${e.version})`)] : '',
      h('dt', {}, 'المنارة'), h('dd', {}, e.in_manara ? h('span', { class: 'badge ok' }, 'تم الإدخال' + (e.manara_no ? ' — ' + e.manara_no : '')) : 'لم يُدخل بعد')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' + (cancelled ? ' dim' : '') },
      h('thead', {}, h('tr', {}, lineCols.map((t) => h('th', {}, t)))),
      h('tbody', {}, (lines || []).map((l) => h('tr', { style: { cursor: 'default' } },
        h('td', {}, `${l.account_code} — ${l.account_name}`), h('td', { class: 'num' }, Number(l.debit) ? fmt.num(l.debit) : ''),
        h('td', { class: 'num' }, Number(l.credit) ? fmt.num(l.credit) : ''), h('td', {}, l.party_name || ''), h('td', {}, invText(l)),
        h('td', {}, l.project_name || ''), h('td', {}, l.cost_center_name || ''),
        h('td', {}, l.equipment_name || '', l.equipment_company_id && l.equipment_company_id !== e.company_id ? h('span', { class: 'badge warn', style: { marginInlineStart: '4px' }, title: 'المعدة ملك شركة أخرى' }, state.companyName(l.equipment_company_id)) : ''),
        h('td', {}, l.line_description || '')))),
      h('tfoot', {}, h('tr', {}, h('td', { style: { fontWeight: 700 } }, 'الإجمالي'), h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totD)),
        h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totD)), h('td', { colspan: 6 }))))));

  m.foot.append(h('button', { class: 'btn', onclick: () => printEntries([{ entry: e, lines: lines || [] }], users || []) }, 'طباعة'));
  if (state.can('accounting', 4) && !e.reversed_by_no) {
    m.foot.append(h('button', { class: 'btn danger', title: 'حذف نهائي — يبقى في سجل القيود المحذوفة', onclick: async () => {
      const note = 'الحذف نهائي: القيد يختفي من الصفحات والتقارير، ونسخة كاملة منه تُحفظ في "القيود المحذوفة". لو كان آخر قيد في السنة يرجع رقمه للقيد التالي، وإلا يفضل رقمه فاضي.'
        + (e.in_manara ? ' القيد مُدخل في المنارة: احذفه من هناك أيضًا.' : '');
      const r = await askReason(`حذف القيد ${e.fiscal_year}-${e.entry_no}`, { ok: 'حذف نهائي', note });
      if (!r) return;
      try {
        const res = await rpc('delete_entry', { p_entry: e.id, p_reason: r }, 'accounting');
        toast(`حُذف القيد ${res.fiscal_year}-${res.entry_no}` + (res.number_reused ? ' — رقمه رجع للقيد التالي' : ''), 'ok'); done();
      } catch (err) { toast(err.message, 'bad'); }
    } }, 'حذف القيد'));
  }
  if (e.version > 1) m.foot.append(h('button', { class: 'btn', onclick: () => historyDialog(e) }, 'سجل التعديلات'));
  if (state.can('accounting', 3) && !cancelled) {
    const editable = e.entry_type !== 'reversal' && !e.reversed_by_no;
    if (editable) m.foot.append(h('button', { class: 'btn primary', onclick: () => editDialog(e, lines || [], done) }, 'تعديل القيد'));
    if (e.entry_type !== 'reversal' && !e.reversed_by_no) {
      m.foot.append(h('button', { class: 'btn', onclick: () => reverseDialog(e, done) }, 'عكس القيد'));
    }
    if (!e.reversed_by_no) {
      m.foot.append(h('button', { class: 'btn danger', onclick: async () => {
        const msg = e.entry_type === 'reversal' ? 'إلغاء القيد العكسي يرجّع القيد الأصلي غير معكوس.' : 'القيد يبقى برقمه بحالة "ملغي" ولا يدخل في أي رصيد أو تقرير.';
        const r = await askReason('سبب إلغاء القيد', { ok: 'إلغاء القيد', note: msg + (e.in_manara ? ' القيد مُدخل في المنارة: ألغِه هناك أيضًا.' : '') });
        if (!r) return;
        try { await rpc('cancel_entry', { p_entry: e.id, p_reason: r }, 'accounting'); toast(`أُلغي القيد ${e.fiscal_year}-${e.entry_no}`, 'ok'); done(); } catch (err) { toast(err.message, 'bad'); }
      } }, 'إلغاء القيد'));
    }
    const manaraNo = h('input', { class: 'input', style: { width: '140px' }, placeholder: 'رقم قيد المنارة', value: e.manara_no || '' });
    const chk = h('input', { type: 'checkbox', checked: e.in_manara, style: { width: '18px', height: '18px' } });
    m.foot.append(h('span', { class: 'spacer' }), h('label', { class: 'check' }, chk, 'تم إدخاله في المنارة'), manaraNo,
      h('button', { class: 'btn', onclick: async () => {
        try { await rpc('set_manara', { p_entry: e.id, p_in: chk.checked, p_no: manaraNo.value }, 'accounting'); toast('تم الحفظ', 'ok'); done(); } catch (err) { toast(err.message, 'bad'); }
      } }, 'حفظ'));
  } else if (state.can('accounting', 3) && cancelled && e.manara_review) {
    m.foot.append(h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: async () => {
      try { await rpc('set_manara', { p_entry: e.id, p_in: false, p_no: null }, 'accounting'); toast('تم', 'ok'); done(); } catch (err) { toast(err.message, 'bad'); }
    } }, 'تم إلغاؤه في المنارة'));
  }
}

// تعديل قيد محفوظ: نفس المحرر، مع سبب إجباري
async function editDialog(e, lines, done) {
  const lk = await loadLookups(e.company_id, { force: true });
  const m = modal({ title: `تعديل القيد ${e.fiscal_year}-${e.entry_no}`, size: 'full' });
  const entry = { entry_date: e.entry_date, description: e.description, entry_type: e.entry_type, lines: lines.map(lineFromSaved) };
  const editor = createEditor({ lk, company: e.company_id, entries: [entry], single: true, excludeEntry: e.id });
  const reason = h('textarea', { class: 'input', id: 'edit-reason', rows: 2, placeholder: 'مثال: تصحيح المبلغ حسب الفاتورة الأصلية' });
  m.body.append(
    h('p', { class: 'notice', style: { marginBottom: '10px' } }, 'القيد يحتفظ برقمه. تُطبَّق كل قواعد الحفظ من جديد، وتُحفظ نسخة القيد قبل التعديل وبعده في سجل التعديلات.',
      e.in_manara ? h('strong', {}, ' القيد مُعلَّم "بالمنارة": العلامة ستُرفع لحد ما تراجعه هناك.') : ''),
    editor.el,
    h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', { for: 'edit-reason' }, 'سبب التعديل', h('span', { class: 'req' }, '*')), reason));
  const save = h('button', { class: 'btn primary', onclick: async () => {
    document.activeElement?.blur();
    await new Promise((r) => setTimeout(r, 20));
    if (!reason.value.trim()) { toast('اكتب سبب التعديل', 'bad'); reason.focus(); return; }
    let c;
    try { c = editor.collect(); } catch (err) { editor.showError(err.message, err.at); toast(err.message, 'bad'); return; }
    save.disabled = true;
    try {
      const r = await rpc('edit_entry', { p_entry: e.id, p_data: c.payload[0], p_reason: reason.value.trim() }, 'accounting');
      toast(`عُدّل القيد ${e.fiscal_year}-${e.entry_no} (النسخة ${r.version})` + (r.manara_review ? ' — راجعه في المنارة' : ''), 'ok');
      m.close(); done();
    } catch (err) { editor.showServerError(err.message, c.clean); toast(err.message, 'bad'); } finally { save.disabled = false; }
  } }, 'حفظ التعديل');
  m.foot.append(save, h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

// سجل التعديلات: كل نسخة بمن عدّل ومتى والسبب، والقيد قبل وبعد مع تمييز ما تغيّر
const LINE_FIELDS = [['account', 'الحساب'], ['debit', 'مدين'], ['credit', 'دائن'], ['party', 'الطرف'], ['invoice', 'الفاتورة'],
  ['project', 'المشروع'], ['cost_center', 'المركز'], ['equipment', 'المعدة'], ['description', 'البيان']];
const lineVal = (l, k) => {
  if (k === 'debit' || k === 'credit') return Number(l[k]) ? fmt.num(l[k]) : '';
  if (k === 'invoice') return invText(l);
  return l[k] || '';
};
async function historyDialog(e) {
  const m = modal({ title: `سجل تعديلات القيد ${e.fiscal_year}-${e.entry_no}`, size: 'full' });
  m.body.append(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  const [{ data: vs, error }, { data: users }] = await Promise.all([
    acc.from('entry_versions').select('*').eq('entry_id', e.id).order('version_no', { ascending: false }),
    core.from('v_user_names').select('id, full_name'),
  ]);
  if (error) { m.body.replaceChildren(h('div', { class: 'notice bad' }, errMsg(error))); return; }
  const name = (uid) => (users || []).find((u) => u.id === uid)?.full_name || '—';
  const head = (snap, other) => h('dl', { class: 'kv' },
    ...[['entry_date', 'التاريخ'], ['description', 'البيان'], ['entry_type', 'النوع']].flatMap(([k, t]) => {
      const v = k === 'entry_type' ? ENTRY_TYPES[snap[k]] : snap[k];
      return [h('dt', {}, t), h('dd', { class: other && snap[k] !== other[k] ? 'chg' : '' }, v)];
    }));
  const linesTable = (snap, other, kind) => h('table', { class: 'grid' },
    h('thead', {}, h('tr', {}, LINE_FIELDS.map(([, t]) => h('th', {}, t)))),
    h('tbody', {}, (snap.lines || []).map((l) => {
      const o = other ? (other.lines || []).find((x) => x.line_no === l.line_no) : null;
      return h('tr', { class: other && !o ? (kind === 'after' ? 'added' : 'removed') : '', style: { cursor: 'default' } },
        LINE_FIELDS.map(([k]) => h('td', { class: (['debit', 'credit'].includes(k) ? 'num ' : '') + (o && lineVal(o, k) !== lineVal(l, k) ? 'chg' : '') }, lineVal(l, k))));
    })));
  m.body.replaceChildren(...(vs || []).map((v) => h('div', { class: 'card ver' },
    h('div', { class: 'toolbar' },
      h('strong', {}, v.action === 'cancel' ? 'إلغاء' : `تعديل — النسخة ${v.version_no}`),
      h('span', {}, name(v.created_by)), h('span', { class: 'help' }, fmt.datetime(v.created_at)),
      h('span', {}, 'السبب: ', h('strong', {}, v.reason)),
      v.before_data?.in_manara ? h('span', { class: 'badge warn' }, 'كان مُدخلًا في المنارة') : ''),
    h('div', { class: 'ver-body' },
      h('div', {}, h('div', { class: 'ver-label' }, 'قبل'), head(v.before_data, v.after_data), h('div', { class: 'table-wrap' }, linesTable(v.before_data, v.after_data, 'before'))),
      v.after_data ? h('div', {}, h('div', { class: 'ver-label after' }, 'بعد'), head(v.after_data, v.before_data), h('div', { class: 'table-wrap' }, linesTable(v.after_data, v.before_data, 'after'))) : ''))),
  (vs || []).length ? '' : h('div', { class: 'empty' }, 'لا توجد تعديلات'));
}

export function renderRegister(el) {
  const from = h('input', { class: 'input', type: 'date', value: yearStart(), style: { width: 'auto' } });
  const to = h('input', { class: 'input', type: 'date', value: today(), style: { width: 'auto' } });
  const type = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, 'كل الأنواع'),
    Object.entries(ENTRY_TYPES).map(([k, v]) => h('option', { value: k }, v)));
  const manara = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, 'المنارة: الكل'),
    h('option', { value: 'no' }, 'لم يُدخل في المنارة'), h('option', { value: 'yes' }, 'تم إدخاله'), h('option', { value: 'review' }, 'يحتاج مراجعة في المنارة'));
  const status = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: 'active' }, 'القيود السارية'),
    h('option', { value: 'edited' }, 'المعدّلة'), h('option', { value: 'cancelled' }, 'الملغاة'), h('option', { value: '' }, 'الكل'));
  const search = h('input', { class: 'input grow', placeholder: 'بحث في البيان أو رقم القيد…' });
  const tbody = h('tbody'); const count = h('div', { class: 'count' });
  let rows = [];
  el.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'toolbar' }, h('span', {}, 'من'), from, h('span', {}, 'إلى'), to, type, status, manara, search,
      h('button', { class: 'btn', onclick: exportX }, 'تصدير')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['الرقم', 'التاريخ', 'الشركة', 'البيان', 'النوع', 'المصدر', 'الإجمالي', 'الصفحة', 'المنارة', ''].map((t) => h('th', {}, t)))), tbody)),
    count));
  [from, to, type, manara, status].forEach((x) => x.addEventListener('change', load));
  search.addEventListener('input', draw);
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) load(); else off(); });

  async function load() {
    tbody.replaceChildren(h('tr', {}, h('td', { colspan: 10, class: 'empty' }, 'جارٍ التحميل…')));
    let q = acc.from('v_entries').select('*').gte('entry_date', from.value).lte('entry_date', to.value)
      .in('company_id', state.selectedCompanies).order('entry_date', { ascending: false }).order('entry_no', { ascending: false }).limit(2000);
    if (type.value) q = q.eq('entry_type', type.value);
    if (manara.value === 'review') q = q.eq('manara_review', true);
    else if (manara.value) q = q.eq('in_manara', manara.value === 'yes').eq('status', 'active');
    if (status.value === 'edited') q = q.gt('version', 1).eq('status', 'active');
    else if (status.value) q = q.eq('status', status.value);
    const { data, error } = await q;
    if (error) { tbody.replaceChildren(h('tr', {}, h('td', { colspan: 10, class: 'empty' }, errMsg(error)))); return; }
    rows = data; draw();
  }
  function visible() {
    const s = search.value.trim();
    return !s ? rows : rows.filter((r) => r.description.includes(s) || `${r.fiscal_year}-${r.entry_no}`.includes(s) || String(r.entry_no) === s);
  }
  function draw() {
    const list = visible();
    tbody.replaceChildren(...(list.length ? list.map((r) => h('tr', { class: r.reversed_by_no || r.status === 'cancelled' ? 'dim' : '', onclick: () => openEntry(r.id, { onChange: load }) },
      h('td', { class: 'ltr' }, `${r.fiscal_year}-${r.entry_no}`), h('td', {}, fmt.date(r.entry_date)), h('td', {}, state.companyName(r.company_id)),
      h('td', { style: { whiteSpace: 'normal', maxWidth: '380px' } }, r.description),
      h('td', {}, ENTRY_TYPES[r.entry_type]),
      h('td', {}, SOURCES[r.source]), h('td', { class: 'num' }, fmt.num(r.total)), h('td', {}, r.batch_no || ''),
      h('td', {}, r.in_manara ? h('span', { class: 'badge ok' }, '✓') : r.manara_review ? h('span', { class: 'badge warn' }, 'راجع') : ''),
      h('td', {}, ...entryBadges({ ...r, entry_type: 'regular', in_manara: false, manara_review: false }), r.reversed_by_no ? ' ' + r.reversed_by_no : '')))
      : [h('tr', {}, h('td', { colspan: 10, class: 'empty' }, 'لا توجد قيود في الفترة'))]));
    count.textContent = `${list.length} قيد — الإجمالي ${fmt.num(list.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + Number(r.total || 0), 0))}`;
  }
  function exportX() {
    const aoa = [['الرقم', 'التاريخ', 'الشركة', 'البيان', 'النوع', 'المصدر', 'الإجمالي', 'الصفحة', 'المنارة', 'رقم المنارة', 'الحالة', 'النسخة', 'سبب الإلغاء'],
      ...visible().map((r) => [`${r.fiscal_year}-${r.entry_no}`, r.entry_date, state.companyName(r.company_id), r.description, ENTRY_TYPES[r.entry_type],
        SOURCES[r.source], Number(r.total), r.batch_no || '', r.in_manara ? 'نعم' : r.manara_review ? 'يحتاج مراجعة' : 'لا', r.manara_no || '',
        r.status === 'cancelled' ? 'ملغي' : 'ساري', r.version, r.cancel_reason || ''])];
    const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(aoa), 'القيود');
    window.XLSX.writeFile(wb, 'سجل القيود.xlsx');
  }
  load();
}

// سجل القيود المحذوفة: من حذف، متى، السبب، والقيد كما كان
export function renderDeleted(el) {
  const tbody = h('tbody'); const count = h('div', { class: 'count' });
  el.replaceChildren(h('p', { class: 'notice', style: { marginBottom: '12px' } }, 'القيود المحذوفة نهائيًا. كل قيد محفوظ هنا بأسطره وتاريخ تعديلاته كما كان لحظة الحذف.'),
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['الرقم', 'تاريخ القيد', 'الشركة', 'البيان', 'الإجمالي', 'السبب', 'حذفه', 'وقت الحذف', 'الرقم'].map((t) => h('th', {}, t)))), tbody)), count));
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) load(); else off(); });
  async function load() {
    const [{ data, error }, { data: users }] = await Promise.all([
      acc.from('deleted_entries').select('*').in('company_id', state.selectedCompanies).order('created_at', { ascending: false }).limit(1000),
      core.from('v_user_names').select('id, full_name')]);
    if (error) { tbody.replaceChildren(h('tr', {}, h('td', { colspan: 9, class: 'empty' }, errMsg(error)))); return; }
    const name = (id) => (users || []).find((u) => u.id === id)?.full_name || '—';
    tbody.replaceChildren(...(data.length ? data.map((d) => h('tr', { onclick: () => showDeleted(d, name) },
      h('td', { class: 'ltr' }, `${d.fiscal_year}-${d.entry_no}`), h('td', {}, fmt.date(d.entry_date)), h('td', {}, state.companyName(d.company_id)),
      h('td', { style: { whiteSpace: 'normal', maxWidth: '320px' } }, d.description), h('td', { class: 'num' }, fmt.num(d.total)),
      h('td', { style: { whiteSpace: 'normal', maxWidth: '260px' } }, d.reason), h('td', {}, name(d.created_by)), h('td', {}, fmt.datetime(d.created_at)),
      h('td', {}, d.number_reused ? h('span', { class: 'badge accent', title: 'كان آخر قيد فرقمه رجع للقيد التالي' }, 'أُعيد استخدامه') : h('span', { class: 'badge' }, 'فاضي'))))
      : [h('tr', {}, h('td', { colspan: 9, class: 'empty' }, 'لا توجد قيود محذوفة'))]));
    count.textContent = `${data.length} قيد محذوف`;
  }
  load();
}

function showDeleted(d, name) {
  const s = d.snapshot || {};
  const m = modal({ title: `القيد المحذوف ${d.fiscal_year}-${d.entry_no} — ${state.companyName(d.company_id)}`, size: 'wide' });
  m.body.append(
    h('div', { class: 'notice bad', style: { marginBottom: '12px' } }, `حُذف بواسطة ${name(d.created_by)} — ${fmt.datetime(d.created_at)}. السبب: ${d.reason}`),
    h('dl', { class: 'kv', style: { marginBottom: '12px' } },
      h('dt', {}, 'التاريخ'), h('dd', {}, fmt.date(s.entry_date)), h('dt', {}, 'البيان'), h('dd', {}, s.description),
      h('dt', {}, 'النوع'), h('dd', {}, ENTRY_TYPES[s.entry_type] || ''), h('dt', {}, 'الحالة وقت الحذف'), h('dd', {}, s.status === 'cancelled' ? 'ملغي — ' + (s.cancel_reason || '') : 'ساري'),
      h('dt', {}, 'أدخله'), h('dd', {}, `${name(s.created_by)} — ${fmt.datetime(s.created_at)}`),
      h('dt', {}, 'المنارة'), h('dd', {}, s.in_manara ? 'كان مُدخلًا' + (s.manara_no ? ' — ' + s.manara_no : '') : 'لا'),
      (s.versions || []).length ? [h('dt', {}, 'تعديلات سابقة'), h('dd', {}, `${s.versions.length} (آخر نسخة ${s.version})`)] : null),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['الحساب', 'مدين', 'دائن', 'الطرف', 'الفاتورة', 'المشروع', 'المركز', 'المعدة', 'البيان'].map((t) => h('th', {}, t)))),
      h('tbody', {}, (s.lines || []).map((l) => h('tr', { style: { cursor: 'default' } }, h('td', {}, l.account), h('td', { class: 'num' }, Number(l.debit) ? fmt.num(l.debit) : ''),
        h('td', { class: 'num' }, Number(l.credit) ? fmt.num(l.credit) : ''), h('td', {}, l.party || ''), h('td', {}, invText(l)), h('td', {}, l.project || ''),
        h('td', {}, l.cost_center || ''), h('td', {}, l.equipment || ''), h('td', {}, l.description || '')))))));
}

export function renderProposed(el) {
  const stateSel = h('select', { class: 'input', style: { width: 'auto' } },
    h('option', { value: 'pending' }, 'بانتظار الاعتماد'), h('option', { value: 'approved' }, 'المعتمدة'), h('option', { value: 'rejected' }, 'المرفوضة'));
  const tbody = h('tbody');
  el.replaceChildren(
    h('p', { class: 'notice', style: { marginBottom: '12px' } }, 'القيود التي تجهزها الأقسام الأخرى (الرواتب، المعدات، العهد…) تنتظر هنا ولا تؤثر على أي رصيد حتى تعتمدها.'),
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, stateSel),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
        h('thead', {}, h('tr', {}, ['التاريخ', 'الشركة', 'المصدر', 'المرجع', 'البيان', 'المبلغ', 'الحالة'].map((t) => h('th', {}, t)))), tbody))));
  stateSel.addEventListener('change', load);
  async function load() {
    const { data, error } = await acc.from('proposed_entries').select('*').eq('state', stateSel.value).in('company_id', state.selectedCompanies).order('created_at', { ascending: false }).limit(500);
    if (error) { tbody.replaceChildren(h('tr', {}, h('td', { colspan: 7, class: 'empty' }, errMsg(error)))); return; }
    tbody.replaceChildren(...(data.length ? data.map((p) => h('tr', { onclick: () => openProposed(p) },
      h('td', {}, fmt.date(p.entry_date)), h('td', {}, state.companyName(p.company_id)), h('td', {}, p.source_module), h('td', {}, p.source_ref || ''),
      h('td', {}, p.description), h('td', { class: 'num' }, fmt.num(p.lines.reduce((s, l) => s + Number(l.debit || 0), 0))),
      h('td', {}, p.state === 'pending' ? h('span', { class: 'badge warn' }, 'معلّق') : p.state === 'approved' ? h('span', { class: 'badge ok' }, 'معتمد') : h('span', { class: 'badge bad' }, 'مرفوض'))))
      : [h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'لا توجد قيود'))]));
  }
  async function openProposed(p) {
    const m = modal({ title: `قيد مقترح — ${p.description}`, size: 'wide' });
    const ids = (k) => [...new Set(p.lines.map((l) => l[k]).filter(Boolean))];
    const [a, pa, pr, cc, eq, em] = await Promise.all([
      ids('account_id').length ? acc.from('accounts').select('id, code, name').in('id', ids('account_id')) : { data: [] },
      ids('party_id').length ? core.from('parties').select('id, name').in('id', ids('party_id')) : { data: [] },
      ids('project_id').length ? core.from('projects').select('id, name').in('id', ids('project_id')) : { data: [] },
      ids('cost_center_id').length ? core.from('cost_centers').select('id, name').in('id', ids('cost_center_id')) : { data: [] },
      ids('equipment_id').length ? core.from('equipment').select('id, name').in('id', ids('equipment_id')) : { data: [] },
      ids('employee_id').length ? core.from('employees').select('id, full_name').in('id', ids('employee_id')) : { data: [] },
    ]);
    const nm = (list, id, f = 'name') => (list.data || []).find((x) => x.id === id)?.[f] || '';
    m.body.append(h('dl', { class: 'kv', style: { marginBottom: '12px' } },
      h('dt', {}, 'الشركة'), h('dd', {}, state.companyName(p.company_id)), h('dt', {}, 'التاريخ'), h('dd', {}, fmt.date(p.entry_date)),
      h('dt', {}, 'المصدر'), h('dd', {}, `${p.source_module}${p.source_ref ? ' — ' + p.source_ref : ''}`),
      p.reject_reason && [h('dt', {}, 'سبب الرفض'), h('dd', {}, p.reject_reason)]),
      h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ['الحساب', 'مدين', 'دائن', 'الطرف', 'المشروع', 'المركز', 'المعدة', 'البيان'].map((t) => h('th', {}, t)))),
        h('tbody', {}, p.lines.map((l) => h('tr', { style: { cursor: 'default' } },
          h('td', {}, (a.data || []).find((x) => x.id === l.account_id) ? `${nm(a, l.account_id, 'code')} — ${nm(a, l.account_id)}` : h('span', { class: 'badge bad' }, 'حساب غير محدد')),
          h('td', { class: 'num' }, Number(l.debit) ? fmt.num(l.debit) : ''), h('td', { class: 'num' }, Number(l.credit) ? fmt.num(l.credit) : ''),
          h('td', {}, nm(pa, l.party_id) || nm(em, l.employee_id, 'full_name')), h('td', {}, nm(pr, l.project_id)), h('td', {}, nm(cc, l.cost_center_id)),
          h('td', {}, nm(eq, l.equipment_id)), h('td', {}, l.description || ''))))));
    if (p.state === 'pending' && state.can('accounting', 4)) {
      m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
        try { const r = await rpc('approve_proposed', { p_id: p.id }, 'accounting'); toast(`اعتُمد وحُفظ القيد رقم ${r.entry_no}`, 'ok'); m.close(); load(); } catch (e) { toast(e.message, 'bad'); }
      } }, 'اعتماد وحفظ القيد'),
      h('button', { class: 'btn danger', onclick: async () => {
        const r2 = await askReason('سبب الرفض');
        if (!r2) return;
        try { await rpc('reject_proposed', { p_id: p.id, p_reason: r2 }, 'accounting'); toast('رُفض القيد', 'ok'); m.close(); load(); } catch (e) { toast(e.message, 'bad'); }
      } }, 'رفض'));
    }
    if (p.posted_entry_id) m.foot.append(h('button', { class: 'btn', onclick: () => { m.close(); openEntry(p.posted_entry_id); } }, 'فتح القيد المحفوظ'));
  }
  load();
}

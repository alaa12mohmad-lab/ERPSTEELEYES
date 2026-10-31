// سجل القيود + نافذة القيد (عكس، علامة المنارة)
import { acc, core, rpc, errMsg } from '../../shared/sb.js';
import { h, modal, toast, fmt, askReason } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { ENTRY_TYPES, SOURCES, yearStart, today } from './lookups.js';

export async function openEntry(id, { onChange } = {}) {
  const m = modal({ title: 'القيد', size: 'wide' });
  m.body.append(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  const [{ data: e, error }, { data: lines }, { data: users }] = await Promise.all([
    acc.from('v_entries').select('*').eq('id', id).single(),
    acc.from('v_lines').select('*').eq('entry_id', id).order('line_no'),
    core.from('v_user_names').select('id, full_name'),
  ]);
  if (error) { m.body.replaceChildren(h('div', { class: 'notice bad' }, errMsg(error))); return; }
  const who = (users || []).find((u) => u.id === e.created_by)?.full_name || '—';
  m.el.querySelector('h2').textContent = `القيد ${e.fiscal_year}-${e.entry_no} — ${state.companyName(e.company_id)}`;
  const totD = (lines || []).reduce((s, l) => s + Number(l.debit), 0);
  m.body.replaceChildren(
    h('dl', { class: 'kv', style: { marginBottom: '14px' } },
      h('dt', {}, 'التاريخ'), h('dd', {}, fmt.date(e.entry_date)),
      h('dt', {}, 'البيان'), h('dd', {}, e.description),
      h('dt', {}, 'النوع'), h('dd', {}, ENTRY_TYPES[e.entry_type], e.reverses_no && ` — يعكس القيد ${e.reverses_no}`),
      h('dt', {}, 'المصدر'), h('dd', {}, SOURCES[e.source] || e.source, e.batch_no && ` — صفحة ${e.batch_no}`),
      e.reversed_by_no && [h('dt', {}, 'معكوس'), h('dd', {}, h('span', { class: 'badge bad' }, `عُكس بالقيد ${e.reversed_by_no}`))],
      h('dt', {}, 'أدخله'), h('dd', {}, `${who} — ${fmt.datetime(e.created_at)}`),
      h('dt', {}, 'المنارة'), h('dd', {}, e.in_manara ? h('span', { class: 'badge ok' }, 'تم الإدخال' + (e.manara_no ? ' — ' + e.manara_no : '')) : 'لم يُدخل بعد')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['الحساب', 'مدين', 'دائن', 'الطرف', 'المشروع', 'المركز', 'المعدة', 'البيان'].map((t) => h('th', {}, t)))),
      h('tbody', {}, (lines || []).map((l) => h('tr', { style: { cursor: 'default' } },
        h('td', {}, `${l.account_code} — ${l.account_name}`), h('td', { class: 'num' }, Number(l.debit) ? fmt.num(l.debit) : ''),
        h('td', { class: 'num' }, Number(l.credit) ? fmt.num(l.credit) : ''), h('td', {}, l.party_name || ''), h('td', {}, l.project_name || ''),
        h('td', {}, l.cost_center_name || ''),
        h('td', {}, l.equipment_name || '', l.equipment_company_id && l.equipment_company_id !== e.company_id ? h('span', { class: 'badge warn', style: { marginInlineStart: '4px' }, title: 'المعدة ملك شركة أخرى' }, state.companyName(l.equipment_company_id)) : ''),
        h('td', {}, l.line_description || '')))),
      h('tfoot', {}, h('tr', {}, h('td', { style: { fontWeight: 700 } }, 'الإجمالي'), h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totD)),
        h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totD)), h('td', { colspan: 5 }))))));

  if (state.can('accounting', 3)) {
    if (e.entry_type !== 'reversal' && !e.reversed_by_no) {
      m.foot.append(h('button', { class: 'btn danger', onclick: () => reverseDialog(e, () => { m.close(); onChange?.(); }) }, 'عكس القيد'));
    }
    const manaraNo = h('input', { class: 'input', style: { width: '140px' }, placeholder: 'رقم قيد المنارة', value: e.manara_no || '' });
    const chk = h('input', { type: 'checkbox', checked: e.in_manara, style: { width: '18px', height: '18px' } });
    m.foot.append(h('span', { class: 'spacer' }), h('label', { class: 'check' }, chk, 'تم إدخاله في المنارة'), manaraNo,
      h('button', { class: 'btn', onclick: async () => {
        try { await rpc('set_manara', { p_entry: e.id, p_in: chk.checked, p_no: manaraNo.value }, 'accounting'); toast('تم الحفظ', 'ok'); m.close(); onChange?.(); } catch (err) { toast(err.message, 'bad'); }
      } }, 'حفظ'));
  }
}

function reverseDialog(e, done) {
  const m = modal({ title: `عكس القيد ${e.fiscal_year}-${e.entry_no}`, size: 'narrow' });
  const date = h('input', { class: 'input', type: 'date', value: today() < e.entry_date ? e.entry_date : today(), id: 'rd' });
  const reason = h('textarea', { class: 'input', id: 'rr', placeholder: 'سبب العكس' });
  m.body.append(h('p', { class: 'notice' }, 'يُنشأ قيد جديد بنفس الأسطر معكوسة ومربوط بالأصل. القيد الأصلي يبقى كما هو.'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' } },
      h('div', { class: 'field' }, h('label', { for: 'rd' }, 'تاريخ العكس'), date),
      h('div', { class: 'field' }, h('label', { for: 'rr' }, 'السبب', h('span', { class: 'req' }, '*')), reason)));
  m.foot.append(h('button', { class: 'btn accent', onclick: async () => {
    if (!reason.value.trim()) { reason.focus(); return; }
    try {
      const r = await rpc('reverse_entry', { p_entry: e.id, p_date: date.value, p_reason: reason.value.trim() }, 'accounting');
      toast(`أُنشئ القيد العكسي ${new Date(date.value).getFullYear()}-${r.entry_no}`, 'ok'); m.close(); done();
    } catch (err) { toast(err.message, 'bad'); }
  } }, 'عكس'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

export function renderRegister(el) {
  const from = h('input', { class: 'input', type: 'date', value: yearStart(), style: { width: 'auto' } });
  const to = h('input', { class: 'input', type: 'date', value: today(), style: { width: 'auto' } });
  const type = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, 'كل الأنواع'),
    Object.entries(ENTRY_TYPES).map(([k, v]) => h('option', { value: k }, v)));
  const manara = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, 'المنارة: الكل'),
    h('option', { value: 'no' }, 'لم يُدخل في المنارة'), h('option', { value: 'yes' }, 'تم إدخاله'));
  const search = h('input', { class: 'input grow', placeholder: 'بحث في البيان أو رقم القيد…' });
  const tbody = h('tbody'); const count = h('div', { class: 'count' });
  let rows = [];
  el.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'toolbar' }, h('span', {}, 'من'), from, h('span', {}, 'إلى'), to, type, manara, search,
      h('button', { class: 'btn', onclick: exportX }, 'تصدير')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['الرقم', 'التاريخ', 'الشركة', 'البيان', 'النوع', 'المصدر', 'الإجمالي', 'الصفحة', 'المنارة', ''].map((t) => h('th', {}, t)))), tbody)),
    count));
  [from, to, type, manara].forEach((x) => x.addEventListener('change', load));
  search.addEventListener('input', draw);
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) load(); else off(); });

  async function load() {
    tbody.replaceChildren(h('tr', {}, h('td', { colspan: 10, class: 'empty' }, 'جارٍ التحميل…')));
    let q = acc.from('v_entries').select('*').gte('entry_date', from.value).lte('entry_date', to.value)
      .in('company_id', state.selectedCompanies).order('entry_date', { ascending: false }).order('entry_no', { ascending: false }).limit(2000);
    if (type.value) q = q.eq('entry_type', type.value);
    if (manara.value) q = q.eq('in_manara', manara.value === 'yes');
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
    tbody.replaceChildren(...(list.length ? list.map((r) => h('tr', { class: r.reversed_by_no ? 'dim' : '', onclick: () => openEntry(r.id, { onChange: load }) },
      h('td', { class: 'ltr' }, `${r.fiscal_year}-${r.entry_no}`), h('td', {}, fmt.date(r.entry_date)), h('td', {}, state.companyName(r.company_id)),
      h('td', { style: { whiteSpace: 'normal', maxWidth: '380px' } }, r.description),
      h('td', {}, r.entry_type === 'regular' ? 'عادي' : h('span', { class: 'badge accent' }, ENTRY_TYPES[r.entry_type])),
      h('td', {}, SOURCES[r.source]), h('td', { class: 'num' }, fmt.num(r.total)), h('td', {}, r.batch_no || ''),
      h('td', {}, r.in_manara ? h('span', { class: 'badge ok' }, '✓') : ''),
      h('td', {}, r.reversed_by_no ? h('span', { class: 'badge bad' }, 'معكوس بـ ' + r.reversed_by_no) : '')))
      : [h('tr', {}, h('td', { colspan: 10, class: 'empty' }, 'لا توجد قيود في الفترة'))]));
    count.textContent = `${list.length} قيد — الإجمالي ${fmt.num(list.reduce((s, r) => s + Number(r.total || 0), 0))}`;
  }
  function exportX() {
    const aoa = [['الرقم', 'التاريخ', 'الشركة', 'البيان', 'النوع', 'المصدر', 'الإجمالي', 'الصفحة', 'المنارة', 'رقم المنارة'],
      ...visible().map((r) => [`${r.fiscal_year}-${r.entry_no}`, r.entry_date, state.companyName(r.company_id), r.description, ENTRY_TYPES[r.entry_type],
        SOURCES[r.source], Number(r.total), r.batch_no || '', r.in_manara ? 'نعم' : 'لا', r.manara_no || ''])];
    const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(aoa), 'القيود');
    window.XLSX.writeFile(wb, 'سجل القيود.xlsx');
  }
  load();
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

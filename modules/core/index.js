// قسم البيانات الأساسية: الشركات، المشاريع، الأطراف، المعدات، الموظفون، الأماكن، مراكز التكلفة، التصنيفات، الوحدات
import { core, errMsg, insertRows, updateRow, rpc } from '../../shared/sb.js';
import { h, modal, toast, askReason, fmt, statusBadge } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { renderMaster, opts } from '../../shared/master.js';

const PHASES = [['planned', 'مخطط'], ['active', 'جاري'], ['on_hold', 'متوقف'], ['completed', 'منتهي']];
const phaseLabel = (v) => (PHASES.find((p) => p[0] === v) || [v, v])[1];
const companyName = (id) => state.companyName(id) || '—';
const normIban = (v) => String(v || '').replace(/[\s-]/g, '').toUpperCase();
const IBAN_RX = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

// ---------------------------------------------------------------------
// الشركات المشاركة في المشروع
// ---------------------------------------------------------------------
async function projectCompaniesPanel(project, box, { editable, reload }) {
  const draw = async () => {
    const { data, error } = await core.from('project_companies').select('*').eq('project_id', project.id).order('created_at');
    if (error) { box.replaceChildren(h('div', { class: 'notice bad' }, errMsg(error))); return; }
    const active = data.filter((r) => r.status === 'active');
    const others = state.companies().filter((c) => !active.some((r) => r.company_id === c.id));
    const sel = h('select', { class: 'input', style: { width: 'auto' } }, others.map((c) => h('option', { value: c.id }, c.name)));
    box.replaceChildren(
      h('h3', { style: { fontSize: 'calc(15px * var(--fs, 1))', margin: '0 0 8px' } }, 'الشركات المشاركة ',
        h('span', { class: 'badge ' + (active.length > 1 ? 'accent' : '') }, active.length > 1 ? 'مشروع مشترك' : 'مشروع خاص')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
        h('tbody', {}, active.map((r) => h('tr', { style: { cursor: 'default' } },
          h('td', {}, companyName(r.company_id), r.company_id === project.lead_company_id && h('span', { class: 'badge', style: { marginInlineStart: '8px' } }, 'الرئيسية')),
          h('td', { style: { textAlign: 'end' } }, editable && state.can('core', 3) && r.company_id !== project.lead_company_id &&
            h('button', { class: 'btn sm danger', onclick: async () => {
              const reason = await askReason('سبب إزالة الشركة من المشروع'); if (!reason) return;
              try { await updateRow('project_companies', r.id, { status: 'cancelled', cancel_reason: reason }); toast('تمت الإزالة', 'ok'); draw(); reload(); } catch (e) { toast(e.message, 'bad'); }
            } }, 'إزالة'))))))),
      editable && state.can('core', 3) && others.length > 0 && h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, sel,
        h('button', { class: 'btn', onclick: async () => {
          const existing = data.find((r) => r.company_id === sel.value);
          try {
            if (existing) await updateRow('project_companies', existing.id, { status: 'active', cancel_reason: null });
            else await insertRows('project_companies', [{ project_id: project.id, company_id: sel.value }]);
            toast('أُضيفت الشركة', 'ok'); draw(); reload();
          } catch (e) { toast(e.message, 'bad'); }
        } }, '+ إضافة شركة مشاركة')));
  };
  draw();
}

// ---------------------------------------------------------------------
// سجل الأسعار (للمعدات والموظفين)
// ---------------------------------------------------------------------
async function pricesPanel(subjectKind, subject, box, { editable }) {
  const module = subjectKind === 'equipment' ? 'equipment' : 'hr';
  const [{ data: kinds }, { data: units }, { data: expenseTypes }, { data: customers }] = await Promise.all([
    core.from('price_kinds').select('*').eq('subject_kind', subjectKind).eq('status', 'active'),
    core.from('units').select('id, code, name').eq('status', 'active').order('code'),
    core.from('categories').select('id, code, name').eq('kind', 'expense_type').eq('status', 'active').order('code'),
    core.from('parties').select('id, code, name').eq('is_customer', true).eq('status', 'active').order('code'),
  ]);
  const visibleKinds = (kinds || []).filter((k) => !k.sensitive_item || state.sensitive(k.sensitive_item));
  const kindName = (c) => (kinds || []).find((k) => k.code === c)?.name || c;
  const unitName = (id) => (units || []).find((u) => u.id === id)?.name || '';

  const draw = async () => {
    const { data, error } = await core.from('prices').select('*').eq('subject_kind', subjectKind).eq('subject_id', subject.id)
      .order('price_kind').order('effective_from', { ascending: false });
    if (error) { box.replaceChildren(h('div', { class: 'notice bad' }, errMsg(error))); return; }
    const canAdd = editable && state.can(module, 2) && visibleKinds.length > 0;
    box.replaceChildren(
      h('h3', { style: { fontSize: 'calc(15px * var(--fs, 1))', margin: '0 0 8px' } }, subjectKind === 'equipment' ? 'الأسعار' : 'الأجور'),
      h('p', { class: 'help', style: { margin: '0 0 8px' } }, 'كل سعر له تاريخ سريان. السعر الجديد لا يغيّر الفترات السابقة. التصحيح = إلغاء السعر وإضافة جديد.'),
      data.length === 0 ? h('div', { class: 'notice' }, 'لا توجد أسعار') :
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
          h('thead', {}, h('tr', {}, h('th', {}, 'النوع'), h('th', {}, 'المبلغ'), h('th', {}, 'الوحدة'), h('th', {}, 'يسري من'), h('th', {}, 'ملاحظات'), h('th', {}, ''))),
          h('tbody', {}, data.map((p) => h('tr', { class: p.status !== 'active' ? 'dim' : '', style: { cursor: 'default' } },
            h('td', {}, kindName(p.price_kind)), h('td', { class: 'num' }, fmt.num(p.amount, 2)), h('td', {}, unitName(p.unit_id)),
            h('td', {}, fmt.date(p.effective_from)),
            h('td', {}, p.included_category_ids?.length ? 'يشمل: ' + p.included_category_ids.map((id) => (expenseTypes || []).find((x) => x.id === id)?.name).join('، ') : (p.notes || ''),
              p.status === 'cancelled' ? ' (ملغي: ' + p.cancel_reason + ')' : ''),
            h('td', {}, p.status === 'active' && editable && state.can(module, 3) && h('button', { class: 'btn sm danger', onclick: async () => {
              const r = await askReason('سبب إلغاء السعر'); if (!r) return;
              try { await updateRow('prices', p.id, { status: 'cancelled', cancel_reason: r }); toast('أُلغي السعر', 'ok'); draw(); } catch (e) { toast(e.message, 'bad'); }
            } }, 'إلغاء'))))))),
      canAdd && h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: addPrice }, '+ سعر جديد'));
  };

  function addPrice() {
    const m = modal({ title: 'سعر جديد', size: 'narrow' });
    const kindSel = h('select', { class: 'input', id: 'pk' }, visibleKinds.map((k) => h('option', { value: k.code }, k.name)));
    const amount = h('input', { class: 'input', type: 'number', step: 'any', min: 0, id: 'pa' });
    const unitSel = h('select', { class: 'input', id: 'pu' }, h('option', { value: '' }, '—'), (units || []).map((u) => h('option', { value: u.id }, u.name)));
    const from = h('input', { class: 'input', type: 'date', id: 'pf', value: new Date().toISOString().slice(0, 10) });
    const partySel = h('select', { class: 'input', id: 'pp' }, h('option', { value: '' }, '—'), (customers || []).map((c) => h('option', { value: c.id }, c.code + ' — ' + c.name)));
    const checks = (expenseTypes || []).map((x) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: x.id }), x.name));
    const notes = h('input', { class: 'input', id: 'pn' });
    const unitField = h('div', { class: 'field' }, h('label', { for: 'pu' }, 'الوحدة'), unitSel);
    const partyField = h('div', { class: 'field' }, h('label', { for: 'pp' }, 'العميل'), partySel);
    const inclField = h('div', { class: 'field' }, h('label', {}, 'المصروفات الداخلة في السعر'), h('div', { class: 'checks' }, checks),
      h('div', { class: 'help' }, 'ما يدخل في السعر يُنقل للمعدة في العرض الإداري، وما يخرج عنه يبقى على المشروع.'));
    const sync = () => {
      const k = visibleKinds.find((x) => x.code === kindSel.value);
      unitField.style.display = k?.needs_unit ? '' : 'none';
      partyField.style.display = kindSel.value === 'client_rate' ? '' : 'none';
      inclField.style.display = kindSel.value === 'internal_rate' ? '' : 'none';
    };
    kindSel.addEventListener('change', sync);
    m.body.append(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('div', { class: 'field' }, h('label', { for: 'pk' }, 'النوع'), kindSel),
      h('div', { class: 'field' }, h('label', { for: 'pa' }, 'المبلغ (ر.س)'), amount),
      unitField, partyField,
      h('div', { class: 'field' }, h('label', { for: 'pf' }, 'يسري من'), from),
      inclField,
      h('div', { class: 'field' }, h('label', { for: 'pn' }, 'ملاحظات'), notes)));
    sync();
    m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
      if (amount.value === '' || !from.value) { toast('المبلغ والتاريخ مطلوبان', 'bad'); return; }
      const included = kindSel.value === 'internal_rate' ? checks.map((c) => c.querySelector('input')).filter((i) => i.checked).map((i) => i.value) : [];
      try {
        await insertRows('prices', [{
          subject_kind: subjectKind, subject_id: subject.id, price_kind: kindSel.value, amount: Number(amount.value),
          unit_id: unitSel.value || null, effective_from: from.value, party_id: kindSel.value === 'client_rate' ? (partySel.value || null) : null,
          included_category_ids: included, notes: notes.value.trim() || null,
        }]);
        toast('تم حفظ السعر', 'ok'); m.close(); draw();
      } catch (e) { toast(e.message, 'bad'); }
    } }, 'حفظ'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
  }
  draw();
}

// ---------------------------------------------------------------------
// نقل موظف لشركة أخرى
// ---------------------------------------------------------------------
function transferEmployee(row, { close, reload }) {
  const m = modal({ title: `نقل ${row.full_name} لشركة أخرى`, size: 'narrow' });
  const others = state.companies().filter((c) => c.id !== row.company_id);
  const comp = h('select', { class: 'input', id: 'tc' }, others.map((c) => h('option', { value: c.id }, c.name)));
  const no = h('input', { class: 'input', id: 'tn' });
  const date = h('input', { class: 'input', type: 'date', id: 'td', value: new Date().toISOString().slice(0, 10) });
  m.body.append(
    h('p', { class: 'notice' }, 'سينتهي سجل الموظف في شركته الحالية قبل تاريخ النقل بيوم، ويُنشأ سجل جديد في الشركة الأخرى بنفس البيانات والأجر الساري.'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' } },
      h('div', { class: 'field' }, h('label', { for: 'tc' }, 'الشركة الجديدة'), comp),
      h('div', { class: 'field' }, h('label', { for: 'tn' }, 'الرقم الوظيفي الجديد'), no),
      h('div', { class: 'field' }, h('label', { for: 'td' }, 'تاريخ النقل'), date)));
  m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
    if (!no.value.trim()) { toast('الرقم الوظيفي مطلوب', 'bad'); return; }
    try {
      await rpc('transfer_employee', { p_employee: row.id, p_to_company: comp.value, p_new_no: no.value.trim(), p_date: date.value });
      toast('تم النقل', 'ok'); m.close(); close(); reload();
    } catch (e) { toast(e.message, 'bad'); }
  } }, 'نقل'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

// ---------------------------------------------------------------------
// الشاشات
// ---------------------------------------------------------------------
const partiesOpt = (kind) => opts.table('parties', { where: (q) => q.eq(kind === 'supplier' ? 'is_supplier' : 'is_customer', true) });
const categoryOpt = (kind) => opts.table('categories', { where: (q) => q.eq('kind', kind) });

export default {
  code: 'core',
  title: 'البيانات الأساسية',
  tabs: [
    {
      path: 'projects', title: 'المشاريع', subtitle: 'المشروع له شركة رئيسية، ويمكن إضافة شركات مشاركة',
      render: (el) => renderMaster(el, {
        title: 'المشروع', table: 'projects', view: 'v_projects', module: 'core', companyField: 'lead_company_id', wideForm: true, importable: true,
        filter: (q) => q, order: [{ col: 'code' }],
        columns: [
          { key: 'code', label: 'الكود' }, { key: 'name', label: 'الاسم' },
          { key: 'lead_company_name', label: 'الشركة الرئيسية' },
          { key: 'companies', label: 'الشركات', render: (r) => r.companies.length > 1 ? h('span', { class: 'badge accent' }, `مشترك (${r.companies.length})`) : 'خاص' },
          { key: 'customer_name', label: 'العميل' },
          { key: 'phase', label: 'المرحلة', render: (r) => phaseLabel(r.phase) },
          { key: 'contract_value', label: 'قيمة العقد', num: true },
        ],
        fields: [
          { key: 'code', label: 'الكود', required: true, readonlyOnEdit: true, ltr: true },
          { key: 'name', label: 'اسم المشروع', required: true },
          { key: 'lead_company_id', label: 'الشركة الرئيسية', type: 'select', required: true, options: opts.companies() },
          { key: 'customer_party_id', label: 'العميل', type: 'select', options: partiesOpt('customer') },
          { key: 'phase', label: 'المرحلة', type: 'select', required: true, default: 'active', options: opts.list(PHASES) },
          { key: 'contract_value', label: 'قيمة العقد (ر.س)', type: 'number' },
          { key: 'start_date', label: 'تاريخ البداية', type: 'date' },
          { key: 'end_date', label: 'تاريخ النهاية', type: 'date' },
          { key: 'notes', label: 'ملاحظات', type: 'textarea' },
        ],
        formExtras: projectCompaniesPanel,
      }),
    },
    {
      path: 'parties', title: 'العملاء والموردون', subtitle: 'بطاقة واحدة لكل طرف، مشتركة بين الشركات',
      render: (el) => renderMaster(el, {
        title: 'الطرف', table: 'parties', module: 'core', importable: true,
        columns: [
          { key: 'code', label: 'الكود' }, { key: 'name', label: 'الاسم' },
          { key: 'type', label: 'النوع', render: (r) => [r.is_customer && 'عميل', r.is_supplier && 'مورد'].filter(Boolean).join(' و ') },
          { key: 'tax_number', label: 'الرقم الضريبي' }, { key: 'phone', label: 'الجوال' }, { key: 'contact_person', label: 'المسؤول' },
          { key: 'sister_company_id', label: 'شقيقة', render: (r) => (r.sister_company_id ? state.companyName(r.sister_company_id) || '✓' : '') },
        ],
        fields: [
          { key: 'code', label: 'الكود', required: true, readonlyOnEdit: true, ltr: true },
          { key: 'name', label: 'الاسم', required: true },
          { key: 'is_customer', label: 'عميل', type: 'bool' },
          { key: 'is_supplier', label: 'مورد', type: 'bool' },
          { key: 'tax_number', label: 'الرقم الضريبي', ltr: true, inputmode: 'numeric', help: '15 رقمًا' },
          { key: 'customer_terms_days', label: 'مدة سداد العميل (يوم)', type: 'number', help: 'ميعاد استحقاق فواتيره = تاريخ الفاتورة + المدة (أعمار الديون والسيولة)' },
          { key: 'supplier_terms_days', label: 'مدة السداد للمورد (يوم)', type: 'number' },
          { key: 'phone', label: 'الجوال', ltr: true },
          { key: 'contact_person', label: 'الشخص المسؤول' },
          { key: 'bank_name', label: 'البنك' },
          { key: 'iban', label: 'الآيبان', ltr: true, help: 'للتحويل البنكي وطلبات التحويل — مثال: SA0380000000608010167519' },
          { key: 'sister_company_id', label: 'شركة شقيقة', type: 'select', options: opts.companies(), placeholder: '— ليس شركة من شركاتنا —',
            help: 'إذا كان هذا الطرف إحدى شركاتنا (مثل عيون الحديد كعميل لريان): تُستبعد تعاملاته من التقارير المجمّعة' },
          { key: 'notes', label: 'ملاحظات', type: 'textarea' },
        ],
        validate: (v) => (!v.is_customer && !v.is_supplier ? 'حدد: عميل أو مورد أو كلاهما' : v.tax_number && !/^\d{15}$/.test(v.tax_number) ? 'الرقم الضريبي 15 رقمًا'
          : v.iban && !IBAN_RX.test(normIban(v.iban)) ? 'الآيبان غير صحيح (يبدأ بحرفين ثم أرقام، مثل SA03…)' : null),
      }),
    },
    {
      path: 'equipment', title: 'المعدات والسيارات', subtitle: 'المملوكة والمستأجرة للشركات الثلاث',
      visible: () => state.can('equipment', 1),
      render: (el) => renderMaster(el, {
        title: 'المعدة', table: 'equipment', view: 'v_equipment', module: 'equipment', companyField: 'company_id', wideForm: true, importable: true,
        columns: [
          { key: 'code', label: 'الكود' }, { key: 'name', label: 'الاسم' },
          { key: 'kind', label: 'النوع', render: (r) => (r.kind === 'vehicle' ? 'سيارة' : 'معدة') },
          { key: 'ownership', label: 'الملكية', render: (r) => h('span', { class: 'badge ' + (r.ownership === 'rented' ? 'warn' : '') }, r.ownership === 'rented' ? 'مستأجرة' : 'مملوكة') },
          { key: 'company_name', label: 'الشركة' }, { key: 'supplier_name', label: 'المورد' },
          { key: 'category_name', label: 'الفئة' }, { key: 'plate_no', label: 'اللوحة' },
          { key: 'lifecycle', label: 'الوضع', render: (r) => ({ active: 'في الخدمة', returned: 'مرتجعة للمورد', sold: 'مباعة' }[r.lifecycle]) },
        ],
        fields: [
          { key: 'code', label: 'الكود', required: true, readonlyOnEdit: true, ltr: true },
          { key: 'name', label: 'الاسم', required: true },
          { key: 'kind', label: 'النوع', type: 'select', required: true, default: 'equipment', options: opts.list([['equipment', 'معدة'], ['vehicle', 'سيارة']]) },
          { key: 'ownership', label: 'الملكية', type: 'select', required: true, default: 'owned', options: opts.list([['owned', 'مملوكة'], ['rented', 'مستأجرة من مورد']]) },
          { key: 'company_id', label: 'الشركة', type: 'select', required: true, options: opts.companies(), help: 'المالكة، أو التي تدفع للمورد في المستأجرة' },
          { key: 'supplier_party_id', label: 'المورد', type: 'select', options: partiesOpt('supplier'), help: 'مطلوب للمستأجرة' },
          { key: 'category_id', label: 'الفئة', type: 'select', options: categoryOpt('equipment_type') },
          { key: 'meter_type', label: 'العداد', type: 'select', options: opts.list([['hours', 'ساعات'], ['km', 'كيلومتر']]) },
          { key: 'plate_no', label: 'رقم اللوحة', ltr: true },
          { key: 'serial_no', label: 'الرقم التسلسلي', ltr: true },
          { key: 'lifecycle', label: 'الوضع', type: 'select', required: true, default: 'active', options: opts.list([['active', 'في الخدمة'], ['returned', 'مرتجعة للمورد'], ['sold', 'مباعة']]) },
          { key: 'start_date', label: 'تاريخ البداية', type: 'date', help: 'الاستلام أو الشراء' },
          { key: 'end_date', label: 'تاريخ النهاية', type: 'date' },
          { key: 'notes', label: 'ملاحظات', type: 'textarea' },
        ],
        validate: (v) => (v.ownership === 'rented' && !v.supplier_party_id ? 'المعدة المستأجرة تحتاج إلى مورد' : null),
        formExtras: (row, box, ctx) => pricesPanel('equipment', row, box, ctx),
      }),
    },
    {
      path: 'employees', title: 'الموظفون', subtitle: 'سجل الموظف في شركة واحدة. الانتقال لشركة أخرى من زر "نقل".',
      visible: () => state.can('hr', 1),
      render: (el) => renderMaster(el, {
        title: 'الموظف', titleKey: 'full_name', table: 'employees', view: 'v_employees', module: 'hr', companyField: 'company_id', wideForm: true, importable: true,
        order: [{ col: 'company_id' }, { col: 'employee_no' }], searchKeys: ['employee_no', 'full_name', 'iqama_no', 'job_title'],
        columns: [
          { key: 'employee_no', label: 'الرقم' }, { key: 'full_name', label: 'الاسم' }, { key: 'company_name', label: 'الشركة' },
          { key: 'job_title', label: 'المسمى' }, { key: 'pay_type', label: 'الأجر', render: (r) => (r.pay_type === 'hourly' ? 'بالساعة' : 'شهري') },
          { key: 'hire_date', label: 'التعيين', render: (r) => fmt.date(r.hire_date) },
          { key: 'end_date', label: 'الانتهاء', render: (r) => (r.end_date ? h('span', { class: 'badge warn' }, fmt.date(r.end_date)) : '') },
        ],
        fields: [
          { key: 'company_id', label: 'الشركة', type: 'select', required: true, options: opts.companies(), readonlyOnEdit: true },
          { key: 'employee_no', label: 'الرقم الوظيفي', required: true, ltr: true },
          { key: 'full_name', label: 'الاسم', required: true },
          { key: 'iqama_no', label: 'رقم الإقامة / الهوية', ltr: true },
          { key: 'nationality', label: 'الجنسية' },
          { key: 'job_title', label: 'المسمى الوظيفي' },
          { key: 'pay_type', label: 'نوع الأجر', type: 'select', required: true, default: 'monthly', options: opts.list([['monthly', 'راتب شهري'], ['hourly', 'بالساعة']]) },
          { key: 'phone', label: 'الجوال', ltr: true },
          { key: 'bank_name', label: 'البنك' },
          { key: 'iban', label: 'الآيبان', ltr: true, help: 'للتحويل البنكي وطلبات التحويل — مثال: SA0380000000608010167519' },
          { key: 'hire_date', label: 'تاريخ التعيين', type: 'date', required: true },
          { key: 'end_date', label: 'تاريخ الانتهاء', type: 'date' },
          { key: 'notes', label: 'ملاحظات', type: 'textarea' },
        ],
        rowActions: [{ label: 'نقل لشركة أخرى', show: (r) => r.status === 'active' && !r.end_date && state.can('hr', 3), run: transferEmployee }],
        formExtras: (row, box, ctx) => pricesPanel('employee', row, box, ctx),
      }),
    },
    {
      path: 'locations', title: 'الأماكن', subtitle: 'كل مشروع مكان تلقائيًا. أضف هنا المخزن والورشة والسكن.',
      render: (el) => renderMaster(el, {
        title: 'المكان', titleKey: 'display_name', table: 'locations', view: 'v_locations', module: 'core', companyField: 'company_id', companyNullable: true,
        columns: [
          { key: 'code', label: 'الكود' }, { key: 'display_name', label: 'الاسم' },
          { key: 'kind', label: 'النوع', render: (r) => ({ project: 'مشروع', warehouse: 'مخزن', workshop: 'ورشة', housing: 'سكن', other: 'أخرى' }[r.kind]) },
          { key: 'company_id', label: 'الشركة', render: (r) => (r.company_id ? companyName(r.company_id) : '') },
        ],
        fields: [
          { key: 'code', label: 'الكود', required: true, readonlyOnEdit: true, ltr: true },
          { key: 'name', label: 'الاسم', required: true, showIf: (r) => r.kind !== 'project' },
          { key: 'kind', label: 'النوع', type: 'select', required: true, default: 'warehouse', readonlyOnEdit: true,
            options: async () => [['warehouse', 'مخزن'], ['workshop', 'ورشة'], ['housing', 'سكن'], ['other', 'أخرى']].map(([value, label]) => ({ value, label, code: value })), showIf: (r) => r.kind !== 'project' },
          { key: 'company_id', label: 'الشركة', type: 'select', options: opts.companies(), placeholder: 'مشترك', showIf: (r) => r.kind !== 'project' },
        ],
      }),
    },
    {
      path: 'cost-centers', title: 'مراكز التكلفة',
      render: (el) => renderMaster(el, {
        title: 'مركز التكلفة', table: 'cost_centers', module: 'core', companyField: 'company_id', companyNullable: true, importable: true,
        columns: [{ key: 'code', label: 'الكود' }, { key: 'name', label: 'الاسم' }, { key: 'company_id', label: 'الشركة', render: (r) => (r.company_id ? companyName(r.company_id) : 'مشترك') }],
        fields: [
          { key: 'code', label: 'الكود', required: true, readonlyOnEdit: true, ltr: true },
          { key: 'name', label: 'الاسم', required: true },
          { key: 'company_id', label: 'الشركة', type: 'select', options: opts.companies(), placeholder: 'مشترك بين الشركات' },
          { key: 'parent_id', label: 'تابع لـ', type: 'select', options: opts.table('cost_centers') },
        ],
      }),
    },
    {
      path: 'categories', title: 'التصنيفات', subtitle: 'أنواع المصروفات، أنواع المعدات، أصناف العدد، أنواع المستندات',
      render: (el) => {
        const KINDS = [['expense_type', 'نوع مصروف'], ['equipment_type', 'نوع معدة'], ['tool_category', 'صنف عِدد'], ['document_type', 'نوع مستند']];
        return renderMaster(el, {
          title: 'التصنيف', table: 'categories', module: 'core', importable: true, order: [{ col: 'kind' }, { col: 'code' }],
          columns: [{ key: 'kind', label: 'النوع', render: (r) => (KINDS.find((k) => k[0] === r.kind) || [])[1] }, { key: 'code', label: 'الكود' }, { key: 'name', label: 'الاسم' }],
          fields: [
            { key: 'kind', label: 'النوع', type: 'select', required: true, readonlyOnEdit: true, options: opts.list(KINDS) },
            { key: 'code', label: 'الكود', required: true, readonlyOnEdit: true, ltr: true },
            { key: 'name', label: 'الاسم', required: true },
            { key: 'parent_id', label: 'تابع لـ', type: 'select', options: opts.table('categories', { label: (r) => r.name }) },
          ],
        });
      },
    },
    {
      path: 'units', title: 'الوحدات',
      render: (el) => renderMaster(el, {
        title: 'الوحدة', table: 'units', module: 'core',
        columns: [{ key: 'code', label: 'الكود' }, { key: 'name', label: 'الاسم' }],
        fields: [{ key: 'code', label: 'الكود', required: true, readonlyOnEdit: true, ltr: true }, { key: 'name', label: 'الاسم', required: true }],
      }),
    },
    {
      path: 'companies', title: 'الشركات', visible: () => state.profile.is_admin,
      render: (el) => renderMaster(el, {
        title: 'الشركة', table: 'companies', module: 'admin', allowAdd: false, allowStatus: false,
        columns: [{ key: 'code', label: 'الكود' }, { key: 'name', label: 'الاسم' }, { key: 'cr_number', label: 'السجل التجاري' }, { key: 'vat_number', label: 'الرقم الضريبي' }, { key: 'phone', label: 'الهاتف' }],
        fields: [
          { key: 'code', label: 'الكود', required: true, readonlyOnEdit: true, ltr: true },
          { key: 'name', label: 'الاسم', required: true },
          { key: 'cr_number', label: 'السجل التجاري', ltr: true },
          { key: 'vat_number', label: 'الرقم الضريبي', ltr: true },
          { key: 'address', label: 'العنوان', help: 'يظهر في ترويسة التقارير المطبوعة' },
          { key: 'phone', label: 'الهاتف', ltr: true },
        ],
      }),
    },
  ],
};

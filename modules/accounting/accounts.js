// شجرة الحسابات
import { acc, rpc, updateRow } from '../../shared/sb.js';
import { h, modal, toast, confirmDialog, store } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { renderMaster, opts } from '../../shared/master.js';
import { companySelect, clearLookups, ACCOUNT_TYPES, RULES, PARTY_RULES, typeLabel } from './lookups.js';

const BS = [['current_asset', 'أصول متداولة'], ['noncurrent_asset', 'أصول غير متداولة'], ['current_liability', 'التزامات متداولة'],
  ['noncurrent_liability', 'التزامات غير متداولة'], ['equity', 'حقوق ملكية']];
const INC = [['revenue', 'إيراد'], ['direct_cost', 'تكلفة مباشرة'], ['admin_general', 'مصروف إداري وعمومي'], ['other_income', 'إيراد آخر'],
  ['finance_cost', 'مصروف تمويلي'], ['tax', 'زكاة / ضريبة دخل']];
const CF = [['operating', 'تشغيلي'], ['investing', 'استثماري'], ['financing', 'تمويلي'], ['cash', 'نقدية']];
const PK = [['customer', 'عميل'], ['supplier', 'مورد'], ['employee', 'موظف'], ['any', 'أي طرف']];
const VAT = [['none', 'لا'], ['input', 'ضريبة مدخلات'], ['output', 'ضريبة مخرجات']];
const lbl = (list, v) => (list.find((x) => x[0] === v) || [v, ''])[1];
const ruleShort = { forbidden: '—', optional: 'اختياري', required: 'إجباري' };

export function renderAccounts(el) {
  let company = null;
  const box = h('div');
  const sel = companySelect((v) => { company = v; draw(); });
  company = sel.value;
  el.replaceChildren(
    h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' } },
      h('label', { style: { fontWeight: 600 } }, 'الشركة:'), sel,
      h('span', { class: 'help' }, 'الحساب المجمّع لا يقبل الإدخال. الحساب الفاضي (بدون حركات ولا فروع) يُحذف، والحساب اللي عليه حركات يُوقف بشرط رصيد صفر.')),
    box);

  // طي الشجرة: الحسابات المجمّعة المطوية محفوظة لكل شركة. الافتراضي: يظهر المستوى الأول والتاني بس
  const foldKey = () => 'erp-acc-fold-' + company;
  let folded = null; let redraw = () => {};
  const saveFold = () => store.set(foldKey(), [...folded]);
  const ensureFold = (rows) => {
    if (folded) return;
    const saved = store.get(foldKey(), null);
    folded = new Set(Array.isArray(saved) ? saved : rows.filter((r) => r.has_children && r.depth >= 1).map((r) => r.code));
  };
  const rowVisible = (r, rows) => {
    ensureFold(rows);
    const parts = String(r.sort_path || '').split('/');
    return !parts.slice(0, -1).some((c) => folded.has(c));
  };
  const toggle = (r) => { if (folded.has(r.code)) folded.delete(r.code); else folded.add(r.code); saveFold(); redraw(); };

  function draw() {
    clearLookups();
    folded = null;
    renderMaster(box, {
      rowVisible,
      title: 'الحساب', schema: 'accounting', table: 'accounts', view: 'v_accounts', module: 'accounting', wideForm: true, importable: true,
      levelAdd: 3, levelEdit: 3, allowStatus: false,
      rowActions: [
        { label: 'توقيف الحساب', show: (r) => r.status === 'active' && state.can('accounting', 3), run: async (r, { close, reload }) => {
          if (!(await confirmDialog(`توقيف "${r.name}"؟ لن يظهر في إدخال القيود. يتطلب أن يكون رصيده صفرًا.`, { ok: 'توقيف' }))) return;
          try { await updateRow('accounts', r.id, { status: 'archived' }, 'accounting'); toast('تم توقيف الحساب', 'ok'); close(); clearLookups(); reload(); } catch (e) { toast(e.message, 'bad'); }
        } },
        { label: 'إعادة التفعيل', show: (r) => r.status !== 'active' && state.can('accounting', 3), run: async (r, { close, reload }) => {
          try { await updateRow('accounts', r.id, { status: 'active', cancel_reason: null }, 'accounting'); toast('تم تفعيل الحساب', 'ok'); close(); clearLookups(); reload(); } catch (e) { toast(e.message, 'bad'); }
        } },
        { label: 'حذف الحساب', show: (r) => !r.has_lines && !r.has_children && state.can('accounting', 3), run: async (r, { close, reload }) => {
          if (!(await confirmDialog(`حذف "${r.code} — ${r.name}" نهائيًا؟ الحساب لم يُستخدم في أي قيد. (يبقى أثره في سجل المراجعة)`, { ok: 'حذف', danger: true }))) return;
          try { await rpc('delete_account', { p_account: r.id }, 'accounting'); toast('حُذف الحساب', 'ok'); close(); clearLookups(); reload(); } catch (e) { toast(e.message, 'bad'); }
        } },
      ],
      filter: (q) => q.eq('company_id', company),
      order: [{ col: 'sort_path' }],
      searchKeys: ['code', 'name'],
      defaults: () => ({ company_id: company, is_postable: true, party_rule: 'optional', project_rule: 'optional', cost_center_rule: 'optional', equipment_rule: 'optional', vat_role: 'none' }),
      columns: [
        { key: 'code', label: 'الكود', render: (r) => h('span', { class: 'ltr', style: { fontWeight: r.is_postable ? 400 : 700 } }, r.code) },
        { key: 'name', label: 'الاسم', render: (r) => h('span', { class: 'tree-name', style: { paddingInlineStart: (r.depth * 22) + 'px', fontWeight: r.is_postable ? 400 : 700 } },
          r.has_children ? h('button', { class: 'fold' + (folded?.has(r.code) ? ' shut' : ''), title: folded?.has(r.code) ? 'فتح' : 'طي',
            onclick: (e) => { e.stopPropagation(); toggle(r); } }, '▾') : h('span', { class: 'fold-sp' }),
          r.name) },
        { key: 'account_type', label: 'النوع', render: (r) => typeLabel(r.account_type) },
        { key: 'is_postable', label: 'الإدخال', render: (r) => (r.is_postable ? 'قابل للإدخال' : h('span', { class: 'badge' }, 'مجمّع')) },
        { key: 'cls', label: 'التبويب', render: (r) => (r.is_postable ? [lbl(BS, r.bs_section) || lbl(INC, r.income_level), lbl(CF, r.cashflow_class)].filter(Boolean).join(' • ') : '') },
        { key: 'rules', label: 'طرف / مشروع / مركز / معدة', render: (r) => (r.is_postable
          ? `${r.party_kind ? ruleShort[r.party_rule] + ' (' + lbl(PK, r.party_kind) + ')' : '—'} / ${ruleShort[r.project_rule]} / ${ruleShort[r.cost_center_rule]} / ${ruleShort[r.equipment_rule]}` : '') },
        { key: 'flags', label: 'خصائص', render: (r) => [r.is_cash_account && 'نقدية', r.is_control_account && 'رقابة', r.vat_role !== 'none' && lbl(VAT, r.vat_role)].filter(Boolean).join('، ') },
      ],
      fields: [
        { key: 'company_id', label: 'الشركة', type: 'select', required: true, readonly: true, options: opts.companies(), importable: false },
        { key: 'code', label: 'الكود', required: true, ltr: true },
        { key: 'name', label: 'الاسم', required: true },
        { key: 'parent_id', label: 'الحساب الأب', type: 'select', placeholder: 'حساب رئيسي (بدون أب)',
          options: async () => {
            const { data } = await acc.from('accounts').select('id, code, name').eq('company_id', company).eq('is_postable', false).eq('status', 'active').order('code');
            return (data || []).map((r) => ({ value: r.id, label: r.code + ' — ' + r.name, code: r.code }));
          } },
        { key: 'account_type', label: 'النوع', type: 'select', required: true, options: opts.list(ACCOUNT_TYPES) },
        { key: 'is_postable', label: 'قابل للإدخال (حساب تفصيلي)', type: 'bool', default: true, help: 'أزل العلامة للحساب المجمّع' },
        { key: 'bs_section', label: 'قسم المركز المالي', type: 'select', options: opts.list(BS), help: 'لحسابات الأصول والالتزامات وحقوق الملكية' },
        { key: 'income_level', label: 'مستوى قائمة الدخل', type: 'select', options: opts.list(INC), help: 'للإيرادات والمصروفات' },
        { key: 'cashflow_class', label: 'تصنيف التدفق النقدي', type: 'select', options: opts.list(CF), help: 'حسابات الصندوق والبنوك = نقدية' },
        { key: 'party_kind', label: 'حساب أطراف', type: 'select', options: opts.list(PK),
          help: 'لحسابات العملاء والموردين وذمم الموظفين (أصل أو التزام): أرصدة الأطراف وكشوفها والفواتير تتحسب منها. في حساب إيراد أو مصروف يحدد قائمة الطرف فقط ولا يدخل الأرصدة. سيبه فاضي لو الطرف مجرد مرجع للتتبع' },
        { key: 'party_rule', label: 'الطرف في السطر', type: 'select', required: true, default: 'optional', options: opts.list(PARTY_RULES),
          help: 'إجباري: لازم يتكتب طرف في كل سطر على الحساب' },
        { key: 'project_rule', label: 'المشروع', type: 'select', required: true, default: 'optional', options: opts.list(RULES) },
        { key: 'cost_center_rule', label: 'مركز التكلفة', type: 'select', required: true, default: 'optional', options: opts.list(RULES) },
        { key: 'equipment_rule', label: 'المعدة', type: 'select', required: true, default: 'optional', options: opts.list(RULES) },
        { key: 'is_cash_account', label: 'حساب نقدية (يمنع الرصيد السالب)', type: 'bool' },
        { key: 'is_control_account', label: 'حساب رقابة (عملاء / موردين / عهد)', type: 'bool' },
        { key: 'vat_role', label: 'الضريبة', type: 'select', required: true, default: 'none', options: opts.list(VAT),
          help: 'لحساب ضريبة المدخلات (أصل) أو المخرجات (التزام) فقط. المصروفات والإيرادات: بدون ضريبة' },
        { key: 'is_noncash_adjustment', label: 'تسوية غير نقدية (مجمع إهلاك / مخصصات)', type: 'bool' },
        { key: 'cashflow_line', label: 'بند التدفق (الطريقة المباشرة)', help: 'اختياري' },
        { key: 'notes', label: 'ملاحظات', type: 'textarea' },
      ],
      beforeSave: (v, rec) => {
        const out = {};
        if (rec.company_id === undefined || !rec.id) out.company_id = company;
        if (v.party_rule === 'forbidden') out.party_rule = 'optional';
        if (v.vat_role && v.vat_role !== 'none' && !['asset', 'liability'].includes(v.account_type)) throw new Error('حساب الضريبة لازم يكون أصل (مدخلات) أو التزام (مخرجات) — المصروف أو الإيراد يتعلّم "بدون ضريبة"');
        if (v.party_rule === 'required' && !v.party_kind) throw new Error('الطرف الإجباري يحتاج تحديد نوع حساب الأطراف');
        if (v.is_postable) {
          if (!v.cashflow_class) throw new Error('حدد تصنيف التدفق النقدي');
          if (['asset', 'liability', 'equity'].includes(v.account_type) && !v.bs_section) throw new Error('حدد قسم المركز المالي');
          if (['revenue', 'expense'].includes(v.account_type) && !v.income_level) throw new Error('حدد مستوى قائمة الدخل');
        }
        return out;
      },
      formExtras: (r, box) => {
        const why = r.has_lines ? 'الحساب لا يُحذف لأنه مستخدم في قيود (ولو قيد ملغي). يمكن توقيفه لو رصيده صفر.'
          : r.has_children ? 'الحساب لا يُحذف لأن له حسابات فرعية (ولو موقوفة). احذف الفروع الأول.' : '';
        if (why) box.append(h('div', { class: 'notice', style: { marginTop: '10px' } }, why));
      },
      toolbarExtras: (ctx) => {
        redraw = ctx.redraw;
        const all = (shut) => async () => {
          const { data } = await acc.from('v_accounts').select('code, has_children').eq('company_id', company);
          folded = new Set(shut ? (data || []).filter((r) => r.has_children).map((r) => r.code) : []);
          saveFold(); redraw();
        };
        return [h('button', { class: 'btn', onclick: all(false) }, 'فتح الكل'), h('button', { class: 'btn', onclick: all(true) }, 'طي الكل'),
          h('button', { class: 'btn', onclick: copyChart }, 'نسخ الشجرة من شركة أخرى')];
      },
    });
  }

  function copyChart() {
    const m = modal({ title: 'نسخ شجرة الحسابات', size: 'narrow' });
    const from = h('select', { class: 'input', id: 'cf' }, state.companies().filter((c) => c.id !== company).map((c) => h('option', { value: c.id }, c.name)));
    m.body.append(h('p', { class: 'notice' }, `تُنسخ الشجرة كاملة بخصائصها إلى "${state.companyName(company)}". يعمل فقط لو الشركة ليس فيها حسابات.`),
      h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', { for: 'cf' }, 'من شركة'), from));
    m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
      try { const n = await rpc('copy_chart', { p_from: from.value, p_to: company }, 'accounting'); toast(`تم نسخ ${n} حساب`, 'ok'); m.close(); draw(); } catch (e) { toast(e.message, 'bad'); }
    } }, 'نسخ'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
  }

  draw();
}

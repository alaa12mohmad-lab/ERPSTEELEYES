// عقود المشاريع والمستخلصات: عقود العملاء ومقاولي الباطن، الدفعة المقدمة واستردادها، المحتجزات وفكها.
//   مستخلصات مقاولي الباطن تُنشئ قيدها مباشرة (accounting.post_contract_bill)، وإلغاء القيد من سجل القيود = إلغاء المستخلص
import { acc, rpc } from '../../shared/sb.js';
import { h, fmt, modal, toast, confirmDialog } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { loadLookups, picker, today } from './lookups.js';
import { N } from './reports.js';
import { openEntry } from './register.js';
import { salesEditor } from './sales.js';

const KIND = { customer: 'عقد عميل', po: 'أمر شراء', subcontract: 'مقاول باطن' };
const isCust = (k) => k !== 'subcontract';
const BILL = { advance: 'دفعة مقدمة', progress: 'مستخلص / فاتورة', release: 'فك محتجز', credit: 'إشعار دائن' };
const cname = (id) => state.companyName(id);
const ids = () => (state.selectedCompanies.length ? state.selectedCompanies : state.companies().map((c) => c.id));
const pct = (a, b) => (Number(b) ? Math.round((Number(a) / Number(b)) * 1000) / 10 : 0);

export function renderContracts(el) {
  const kindSel = h('select', { class: 'input', style: { width: 'auto' } },
    h('option', { value: '' }, 'كل العقود وأوامر الشراء'), h('option', { value: 'customer' }, 'عقود العملاء'), h('option', { value: 'po' }, 'أوامر الشراء من العملاء'),
    h('option', { value: 'subcontract' }, 'مقاولو الباطن'), h('option', { value: 'over' }, 'تحتاج إلى تعديل (متجاوزة)'));
  const viewSel = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: 'list' }, 'عرض العقود'), h('option', { value: 'project' }, 'ملخص حسب المشروع'));
  viewSel.onchange = () => load();
  const out = h('div');
  kindSel.onchange = () => load();
  el.replaceChildren(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'toolbar' }, kindSel, viewSel, h('div', { class: 'grow' }),
    state.can('accounting', 3) ? h('button', { class: 'btn primary', onclick: () => contractForm(null, load) }, '＋ عقد / أمر شراء') : null)), out);

  async function load() {
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    let rows = await rpc('contract_status', { p_companies: ids() }, 'accounting');
    if (kindSel.value === 'over') rows = rows.filter((r) => Number(r.over_amount) > 0);
    else if (kindSel.value) rows = rows.filter((r) => r.kind === kindSel.value);
    rows = rows.filter((r) => r.status === 'active' || r.bills > 0);
    if (!rows.length) { out.replaceChildren(h('div', { class: 'notice' }, kindSel.value === 'over' ? 'لا توجد أوامر شراء متجاوزة.' : 'لا توجد عقود. اضغط «عقد / أمر شراء» وسجّل عقد المشروع أو أمر الشراء من العميل أو عقد مقاول الباطن.')); return; }
    if (viewSel.value === 'project') { out.replaceChildren(projectSummary(rows)); return; }
    const tot = (k, kind) => rows.filter((r) => (kind === 'customer' ? isCust(r.kind) : r.kind === kind)).reduce((s, r) => s + Number(r[k]), 0);
    const overN = rows.filter((r) => Number(r.over_amount) > 0).length;
    out.replaceChildren(
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, 'المتبقي على العملاء (عقود وأوامر شراء)'), h('b', {}, fmt.num(tot('outstanding', 'customer'))),
          overN ? h('span', { class: 'bad' }, `${overN} أمر شراء يحتاج إلى تعديل`) : null),
        h('div', { class: 'kpi' }, h('small', {}, 'محتجزات لنا لدى العملاء'), h('b', {}, fmt.num(tot('retention_held', 'customer')))),
        h('div', { class: 'kpi' }, h('small', {}, 'المتبقي لمقاولي الباطن'), h('b', {}, fmt.num(tot('outstanding', 'subcontract')))),
        h('div', { class: 'kpi' }, h('small', {}, 'محتجزات علينا لمقاولي الباطن'), h('b', {}, fmt.num(tot('retention_held', 'subcontract'))))),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report contracts' },
        h('thead', {}, h('tr', {}, ['العقد', 'النوع', 'المشروع', 'الطرف', 'القيمة الحالية', 'المنفّذ / المفوتر', 'الدفعة المقدمة (المسترد)', 'المحتجز', 'المفوتر', 'المحصّل/المدفوع', 'الباقي'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.map((r) => h('tr', { onclick: () => contractView(r.contract_id, load), class: r.status !== 'active' ? 'dim' : '' },
          h('td', {}, h('b', { class: 'ltr' }, r.contract_no), r.title ? h('div', { class: 'help' }, r.title) : null, ids().length > 1 ? h('div', { class: 'help' }, cname(r.company_id)) : null),
          h('td', {}, h('span', { class: 'badge' + (r.kind === 'subcontract' ? ' warn' : '') }, KIND[r.kind])),
          h('td', {}, `${r.project_code} — ${r.project_name}`), h('td', {}, r.party_name),
          h('td', { class: 'num' }, N(r.current_value), Number(r.amendments) ? h('div', { class: 'help' }, `الأصلية ${fmt.num(r.contract_value)} ${Number(r.amendments) > 0 ? '+' : '−'} ${fmt.num(Math.abs(r.amendments))}`) : null),
          h('td', { class: 'num' }, N(r.work_done), h('div', { class: 'pbar' + (Number(r.over_amount) > 0 ? ' over' : '') }, h('i', { style: { width: Math.min(100, pct(r.work_done, r.current_value)) + '%' } })),
            h('small', { class: 'help' }, pct(r.work_done, r.current_value) + '%'),
            Number(r.over_amount) > 0 ? h('div', {}, h('span', { class: 'badge bad', title: 'تجاوزت الفواتير قيمة أمر الشراء — يحتاج إلى تعديل من العميل' }, `متجاوز ${fmt.num(r.over_amount)}`)) : null),
          h('td', { class: 'num' }, Number(r.advance_billed) ? `${fmt.num(r.advance_billed)} (${fmt.num(r.advance_recovered)})` : ''),
          h('td', { class: 'num' }, Number(r.retention_held) ? N(r.retention_held) : ''),
          h('td', { class: 'num' }, N(r.billed_total)), h('td', { class: 'num' }, N(r.collected)), h('td', { class: 'num' }, h('b', {}, N(r.outstanding))))))))));
  }
  load();
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) load(); else off(); });
}

// ---------------------------------------------------------------------
// تفاصيل العقد + المستخلصات
// ---------------------------------------------------------------------
async function contractView(id, done) {
  const m = modal({ title: 'العقد', size: 'full' });
  const draw = async () => {
    const [{ data: c }, st, { data: bills }] = await Promise.all([
      acc.from('contracts').select('*').eq('id', id).single(),
      rpc('contract_status', { p_companies: ids() }, 'accounting'),
      acc.from('v_contract_bills').select('*').eq('contract_id', id).order('bill_date').order('created_at'),
    ]);
    const s = st.find((x) => x.contract_id === id);
    m.setTitle?.(`${KIND[c.kind]} ${c.contract_no}`);
    const lvl2 = state.can('accounting', 2) && c.status === 'active';
    // عقود العملاء وأوامر الشراء: تُنشأ الفاتورة من صفحة فواتير المبيعات وتمر بالاعتماد. مقاول الباطن: مستخلص مباشر
    const bill = (kind) => (isCust(c.kind) ? salesEditor({ company_id: c.company_id, contract_id: c.id, bill_kind: kind, onDone: draw }) : billDialog(c, kind, s, draw));
    const [{ data: amends }, { data: pend }] = await Promise.all([
      acc.from('contract_amendments').select('*').eq('contract_id', id).eq('status', 'active').order('amend_date'),
      acc.from('v_sales_invoices').select('*').eq('contract_id', id).in('state', ['draft', 'submitted', 'rejected']).order('invoice_date'),
    ]);
    const advLeft = Math.max(0, Number(c.advance_amount) - Number(s.advance_billed));
    m.body.replaceChildren(
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi main' }, h('small', {}, c.kind === 'po' ? 'قيمة أمر الشراء الحالية' : 'قيمة العقد الحالية'), h('b', {}, fmt.num(s.current_value)),
          h('span', {}, `${s.project_code} — ${s.project_name} · ${s.party_name}`), Number(s.amendments) ? h('span', {}, `الأصلية ${fmt.num(c.contract_value)} + تعديلات ${fmt.num(s.amendments)}`) : null),
        h('div', { class: 'kpi' }, h('small', {}, c.kind === 'po' ? 'المفوتر' : 'المنفّذ (المستخلصات)'), h('b', {}, fmt.num(s.work_done)),
          Number(s.over_amount) > 0 ? h('span', { class: 'bad' }, `متجاوز ${fmt.num(s.over_amount)} — يحتاج إلى تعديل من العميل`) : h('span', {}, `${pct(s.work_done, s.current_value)}% — المتبقي ${fmt.num(s.current_value - s.work_done)}`)),
        h('div', { class: 'kpi' }, h('small', {}, 'الدفعة المقدمة'), h('b', {}, fmt.num(s.advance_billed)), h('span', {}, `المسترد ${fmt.num(s.advance_recovered)} — المتبقي ${fmt.num(s.advance_billed - s.advance_recovered)}`)),
        h('div', { class: 'kpi' }, h('small', {}, `المحتجز (${Number(c.retention_pct)}%)`), h('b', {}, fmt.num(s.retention_held)), h('span', {}, `المفكوك ${fmt.num(s.retention_released)}`)),
        h('div', { class: 'kpi' }, h('small', {}, isCust(c.kind) ? 'المحصّل' : 'المدفوع'), h('b', {}, fmt.num(s.collected)), h('span', {}, `من ${fmt.num(s.billed_total)} — المتبقي ${fmt.num(s.outstanding)}`))),
      lvl2 ? h('div', { class: 'toolbar', style: { margin: '6px 0 12px' } },
        h('button', { class: 'btn primary', onclick: () => bill('progress') }, c.kind === 'po' ? '＋ فاتورة' : '＋ مستخلص'),
        Number(c.advance_amount) > 0 ? h('button', { class: 'btn', disabled: advLeft <= 0, onclick: () => bill('advance') }, 'دفعة مقدمة') : null,
        Number(s.retention_held) > 0 ? h('button', { class: 'btn', onclick: () => bill('release') }, 'فك محتجز') : null,
        state.can('accounting', 3) ? h('button', { class: 'btn ghost', onclick: () => amendDialog(c, draw) }, c.kind === 'po' ? 'تعديل أمر الشراء' : 'أمر تغيير') : null,
        h('div', { class: 'grow' }),
        state.can('accounting', 3) ? h('button', { class: 'btn ghost', onclick: () => contractForm(c, () => { draw(); done(); }) }, 'تعديل العقد') : null) : null,
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['النوع', 'رقم', 'التاريخ', 'الفاتورة', 'قيمة الأعمال/المبلغ', 'استرداد الدفعة', 'المحتجز', 'الخاضع', 'الضريبة', 'الصافي', 'القيد'].map((t) => h('th', {}, t)))),
        h('tbody', {}, bills.length ? bills.map((b) => h('tr', { class: b.entry_status !== 'active' ? 'cancelled' : '' },
          h('td', {}, BILL[b.kind], b.entry_status !== 'active' ? h('span', { class: 'badge bad', style: { marginInlineStart: '6px' } }, 'ملغي') : null,
            b.entry_version > 1 ? h('span', { class: 'badge warn', title: 'عُدّل القيد بعد إصداره — قد تختلف أرقام المستخلص هنا عنه', style: { marginInlineStart: '6px' } }, 'القيد معدّل') : null),
          h('td', { class: 'num' }, b.bill_no), h('td', {}, fmt.date(b.bill_date)), h('td', { class: 'ltr' }, b.invoice_no),
          h('td', { class: 'num' }, N(b.work_amount)), h('td', { class: 'num' }, Number(b.recovery) ? N(b.recovery) : ''), h('td', { class: 'num' }, Number(b.retention) ? N(b.retention) : ''),
          h('td', { class: 'num' }, Number(b.vat_base) ? N(b.vat_base) : ''), h('td', { class: 'num' }, Number(b.vat_amount) ? N(b.vat_amount) : ''),
          h('td', { class: 'num' }, h('b', {}, N(b.net_amount))),
          h('td', {}, h('a', { href: 'javascript:void 0', onclick: () => openEntry(b.entry_id, { onChange: draw }) }, b.entry_ref))))
          : h('tr', {}, h('td', { colspan: 11, class: 'empty' }, 'لا توجد مستخلصات بعد')))))),
      pend?.length ? h('div', { class: 'section-title' }, 'فواتير لم تُعتمد بعد (لا تُنقص العقد حتى اعتمادها)') : null,
      pend?.length ? h('div', { class: 'card' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الفاتورة', 'التاريخ', 'النوع', 'الصافي', 'الحالة'].map((t) => h('th', {}, t)))),
        h('tbody', {}, pend.map((p) => h('tr', { onclick: () => salesEditor({ id: p.id, onDone: draw }) },
          h('td', { class: 'ltr' }, p.invoice_no), h('td', {}, fmt.date(p.invoice_date)), h('td', {}, BILL[p.bill_kind] || 'فاتورة'),
          h('td', { class: 'num' }, N(p.net_amount)),
          h('td', {}, h('span', { class: 'badge ' + (p.state === 'submitted' ? 'warn' : p.state === 'rejected' ? 'bad' : '') },
            { draft: 'مسودة', submitted: 'بانتظار الاعتماد', rejected: 'مرفوضة' }[p.state]))))))) : null,
      amends?.length ? h('div', { class: 'section-title' }, c.kind === 'po' ? 'تعديلات أمر الشراء' : 'أوامر التغيير') : null,
      amends?.length ? h('div', { class: 'card' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الرقم', 'التاريخ', 'المبلغ', 'ملاحظات', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, amends.map((a) => h('tr', {}, h('td', { class: 'ltr' }, a.amend_no), h('td', {}, fmt.date(a.amend_date)),
          h('td', { class: 'num' }, N(a.amount)), h('td', {}, a.notes || ''),
          h('td', {}, state.can('accounting', 3) ? h('button', { class: 'btn ghost', onclick: async () => {
            if (!(await confirmDialog(`إلغاء التعديل ${a.amend_no}؟`, { danger: true }))) return;
            const { error } = await acc.from('contract_amendments').update({ status: 'cancelled', cancel_reason: 'إلغاء من شاشة العقد' }).eq('id', a.id);
            if (error) toast(error.message, 'bad'); else draw();
          } }, 'إلغاء') : null)))))) : null,
      h('p', { class: 'help' }, isCust(c.kind)
        ? 'تُنشأ الفواتير والمستخلصات من فواتير المبيعات وتمر بالاعتماد. لإلغاء فاتورة معتمدة: افتح قيدها وألغِه، أو أنشئ إشعارًا دائنًا. الضريبة على قيمة الأعمال بعد خصم الدفعة المقدمة المستردة، والمحتجز لا يُنقص الضريبة.'
        : 'لإلغاء مستخلص: افتح قيده وألغِه — فيخرج من حسابات العقد.'));
  };
  m.foot.append(h('button', { class: 'btn', onclick: () => { m.close(); done(); } }, 'إغلاق'));
  await draw();
}

// ---------------------------------------------------------------------
// إصدار مستخلص / دفعة مقدمة / فك محتجز — بمعاينة القيد قبل الحفظ
// ---------------------------------------------------------------------
async function billDialog(c, kind, s, done) {
  const lk = await loadLookups(c.company_id);
  const m = modal({ title: `${BILL[kind]} — عقد ${c.contract_no}`, size: 'wide' });
  const next = (await acc.from('contract_bills').select('id', { count: 'exact', head: true }).eq('contract_id', c.id).eq('kind', kind)).count + 1;
  const date = h('input', { class: 'input', type: 'date', value: today() });
  const inv = h('input', { class: 'input ltr', value: `${c.contract_no}-${kind === 'advance' ? 'ADV' : kind === 'release' ? 'RET' : 'P'}${next}` });
  const amtDefault = kind === 'advance' ? Math.max(0, c.advance_amount - s.advance_billed) : kind === 'release' ? Number(s.retention_held) : '';
  const amt = h('input', { class: 'input', type: 'number', step: '0.01', value: amtDefault || '' });
  const rec = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'تلقائي' });
  const ret = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'تلقائي' });
  const notes = h('input', { class: 'input', placeholder: 'مثل: أعمال شهر فبراير' });
  const prev = h('div');
  const label = { advance: 'مبلغ الدفعة المقدمة (قبل الضريبة)', progress: 'قيمة الأعمال المنفذة في هذا المستخلص (قبل الضريبة)', release: 'المحتجز المفكوك' }[kind];
  m.body.append(h('div', { class: 'form-grid' },
    h('div', { class: 'field' }, h('label', {}, 'التاريخ'), date),
    h('div', { class: 'field' }, h('label', {}, 'رقم الفاتورة'), inv),
    h('div', { class: 'field wide' }, h('label', {}, label, h('span', { class: 'req' }, '*')), amt),
    kind === 'progress' ? h('div', { class: 'field' }, h('label', {}, `استرداد الدفعة المقدمة (${Number(c.advance_recovery_pct)}%)`), rec) : null,
    kind === 'progress' ? h('div', { class: 'field' }, h('label', {}, `المحتجز (${Number(c.retention_pct)}%)`), ret) : null,
    h('div', { class: 'field wide' }, h('label', {}, 'ملاحظات'), notes)), prev);
  const args = (preview) => ({ p_contract: c.id, p_kind: kind, p_date: date.value, p_amount: Number(amt.value) || 0, p_invoice_no: inv.value,
    p_recovery: rec.value === '' ? null : Number(rec.value), p_retention: ret.value === '' ? null : Number(ret.value), p_notes: notes.value, p_preview: preview });
  let t;
  const preview = () => { clearTimeout(t); t = setTimeout(async () => {
    if (!(Number(amt.value) > 0)) { prev.replaceChildren(); go.disabled = true; return; }
    try {
      const r = await rpc('post_contract_bill', args(true), 'accounting');
      const accName = (id) => lk.accounts.find((a) => a.id === id)?.label || '';
      const sum = (k) => r.lines.reduce((x, l) => x + Number(l[k] || 0), 0);
      prev.replaceChildren(
        h('div', { class: 'kpis', style: { marginTop: '12px' } },
          kind === 'progress' ? h('div', { class: 'kpi' }, h('small', {}, 'استرداد / محتجز'), h('b', {}, `${fmt.num(r.recovery)} / ${fmt.num(r.retention)}`)) : null,
          h('div', { class: 'kpi' }, h('small', {}, 'الخاضع / الضريبة'), h('b', {}, `${fmt.num(r.vat_base)} / ${fmt.num(r.vat)}`)),
          h('div', { class: 'kpi main' }, h('small', {}, isCust(c.kind) ? 'الصافي على العميل' : 'الصافي للمقاول'), h('b', {}, fmt.num(r.net)))),
        h('div', { class: 'help', style: { margin: '6px 0' } }, 'القيد الذي سيُنشأ:'),
        h('table', { class: 'grid report' }, h('thead', {}, h('tr', {}, ['الحساب', 'مدين', 'دائن', 'بيان'].map((x) => h('th', {}, x)))),
          h('tbody', {}, r.lines.map((l) => h('tr', {}, h('td', {}, accName(l.account_id)), h('td', { class: 'num' }, Number(l.debit) ? N(l.debit) : ''),
            h('td', { class: 'num' }, Number(l.credit) ? N(l.credit) : ''), h('td', { class: 'help' }, l.description || (l.invoice_no ? 'فاتورة ' + l.invoice_no : ''))))),
          h('tfoot', {}, h('tr', {}, h('td', {}, 'الإجمالي'), h('td', { class: 'num' }, N(sum('debit'))), h('td', { class: 'num' }, N(sum('credit'))), h('td')))));
      go.disabled = false;
    } catch (e) { prev.replaceChildren(h('div', { class: 'notice bad', style: { marginTop: '10px' } }, e.message)); go.disabled = true; }
  }, 250); };
  [date, inv, amt, rec, ret].forEach((x) => x.addEventListener('input', preview));
  const go = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
    go.disabled = true;
    try {
      const r = await rpc('post_contract_bill', args(false), 'accounting');
      toast(`${BILL[kind]} ${r.bill_no} — القيد ${r.fiscal_year}-${r.entries[0].entry_no}`, 'ok');
      m.close(); done();
    } catch (e) { toast(e.message, 'bad'); go.disabled = false; }
  } }, 'إصدار وحفظ القيد');
  m.foot.append(go, h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
  preview();
  setTimeout(() => amt.focus(), 0);
}

// ---------------------------------------------------------------------
// نموذج العقد
// ---------------------------------------------------------------------
async function contractForm(c, done) {
  const m = modal({ title: c ? `تعديل العقد ${c.contract_no}` : 'عقد جديد', size: 'wide' });
  const coSel = h('select', { class: 'input', disabled: !!c }, ids().map((id) => h('option', { value: id, selected: c?.company_id === id }, cname(id))));
  const kind = h('select', { class: 'input', disabled: !!c }, h('option', { value: 'customer' }, 'عقد مع عميل (إيراد)'), h('option', { value: 'po' }, 'أمر شراء من عميل (إيراد)'),
    h('option', { value: 'subcontract' }, 'مقاول باطن (تكلفة)'));
  if (c) kind.value = c.kind;
  const no = h('input', { class: 'input ltr', value: c?.contract_no || '' });
  const title = h('input', { class: 'input', value: c?.title || '' });
  const num = (v, ph) => h('input', { class: 'input', type: 'number', step: '0.01', value: v ?? '', placeholder: ph || '' });
  const value = num(c?.contract_value), retPct = num(c?.retention_pct ?? 0), adv = num(c?.advance_amount ?? 0), recPct = num(c?.advance_recovery_pct ?? 0);
  const start = h('input', { class: 'input', type: 'date', value: c?.start_date || '' }), end = h('input', { class: 'input', type: 'date', value: c?.end_date || '' });
  const notes = h('textarea', { class: 'input', rows: 2 }, c?.notes || '');
  const slots = {}; const pk = {};
  ['project', 'party', 'party_account', 'main', 'retention', 'advance', 'vat'].forEach((k) => { slots[k] = h('div'); });
  const err = h('p', { class: 'notice bad', style: { display: 'none', marginTop: '10px' } });
  let lk;
  async function build() {
    lk = await loadLookups(coSel.value);
    const cust = kind.value !== 'subcontract';
    const A = (f) => lk.postable.filter((a) => f(a.row));
    const byName = (list, rx) => list.find((a) => rx.test(a.name))?.id || null;
    const lists = {
      project: lk.projects,
      party: cust ? lk.customers : lk.suppliers,
      party_account: A((r) => r.party_kind === (cust ? 'customer' : 'supplier') && r.vat_role === 'none' && r.account_type === (cust ? 'asset' : 'liability')),
      main: A((r) => (cust ? r.account_type === 'revenue' : r.account_type === 'expense')),
      retention: A((r) => r.account_type === (cust ? 'asset' : 'liability') && r.vat_role === 'none' && !r.is_cash_account),
      advance: A((r) => r.account_type === (cust ? 'liability' : 'asset') && r.vat_role === 'none' && !r.is_cash_account),
      vat: A((r) => r.vat_role === (cust ? 'output' : 'input')),
    };
    const defaults = {
      project: c?.project_id, party: c?.party_id,
      party_account: c?.party_account_id || lists.party_account[0]?.id,
      main: c?.main_account_id || (cust ? lists.main.find((a) => a.row.project_rule === 'required')?.id || lists.main[0]?.id : null),
      retention: c ? c.retention_account_id : byName(lists.retention, /محتجز/),
      advance: c ? c.advance_account_id : byName(lists.advance, /مقدم/),
      vat: c ? c.vat_account_id : lists.vat[0]?.id,
    };
    for (const k of Object.keys(lists)) {
      pk[k] = picker({ options: lists[k], listKey: `ct-${k}-${coSel.value}-${kind.value}`, value: defaults[k] || null, placeholder: k === 'vat' ? 'بدون ضريبة' : '' });
      slots[k].replaceChildren(pk[k].el);
    }
    if (c) { pk.project.setDisabled?.(false); }
  }
  coSel.onchange = build; kind.onchange = build;
  const F = (label, input, opt = {}) => h('div', { class: 'field' + (opt.wide ? ' wide' : '') }, h('label', {}, label, opt.req ? h('span', { class: 'req' }, '*') : ''), input, opt.help ? h('div', { class: 'help' }, opt.help) : null);
  m.body.append(h('div', { class: 'form-grid' },
    F('الشركة', coSel, { req: true }), F('النوع', kind, { req: true }),
    F('رقم العقد / أمر الشراء', no, { req: true }), F('الاسم / الوصف', title),
    F('المشروع', slots.project, { req: true }), F('العميل / المقاول', slots.party, { req: true }),
    F('القيمة الأصلية (قبل الضريبة)', value, { req: true, help: 'تُسجَّل الزيادات اللاحقة كأمر تغيير / تعديل أمر شراء' }), F('نسبة المحتجز %', retPct, { help: 'تُخصم من كل مستخلص (غالبًا 5% أو 10%)' }),
    F('الدفعة المقدمة (قبل الضريبة)', adv, { help: 'صفر إن لم توجد' }), F('نسبة استرداد الدفعة %', recPct, { help: 'تُخصم من كل مستخلص حتى تنتهي الدفعة' }),
    F('تاريخ البداية', start), F('تاريخ النهاية', end, { help: 'الموعد المتوقع لفك المحتجز في السيولة' })),
  h('div', { class: 'section-title' }, 'الحسابات'),
  h('div', { class: 'form-grid' },
    F('حساب العميل / المقاول', slots.party_account, { req: true }), F(kind.value !== 'subcontract' ? 'حساب الإيراد' : 'حساب الإيراد / التكلفة', slots.main, { req: true }),
    F('حساب المحتجزات', slots.retention, { help: 'محتجزات لدى العملاء (أصل) أو محتجزات مقاولي الباطن (التزام)' }),
    F('حساب الدفعات المقدمة', slots.advance, { help: 'دفعات مقدمة من العملاء (التزام) أو لمقاولي الباطن (أصل)' }),
    F('حساب الضريبة', slots.vat, { help: 'فارغ = عقد بدون ضريبة (مثل مقاول بلا رقم ضريبي)' }), F('ملاحظات', notes, { wide: true })), err);
  await build();
  const save = h('button', { class: 'btn primary', onclick: async () => {
    err.style.display = 'none';
    const row = {
      company_id: coSel.value, kind: kind.value, contract_no: no.value.trim(), title: title.value.trim() || null,
      project_id: pk.project.id, party_id: pk.party.id, contract_value: Number(value.value) || null,
      retention_pct: Number(retPct.value) || 0, advance_amount: Number(adv.value) || 0, advance_recovery_pct: Number(recPct.value) || 0,
      party_account_id: parseAccId(pk.party_account.id), main_account_id: parseAccId(pk.main.id), retention_account_id: parseAccId(pk.retention.id),
      advance_account_id: parseAccId(pk.advance.id), vat_account_id: parseAccId(pk.vat.id),
      start_date: start.value || null, end_date: end.value || null, notes: notes.value.trim() || null,
    };
    const miss = [['contract_no', 'رقم العقد'], ['project_id', 'المشروع'], ['party_id', 'الطرف'], ['contract_value', 'قيمة العقد'], ['party_account_id', 'حساب الطرف'], ['main_account_id', 'حساب الإيراد/التكلفة']].filter(([k]) => !row[k]);
    if (miss.length) { err.textContent = 'ناقص: ' + miss.map((x) => x[1]).join('، '); err.style.display = ''; return; }
    if (row.advance_amount > 0 && !row.advance_recovery_pct) { err.textContent = 'حدد نسبة استرداد الدفعة المقدمة'; err.style.display = ''; return; }
    save.disabled = true;
    const q = c ? acc.from('contracts').update(row).eq('id', c.id) : acc.from('contracts').insert(row);
    const { error } = await q;
    save.disabled = false;
    if (error) { err.textContent = /contracts_no_uq/.test(error.message) ? 'رقم العقد مستخدم سابقًا في هذه الشركة' : error.message; err.style.display = ''; return; }
    toast(c ? 'عُدّل العقد' : 'سُجّل العقد', 'ok'); m.close(); done();
  } }, 'حفظ');
  m.foot.append(...[save,
    c && state.can('accounting', 3) ? h('button', { class: 'btn ghost', onclick: async () => {
      if (!(await confirmDialog(`إيقاف العقد ${c.contract_no}؟ تبقى المستخلصات المُصدرة كما هي.`))) return;
      const { error } = await acc.from('contracts').update({ status: c.status === 'active' ? 'archived' : 'active' }).eq('id', c.id);
      if (error) toast(error.message, 'bad'); else { m.close(); done(); }
    } }, c.status === 'active' ? 'إيقاف العقد' : 'إعادة التفعيل') : null,
    h('button', { class: 'btn', onclick: m.close }, 'رجوع')].filter(Boolean));
}
// أمر تغيير في عقد / تعديل أمر شراء من العميل (زيادة أو نقص)
function amendDialog(c, done) {
  const m = modal({ title: c.kind === 'po' ? `تعديل أمر الشراء ${c.contract_no}` : `أمر تغيير — عقد ${c.contract_no}`, size: 'narrow' });
  const no = h('input', { class: 'input ltr', value: `${c.contract_no} Rev.` });
  const date = h('input', { class: 'input', type: 'date', value: today() });
  const amt = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'موجب = زيادة، سالب = نقص' });
  const notes = h('input', { class: 'input' });
  const err = h('p', { class: 'notice bad', style: { display: 'none' } });
  m.body.append(h('div', { class: 'form-grid' },
    h('div', { class: 'field' }, h('label', {}, 'رقم التعديل'), no), h('div', { class: 'field' }, h('label', {}, 'التاريخ'), date),
    h('div', { class: 'field wide' }, h('label', {}, 'المبلغ (قبل الضريبة)', h('span', { class: 'req' }, '*')), amt),
    h('div', { class: 'field wide' }, h('label', {}, 'ملاحظات'), notes)), err);
  m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
    err.style.display = 'none';
    if (!Number(amt.value) || !no.value.trim() || !date.value) { err.textContent = 'الرقم والتاريخ والمبلغ مطلوبة'; err.style.display = ''; return; }
    const { error } = await acc.from('contract_amendments').insert({ contract_id: c.id, company_id: c.company_id, amend_no: no.value.trim(), amend_date: date.value,
      amount: Number(amt.value), notes: notes.value.trim() || null });
    if (error) { err.textContent = error.message; err.style.display = ''; return; }
    toast('سُجّل التعديل', 'ok'); m.close(); done();
  } }, 'حفظ'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
  setTimeout(() => amt.focus(), 0);
}

// ملخص حسب المشروع: عقود العملاء وأوامر الشراء ← المفوتر ← المحصّل ← الباقي
function projectSummary(rows) {
  const by = new Map();
  rows.filter((r) => isCust(r.kind)).forEach((r) => {
    const k = r.project_id;
    if (!by.has(k)) by.set(k, { code: r.project_code, name: r.project_name, n: 0, value: 0, work: 0, billed: 0, collected: 0, outstanding: 0, retention: 0, over: 0 });
    const x = by.get(k);
    x.n += 1; x.value += Number(r.current_value); x.work += Number(r.work_done); x.billed += Number(r.billed_total); x.collected += Number(r.collected);
    x.outstanding += Number(r.outstanding); x.retention += Number(r.retention_held); x.over += Number(r.over_amount);
  });
  const list = [...by.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  if (!list.length) return h('div', { class: 'notice' }, 'لا توجد عقود عملاء أو أوامر شراء.');
  const T = (k) => list.reduce((s, x) => s + x[k], 0);
  return h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
    h('thead', {}, h('tr', {}, ['المشروع', 'عدد العقود/الأوامر', 'القيمة الحالية', 'المنفّذ/المفوتر (قبل الضريبة)', 'المتبقي من القيمة', 'المفوتر بالضريبة', 'المحصّل', 'المتبقي على العميل', 'المحتجز', 'المتجاوز'].map((t) => h('th', {}, t)))),
    h('tbody', {}, list.map((x) => h('tr', {}, h('td', {}, `${x.code} — ${x.name}`), h('td', { class: 'num' }, x.n), h('td', { class: 'num' }, N(x.value)),
      h('td', { class: 'num' }, N(x.work), h('small', { class: 'help' }, ` ${pct(x.work, x.value)}%`)), h('td', { class: 'num' }, N(Math.max(0, x.value - x.work))),
      h('td', { class: 'num' }, N(x.billed)), h('td', { class: 'num' }, N(x.collected)), h('td', { class: 'num' }, h('b', {}, N(x.outstanding))),
      h('td', { class: 'num' }, x.retention ? N(x.retention) : ''), h('td', { class: 'num' }, x.over ? h('span', { class: 'badge bad' }, fmt.num(x.over)) : '')))),
    h('tfoot', {}, h('tr', {}, h('td', {}, 'الإجمالي'), h('td'), h('td', { class: 'num' }, N(T('value'))), h('td', { class: 'num' }, N(T('work'))),
      h('td', { class: 'num' }, N(list.reduce((s, x) => s + Math.max(0, x.value - x.work), 0))), h('td', { class: 'num' }, N(T('billed'))),
      h('td', { class: 'num' }, N(T('collected'))), h('td', { class: 'num' }, N(T('outstanding'))), h('td', { class: 'num' }, N(T('retention'))), h('td', { class: 'num' }, T('over') ? N(T('over')) : ''))))));
}

const parseAccId = (id) => (id && String(id).startsWith('p:') ? String(id).split(':')[2] : id || null);

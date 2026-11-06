// عقود المشاريع والمستخلصات: عقود العملاء ومقاولي الباطن، الدفعة المقدمة واستردادها، المحتجزات وفكها.
//   كل مستخلص بيعمل قيده لوحده (accounting.post_contract_bill) — إلغاء القيد من سجل القيود = إلغاء المستخلص
import { acc, rpc } from '../../shared/sb.js';
import { h, fmt, modal, toast, confirmDialog } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { loadLookups, picker, today } from './lookups.js';
import { N } from './reports.js';
import { openEntry } from './register.js';

const KIND = { customer: 'عقد عميل', subcontract: 'مقاول باطن' };
const BILL = { advance: 'دفعة مقدمة', progress: 'مستخلص', release: 'فك محتجز' };
const cname = (id) => state.companyName(id);
const ids = () => (state.selectedCompanies.length ? state.selectedCompanies : state.companies().map((c) => c.id));
const pct = (a, b) => (Number(b) ? Math.round((Number(a) / Number(b)) * 1000) / 10 : 0);

export function renderContracts(el) {
  const kindSel = h('select', { class: 'input', style: { width: 'auto' } },
    h('option', { value: '' }, 'كل العقود'), h('option', { value: 'customer' }, 'عقود العملاء'), h('option', { value: 'subcontract' }, 'مقاولو الباطن'));
  const out = h('div');
  kindSel.onchange = () => load();
  el.replaceChildren(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'toolbar' }, kindSel, h('div', { class: 'grow' }),
    state.can('accounting', 3) ? h('button', { class: 'btn primary', onclick: () => contractForm(null, load) }, '＋ عقد جديد') : null)), out);

  async function load() {
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    let rows = await rpc('contract_status', { p_companies: ids() }, 'accounting');
    if (kindSel.value) rows = rows.filter((r) => r.kind === kindSel.value);
    rows = rows.filter((r) => r.status === 'active' || r.bills > 0);
    if (!rows.length) { out.replaceChildren(h('div', { class: 'notice' }, 'مفيش عقود. اضغط "عقد جديد" وسجّل عقد المشروع مع العميل أو مقاول الباطن.')); return; }
    const tot = (k, kind) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r[k]), 0);
    out.replaceChildren(
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, 'باقي على العملاء من المستخلصات'), h('b', {}, fmt.num(tot('outstanding', 'customer')))),
        h('div', { class: 'kpi' }, h('small', {}, 'محتجزات لينا عند العملاء'), h('b', {}, fmt.num(tot('retention_held', 'customer')))),
        h('div', { class: 'kpi' }, h('small', {}, 'باقي لمقاولي الباطن'), h('b', {}, fmt.num(tot('outstanding', 'subcontract')))),
        h('div', { class: 'kpi' }, h('small', {}, 'محتجزات علينا لمقاولي الباطن'), h('b', {}, fmt.num(tot('retention_held', 'subcontract'))))),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report contracts' },
        h('thead', {}, h('tr', {}, ['العقد', 'النوع', 'المشروع', 'الطرف', 'قيمة العقد', 'المنفّذ', 'الدفعة المقدمة (المسترد)', 'المحتجز', 'المتفوتر', 'المحصّل/المدفوع', 'الباقي'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.map((r) => h('tr', { onclick: () => contractView(r.contract_id, load), class: r.status !== 'active' ? 'dim' : '' },
          h('td', {}, h('b', { class: 'ltr' }, r.contract_no), r.title ? h('div', { class: 'help' }, r.title) : null, ids().length > 1 ? h('div', { class: 'help' }, cname(r.company_id)) : null),
          h('td', {}, h('span', { class: 'badge' + (r.kind === 'subcontract' ? ' warn' : '') }, KIND[r.kind])),
          h('td', {}, `${r.project_code} — ${r.project_name}`), h('td', {}, r.party_name),
          h('td', { class: 'num' }, N(r.contract_value)),
          h('td', { class: 'num' }, N(r.work_done), h('div', { class: 'pbar' }, h('i', { style: { width: Math.min(100, pct(r.work_done, r.contract_value)) + '%' } })), h('small', { class: 'help' }, pct(r.work_done, r.contract_value) + '%')),
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
    const advLeft = Math.max(0, Number(c.advance_amount) - Number(s.advance_billed));
    m.body.replaceChildren(
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi main' }, h('small', {}, 'قيمة العقد'), h('b', {}, fmt.num(c.contract_value)), h('span', {}, `${s.project_code} — ${s.project_name} · ${s.party_name}`)),
        h('div', { class: 'kpi' }, h('small', {}, 'المنفّذ (المستخلصات)'), h('b', {}, fmt.num(s.work_done)), h('span', {}, `${pct(s.work_done, c.contract_value)}% — الباقي ${fmt.num(c.contract_value - s.work_done)}`)),
        h('div', { class: 'kpi' }, h('small', {}, 'الدفعة المقدمة'), h('b', {}, fmt.num(s.advance_billed)), h('span', {}, `مسترد ${fmt.num(s.advance_recovered)} — باقي ${fmt.num(s.advance_billed - s.advance_recovered)}`)),
        h('div', { class: 'kpi' }, h('small', {}, `المحتجز (${Number(c.retention_pct)}%)`), h('b', {}, fmt.num(s.retention_held)), h('span', {}, `اتفك ${fmt.num(s.retention_released)}`)),
        h('div', { class: 'kpi' }, h('small', {}, c.kind === 'customer' ? 'المحصّل' : 'المدفوع'), h('b', {}, fmt.num(s.collected)), h('span', {}, `من ${fmt.num(s.billed_total)} — الباقي ${fmt.num(s.outstanding)}`))),
      lvl2 ? h('div', { class: 'toolbar', style: { margin: '6px 0 12px' } },
        h('button', { class: 'btn primary', onclick: () => billDialog(c, 'progress', s, draw) }, '＋ مستخلص'),
        Number(c.advance_amount) > 0 ? h('button', { class: 'btn', disabled: advLeft <= 0, onclick: () => billDialog(c, 'advance', s, draw) }, 'دفعة مقدمة') : null,
        Number(s.retention_held) > 0 ? h('button', { class: 'btn', onclick: () => billDialog(c, 'release', s, draw) }, 'فك محتجز') : null,
        h('div', { class: 'grow' }),
        state.can('accounting', 3) ? h('button', { class: 'btn ghost', onclick: () => contractForm(c, () => { draw(); done(); }) }, 'تعديل العقد') : null) : null,
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['النوع', 'رقم', 'التاريخ', 'الفاتورة', 'قيمة الأعمال/المبلغ', 'استرداد الدفعة', 'المحتجز', 'الخاضع', 'الضريبة', 'الصافي', 'القيد'].map((t) => h('th', {}, t)))),
        h('tbody', {}, bills.length ? bills.map((b) => h('tr', { class: b.entry_status !== 'active' ? 'cancelled' : '' },
          h('td', {}, BILL[b.kind], b.entry_status !== 'active' ? h('span', { class: 'badge bad', style: { marginInlineStart: '6px' } }, 'ملغي') : null,
            b.entry_version > 1 ? h('span', { class: 'badge warn', title: 'القيد اتعدّل بعد إصداره — أرقام المستخلص هنا ممكن تختلف عنه', style: { marginInlineStart: '6px' } }, 'القيد معدّل') : null),
          h('td', { class: 'num' }, b.bill_no), h('td', {}, fmt.date(b.bill_date)), h('td', { class: 'ltr' }, b.invoice_no),
          h('td', { class: 'num' }, N(b.work_amount)), h('td', { class: 'num' }, Number(b.recovery) ? N(b.recovery) : ''), h('td', { class: 'num' }, Number(b.retention) ? N(b.retention) : ''),
          h('td', { class: 'num' }, Number(b.vat_base) ? N(b.vat_base) : ''), h('td', { class: 'num' }, Number(b.vat_amount) ? N(b.vat_amount) : ''),
          h('td', { class: 'num' }, h('b', {}, N(b.net_amount))),
          h('td', {}, h('a', { href: 'javascript:void 0', onclick: () => openEntry(b.entry_id, { onChange: draw }) }, b.entry_ref))))
          : h('tr', {}, h('td', { colspan: 11, class: 'empty' }, 'لسه مفيش مستخلصات')))))),
      h('p', { class: 'help' }, 'لإلغاء مستخلص: افتح قيده وألغيه — بيخرج من حسابات العقد. الضريبة على قيمة الأعمال بعد خصم الدفعة المقدمة المستردة، والمحتجز ما بيقلّلش الضريبة.'));
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
  const notes = h('input', { class: 'input', placeholder: 'مثلًا: أعمال شهر فبراير' });
  const prev = h('div');
  const label = { advance: 'مبلغ الدفعة المقدمة (قبل الضريبة)', progress: 'قيمة الأعمال المنفذة في المستخلص ده (قبل الضريبة)', release: 'المحتجز المفكوك' }[kind];
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
          h('div', { class: 'kpi main' }, h('small', {}, c.kind === 'customer' ? 'الصافي على العميل' : 'الصافي للمقاول'), h('b', {}, fmt.num(r.net)))),
        h('div', { class: 'help', style: { margin: '6px 0' } }, 'القيد اللي هيتعمل:'),
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
  const kind = h('select', { class: 'input', disabled: !!c }, h('option', { value: 'customer' }, 'عقد مع عميل (إيراد)'), h('option', { value: 'subcontract' }, 'مقاول باطن (تكلفة)'));
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
    const cust = kind.value === 'customer';
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
    F('رقم العقد', no, { req: true }), F('اسم العقد', title),
    F('المشروع', slots.project, { req: true }), F('العميل / المقاول', slots.party, { req: true }),
    F('قيمة العقد (قبل الضريبة)', value, { req: true }), F('نسبة المحتجز %', retPct, { help: 'بتتخصم من كل مستخلص (غالبًا 5% أو 10%)' }),
    F('الدفعة المقدمة (قبل الضريبة)', adv, { help: 'صفر لو مفيش' }), F('نسبة استرداد الدفعة %', recPct, { help: 'بتتخصم من كل مستخلص لحد ما الدفعة تخلص' }),
    F('تاريخ البداية', start), F('تاريخ النهاية', end, { help: 'ميعاد فك المحتجز المتوقع في السيولة' })),
  h('div', { class: 'section-title' }, 'الحسابات'),
  h('div', { class: 'form-grid' },
    F('حساب العميل / المقاول', slots.party_account, { req: true }), F(kind.value === 'customer' ? 'حساب الإيراد' : 'حساب الإيراد / التكلفة', slots.main, { req: true }),
    F('حساب المحتجزات', slots.retention, { help: 'محتجزات لدى العملاء (أصل) أو محتجزات مقاولي الباطن (التزام)' }),
    F('حساب الدفعات المقدمة', slots.advance, { help: 'دفعات مقدمة من العملاء (التزام) أو لمقاولي الباطن (أصل)' }),
    F('حساب الضريبة', slots.vat, { help: 'فاضي = العقد من غير ضريبة (مثلًا مقاول بدون رقم ضريبي)' }), F('ملاحظات', notes, { wide: true })), err);
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
    if (error) { err.textContent = /contracts_no_uq/.test(error.message) ? 'رقم العقد مستخدم قبل كده في الشركة دي' : error.message; err.style.display = ''; return; }
    toast(c ? 'اتعدّل العقد' : 'اتسجل العقد', 'ok'); m.close(); done();
  } }, 'حفظ');
  m.foot.append(...[save,
    c && state.can('accounting', 3) ? h('button', { class: 'btn ghost', onclick: async () => {
      if (!(await confirmDialog(`إيقاف العقد ${c.contract_no}؟ المستخلصات اللي اتعملت بتفضل زي ما هي.`))) return;
      const { error } = await acc.from('contracts').update({ status: c.status === 'active' ? 'archived' : 'active' }).eq('id', c.id);
      if (error) toast(error.message, 'bad'); else { m.close(); done(); }
    } }, c.status === 'active' ? 'إيقاف العقد' : 'إعادة التفعيل') : null,
    h('button', { class: 'btn', onclick: m.close }, 'رجوع')].filter(Boolean));
}
const parseAccId = (id) => (id && String(id).startsWith('p:') ? String(id).split(':')[2] : id || null);

// قسم طلبات التحويل: مقدّم الطلب ← مدير المشروع (في حدّه) ← المدير العام (إذا تجاوز) ← المحاسبة ← قيد سداد يسجّله المحاسب
//   طلباتي: لمن يقدّم.  بانتظار موافقتي: لمدير المشروع والمدير العام (ومعها المعتمد للعلم والموقوف).
//   كل الطلبات: المحاسبة ترى كل طلب من لحظة تقديمه بخط سيره.  جاهزة للسداد: كشف التحويل للبنك، وقيد السداد أو الربط بقيد.
import { acc, rpc, sb } from '../../shared/sb.js';
import { h, fmt, modal, toast, confirmDialog, askReason } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { brand, companyInfo, refreshCompanies, hijri } from '../../shared/branding.js';
import { combo } from '../../shared/combo.js';

export const KINDS = { invoice: 'سداد فاتورة', advance: 'دفعة مقدمة', sub_bill: 'مستخلص مقاول باطن', custody: 'عهدة', expense: 'مصروف مباشر', salary_advance: 'سلفة راتب' };
export const STATES = {
  pending: ['بانتظار الاعتماد', 'warn'], returned: ['مُرجَع للتعديل', 'warn'], rejected: ['مرفوض', 'bad'], withdrawn: ['مسحوب', ''],
  approved: ['معتمد — بانتظار السداد', 'ok'], on_hold: ['موقوف', 'bad'], transferred: ['حُوِّل — بلا قيد', 'warn'], paid: ['مدفوع', 'ok'],
};
const EVENTS = {
  submit: 'قدّم الطلب', resubmit: 'أعاد التقديم بعد التعديل', approve: 'وافق', forward: 'وافق وأحاله للمدير العام', return: 'أرجعه للتعديل',
  reject: 'رفضه', hold: 'أوقفه', release: 'أطلقه', withdraw: 'سحبه', transfer: 'سجّل «تم التحويل»', link: 'ربط قيد السداد', unlink: 'فك ربط القيد',
  auto_unlink: 'عاد غير مدفوع',
};
const LEVEL = { 1: 'مدير المشروع', 2: 'المدير العام' };
export const BASES = { invoice: 'فاتورة مسجّلة', pending_invoice: 'فاتورة لم تُسجَّل بعد', quote: 'عرض سعر', none: 'بدون مستند' };
const docText = (r) => (r.basis === 'quote' ? `عرض سعر ${r.quote_no}` : r.invoice_no ? `فاتورة ${r.invoice_no}${r.basis === 'pending_invoice' ? ' (لم تُسجَّل)' : ''}` : '');
const P = () => state.profile?.payments || {};
const canRequest = () => !!P().can_request;
const isApprover = () => !!(P().unlimited || P().limit != null || (P().managed_projects || []).length);
const isAcc = (lvl = 1) => state.can('accounting', lvl);
const ids = () => (state.selectedCompanies.length ? state.selectedCompanies : state.companies().map((c) => c.id));
const num = (v) => fmt.num(v);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const badge = (s) => h('span', { class: 'badge ' + (STATES[s]?.[1] || '') }, STATES[s]?.[0] || s);
const overdue = (r) => ['approved', 'on_hold', 'pending', 'returned'].includes(r.state) && r.due_date < today();
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
const run = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok, 'ok'); return r ?? true; } catch (e) { toast(e.message, 'bad'); return null; } };

// أين الطلب الآن (سطر واحد)
function whereNow(r) {
  if (r.state === 'pending') {
    const who = (r.waiting_for || []).join('، ');
    return `بانتظار ${LEVEL[r.level]}${who ? ': ' + who : ' — لا يوجد من يعتمد في هذه المرحلة (حدده من شاشة المستخدمين)'}`;
  }
  if (r.state === 'returned') return `عند ${r.requester_name} للتعديل`;
  if (r.state === 'approved') return 'في المحاسبة — بانتظار التحويل' + (r.gm_info ? ' (اعتمده مدير المشروع؛ للعلم عند المدير العام)' : '');
  if (r.state === 'on_hold') return 'أوقفه المدير العام';
  if (r.state === 'transferred') return `حُوِّل ${fmt.date(r.transfer_date)} — بانتظار قيد السداد`;
  if (r.state === 'paid') return `مدفوع بالقيد ${r.entry_ref || ''}`;
  return '';
}

async function loadRows(filter) {
  let q = acc.from('v_payment_requests').select('*').in('company_id', ids());
  q = filter(q);
  const { data, error } = await q.order('request_date', { ascending: false }).order('request_no', { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  return data || [];
}

// جدول الطلبات
function table(rows, { onOpen, select = null, cols = 'all' } = {}) {
  const multi = ids().length > 1;
  const head = [select ? '' : null, 'الرقم', 'التاريخ', 'المستفيد', 'النوع', 'المشروع', 'المبلغ', 'آخر موعد', 'الحالة', cols === 'all' ? 'أين الآن' : 'مقدّم الطلب'].filter((x) => x !== null);
  const tbl = h('table', { class: 'grid report pr-cards' },
    h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.length ? rows.map((r) => h('tr', { onclick: (e) => { if (e.target.type !== 'checkbox') onOpen(r); } },
      select ? h('td', { style: { width: '32px' } }, select(r)) : null,
      h('td', {}, h('b', { class: 'ltr' }, r.request_no), r.priority === 'urgent' ? h('span', { class: 'badge bad', style: { marginInlineStart: '6px' } }, 'عاجل') : null,
        multi ? h('div', { class: 'help' }, r.company_name) : null),
      h('td', {}, fmt.date(r.request_date)),
      h('td', {}, r.payee_name, docText(r) ? h('div', { class: 'help' }, docText(r)) : null),
      h('td', {}, KINDS[r.kind]),
      h('td', {}, r.project_code ? `${r.project_code} — ${r.project_name}` : ''),
      h('td', { class: 'num' }, h('b', {}, num(r.amount))),
      h('td', {}, h('span', { class: overdue(r) ? 'badge bad' : '' }, fmt.date(r.due_date))),
      h('td', {}, badge(r.state), r.attachments ? h('span', { class: 'help', title: 'مرفقات' }, ` 📎${r.attachments}`) : null),
      h('td', { class: 'wrap' }, cols === 'all' ? whereNow(r) : r.requester_name)))
      : h('tr', {}, h('td', { colspan: head.length, class: 'empty' }, 'لا توجد طلبات'))));
  // على التليفون يظهر كل طلب بطاقة: اسم العمود بجانب قيمته
  tbl.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (!td.classList.contains('empty')) td.dataset.label = head[i] || ''; }));
  return h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, tbl));
}

function listPage(el, { title, filter, toolbar = [], states = null, extra }) {
  const stSel = states ? h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, 'كل الحالات'),
    states.map((s) => h('option', { value: s }, STATES[s][0]))) : null;
  const q = h('input', { class: 'input', placeholder: 'الرقم أو المستفيد أو المشروع أو الفاتورة', style: { width: '260px' } });
  const out = h('div');
  el.replaceChildren(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'toolbar' },
    title ? h('strong', {}, title) : null, stSel, q, h('div', { class: 'grow' }), ...toolbar.map((b) => b(load)))), out);
  let rows = [];
  async function load() {
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    try { rows = await loadRows(filter); } catch (e) { out.replaceChildren(h('div', { class: 'notice bad' }, e.message)); return; }
    draw();
  }
  function draw() {
    const nq = q.value.trim().toLowerCase();
    const list = rows.filter((r) => (!stSel?.value || r.state === stSel.value)
      && (!nq || [r.request_no, r.payee_name, r.project_code, r.project_name, r.invoice_no, r.quote_no, r.requester_name].some((v) => String(v || '').toLowerCase().includes(nq))));
    put(out, extra ? extra(list, load) : table(list, { onOpen: (r) => openRequest(r.id, load) }));
  }
  stSel?.addEventListener('change', draw);
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 200); });
  load();
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) load(); else off(); });
  return { load };
}

// ---------------------------------------------------------------------
// طلباتي
// ---------------------------------------------------------------------
function renderMine(el) {
  listPage(el, {
    filter: (q) => q.eq('requester_id', state.profile.id),
    states: Object.keys(STATES),
    toolbar: [(load) => h('button', { class: 'btn primary', onclick: () => requestForm(null, load) }, '＋ طلب تحويل')],
  });
}

// ---------------------------------------------------------------------
// بانتظار موافقتي + للعلم + الموقوف
// ---------------------------------------------------------------------
function renderApprovals(el) {
  listPage(el, {
    filter: (q) => q.in('state', ['pending', 'approved', 'on_hold']).neq('requester_id', state.profile.id),
    extra: (list, load) => {
      const mine = list.filter((r) => (r.my_actions || []).includes('approve'));
      const info = list.filter((r) => r.state === 'approved' && r.gm_info && (r.my_actions || []).includes('hold'));
      const held = list.filter((r) => r.state === 'on_hold' && (r.my_actions || []).includes('release'));
      const open = (r) => openRequest(r.id, load);
      return [
        h('div', { class: 'kpis' },
          h('div', { class: 'kpi main' }, h('small', {}, 'بانتظار موافقتي'), h('b', {}, String(mine.length)), h('span', {}, num(mine.reduce((s, r) => s + Number(r.amount), 0)))),
          P().unlimited ? h('div', { class: 'kpi' }, h('small', {}, 'اعتمدها مدير المشروع — للعلم'), h('b', {}, String(info.length)), h('span', {}, 'تستطيع إيقاف أي منها قبل السداد')) : null,
          held.length ? h('div', { class: 'kpi bad' }, h('small', {}, 'موقوفة'), h('b', {}, String(held.length))) : null),
        h('div', { class: 'section-title' }, 'بانتظار موافقتي'), table(mine, { onOpen: open, cols: 'req' }),
        P().unlimited ? [h('div', { class: 'section-title' }, 'معتمدة من مدير المشروع — للعلم'), table(info, { onOpen: open, cols: 'req' })] : null,
        held.length ? [h('div', { class: 'section-title' }, 'موقوفة'), table(held, { onOpen: open, cols: 'req' })] : null,
      ];
    },
  });
}

// ---------------------------------------------------------------------
// كل الطلبات (المحاسبة) بخط السير
// ---------------------------------------------------------------------
function renderAll(el) {
  listPage(el, { filter: (q) => q, states: Object.keys(STATES) });
}

// ---------------------------------------------------------------------
// جاهزة للسداد: مرتبة حسب آخر موعد، وكشف تحويل للبنك، و«تم التحويل»، وقيد السداد
// ---------------------------------------------------------------------
function renderPay(el) {
  const chosen = new Set();
  listPage(el, {
    filter: (q) => q.in('state', ['approved', 'transferred', 'on_hold']),
    extra: (list, load) => {
      list = [...list].sort((a, b) => (a.state === 'on_hold') - (b.state === 'on_hold') || (b.priority === 'urgent') - (a.priority === 'urgent') || a.due_date.localeCompare(b.due_date));
      [...chosen].forEach((id) => { if (!list.some((r) => r.id === id && r.state === 'approved')) chosen.delete(id); });
      const sel = () => list.filter((r) => chosen.has(r.id));
      const info = h('span', { class: 'help' });
      const refresh = () => { const s = sel(); info.textContent = s.length ? `${s.length} طلب — ${num(s.reduce((x, r) => x + Number(r.amount), 0))}` : 'اختر طلبات لكشف التحويل'; };
      const box = (r) => (r.state === 'approved' ? h('input', { type: 'checkbox', checked: chosen.has(r.id), onchange: (e) => { e.target.checked ? chosen.add(r.id) : chosen.delete(r.id); refresh(); } }) : '');
      const appr = list.filter((r) => r.state === 'approved');
      const sum = (l) => num(l.reduce((s, r) => s + Number(r.amount), 0));
      refresh();
      return [
        h('div', { class: 'kpis' },
          h('div', { class: 'kpi main' }, h('small', {}, 'بانتظار التحويل'), h('b', {}, String(appr.length)), h('span', {}, sum(appr))),
          h('div', { class: 'kpi bad' }, h('small', {}, 'متأخرة عن موعدها'), h('b', {}, String(appr.filter(overdue).length)), h('span', {}, sum(appr.filter(overdue)))),
          h('div', { class: 'kpi warn' }, h('small', {}, 'حُوِّلت بلا قيد'), h('b', {}, String(list.filter((r) => r.state === 'transferred').length)))),
        h('div', { class: 'toolbar', style: { margin: '0 0 10px' } },
          h('button', { class: 'btn', onclick: () => { appr.forEach((r) => chosen.add(r.id)); load(); } }, 'اختيار الكل'),
          h('button', { class: 'btn primary', onclick: () => { const s = sel(); if (!s.length) return toast('اختر طلبًا واحدًا على الأقل', 'bad');
            if (new Set(s.map((r) => r.company_id)).size > 1) return toast('كشف التحويل لشركة واحدة — اختر طلبات شركة واحدة', 'bad'); printTransfers(s); } }, 'كشف تحويل للبنك (PDF)'),
          isAcc(2) ? h('button', { class: 'btn', onclick: () => { const s = sel(); if (!s.length) return toast('اختر طلبًا واحدًا على الأقل', 'bad'); markTransferred(s, load); } }, 'تم التحويل') : null,
          info),
        table(list, { onOpen: (r) => openRequest(r.id, load), select: box }),
      ];
    },
  });
}

async function markTransferred(rows, done) {
  const m = modal({ title: `تم التحويل — ${rows.length} طلب`, size: 'narrow' });
  const d = h('input', { class: 'input', type: 'date', value: today(), max: today() });
  const ref = h('input', { class: 'input ltr', placeholder: 'رقم الحوالة أو المرجع (اختياري)' });
  m.body.append(h('p', { class: 'help', style: { marginTop: 0 } }, 'يُعلَّم الطلب «حُوِّل» حتى تسجّل قيد السداد أو تربطه. إذا مرّت 3 أيام بلا قيد يظهر تنبيه في فحص سلامة البيانات.'),
    h('div', { class: 'field' }, h('label', {}, 'تاريخ التحويل'), d), h('div', { class: 'field' }, h('label', {}, 'المرجع'), ref));
  m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
    if (await run(() => rpc('mark_payment_transferred', { p_ids: rows.map((r) => r.id), p_date: d.value, p_ref: ref.value }, 'accounting'), 'تم')) { m.close(); done(); }
  } }, 'حفظ'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

// ---------------------------------------------------------------------
// نموذج الطلب: جديد، أو تعديل بعد الإرجاع
// ---------------------------------------------------------------------
async function requestForm(r, done) {
  const m = modal({ title: r ? `تعديل الطلب ${r.request_no}` : 'طلب تحويل جديد', size: 'wide' });
  const companies = state.companies();
  const coSel = h('select', { class: 'input', disabled: !!r }, companies.map((c) => h('option', { value: c.id, selected: (r?.company_id || ids()[0]) === c.id }, c.name)));
  const kind = h('select', { class: 'input' }, Object.entries(KINDS).map(([k, t]) => h('option', { value: k, selected: (r?.kind || 'invoice') === k }, t)));
  const ptype = h('select', { class: 'input' },
    [['party', 'مورد / مقاول مسجّل'], ['employee', 'موظف'], ['other', 'مستفيد آخر (بالاسم والآيبان)']].map(([k, t]) => h('option', { value: k, selected: (r?.payee_type || 'party') === k }, t)));
  const pname = h('input', { class: 'input', value: r?.payee_type === 'other' ? r.payee_name : '', placeholder: 'اسم المستفيد كما في البنك' });
  const bank = h('input', { class: 'input', value: r?.payee_bank || '', placeholder: 'من كارت المستفيد' });
  const iban = h('input', { class: 'input ltr', value: r?.payee_iban || '', placeholder: 'SA…' });
  const invSel = h('select', { class: 'input' });
  const basis = h('select', { class: 'input' });
  const invNo = h('input', { class: 'input ltr', value: r?.basis === 'pending_invoice' ? r.invoice_no || '' : '', placeholder: 'رقم فاتورة المورد' });
  const quoteNo = h('input', { class: 'input ltr', value: r?.quote_no || '', placeholder: 'رقم عرض السعر' });
  const docVal = h('input', { class: 'input', type: 'number', step: '0.01', min: 0, value: r?.doc_value ?? '' });
  const invHelp = h('div', { class: 'help' });
  const amount = h('input', { class: 'input', type: 'number', step: '0.01', min: 0, value: r?.amount ?? '' });
  const due = h('input', { class: 'input', type: 'date', value: r?.due_date || today() });
  const prio = h('select', { class: 'input' }, h('option', { value: 'normal' }, 'عادي'), h('option', { value: 'urgent', selected: r?.priority === 'urgent' }, 'عاجل'));
  const desc = h('textarea', { class: 'input', rows: 3, placeholder: 'ماذا سيُدفع ولماذا الآن' }, r?.description || '');
  const note = h('input', { class: 'input', placeholder: 'ماذا عدّلت (يظهر في خط السير)' });
  const files = h('input', { type: 'file', class: 'input', multiple: true, accept: 'image/jpeg,image/png,image/webp,application/pdf' });
  const slot = { payee: h('div'), project: h('div'), cc: h('div'), eq: h('div') };
  const err = h('p', { class: 'notice bad', style: { display: 'none' } });
  let fd = null; let pk = {}; let invoices = [];

  const F = (label, input, o = {}) => h('div', { class: 'field' + (o.wide ? ' wide' : ''), style: o.hide ? { display: 'none' } : {} },
    h('label', {}, label, o.req ? h('span', { class: 'req' }, '*') : ''), input, o.help ? h('div', { class: 'help' }, o.help) : null);
  const fPayee = F('المستفيد', slot.payee, { req: true });
  const fName = F('اسم المستفيد', pname, { req: true });
  const fInv = F('الفاتورة', invSel, { req: true });
  fInv.append(invHelp);
  const fBasis = F('أساس التحويل', basis, { help: 'رقم الفاتورة ليس إلزاميًا — التحويل قد يسبق الفاتورة' });
  const fInvNo = F('رقم الفاتورة', invNo, { req: true });
  const fQuote = F('رقم عرض السعر', quoteNo, { req: true });
  const fVal = F('القيمة', docVal, { req: true, help: 'قيمة الفاتورة أو العرض كاملة — مجموع الطلبات عليها لا يتجاوزها' });
  const opt = (x) => ({ id: x.id, code: x.code || '', name: x.name, label: `${x.code ? x.code + ' — ' : ''}${x.name}`, row: x });
  const mk = (list, value, ph, onChange) => combo({ options: list.map(opt), listKey: 'pr-' + ph, value, placeholder: ph, onChange });

  async function loadCompany() {
    try { fd = await rpc('pr_form_data', { p_company: coSel.value }, 'accounting'); } catch (e) { err.textContent = e.message; err.style.display = ''; return; }
    pk.project = mk(fd.projects, r?.project_id || null, 'بدون مشروع');
    pk.cc = mk(fd.cost_centers, r?.cost_center_id || null, 'بدون مركز');
    pk.eq = mk(fd.equipment, r?.equipment_id || null, 'بدون معدة');
    slot.project.replaceChildren(pk.project.el); slot.cc.replaceChildren(pk.cc.el); slot.eq.replaceChildren(pk.eq.el);
    drawPayee();
  }
  function drawPayee() {
    const t = ptype.value;
    const cur0 = basis.value || r?.basis || (t === 'party' ? 'invoice' : 'none');
    put(basis, Object.entries(BASES).filter(([k]) => k !== 'invoice' || t === 'party').map(([k, x]) => h('option', { value: k, selected: k === (cur0 === 'invoice' && t !== 'party' ? 'none' : cur0) }, x)));
    fPayee.style.display = t === 'other' ? 'none' : '';
    fName.style.display = t === 'other' ? '' : 'none';
    showBasis();
    if (t === 'other') { invSel.replaceChildren(); return; }
    const list = t === 'party' ? fd.parties : fd.employees;
    const cur = t === 'party' ? r?.party_id : r?.employee_id;
    pk.payee = mk(list, r?.payee_type === t ? cur : null, t === 'party' ? 'اختر المورد' : 'اختر الموظف', (o) => {
      const x = o?.row;
      bank.value = x?.bank_name || ''; iban.value = x?.iban || '';
      loadInvoices();
    });
    slot.payee.replaceChildren(pk.payee.el);
    loadInvoices();
  }
  async function loadInvoices() {
    invSel.replaceChildren(); invHelp.textContent = ''; invoices = [];
    if (basis.value !== 'invoice' || ptype.value !== 'party' || !pk.payee?.id) return;
    const { data, error } = await acc.rpc('pr_open_invoices', { p_company: coSel.value, p_party: pk.payee.id, p_exclude: r?.id || null });
    if (error) { invHelp.textContent = error.message; return; }
    invoices = data || [];
    put(invSel, h('option', { value: '' }, invoices.length ? '— اختر الفاتورة —' : 'لا توجد فواتير مفتوحة لهذا المورد'),
      invoices.map((x) => h('option', { value: x.invoice_no, selected: x.invoice_no === r?.invoice_no },
        `${x.invoice_no} — ${fmt.date(x.invoice_date)} — الباقي ${num(x.remaining)}` + (Number(x.reserved) ? ` (منها ${num(x.reserved)} في طلب آخر)` : ''))));
    showInv();
  }
  function showInv() {
    const x = invoices.find((i) => i.invoice_no === invSel.value);
    invHelp.textContent = x ? `قيمة الفاتورة ${num(x.amount)} — الباقي ${num(x.remaining)}${x.due_date ? ' — تستحق ' + fmt.date(x.due_date) : ''}` : '';
    if (x && !amount.value) amount.value = Number(x.remaining) - Number(x.reserved || 0) > 0 ? Number(x.remaining) - Number(x.reserved || 0) : '';
  }
  function showBasis() {
    const b = basis.value;
    fInv.style.display = b === 'invoice' ? '' : 'none';
    fInvNo.style.display = b === 'pending_invoice' ? '' : 'none';
    fQuote.style.display = b === 'quote' ? '' : 'none';
    fVal.style.display = b === 'pending_invoice' || b === 'quote' ? '' : 'none';
  }
  basis.onchange = () => { showBasis(); loadInvoices(); };
  invSel.onchange = showInv;
  ptype.onchange = drawPayee; coSel.onchange = loadCompany;

  put(m.body,
    r?.last_note ? h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, h('b', {}, 'المطلوب تعديله: '), r.last_note) : null,
    h('div', { class: 'form-grid' },
      F('الشركة التي ستدفع', coSel, { req: true }), F('نوع الطلب', kind, { req: true }),
      F('المستفيد من', ptype), fPayee, fName, fBasis, fInv, fInvNo, fQuote, fVal,
      F('المبلغ', amount, { req: true }), F('آخر موعد للتحويل', due, { req: true }), F('الأولوية', prio),
      F('البنك', bank), F('الآيبان', iban, { help: 'يُسحب من كارت المستفيد، ويمكن كتابة حساب آخر لهذا الطلب' }),
      F('المشروع', slot.project), F('مركز التكلفة', slot.cc), F('المعدة', slot.eq),
      F('البيان والمبرر', desc, { req: true, wide: true }),
      r ? F('ملاحظة التعديل', note, { wide: true }) : null,
      F('المرفقات (اختيارية)', files, { wide: true, help: 'صورة الفاتورة أو عرض السعر أو أمر الشراء — صور أو PDF حتى 15 ميجا' })),
    err);
  await loadCompany();

  const payload = (confirm) => ({
    id: r?.id || null, company_id: coSel.value, kind: kind.value, payee_type: ptype.value,
    party_id: ptype.value === 'party' ? pk.payee?.id || null : null, employee_id: ptype.value === 'employee' ? pk.payee?.id || null : null,
    payee_name: ptype.value === 'other' ? pname.value : null, payee_bank: bank.value, payee_iban: iban.value,
    basis: basis.value, invoice_no: basis.value === 'invoice' ? invSel.value || null : basis.value === 'pending_invoice' ? invNo.value : null,
    quote_no: basis.value === 'quote' ? quoteNo.value : null, doc_value: ['quote', 'pending_invoice'].includes(basis.value) && docVal.value !== '' ? Number(docVal.value) : null, amount: amount.value === '' ? null : Number(amount.value), due_date: due.value || null,
    priority: prio.value, project_id: pk.project?.id || null, cost_center_id: pk.cc?.id || null, equipment_id: pk.eq?.id || null,
    description: desc.value, resubmit_note: note.value, confirm_duplicate: confirm,
  });
  const send = async (confirm = false) => {
    err.style.display = 'none'; btn.disabled = true;
    try {
      const res = await rpc('submit_payment_request', { p: payload(confirm) }, 'accounting');
      if (files.files.length) await uploadFiles(res.id, coSel.value, files.files);
      toast(`${r ? 'أُعيد تقديم' : 'قُدِّم'} الطلب ${res.request_no}`, 'ok');
      m.close(); done?.();
    } catch (e) {
      if (/^تحذير تكرار/.test(e.message) && await confirmDialog(e.message.replace(/ ثم أرسل مرة أخرى$/, '') + ' — هل تريد إرساله؟', { ok: 'نعم، أرسله' })) { btn.disabled = false; return send(true); }
      err.textContent = e.message; err.style.display = '';
    } finally { btn.disabled = false; }
  };
  const btn = h('button', { class: 'btn primary', onclick: () => send() }, r ? 'إعادة التقديم' : 'تقديم الطلب');
  m.foot.append(btn, h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

// المرفقات: تُرفع إلى التخزين الخاص ثم يُسجَّل سجل المرفق (صلاحياته من الشركة)
async function uploadFiles(reqId, company, list) {
  for (const f of list) {
    if (f.size > 15 * 1024 * 1024) { toast(`${f.name}: أكبر من 15 ميجا`, 'bad'); continue; }
    const path = `${company}/payment_requests/${reqId}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-؀-ۿ]+/g, '_')}`;
    try {
      const { error } = await sb.storage.from('attachments').upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw error;
      const { error: e2 } = await sb.schema('core').from('attachments').insert({ path, file_name: f.name, mime_type: f.type, size_bytes: f.size,
        subject_table: 'accounting.payment_requests', subject_id: reqId, company_id: company });
      if (e2) throw e2;
    } catch (e) { toast(`تعذّر رفع ${f.name}: ${e.message || e}`, 'bad'); }
  }
}

// ---------------------------------------------------------------------
// تفاصيل الطلب: البيانات، وخط السير، والمرفقات، والإجراءات المتاحة
// ---------------------------------------------------------------------
export async function openRequest(id, done) {
  const m = modal({ title: 'طلب تحويل', size: 'wide' });
  m.body.append(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  const [{ data: r, error }, { data: ev }, { data: att }] = await Promise.all([
    acc.from('v_payment_requests').select('*').eq('id', id).single(),
    acc.from('v_payment_request_events').select('*').eq('request_id', id).order('created_at'),
    sb.schema('core').from('attachments').select('id, path, file_name, created_at').eq('subject_table', 'accounting.payment_requests').eq('subject_id', id).eq('status', 'active'),
  ]);
  if (error) { m.body.replaceChildren(h('div', { class: 'notice bad' }, error.message)); return; }
  m.el.querySelector('h2').textContent = `طلب تحويل ${r.request_no} — ${r.company_name}`;
  const reload = () => { m.close(); done?.(); openRequest(id, done); };
  const A = r.my_actions || [];
  const row = (k, v) => (v ? h('tr', {}, h('th', {}, k), h('td', {}, v)) : null);

  // خط السير: كل حدث، ثم الخطوة الحالية بانتظار من
  const steps = (ev || []).map((e) => h('li', { class: 'pr-step ' + (['reject', 'hold', 'return', 'auto_unlink'].includes(e.action) ? 'bad' : e.action === 'link' || e.action === 'approve' ? 'ok' : '') },
    h('div', {}, h('b', {}, e.user_name || 'النظام'), ' ', EVENTS[e.action] || e.action,
      e.level ? h('span', { class: 'help' }, ['submit', 'resubmit'].includes(e.action) ? ` ← إلى ${LEVEL[e.level]}` : ` (${LEVEL[e.level]})`) : null),
    h('div', { class: 'help' }, fmt.datetime(e.created_at)), e.note ? h('div', { class: 'pr-note' }, e.note) : null));
  if (r.state === 'pending') steps.push(h('li', { class: 'pr-step now' }, h('b', {}, whereNow(r))));
  else if (!['paid', 'rejected', 'withdrawn'].includes(r.state)) steps.push(h('li', { class: 'pr-step now' }, h('b', {}, whereNow(r))));

  put(m.body,
    h('div', { class: 'notice', style: { marginBottom: '12px' } }, badge(r.state), ' ', whereNow(r),
      r.priority === 'urgent' ? h('span', { class: 'badge bad', style: { marginInlineStart: '8px' } }, 'عاجل') : null,
      overdue(r) ? h('span', { class: 'badge bad', style: { marginInlineStart: '8px' } }, 'تجاوز آخر موعد') : null),
    r.last_note && ['returned', 'rejected', 'on_hold', 'withdrawn'].includes(r.state) ? h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, h('b', {}, 'الملاحظة: '), r.last_note) : null,
    h('div', { class: 'pr-detail' },
      h('table', { class: 'grid report pr-info' }, h('tbody', {},
        row('المستفيد', r.payee_name), row('البنك', r.payee_bank), row('الآيبان', r.payee_iban ? h('span', { class: 'ltr' }, r.payee_iban) : null),
        row('النوع', KINDS[r.kind]),
        row('الأساس', BASES[r.basis] + (r.basis === 'invoice' ? ` ${r.invoice_no} — الباقي وقت الطلب ${num(r.invoice_remaining)}`
          : r.basis === 'pending_invoice' ? ` ${r.invoice_no} — قيمتها ${num(r.doc_value)}` : r.basis === 'quote' ? ` ${r.quote_no} — قيمته ${num(r.doc_value)}` : '')),
        row('المبلغ', h('b', {}, num(r.amount))), row('آخر موعد', fmt.date(r.due_date)),
        row('المشروع', r.project_code ? `${r.project_code} — ${r.project_name}` : null), row('مركز التكلفة', r.cost_center_name), row('المعدة', r.equipment_name),
        row('البيان', h('div', { class: 'wrap' }, r.description)), row('مقدّم الطلب', `${r.requester_name} — ${fmt.date(r.request_date)}` + (r.submit_round > 1 ? ` (قُدّم ${r.submit_round} مرات)` : '')),
        row('الحوالة', r.transfer_date ? `${fmt.date(r.transfer_date)}${r.transfer_ref ? ' — ' + r.transfer_ref : ''}` : null),
        row('قيد السداد', r.entry_ref ? `${r.entry_ref} — ${fmt.date(r.entry_date)}` : null))),
      h('div', {}, h('div', { class: 'section-title', style: { marginTop: 0 } }, 'خط السير'), h('ol', { class: 'pr-timeline' }, steps),
        h('div', { class: 'section-title' }, 'المرفقات'),
        (att || []).length ? h('ul', { class: 'pr-files' }, att.map((a) => h('li', {}, h('a', { href: 'javascript:void 0', onclick: () => openFile(a.path) }, '📎 ', a.file_name)))) : h('div', { class: 'help' }, 'لا توجد مرفقات'),
        r.requester_id === state.profile.id || isAcc(2) ? (() => {
          const f = h('input', { type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/webp,application/pdf', style: { marginTop: '6px' } });
          f.onchange = async () => { await uploadFiles(r.id, r.company_id, f.files); reload(); };
          return f;
        })() : null)));

  const B = (label, cls, fn) => h('button', { class: 'btn ' + cls, onclick: fn }, label);
  const act = (fnName, args, ok) => async () => { if (await run(() => rpc(fnName, args, 'accounting'), ok)) reload(); };
  const withNote = (title, okText, fnName, mk, required = true) => async () => {
    const note = required ? await askReason(title, { ok: okText }) : await optionalNote(title, okText);
    if (note === null) return;
    if (await run(() => rpc(fnName, mk(note), 'accounting'), 'تم')) reload();
  };
  if (A.includes('approve')) m.foot.append(B(r.level === 1 ? 'موافقة' : 'موافقة (المدير العام)', 'primary', withNote('موافقة على الطلب', 'موافقة', 'decide_payment_request', (n) => ({ p_id: r.id, p_action: 'approve', p_note: n }), false)));
  if (A.includes('return')) m.foot.append(B('إرجاع للتعديل', '', withNote('المطلوب تعديله', 'إرجاع', 'decide_payment_request', (n) => ({ p_id: r.id, p_action: 'return', p_note: n }))));
  if (A.includes('reject') && r.state === 'pending') m.foot.append(B('رفض', 'danger', withNote('سبب الرفض', 'رفض', 'decide_payment_request', (n) => ({ p_id: r.id, p_action: 'reject', p_note: n }))));
  if (A.includes('hold')) m.foot.append(B('إيقاف قبل السداد', 'danger', withNote('سبب الإيقاف', 'إيقاف', 'hold_payment_request', (n) => ({ p_id: r.id, p_action: 'hold', p_note: n }))));
  if (A.includes('release')) m.foot.append(B('إطلاق الطلب', 'primary', withNote('إطلاق الطلب للسداد', 'إطلاق', 'hold_payment_request', (n) => ({ p_id: r.id, p_action: 'release', p_note: n }), false)));
  if (A.includes('reject') && r.state === 'on_hold') m.foot.append(B('رفض', 'danger', withNote('سبب الرفض', 'رفض', 'hold_payment_request', (n) => ({ p_id: r.id, p_action: 'reject', p_note: n }))));
  if (A.includes('edit')) m.foot.append(B('تعديل وإعادة التقديم', 'primary', () => { m.close(); requestForm(r, done); }));
  if (A.includes('withdraw')) m.foot.append(B('سحب الطلب', '', withNote('سبب سحب الطلب', 'سحب', 'withdraw_payment_request', (n) => ({ p_id: r.id, p_reason: n }))));
  if (A.includes('pay')) m.foot.append(B('سجّل قيد السداد', 'primary', () => payEntry(r, reload)));
  if (A.includes('link')) m.foot.append(B('اربط بقيد', '', () => linkEntry(r, reload)));
  if (A.includes('transfer')) m.foot.append(B('تم التحويل', '', () => { m.close(); markTransferred([r], () => { done?.(); openRequest(id, done); }); }));
  if (A.includes('unlink')) m.foot.append(B('فك ربط القيد', 'ghost', withNote('سبب فك الربط', 'فك الربط', 'unlink_payment_entry', (n) => ({ p_id: r.id, p_reason: n }))));
  if (['approved', 'transferred', 'paid'].includes(r.state)) m.foot.append(B('كشف التحويل (PDF)', 'ghost', () => printTransfers([r])));
  m.foot.append(h('span', { class: 'spacer' }), B('إغلاق', '', m.close));
}

function optionalNote(title, ok) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title, size: 'narrow', onClose: () => { if (!done) resolve(null); } });
    const ta = h('textarea', { class: 'input', placeholder: 'ملاحظة (اختيارية)' });
    m.body.append(ta);
    m.foot.append(h('button', { class: 'btn primary', onclick: () => { done = true; m.close(); resolve(ta.value.trim()); } }, ok), h('button', { class: 'btn', onclick: () => m.close() }, 'رجوع'));
    setTimeout(() => ta.focus(), 30);
  });
}

async function openFile(path) {
  const { data, error } = await sb.storage.from('attachments').createSignedUrl(path, 300);
  if (error) { toast(error.message, 'bad'); return; }
  window.open(data.signedUrl, '_blank', 'noopener');
}

// ---------------------------------------------------------------------
// قيد السداد: نموذج معبّأ من الطلب يراجعه المحاسب ويحفظه بنفسه، ثم يُربط بالطلب
// ---------------------------------------------------------------------
async function payEntry(r, done) {
  const [{ loadLookups }, { createEditor, emptyLine }] = await Promise.all([import('../accounting/lookups.js'), import('../accounting/editor.js')]);
  const lk = await loadLookups(r.company_id, { force: true });
  const amt = String(Number(r.amount));
  const desc = `سداد ${r.request_no} — ${r.payee_name}` + (docText(r) ? ` — ${docText(r)}` : '');
  const payee = { ...emptyLine(), account_id: r.invoice_account_id || null, debit: amt, party_id: r.party_id, employee_id: r.employee_id,
    invoice_no: r.basis === 'invoice' ? r.invoice_no || '' : '', project_id: r.project_id, cost_center_id: r.cost_center_id, equipment_id: r.equipment_id, description: r.description.slice(0, 200) };
  const bankLine = { ...emptyLine(), credit: amt, description: r.payee_iban ? `تحويل إلى ${r.payee_iban}` : '' };
  const entry = { entry_date: r.transfer_date || today(), description: desc, entry_type: 'regular', lines: [payee, bankLine] };
  const m = modal({ title: `قيد سداد الطلب ${r.request_no}`, size: 'full' });
  const editor = createEditor({ lk, company: r.company_id, entries: [entry], single: true });
  m.body.append(h('p', { class: 'notice', style: { marginBottom: '10px' } },
    `النموذج معبّأ من الطلب: ${r.payee_name} بمبلغ ${num(r.amount)}${r.invoice_account_id ? '' : ' — اختر حساب المستفيد'}. اختر حساب البنك المدفوع منه وراجع القيد ثم احفظ، فيُربط بالطلب ويصبح «مدفوعًا».`), editor.el);
  const save = h('button', { class: 'btn primary', onclick: async () => {
    document.activeElement?.blur(); await new Promise((x) => setTimeout(x, 20));
    let c; try { c = editor.collect(); } catch (err) { editor.showError(err.message, err.at); toast(err.message, 'bad'); return; }
    save.disabled = true;
    let res;
    try { res = await rpc('post_batch', { p_company: r.company_id, p_entries: c.payload }, 'accounting'); }
    catch (err) { editor.showServerError(err.message, c.clean); toast(err.message, 'bad'); save.disabled = false; return; }
    const e = res.entries[0];
    const ok = await run(() => rpc('link_payment_entry', { p_id: r.id, p_entry: e.id }, 'accounting'));
    toast(ok ? `سُجّل القيد ${res.fiscal_year}-${e.entry_no} وأصبح الطلب مدفوعًا` : `سُجّل القيد ${res.fiscal_year}-${e.entry_no} لكن لم يُربط — اربطه من الطلب`, ok ? 'ok' : 'bad');
    m.close(); done();
  } }, 'حفظ القيد وربطه');
  m.foot.append(save, h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

// ربط الطلب بقيد موجود: مقترحات بنفس المستفيد والمبلغ، أو برقم القيد
async function linkEntry(r, done) {
  const m = modal({ title: `ربط الطلب ${r.request_no} بقيد`, size: 'wide' });
  const refIn = h('input', { class: 'input ltr', placeholder: `${new Date().getFullYear()}-125`, style: { width: '160px' } });
  const list = h('div', {}, h('div', { class: 'empty' }, 'جارٍ البحث…'));
  const link = async (entryId) => { if (await run(() => rpc('link_payment_entry', { p_id: r.id, p_entry: entryId }, 'accounting'), 'رُبط القيد وأصبح الطلب مدفوعًا')) { m.close(); done(); } };
  m.body.append(h('p', { class: 'help', style: { marginTop: 0 } }, `القيد يجب أن يكون فيه مدين ${r.payee_name} بمبلغ ${num(r.amount)} بالضبط${r.payee_type === 'other' ? ' (أو مدفوع من البنك/الصندوق بالمبلغ نفسه)' : ''}، وألا يكون مربوطًا بطلب آخر.`),
    h('div', { class: 'toolbar', style: { marginBottom: '10px' } }, h('label', {}, 'رقم القيد (السنة-الرقم)'), refIn,
      h('button', { class: 'btn primary', onclick: async () => {
        const [y, n] = refIn.value.trim().split('-').map(Number);
        if (!y || !n) return toast('اكتب رقم القيد مثل 2026-125', 'bad');
        const { data } = await acc.from('journal_entries').select('id').eq('company_id', r.company_id).eq('fiscal_year', y).eq('entry_no', n).maybeSingle();
        if (!data) return toast('القيد غير موجود في هذه الشركة', 'bad');
        link(data.id);
      } }, 'ربط')),
    h('div', { class: 'section-title' }, 'قيود مقترحة'), list);
  m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
  const { data, error } = await acc.rpc('pr_suggest_entries', { p_id: r.id });
  if (error) { list.replaceChildren(h('div', { class: 'notice bad' }, error.message)); return; }
  list.replaceChildren((data || []).length ? h('table', { class: 'grid report' },
    h('thead', {}, h('tr', {}, ['القيد', 'التاريخ', 'البيان', 'مبلغ المستفيد', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, data.map((e) => h('tr', {}, h('td', { class: 'ltr' }, e.entry_ref), h('td', {}, fmt.date(e.entry_date)), h('td', { class: 'wrap' }, e.description),
      h('td', { class: 'num' }, num(e.amount), e.exact ? ' ✓' : ''), h('td', {}, e.exact ? h('button', { class: 'btn sm primary', onclick: () => link(e.entry_id) }, 'ربط') : h('span', { class: 'help' }, 'المبلغ مختلف'))))))
    : h('div', { class: 'help' }, r.payee_type === 'other' ? 'المستفيد غير مسجّل — اربط برقم القيد' : 'لا توجد قيود حديثة بنفس المستفيد — سجّل قيد السداد أو اكتب رقم القيد'));
}

// ---------------------------------------------------------------------
// كشف التحويل للبنك (PDF): الشركة، والتاريخ، والمستفيدون بالبنك والآيبان والمبلغ والغرض، والإجمالي، وخانة المفوض بالتوقيع
// ---------------------------------------------------------------------
export async function printTransfers(rows) {
  const [{ amountInWords }] = await Promise.all([import('../accounting/print.js'), refreshCompanies()]);
  const company = rows[0].company_id;
  const { data: lh } = await sb.schema('core').from('company_letterheads').select('*').eq('company_id', company).eq('status', 'active').maybeSingle();
  const co = companyInfo(company) || {};
  const hasLh = !!lh?.image;
  const top = hasLh ? Number(lh.top_mm) : 12, bottom = hasLh ? Number(lh.bottom_mm) : 12, side = hasLh ? Number(lh.side_mm) : 14;
  document.getElementById('print-area')?.remove(); document.getElementById('print-page')?.remove();
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const d = new Date();
  const purpose = (r) => [KINDS[r.kind], docText(r).replace(' (لم تُسجَّل)', ''), r.project_code && 'مشروع ' + r.project_code].filter(Boolean).join(' — ') + ` (${r.request_no})`;
  const content = h('div', { class: 'qt-body' },
    hasLh ? null : h('div', { class: 'qt-plainhead' }, brand.logo ? h('img', { class: 'rp-logo', src: brand.logo, alt: '' }) : null,
      h('div', {}, h('div', { class: 'rp-co' }, co.name || ''), h('div', { class: 'rp-meta' },
        [co.cr_number && 'س.ت: ' + co.cr_number, co.vat_number && 'الرقم الضريبي: ' + co.vat_number, co.address, co.phone && 'هاتف: ' + co.phone].filter(Boolean).join(' — ')))),
    h('div', { class: 'qt-title' }, rows.length > 1 ? 'كشف تحويلات بنكية' : 'طلب تحويل بنكي'),
    h('div', { class: 'qt-top' },
      h('div', { class: 'qt-to' }, h('div', {}, 'السادة / بنك ', h('span', { class: 'pr-blank' }), ' المحترمين'),
        h('div', {}, 'نرجو تحويل المبالغ التالية من حسابنا رقم ', h('span', { class: 'pr-blank wide' }), ' حسب البيان أدناه:')),
      h('table', { class: 'qt-meta' }, h('tbody', {},
        h('tr', {}, h('th', {}, 'الشركة'), h('td', {}, co.name || rows[0].company_name)),
        h('tr', {}, h('th', {}, 'التاريخ'), h('td', {}, today() + (brand.hijri ? ` — ${hijri(d)}` : ''))),
        h('tr', {}, h('th', {}, 'عدد التحويلات'), h('td', {}, String(rows.length)))))),
    h('table', { class: 'qt-items pr-bank' },
      h('thead', {}, h('tr', {}, ['م', 'المستفيد', 'البنك', 'الآيبان', 'المبلغ', 'الغرض / رقم الفاتورة'].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r, i) => h('tr', {}, h('td', { class: 'c' }, String(i + 1)), h('td', {}, r.payee_name), h('td', {}, r.payee_bank || ''),
        h('td', { class: 'ltr c' }, (r.payee_iban || '').replace(/(.{4})/g, '$1 ').trim()), h('td', { class: 'n' }, num(r.amount)), h('td', { class: 'desc' }, purpose(r))))),
      h('tfoot', {}, h('tr', { class: 'grand' }, h('td', { colspan: 4 }, 'الإجمالي'), h('td', { class: 'n' }, num(total)), h('td', {})))),
    h('div', { class: 'qt-words' }, h('b', {}, 'المبلغ كتابةً: '), amountInWords(total)),
    h('div', { class: 'pr-signs' },
      h('div', { class: 'pr-sign' }, h('div', {}, 'المفوض بالتوقيع'), h('div', { class: 'qt-line' }, 'الاسم والتوقيع')),
      h('div', { class: 'pr-sign' }, h('div', {}, 'المفوض بالتوقيع'), h('div', { class: 'qt-line' }, 'الاسم والتوقيع')),
      h('div', { class: 'pr-sign' }, h('div', {}, 'الختم'), h('div', { class: 'qt-line' }, ''))));
  const area = h('div', { id: 'print-area', class: 'qt' }, hasLh ? h('img', { class: 'qt-bg', src: lh.image, alt: '' }) : null,
    h('table', { class: 'qt-frame' },
      h('thead', {}, h('tr', {}, h('td', { style: { height: top + 'mm' } }))), h('tfoot', {}, h('tr', {}, h('td', { style: { height: bottom + 'mm' } }))),
      h('tbody', {}, h('tr', {}, h('td', { style: { padding: `0 ${side}mm` } }, content)))));
  const page = h('style', { id: 'print-page' }, '@media print { @page { size: A4 portrait; margin: 0; } }');
  document.head.append(page); document.body.append(area);
  const oldTitle = document.title;
  document.title = `تحويلات ${co.name || ''} ${today()}`.replace(/[\\/:*?"<>|]/g, '-');
  document.body.classList.add('printing');
  const fin = () => { document.body.classList.remove('printing'); area.remove(); page.remove(); document.title = oldTitle; window.removeEventListener('afterprint', fin); };
  window.addEventListener('afterprint', fin);
  setTimeout(() => window.print(), 50);
}

// ---------------------------------------------------------------------
// بطاقة لوحة التحكم: ما ينتظرك
// ---------------------------------------------------------------------
async function widget(el) {
  const rows = await loadRows((q) => q.in('state', ['pending', 'approved', 'transferred'])).catch(() => []);
  const mine = rows.filter((r) => (r.my_actions || []).includes('approve'));
  const pay = rows.filter((r) => ['approved', 'transferred'].includes(r.state) && (r.my_actions || []).includes('link'));
  el.replaceChildren(h('div', { class: 'kpis' },
    isApprover() ? h('a', { class: 'kpi main', href: '#/payments/approvals' }, h('small', {}, 'بانتظار موافقتك'), h('b', {}, String(mine.length))) : null,
    isAcc(2) ? h('a', { class: 'kpi', href: '#/payments/pay' }, h('small', {}, 'جاهزة للسداد'), h('b', {}, String(pay.length)),
      h('span', {}, num(pay.reduce((s, r) => s + Number(r.amount), 0)))) : null));
}

export default {
  code: 'payments',
  title: 'طلبات التحويل',
  tabs: [
    { path: 'mine', title: 'طلباتي', visible: canRequest, subtitle: 'طلب تحويل لمورد أو موظف أو أي مستفيد، يمر بموافقة مدير المشروع أو المدير العام قبل أن يصل للمحاسبة', render: renderMine },
    { path: 'approvals', title: 'بانتظار موافقتي', visible: isApprover, subtitle: 'وافق أو أرجع للتعديل أو ارفض — ولا تظهر هنا طلباتك أنت', render: renderApprovals },
    { path: 'pay', title: 'جاهزة للسداد', group: 'المحاسبة', visible: () => isAcc(1), wide: true, subtitle: 'المعتمدة حسب آخر موعد: كشف تحويل للبنك، ثم قيد السداد أو ربطه بقيد', render: renderPay },
    { path: 'all', title: 'كل الطلبات', group: 'المحاسبة', visible: () => isAcc(1), wide: true, subtitle: 'كل طلب من لحظة تقديمه: أين هو الآن وبانتظار من', render: renderAll },
  ],
  widgets: [{ id: 'payments', title: 'طلبات التحويل', size: 'sm', visible: () => isApprover() || isAcc(2), render: widget }],
};

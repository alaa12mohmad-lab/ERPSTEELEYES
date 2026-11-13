// قسم العهد: العهدة تُفتح من المحاسبة (نقدًا من الصندوق أو من طلب تحويل مدفوع) وتُربط بمستخدم فتظهر في حسابه.
//   المصروفات يُدخلها حامل العهدة أو أي مستخدم مسموح له ← المدير العام يعتمد ← المحاسبة تعتمد وترحّل القيد.
//   كل سطر: من عهدة أي شركة دُفع، وعلى أي شركة المصروف، ونوع المستند (قواعد القبول من الإعدادات لكل شركة).
// للتعديل لاحقًا: الأنواع والحالات في الثوابت أدناه، والقواعد في قاعدة البيانات (022) والإعدادات — لا منطق اعتماد في الواجهة.
import { acc, core, rpc, sb, updateRow } from '../../shared/sb.js';
import { h, fmt, modal, toast, confirmDialog, askReason } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { combo } from '../../shared/combo.js';

export const DOCS = { tax: 'فاتورة ضريبية', simplified: 'فاتورة مبسطة', receipt: 'إيصال دفع', none: 'بدون مستند' };
const RULES = { accept: 'يُقبل', attach: 'يُقبل بمرفق إجباري', reject: 'لا يُقبل' };
const CROSS = { auto: 'قيدان متقابلان في الشركتين (تلقائي)', warn: 'تنبيه فقط — أسجّل القيود بيدي', block: 'ممنوع' };
const STATES = {
  draft: ['مسودة', ''], returned: ['مُرجَع للتعديل', 'warn'], submitted: ['بانتظار المدير العام', 'warn'],
  gm_approved: ['بانتظار ترحيل المحاسبة', 'warn'], posted: ['مرحَّل', 'ok'], rejected: ['مرفوض — على حامل العهدة', 'bad'],
};
const C = () => state.profile?.custody || {};
const isGm = () => !!state.profile?.payments?.unlimited;
const isAcc = (lvl = 1) => state.can('accounting', lvl);
const ids = () => (state.selectedCompanies.length ? state.selectedCompanies : state.companies().map((c) => c.id));
const num = (v) => fmt.num(v);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const badge = (s) => h('span', { class: 'badge ' + (STATES[s]?.[1] || '') }, STATES[s]?.[0] || s);
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
const run = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok, 'ok'); return r ?? true; } catch (e) { toast(e.message, 'bad'); return null; } };
const opt = (x) => ({ id: x.id, code: x.code || '', name: x.name, label: `${x.code ? x.code + ' — ' : ''}${x.name}`, row: x });
const F = (label, input, o = {}) => h('div', { class: 'field' + (o.wide ? ' wide' : ''), style: o.hide ? { display: 'none' } : {} },
  h('label', {}, label, o.req ? h('span', { class: 'req' }, '*') : ''), input, o.help ? h('div', { class: 'help' }, o.help) : null);
const docLine = (e) => [DOCS[e.doc_type], e.doc_no, e.supplier_name].filter(Boolean).join(' — ');

// جدول يتحول بطاقات على التليفون
function grid(head, rows, empty = 'لا توجد بيانات') {
  const tbl = h('table', { class: 'grid report pr-cards' }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: head.length, class: 'empty' }, empty))));
  tbl.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (!td.classList.contains('empty')) td.dataset.label = head[i] || ''; }));
  return h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, tbl));
}

async function q(view, build) {
  const { data, error } = await build(acc.from(view).select('*'));
  if (error) throw new Error(error.message);
  return data || [];
}

function page(el, { toolbar = [], load, draw }) {
  const out = h('div');
  const bar = h('div', { class: 'toolbar' });
  el.replaceChildren(h('div', { class: 'card', style: { marginBottom: '12px' } }, bar), out);
  let rows = [];
  const refresh = async () => {
    put(out, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    try { rows = await load(); } catch (e) { put(out, h('div', { class: 'notice bad' }, e.message)); return; }
    put(out, draw(rows, refresh));
  };
  put(bar, toolbar.map((b) => b(refresh, () => put(out, draw(rows, refresh)))));
  refresh();
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) refresh(); else off(); });
}

// ---------------------------------------------------------------------
// العهد: قائمة العهد الظاهرة للمستخدم (عهدته، أو كل عهد شركاته لمن يُدخل أو يعتمد أو يحاسب)
// ---------------------------------------------------------------------
function renderList(el) {
  const st = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: 'open' }, 'المفتوحة'), h('option', { value: 'closed' }, 'المقفلة'), h('option', { value: '' }, 'الكل'));
  const search = h('input', { class: 'input', placeholder: 'الرقم أو حامل العهدة', style: { width: '220px' } });
  page(el, {
    toolbar: [
      (refresh, redraw) => { st.onchange = redraw; return st; },
      (refresh, redraw) => { search.oninput = redraw; return search; },
      () => h('div', { class: 'grow' }),
      (refresh) => (state.profile.is_admin ? h('button', { class: 'btn', onclick: () => settingsDialog() }, 'قواعد المستندات') : null),
      (refresh) => (isAcc(2) ? h('button', { class: 'btn primary', onclick: () => openDialog(refresh) }, '＋ عهدة جديدة') : null),
    ],
    load: async () => {
      const [rows, openAll] = await Promise.all([
        q('v_custodies', (x) => x.in('company_id', ids()).order('opened_date', { ascending: false }).limit(1000)),
        q('v_custodies', (x) => x.eq('state', 'open').in('company_id', ids())),
      ]);
      rows.openAll = openAll;
      return rows;
    },
    draw: (rows, refresh) => {
      const nq = search.value.trim().toLowerCase();
      const list = rows.filter((r) => (!st.value || r.state === st.value) && (!nq || [r.custody_no, r.holder_name, r.user_name].some((v) => String(v || '').toLowerCase().includes(nq))));
      const open = rows.openAll || rows.filter((r) => r.state === 'open');
      const multi = ids().length > 1;
      return [
        rows.length >= 1000 ? h('div', { class: 'notice', style: { marginBottom: '10px' } }, 'القائمة تعرض آخر 1,000 عهدة — المؤشرات محسوبة من كل العهد المفتوحة') : null,
        h('div', { class: 'kpis' },
          h('div', { class: 'kpi main' }, h('small', {}, 'عهد مفتوحة'), h('b', {}, String(open.length)), h('span', {}, 'رصيدها ' + num(open.reduce((s, r) => s + Number(r.balance), 0)))),
          h('div', { class: 'kpi warn' }, h('small', {}, 'مصروفات لم تُرحَّل'), h('b', {}, num(open.reduce((s, r) => s + Number(r.pending), 0)))),
          h('div', { class: 'kpi' }, h('small', {}, 'بانتظار المدير العام / المحاسبة'), h('b', {}, `${open.reduce((s, r) => s + r.waiting_gm, 0)} / ${open.reduce((s, r) => s + r.waiting_acc, 0)}`))),
        grid(['الرقم', 'حامل العهدة', 'الغرض', 'المصروف له', 'المرحَّل', 'لم يُرحَّل', 'الرصيد', 'الحالة'], list.map((r) => h('tr', { onclick: () => custodyDialog(r.id, refresh) },
          h('td', {}, h('b', { class: 'ltr' }, r.custody_no), multi ? h('div', { class: 'help' }, r.company_name) : null),
          h('td', {}, r.holder_name, r.user_name && r.user_name !== r.holder_name ? h('div', { class: 'help' }, 'حساب: ' + r.user_name) : null),
          h('td', { class: 'wrap' }, r.purpose, r.project_code ? h('div', { class: 'help' }, r.project_code + ' — ' + r.project_name) : null),
          h('td', { class: 'num' }, num(Number(r.issued) - Number(r.returned))), h('td', { class: 'num' }, num(r.spent)), h('td', { class: 'num' }, num(r.pending)),
          h('td', { class: 'num' }, h('b', {}, num(r.balance))),
          h('td', {}, r.state === 'closed' ? h('span', { class: 'badge' }, 'مقفلة') : r.drafts ? h('span', { class: 'badge warn' }, `${r.drafts} لم يُقدَّم`) : h('span', { class: 'badge ok' }, 'مفتوحة')))), 'لا توجد عهد'),
      ];
    },
  });
}

// ---------------------------------------------------------------------
// بانتظار اعتمادي (المدير العام)
// ---------------------------------------------------------------------
function renderApprovals(el) {
  const chosen = new Set();
  page(el, {
    toolbar: [() => h('strong', {}, 'مصروفات العهد المقدَّمة'), () => h('div', { class: 'grow' })],
    load: () => q('v_custody_expenses', (x) => x.eq('state', 'submitted').in('company_id', ids()).order('expense_date')),
    draw: (rows, refresh) => {
      const mine = rows.filter((r) => (r.my_actions || []).includes('approve'));
      [...chosen].forEach((id) => { if (!mine.some((r) => r.id === id)) chosen.delete(id); });
      const info = h('span', { class: 'help' });
      const upd = () => { const s = mine.filter((r) => chosen.has(r.id)); info.textContent = s.length ? `${s.length} سطر — ${num(s.reduce((x, r) => x + Number(r.amount), 0))}` : ''; };
      upd();
      return [
        h('div', { class: 'toolbar', style: { margin: '0 0 10px' } },
          h('button', { class: 'btn', onclick: () => { mine.forEach((r) => chosen.add(r.id)); refresh(); } }, 'اختيار الكل'),
          h('button', { class: 'btn primary', onclick: async () => {
            if (!chosen.size) return toast('اختر سطرًا واحدًا على الأقل', 'bad');
            if (await run(() => rpc('decide_custody_expenses', { p_ids: [...chosen], p_action: 'approve', p_note: null }, 'accounting'), 'اعتُمدت وذهبت للمحاسبة')) { chosen.clear(); refresh(); }
          } }, 'موافقة على المختار'), info),
        expTable(mine, { onOpen: (r) => expenseView(r, refresh), select: (r) => h('input', { type: 'checkbox', checked: chosen.has(r.id), onchange: (e) => { e.target.checked ? chosen.add(r.id) : chosen.delete(r.id); upd(); } }), showCustody: true }),
      ];
    },
  });
}

// ---------------------------------------------------------------------
// بانتظار الترحيل (المحاسبة): أسطر معتمدة من المدير العام، تُرحَّل عهدة عهدة
// ---------------------------------------------------------------------
function renderPost(el) {
  page(el, {
    toolbar: [() => h('strong', {}, 'معتمدة من المدير العام — بانتظار الترحيل'), () => h('div', { class: 'grow' })],
    load: () => q('v_custody_expenses', (x) => x.eq('state', 'gm_approved').in('company_id', ids()).order('expense_date')),
    draw: (rows, refresh) => {
      const by = new Map();
      rows.forEach((r) => { if (!by.has(r.custody_id)) by.set(r.custody_id, []); by.get(r.custody_id).push(r); });
      if (!by.size) return h('div', { class: 'card' }, h('div', { class: 'empty' }, 'لا توجد أسطر بانتظار الترحيل'));
      return [...by.values()].map((list) => [
        h('div', { class: 'toolbar', style: { margin: '14px 0 8px' } },
          h('strong', {}, `${list[0].custody_no} — ${list[0].holder_name}`), h('span', { class: 'help' }, `${list.length} سطر — ${num(list.reduce((s, r) => s + Number(r.amount), 0))}`),
          h('div', { class: 'grow' }),
          isAcc(2) ? h('button', { class: 'btn primary', onclick: () => postDialog(list, refresh) }, 'مراجعة وترحيل') : null),
        expTable(list, { onOpen: (r) => expenseView(r, refresh) }),
      ]);
    },
  });
}

function expTable(rows, { onOpen, select = null, showCustody = false } = {}) {
  const head = [select ? '' : null, 'التاريخ', showCustody ? 'العهدة' : null, 'البيان', 'المستند', 'على شركة', 'المبلغ', 'الحالة'].filter((x) => x !== null);
  return grid(head, rows.map((r) => h('tr', { onclick: (e) => { if (e.target.type !== 'checkbox') onOpen(r); } },
    select ? h('td', { style: { width: '32px' } }, select(r)) : null,
    h('td', {}, fmt.date(r.expense_date)),
    showCustody ? h('td', {}, h('b', { class: 'ltr' }, r.custody_no), h('div', { class: 'help' }, r.holder_name)) : null,
    h('td', { class: 'wrap' }, r.description, r.project_code ? h('div', { class: 'help' }, r.project_code + ' — ' + r.project_name) : null),
    h('td', { class: 'wrap' }, docLine(r), r.attachments ? h('span', { class: 'help' }, ` 📎${r.attachments}`) : null),
    h('td', {}, r.expense_company_name, r.expense_company_id !== r.company_id ? h('div', {}, h('span', { class: 'badge warn' }, 'من عهدة ' + r.company_name)) : null),
    h('td', { class: 'num' }, h('b', {}, num(r.amount)), Number(r.vat_amount) ? h('div', { class: 'help' }, 'ضريبة ' + num(r.vat_amount)) : null),
    h('td', {}, badge(r.state), r.gm_bypass && r.state === 'gm_approved' ? h('span', { class: 'badge bad', style: { marginInlineStart: '4px' }, title: r.last_note || '' }, 'استثناء بلا مدير عام') : null,
      r.last_note && r.state !== 'posted' ? h('div', { class: 'help wrap' }, r.last_note) : null, r.entry_ref ? h('div', { class: 'help ltr' }, r.entry_ref) : null))), 'لا توجد مصروفات');
}

// ---------------------------------------------------------------------
// تفاصيل العهدة: الرصيد، الحركات النقدية، المصروفات، والإجراءات
// ---------------------------------------------------------------------
async function custodyDialog(id, done) {
  const m = modal({ title: 'عهدة', size: 'wide', onClose: () => done?.() });
  const chosen = new Set();
  async function draw() {
    put(m.body, h('div', { class: 'empty' }, 'جارٍ التحميل…')); m.foot.replaceChildren();
    let c, exp, moves, others;
    try {
      [[c], exp, moves] = await Promise.all([
        q('v_custodies', (x) => x.eq('id', id)),
        q('v_custody_expenses', (x) => x.eq('custody_id', id).order('expense_date', { ascending: false }).order('created_at', { ascending: false })),
        q('v_custody_moves', (x) => x.eq('custody_id', id).order('move_date')),
      ]);
      if (!c) throw new Error('العهدة غير موجودة أو لا تظهر لك');
      others = c.employee_id || c.user_id ? await q('v_custodies', (x) => x.eq('state', 'open').neq('id', id).or([c.employee_id && `employee_id.eq.${c.employee_id}`, c.user_id && `user_id.eq.${c.user_id}`].filter(Boolean).join(','))) : [];
    } catch (e) { put(m.body, h('div', { class: 'notice bad' }, e.message)); return; }
    m.el.querySelector('h2').textContent = `العهدة ${c.custody_no} — ${c.holder_name}`;
    const drafts = exp.filter((r) => ['draft', 'returned'].includes(r.state) && (r.my_actions || []).includes('submit'));
    [...chosen].forEach((x) => { if (!drafts.some((r) => r.id === x)) chosen.delete(x); });
    const rejected = exp.filter((r) => r.state === 'rejected');
    put(m.body,
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, 'المصروف لحامل العهدة'), h('b', {}, num(Number(c.issued) - Number(c.returned)))),
        h('div', { class: 'kpi' }, h('small', {}, 'مصروفات مرحَّلة'), h('b', {}, num(c.spent))),
        h('div', { class: 'kpi warn' }, h('small', {}, 'مصروفات لم تُرحَّل بعد'), h('b', {}, num(c.pending))),
        h('div', { class: 'kpi main' }, h('small', {}, 'الرصيد على حامل العهدة'), h('b', {}, num(c.balance)),
          h('span', {}, Number(c.pending) ? `بعد ترحيل الباقي: ${num(Number(c.balance) - Number(c.pending))}` : ''))),
      h('div', { class: 'help', style: { margin: '0 0 10px' } }, `${c.company_name} — ${c.purpose}`, c.project_code ? ` — ${c.project_code}` : '', ` — فُتحت ${fmt.date(c.opened_date)}`,
        c.user_name ? ` — تظهر في حساب ${c.user_name}` : ' — غير مربوطة بمستخدم', c.is_acc ? ` — حساب ${c.account_code} ${c.account_name}` : '',
        c.state === 'closed' ? h('span', { class: 'badge', style: { marginInlineStart: '8px' } }, 'مقفلة') : null),
      c.last_note && c.state === 'open' ? h('div', { class: 'notice warn', style: { marginBottom: '10px' } }, c.last_note) : null,
      others.length ? h('div', { class: 'notice warn', style: { marginBottom: '10px' } }, 'على حامل العهدة عهد أخرى مفتوحة: ',
        others.map((o) => `${o.custody_no} (${num(o.balance)})`).join('، ')) : null,
      rejected.length ? h('div', { class: 'notice bad', style: { marginBottom: '10px' } }, `${rejected.length} سطر مرفوض بمبلغ ${num(rejected.reduce((s, r) => s + Number(r.amount), 0))} — باقٍ على حامل العهدة ضمن الرصيد.`) : null,
      h('div', { class: 'section-title' }, 'المصروفات'),
      expTable(exp, { onOpen: (r) => ((r.my_actions || []).includes('edit') ? expenseForm(c, r, draw) : expenseView(r, draw)),
        select: drafts.length ? (r) => (drafts.some((d) => d.id === r.id) ? h('input', { type: 'checkbox', checked: chosen.has(r.id), onchange: (e) => { e.target.checked ? chosen.add(r.id) : chosen.delete(r.id); } }) : '') : null }),
      h('div', { class: 'section-title' }, 'الحركات النقدية'),
      grid(['التاريخ', 'الحركة', 'المبلغ', 'من / إلى', 'القيد', 'ملاحظة'], moves.map((v) => h('tr', {},
        h('td', {}, fmt.date(v.move_date)), h('td', {}, v.kind === 'issue' ? 'صرف لحامل العهدة' : 'ردّ منه'), h('td', { class: 'num' }, num(v.amount)),
        h('td', {}, v.request_no ? 'طلب تحويل ' + v.request_no : v.cash_code ? `${v.cash_code} — ${v.cash_name}` : ''), h('td', { class: 'ltr' }, v.entry_ref || ''), h('td', { class: 'wrap' }, v.note || ''))), 'لا توجد حركات'));
    const B = (label, cls, fn) => h('button', { class: 'btn ' + cls, onclick: fn }, label);
    if (c.can_enter && c.state === 'open') m.foot.append(B('＋ مصروف', 'primary', () => expenseForm(c, null, draw)));
    if (drafts.length) m.foot.append(B('تقديم المختار للاعتماد', '', async () => {
      const list = chosen.size ? [...chosen] : drafts.map((r) => r.id);
      if (!chosen.size && !(await confirmDialog(`تقديم كل الأسطر غير المقدَّمة (${drafts.length})؟`, { ok: 'تقديم' }))) return;
      if (await run(() => rpc('submit_custody_expenses', { p_ids: list }, 'accounting'), 'قُدّمت للاعتماد')) { chosen.clear(); draw(); }
    }));
    if (c.is_acc && c.state === 'open') {
      m.foot.append(B('صرف إضافي', '', () => cashDialog(c, 'issue', draw)), B('ردّ الباقي', '', () => cashDialog(c, 'return', draw)), B('تعديل', 'ghost', () => editDialog(c, draw)),
        B('قفل العهدة', 'ghost', async () => { if (await run(() => rpc('update_custody', { p_id: c.id, p: { state: 'closed' } }, 'accounting'), 'أُقفلت العهدة')) draw(); }));
    }
    if (c.is_acc && c.state === 'closed') m.foot.append(B('إعادة فتح', 'ghost', async () => { if (await run(() => rpc('update_custody', { p_id: c.id, p: { state: 'open' } }, 'accounting'), 'فُتحت العهدة')) draw(); }));
    m.foot.append(h('span', { class: 'spacer' }), B('إغلاق', '', m.close));
  }
  draw();
}

// ---------------------------------------------------------------------
// نموذج المصروف
// ---------------------------------------------------------------------
async function expenseForm(c, e, done) {
  const m = modal({ title: e ? 'تعديل مصروف' : `مصروف على العهدة ${c.custody_no}`, size: 'wide' });
  const co = h('select', { class: 'input' });
  const date = h('input', { class: 'input', type: 'date', value: e?.expense_date || today(), max: today() });
  const doc = h('select', { class: 'input' });
  const docHelp = h('div', { class: 'help' });
  const docNo = h('input', { class: 'input ltr', value: e?.doc_no || '' });
  const sup = h('input', { class: 'input', value: e?.supplier_name || '', placeholder: 'كما في الفاتورة' });
  const vatNo = h('input', { class: 'input ltr', value: e?.supplier_vat || '', maxlength: 15, placeholder: '15 رقمًا' });
  const amount = h('input', { class: 'input', type: 'number', step: '0.01', min: 0, value: e?.amount ?? '' });
  const vat = h('input', { class: 'input', type: 'number', step: '0.01', min: 0, value: e && Number(e.vat_amount) ? e.vat_amount : '' });
  const desc = h('textarea', { class: 'input', rows: 2, placeholder: 'ماذا اشتُري ولأي عمل' }, e?.description || '');
  const files = h('input', { type: 'file', class: 'input', multiple: true, accept: 'image/jpeg,image/png,image/webp,application/pdf' });
  const slot = { project: h('div'), cc: h('div'), eq: h('div') };
  const err = h('p', { class: 'notice bad', style: { display: 'none' } });
  const cross = h('div', { class: 'notice warn', style: { display: 'none', marginBottom: '10px' } });
  let fd = null; const pk = {}; let first = true;
  const fNo = F('رقم المستند', docNo), fSup = F('اسم المورد', sup), fVatNo = F('الرقم الضريبي للمورد', vatNo, { req: true }), fVat = F('منها ضريبة', vat, { help: 'مبلغ الضريبة داخل المبلغ' });
  const fFiles = F('صورة المستند', files, { wide: true });
  const fDoc = F('نوع المستند', doc, { req: true }); fDoc.append(docHelp);
  const mk = (list, value, ph) => combo({ options: list.map(opt), listKey: 'cu-' + ph, value, placeholder: ph });

  async function loadCo() {
    try { fd = await rpc('cu_form_data', { p_custody: c.id, p_company: co.value || null }, 'accounting'); } catch (x) { err.textContent = x.message; err.style.display = ''; return; }
    if (first) put(co, fd.companies.map((x) => h('option', { value: x.id, selected: x.id === (e?.expense_company_id || c.company_id) }, x.name)));
    const keep = first && e;
    pk.project = mk(fd.projects, keep ? e.project_id : (co.value === c.company_id ? c.project_id : null), 'بدون مشروع');
    pk.cc = mk(fd.cost_centers, keep ? e.cost_center_id : null, 'بدون مركز');
    pk.eq = mk(fd.equipment, keep ? e.equipment_id : null, 'بدون معدة');
    slot.project.replaceChildren(pk.project.el); slot.cc.replaceChildren(pk.cc.el); slot.eq.replaceChildren(pk.eq.el);
    const cur = doc.value || e?.doc_type || 'tax';
    put(doc, Object.entries(DOCS).map(([k, t]) => h('option', { value: k, disabled: fd.rules[k] === 'reject', selected: k === cur && fd.rules[k] !== 'reject' },
      t + (fd.rules[k] === 'reject' ? ' — لا يُقبل على هذه الشركة' : fd.rules[k] === 'attach' ? ' — بمرفق' : ''))));
    cross.style.display = co.value !== c.company_id ? '' : 'none';
    cross.textContent = `النقد من عهدة ${c.company_name} والمصروف على شركة أخرى: ` + (fd.cross_mode === 'auto' ? 'تسجّل المحاسبة قيدين متقابلين بين الشركتين.' : 'تسجّل المحاسبة قيوده بيدها.');
    first = false; showDoc();
  }
  function showDoc() {
    const d = doc.value; const canVat = d === 'tax' || (d === 'simplified' && fd.simplified_vat);
    fNo.style.display = d === 'none' ? 'none' : ''; fSup.style.display = d === 'none' || d === 'receipt' ? 'none' : '';
    fVatNo.style.display = d === 'tax' || (d === 'simplified' && fd.simplified_vat) ? '' : 'none'; fVat.style.display = canVat ? '' : 'none';
    const rule = fd.rules[d];
    fFiles.querySelector('label').textContent = rule === 'attach' ? 'صورة المستند (إجبارية)' : 'صورة المستند (اختيارية)';
    const rejected = Object.entries(fd.rules).filter(([, v]) => v === 'reject').map(([k]) => DOCS[k]);
    docHelp.textContent = (d === 'simplified' && !fd.simplified_vat ? 'المبلغ كله مصروف — لا تُخصم ضريبة الفاتورة المبسطة. ' : '')
      + (rejected.length ? `لا يُقبل على هذه الشركة: ${rejected.join('، ')} — المصروف بلا مستند مقبول يبقى على حامل العهدة.` : '');
  }
  doc.onchange = showDoc; co.onchange = loadCo;
  amount.onchange = () => { if (doc.value === 'tax' && !vat.value && Number(amount.value) > 0) vat.value = (Math.round(Number(amount.value) * 15 / 115 * 100) / 100).toFixed(2); };

  put(m.body,
    e?.last_note && e.state === 'returned' ? h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, h('b', {}, 'المطلوب تعديله: '), e.last_note) : null,
    cross,
    h('div', { class: 'form-grid' },
      F('المصروف على شركة', co, { req: true, help: 'الشركة التي باسمها المستند' }), F('التاريخ', date, { req: true }),
      fDoc, fNo, fSup, fVatNo,
      F('المبلغ (شامل الضريبة)', amount, { req: true }), fVat,
      F('المشروع', slot.project), F('مركز التكلفة', slot.cc), F('المعدة', slot.eq),
      F('البيان', desc, { req: true, wide: true }), fFiles),
    err);
  await loadCo();

  const send = async (submit) => {
    err.style.display = 'none';
    const p = { id: e?.id || null, custody_id: c.id, expense_company_id: co.value, expense_date: date.value || null, amount: amount.value === '' ? null : Number(amount.value),
      vat_amount: vat.value === '' || fVat.style.display === 'none' ? 0 : Number(vat.value), doc_type: doc.value, doc_no: docNo.value, supplier_name: sup.value,
      supplier_vat: fVatNo.style.display === 'none' ? null : vatNo.value, description: desc.value,
      project_id: pk.project?.id || null, cost_center_id: pk.cc?.id || null, equipment_id: pk.eq?.id || null };
    bs.disabled = bd.disabled = true;
    try {
      const id = await rpc('save_custody_expense', { p }, 'accounting');
      if (files.files.length) await uploadFiles(id, c.company_id, files.files);
      if (submit) {
        try { await rpc('submit_custody_expenses', { p_ids: [id] }, 'accounting'); toast('حُفظ وقُدّم للاعتماد', 'ok'); }
        catch (x) { toast('حُفظ مسودة ولم يُقدَّم: ' + x.message, 'bad'); }
      } else toast('حُفظ مسودة', 'ok');
      m.close(); done?.();
    } catch (x) { err.textContent = x.message; err.style.display = ''; } finally { bs.disabled = bd.disabled = false; }
  };
  const bs = h('button', { class: 'btn primary', onclick: () => send(true) }, 'حفظ وتقديم للاعتماد');
  const bd = h('button', { class: 'btn', onclick: () => send(false) }, 'حفظ مسودة');
  m.foot.append(bs, bd);
  if (e) m.foot.append(h('button', { class: 'btn danger', onclick: async () => {
    if (!(await confirmDialog('حذف هذا السطر؟', { ok: 'حذف', danger: true }))) return;
    if (await run(() => rpc('cancel_custody_expense', { p_id: e.id, p_reason: null }, 'accounting'), 'حُذف السطر')) { m.close(); done?.(); }
  } }, 'حذف'));
  m.foot.append(h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

async function uploadFiles(id, company, list) {
  for (const f of list) {
    if (f.size > 15 * 1024 * 1024) { toast(`${f.name}: أكبر من 15 ميجا`, 'bad'); continue; }
    const path = `${company}/custody/${id}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-؀-ۿ]+/g, '_')}`;
    try {
      const { error } = await sb.storage.from('attachments').upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw error;
      const { error: e2 } = await sb.schema('core').from('attachments').insert({ path, file_name: f.name, mime_type: f.type, size_bytes: f.size,
        subject_table: 'accounting.custody_expenses', subject_id: id, company_id: company });
      if (e2) throw e2;
    } catch (x) { toast(`تعذّر رفع ${f.name}: ${x.message || x}`, 'bad'); }
  }
}

// عرض سطر: بياناته ومرفقاته، وإجراءات المدير العام أو المحاسبة
async function expenseView(r, done) {
  const m = modal({ title: `مصروف — ${r.custody_no}`, size: '' });
  const { data: att } = await sb.schema('core').from('attachments').select('id, path, file_name').eq('subject_table', 'accounting.custody_expenses').eq('subject_id', r.id).eq('status', 'active');
  const row = (k, v) => (v ? h('tr', {}, h('th', {}, k), h('td', {}, v)) : null);
  const openFile = async (path) => { const { data, error } = await sb.storage.from('attachments').createSignedUrl(path, 300); if (error) return toast(error.message, 'bad'); window.open(data.signedUrl, '_blank', 'noopener'); };
  put(m.body,
    h('div', { class: 'notice', style: { marginBottom: '10px' } }, badge(r.state), r.last_note ? ' ' + r.last_note : ''),
    r.expense_company_id !== r.company_id ? h('div', { class: 'notice warn', style: { marginBottom: '10px' } }, `دُفع من عهدة ${r.company_name} والمصروف على ${r.expense_company_name}`) : null,
    h('table', { class: 'grid report pr-info' }, h('tbody', {},
      row('العهدة', `${r.custody_no} — ${r.holder_name}`), row('التاريخ', fmt.date(r.expense_date)), row('البيان', h('div', { class: 'wrap' }, r.description)),
      row('المستند', docLine(r)), row('الرقم الضريبي', r.supplier_vat ? h('span', { class: 'ltr' }, r.supplier_vat) : null),
      row('المبلغ', h('b', {}, num(r.amount))), row('منها ضريبة', Number(r.vat_amount) ? num(r.vat_amount) : null),
      row('على شركة', r.expense_company_name), row('المشروع', r.project_code ? `${r.project_code} — ${r.project_name}` : null), row('مركز التكلفة', r.cost_center_name), row('المعدة', r.equipment_name),
      row('أدخله', r.entered_name), row('اعتمده', r.gm_name ? `${r.gm_name} — ${fmt.datetime(r.gm_at)}` : null),
      row('الحساب', r.account_code ? `${r.account_code} — ${r.account_name}` : null),
      row('القيد', [r.entry_ref, r.x_entry_ref].filter(Boolean).join(' / ') || (r.manual_entry ? 'قيد يدوي' : null)))),
    h('div', { class: 'section-title' }, 'المرفقات'),
    (att || []).length ? h('ul', { class: 'pr-files' }, att.map((a) => h('li', {}, h('button', { class: 'btn ghost sm', onclick: () => openFile(a.path) }, '📎 ' + a.file_name)))) : h('div', { class: 'help' }, 'لا توجد مرفقات'));
  const A = r.my_actions || [];
  const decide = (action, title, ok, need = true) => async () => {
    const note = need ? await askReason(title, { ok }) : null;
    if (need && note === null) return;
    if (await run(() => rpc('decide_custody_expenses', { p_ids: [r.id], p_action: action, p_note: note }, 'accounting'), 'تم')) { m.close(); done?.(); }
  };
  if (A.includes('approve')) m.foot.append(h('button', { class: 'btn primary', onclick: decide('approve', '', '', false) }, 'موافقة'));
  if (A.includes('post')) m.foot.append(h('button', { class: 'btn primary', onclick: () => { m.close(); postDialog([r], done); } }, 'مراجعة وترحيل'));
  if (A.includes('return')) m.foot.append(h('button', { class: 'btn', onclick: decide('return', 'المطلوب تعديله', 'إرجاع') }, 'إرجاع للتعديل'));
  if (A.includes('reject')) m.foot.append(h('button', { class: 'btn danger', onclick: decide('reject', 'سبب الرفض (يبقى المبلغ على حامل العهدة)', 'رفض') }, 'رفض'));
  m.foot.append(h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: m.close }, 'إغلاق'));
}

// ---------------------------------------------------------------------
// الترحيل: حساب كل سطر، وحساب الضريبة، وحسابات الجاري بين الشركات
// ---------------------------------------------------------------------
async function postDialog(lines, done) {
  const { loadLookups } = await import('../accounting/lookups.js');
  const m = modal({ title: `ترحيل تسوية ${lines[0].custody_no} — ${lines[0].holder_name}`, size: 'full' });
  put(m.body, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  const cco = lines[0].company_id;
  const cos = [...new Set([cco, ...lines.map((l) => l.expense_company_id)])];
  let lks, mode;
  try {
    lks = Object.fromEntries(await Promise.all(cos.map(async (c) => [c, await loadLookups(c, { force: true })])));
    mode = (await acc.rpc('cu_cross_mode')).data || 'auto';
  } catch (e) { put(m.body, h('div', { class: 'notice bad' }, e.message)); return; }
  const name = (c) => state.companies().find((x) => x.id === c)?.name || lines.find((l) => l.expense_company_id === c)?.expense_company_name || '';
  const mem = (k, v) => { try { if (v === undefined) return localStorage.getItem('erp-cu-' + k); localStorage.setItem('erp-cu-' + k, v); } catch { /* ignore */ } return null; };
  const postable = (c, f = () => true) => lks[c].accounts.filter((a) => a.row.is_postable && f(a.row));
  const date = h('input', { class: 'input', type: 'date', value: today(), max: today(), style: { width: 'auto' } });
  const crossLines = lines.filter((l) => l.expense_company_id !== cco);
  const manual = mode === 'warn' && crossLines.length;
  const rows = lines.map((l) => {
    const c = l.expense_company_id; const isManual = manual && c !== cco;
    const r = { l, isManual };
    if (!isManual) {
      r.acc = combo({ options: postable(c, (a) => ['expense', 'asset'].includes(a.account_type) && !a.is_cash_account && a.vat_role === 'none'), listKey: 'cu-acc-' + c, value: null, placeholder: 'حساب المصروف' });
      r.project = combo({ options: lks[c].projects, listKey: 'cu-pj-' + c, value: l.project_id, placeholder: 'مشروع' });
      r.cc = combo({ options: lks[c].costCenters || [], listKey: 'cu-cc-' + c, value: l.cost_center_id, placeholder: 'مركز' });
      r.eq = combo({ options: (lks[c].equipment || []), listKey: 'cu-eq-' + c, value: l.equipment_id, placeholder: 'معدة' });
    }
    return r;
  });
  // حساب ضريبة المدخلات لكل شركة فيها سطر بضريبة (إن وُجد أكثر من حساب)
  const vatCo = [...new Set(lines.filter((l) => Number(l.vat_amount) > 0).map((l) => l.expense_company_id))];
  if (vatCo.length > 1) { put(m.body, h('div', { class: 'notice bad' }, 'أسطر الضريبة على أكثر من شركة — رحّل أسطر كل شركة وحدها.')); return; }
  const vatOpts = vatCo.length ? postable(vatCo[0], (a) => a.vat_role === 'input') : [];
  const vatPick = vatOpts.length > 1 ? combo({ options: vatOpts, listKey: 'cu-vat', value: vatOpts[0].id, placeholder: 'حساب ضريبة المدخلات' }) : null;
  // حسابات الجاري بين الشركات
  const ic = {};
  if (crossLines.length && !manual) cos.forEach((c) => { ic[c] = combo({ options: postable(c, (a) => ['asset', 'liability'].includes(a.account_type) && !a.is_cash_account), listKey: 'cu-ic-' + c, value: mem('ic-' + c), placeholder: 'حساب جاري الشركات الشقيقة' }); });
  // القيد اليدوي: رقم القيد في شركة العهدة (دائن حساب العهدة) وفي كل شركة عليها مصروف — يتحقق النظام من المبالغ
  const manRefs = {};
  if (manual) [cco, ...new Set(crossLines.map((l) => l.expense_company_id))].forEach((c) => { manRefs[c] = h('input', { class: 'input ltr', placeholder: 'مثال: 2026-15' }); });
  const err = h('p', { class: 'notice bad', style: { display: 'none' } });
  const total = lines.reduce((s, l) => s + Number(l.amount), 0);

  put(m.body,
    h('div', { class: 'toolbar', style: { marginBottom: '10px' } }, h('label', {}, 'تاريخ القيد'), date, h('span', { class: 'help' }, `${lines.length} سطر — ${num(total)} — دائن حساب العهدة`)),
    crossLines.length ? h('div', { class: 'notice warn', style: { marginBottom: '10px' } }, manual
      ? 'أسطر على شركة أخرى (الإعداد: تنبيه فقط): سجّل قيديها بنفسك — في شركة العهدة دائن حساب العهدة، وفي الشركة الأخرى المصروفات — ثم اكتب رقمي القيدين هنا. يتحقق النظام من المبالغ قبل الترحيل.'
      : 'أسطر على شركة أخرى: يُسجَّل قيد في كل شركة عليها مصروف (دائن مستحق لشركة العهدة) وقيد في شركة العهدة (مدين مستحق من الشقيقة).') : null,
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
      h('thead', {}, h('tr', {}, ['التاريخ', 'البيان والمستند', 'على شركة', 'المبلغ', 'حساب المصروف', 'المشروع', 'مركز التكلفة', 'المعدة'].map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, fmt.date(r.l.expense_date)),
        h('td', { class: 'wrap' }, r.l.description, h('div', { class: 'help' }, docLine(r.l))),
        h('td', {}, r.l.expense_company_name),
        h('td', { class: 'num' }, num(Number(r.l.amount) - Number(r.l.vat_amount)), Number(r.l.vat_amount) ? h('div', { class: 'help' }, '+ ضريبة ' + num(r.l.vat_amount)) : null),
        r.isManual ? h('td', { colspan: 4, class: 'help' }, 'قيد يدوي') : [h('td', { style: { minWidth: '200px' } }, r.acc.el), h('td', { style: { minWidth: '130px' } }, r.project.el), h('td', { style: { minWidth: '120px' } }, r.cc.el), h('td', { style: { minWidth: '120px' } }, r.eq.el)])))))),
    vatPick ? h('div', { class: 'toolbar', style: { marginTop: '10px' } }, h('label', {}, 'حساب ضريبة المدخلات'), h('div', { style: { minWidth: '260px' } }, vatPick.el)) : null,
    Object.keys(ic).length ? h('div', { class: 'form-grid', style: { marginTop: '10px' } }, cos.map((c) => F('حساب الجاري في ' + name(c), ic[c].el, { req: true }))) : null,
    Object.keys(manRefs).length ? h('div', { class: 'form-grid', style: { marginTop: '10px' } }, Object.entries(manRefs).map(([c, inp]) =>
      F('رقم القيد اليدوي في ' + name(c), inp, { req: true, help: c === cco ? `دائن حساب العهدة بـ ${num(crossLines.reduce((s, l) => s + Number(l.amount), 0))}` : `مصروفات ${num(crossLines.filter((l) => l.expense_company_id === c).reduce((s, l) => s + Number(l.amount), 0))}` }))) : null,
    h('p', { class: 'help' }, 'المورد في الفاتورة الضريبية يُضاف تلقائيًا من رقمه الضريبي إن لم يكن مسجّلًا. إلغاء القيد لاحقًا يعيد الأسطر هنا للترحيل.'),
    err);

  const go = h('button', { class: 'btn primary', onclick: async () => {
    err.style.display = 'none';
    const miss = rows.find((r) => !r.isManual && !r.acc.id);
    if (miss) { err.textContent = `اختر حساب المصروف للسطر «${miss.l.description.slice(0, 40)}»`; err.style.display = ''; return; }
    go.disabled = true;
    try {
      const out = [];
      const auto = rows.filter((r) => !r.isManual);
      if (auto.length) {
        Object.entries(ic).forEach(([c, p]) => { if (p.id) mem('ic-' + c, p.id); });
        const res = await rpc('post_custody_expenses', { p_date: date.value,
          p_lines: auto.map((r) => ({ id: r.l.id, account_id: r.acc.id, project_id: r.project.id || null, cost_center_id: r.cc.id || null, equipment_id: r.eq.id || null })),
          p_opts: { vat_account_id: vatPick?.id || null, ic: Object.fromEntries(Object.entries(ic).map(([c, p]) => [c, p.id || null])) } }, 'accounting');
        out.push(...(res.entries || []).map((x) => `${name(x.company_id)} ${x.ref}`));
      }
      const man = rows.filter((r) => r.isManual);
      if (man.length) {
        const refs = Object.fromEntries(Object.entries(manRefs).map(([c, inp]) => [c, inp.value.trim()]));
        await rpc('post_custody_expenses', { p_date: date.value, p_lines: man.map((r) => ({ id: r.l.id })), p_opts: { manual: true, manual_entries: refs } }, 'accounting');
      }
      toast(out.length ? 'رُحّلت التسوية — القيد: ' + out.join(' و') : 'رُبطت الأسطر بالقيدين اليدويين', 'ok');
      m.close(); done?.();
    } catch (e) { err.textContent = e.message; err.style.display = ''; } finally { go.disabled = false; }
  } }, 'اعتماد وترحيل القيد');
  m.foot.append(go, h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

// ---------------------------------------------------------------------
// فتح عهدة، وحركة نقدية، وتعديل (المحاسبة)
// ---------------------------------------------------------------------
async function usersList() {
  const { data } = await core.from('v_user_names').select('id, full_name').order('full_name');
  return data || [];
}

async function openDialog(done) {
  const { loadLookups } = await import('../accounting/lookups.js');
  const m = modal({ title: 'عهدة جديدة', size: 'wide' });
  const cos = state.companies();
  const co = h('select', { class: 'input' }, cos.map((c) => h('option', { value: c.id, selected: c.id === ids()[0] }, c.name)));
  const src = h('select', { class: 'input' }, h('option', { value: 'cash' }, 'نقدًا من الصندوق أو البنك'), h('option', { value: 'request' }, 'من طلب تحويل مدفوع (عهدة)'));
  const req = h('select', { class: 'input' });
  const holder = h('input', { class: 'input', placeholder: 'إن لم يكن موظفًا مسجّلًا' });
  const user = h('select', { class: 'input' });
  const amount = h('input', { class: 'input', type: 'number', step: '0.01', min: 0 });
  const date = h('input', { class: 'input', type: 'date', value: today(), max: today() });
  const purpose = h('input', { class: 'input', placeholder: 'مصروفات موقع، مشتريات عاجلة…' });
  const slot = { emp: h('div'), acc: h('div'), cash: h('div'), project: h('div') };
  const warn = h('div', { class: 'notice warn', style: { display: 'none', marginBottom: '10px' } });
  const err = h('p', { class: 'notice bad', style: { display: 'none' } });
  const pk = {}; let reqs = [];
  const fReq = F('طلب التحويل', req, { req: true }), fAmt = F('المبلغ', amount, { req: true }), fCash = F('يُصرف من', slot.cash, { req: true });
  const fAcc = F('حساب العهدة', slot.acc, { req: true });
  const fAccReq = h('div', { class: 'help', style: { gridColumn: '1 / -1' } }, 'حساب العهدة والموظف يُؤخذان من قيد سداد الطلب.');
  put(user, h('option', { value: '' }, '— غير مربوطة بمستخدم —'), (await usersList()).map((u) => h('option', { value: u.id }, u.full_name)));

  async function checkOpen() {
    warn.style.display = 'none';
    const e = pk.emp?.id, u = user.value;
    if (!e && !u) return;
    const list = await q('v_custodies', (x) => x.eq('state', 'open').or([e && `employee_id.eq.${e}`, u && `user_id.eq.${u}`].filter(Boolean).join(','))).catch(() => []);
    if (list.length) { warn.textContent = 'تنبيه: عليه عهد مفتوحة — ' + list.map((o) => `${o.custody_no} رصيدها ${num(o.balance)}`).join('، '); warn.style.display = ''; }
  }
  async function loadCo() {
    const lk = await loadLookups(co.value, { force: true });
    const post = lk.accounts.filter((a) => a.row.is_postable);
    const custAcc = post.filter((a) => a.row.account_type === 'asset' && !a.row.is_cash_account && a.row.vat_role === 'none');
    const guess = localStorage.getItem('erp-cu-acc-' + co.value) || custAcc.find((a) => a.row.party_kind === 'employee' && /عهد/.test(a.name))?.id || null;
    pk.emp = combo({ options: lk.employees, listKey: 'cu-emp', value: null, placeholder: 'اختر الموظف', onChange: checkOpen });
    pk.acc = combo({ options: custAcc, listKey: 'cu-cacc', value: custAcc.some((a) => a.id === guess) ? guess : null, placeholder: 'حساب العهد' });
    pk.cash = combo({ options: post.filter((a) => a.row.is_cash_account), listKey: 'cu-cash', value: null, placeholder: 'الصندوق أو البنك' });
    pk.project = combo({ options: lk.projects, listKey: 'cu-opj', value: null, placeholder: 'بدون مشروع' });
    Object.keys(slot).forEach((k) => slot[k].replaceChildren(pk[k].el));
    const [paid, used] = await Promise.all([
      q('v_payment_requests', (x) => x.eq('company_id', co.value).eq('kind', 'custody').eq('state', 'paid')).catch(() => []),
      acc.from('custody_moves').select('request_id').not('request_id', 'is', null).eq('status', 'active').then((r) => new Set((r.data || []).map((v) => v.request_id))),
    ]);
    reqs = paid.filter((r) => !used.has(r.id));
    put(req, h('option', { value: '' }, reqs.length ? '— اختر الطلب —' : 'لا توجد طلبات عهدة مدفوعة غير مربوطة'), reqs.map((r) => h('option', { value: r.id }, `${r.request_no} — ${r.payee_name} — ${num(r.amount)}`)));
  }
  const showSrc = () => { const isReq = src.value === 'request'; fReq.style.display = fAccReq.style.display = isReq ? '' : 'none'; fAmt.style.display = fCash.style.display = fAcc.style.display = isReq ? 'none' : ''; };
  src.onchange = showSrc; co.onchange = loadCo; user.onchange = checkOpen;
  req.onchange = () => { const r = reqs.find((x) => x.id === req.value); if (r && !purpose.value) purpose.value = r.description.slice(0, 120); };
  put(m.body, warn, h('div', { class: 'form-grid' },
    F('الشركة (مصدر النقد)', co, { req: true }), F('مصدر العهدة', src), fReq,
    F('الموظف حامل العهدة', slot.emp), F('أو الاسم', holder), F('تظهر في حساب المستخدم', user, { help: 'يرى عهدته ويُدخل مصروفاتها' }),
    fAmt, fCash, F('التاريخ', date, { req: true }), fAcc, fAccReq, F('المشروع', slot.project),
    F('الغرض', purpose, { req: true, wide: true })), err);
  await loadCo(); showSrc();
  const go = h('button', { class: 'btn primary', onclick: async () => {
    err.style.display = 'none'; go.disabled = true;
    try {
      const isReq = src.value === 'request';
      if (isReq && !req.value) throw new Error('اختر طلب التحويل');
      const res = await rpc('open_custody', { p: { company_id: co.value, holder_name: holder.value, employee_id: pk.emp.id || null, user_id: user.value || null, account_id: isReq ? null : pk.acc.id || null,
        project_id: pk.project.id || null, purpose: purpose.value, date: date.value, amount: isReq ? null : Number(amount.value), cash_account_id: isReq ? null : pk.cash.id || null,
        request_id: isReq ? req.value || null : null } }, 'accounting');
      try { if (pk.acc.id) localStorage.setItem('erp-cu-acc-' + co.value, pk.acc.id); } catch { /* ignore */ }
      toast(`فُتحت العهدة ${res.custody_no}` + (isReq ? '' : ' وسُجّل قيد الصرف'), 'ok');
      m.close(); done?.();
    } catch (e) { err.textContent = e.message; err.style.display = ''; } finally { go.disabled = false; }
  } }, 'فتح العهدة');
  m.foot.append(go, h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

async function cashDialog(c, kind, done) {
  const { loadLookups } = await import('../accounting/lookups.js');
  const lk = await loadLookups(c.company_id);
  const m = modal({ title: (kind === 'issue' ? 'صرف إضافي على العهدة ' : 'ردّ من العهدة ') + c.custody_no, size: 'narrow' });
  const bal = Number(c.balance);
  const amount = h('input', { class: 'input', type: 'number', step: '0.01', min: 0, value: kind === 'return' && bal - Number(c.pending) > 0 ? bal - Number(c.pending) : kind === 'issue' && bal < 0 ? -bal : '' });
  const date = h('input', { class: 'input', type: 'date', value: today(), max: today() });
  const note = h('input', { class: 'input' });
  const cash = combo({ options: lk.accounts.filter((a) => a.row.is_postable && a.row.is_cash_account), listKey: 'cu-cash', value: null, placeholder: 'الصندوق أو البنك' });
  m.body.append(h('p', { class: 'help', style: { marginTop: 0 } }, `رصيد العهدة ${num(bal)}` + (Number(c.pending) ? ` (منها ${num(c.pending)} مصروفات لم تُرحَّل)` : '') + '. ' + (kind === 'issue' ? 'يُسجَّل قيد: مدين العهدة — دائن النقد.' : 'يُسجَّل قيد: مدين النقد — دائن العهدة.')),
    F('المبلغ', amount, { req: true }), F(kind === 'issue' ? 'يُصرف من' : 'يُورَّد إلى', cash.el, { req: true }), F('التاريخ', date, { req: true }), F('ملاحظة', note));
  m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
    if (await run(() => rpc('custody_cash', { p_custody: c.id, p_kind: kind, p_amount: Number(amount.value), p_date: date.value, p_cash_account: cash.id || null, p_note: note.value, p_request: null }, 'accounting'), 'سُجّلت الحركة وقيدها')) { m.close(); done?.(); }
  } }, 'حفظ'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

async function editDialog(c, done) {
  const m = modal({ title: 'تعديل العهدة ' + c.custody_no, size: 'narrow' });
  const user = h('select', { class: 'input' }, h('option', { value: '' }, '— غير مربوطة بمستخدم —'), (await usersList()).map((u) => h('option', { value: u.id, selected: u.id === c.user_id }, u.full_name)));
  const purpose = h('input', { class: 'input', value: c.purpose });
  m.body.append(F('تظهر في حساب المستخدم', user), F('الغرض', purpose));
  m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
    if (await run(() => rpc('update_custody', { p_id: c.id, p: { user_id: user.value || '', purpose: purpose.value } }, 'accounting'), 'حُفظ')) { m.close(); done?.(); }
  } }, 'حفظ'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

// ---------------------------------------------------------------------
// قواعد المستندات (المدير): لكل شركة ولكل نوع مستند، والتعامل بين الشركات
// ---------------------------------------------------------------------
async function settingsDialog() {
  const m = modal({ title: 'قواعد مستندات العهد', size: 'wide' });
  const { data: rows, error } = await core.from('settings').select('*').like('key', 'custody.%');
  if (error) { m.body.append(h('div', { class: 'notice bad' }, error.message)); return; }
  const find = (key, company) => rows.find((r) => r.key === key && (r.company_id || null) === company);
  const cos = [{ id: null, name: 'الافتراضي لكل الشركات' }, ...state.companies()];
  const cells = [];
  const sel = (key, company, values, fallback) => {
    const cur = find(key, company);
    const s = h('select', { class: 'input' }, company ? h('option', { value: '' }, 'كالافتراضي') : null,
      Object.entries(values).map(([k, t]) => h('option', { value: k, selected: (cur && cur.status === 'active' ? cur.value : company ? '' : fallback) === k }, t)));
    cells.push({ key, company, s, cur });
    return s;
  };
  const cross = sel('custody.cross_company', null, CROSS, 'auto');
  const tbl = h('table', { class: 'grid report' },
    h('thead', {}, h('tr', {}, h('th', {}, 'الشركة'), Object.values(DOCS).map((t) => h('th', {}, t)))),
    h('tbody', {}, cos.map((c) => h('tr', {}, h('td', {}, h('b', {}, c.name)),
      Object.keys(DOCS).map((d) => h('td', {}, sel('custody.doc.' + d, c.id, RULES, d === 'receipt' ? 'attach' : 'accept')))))));
  cells.shift();
  m.body.append(
    h('p', { class: 'help', style: { marginTop: 0 } }, 'المصروف الذي لا يُقبل مستنده لا يُسجَّل على الشركة، ويبقى مبلغه في رصيد العهدة على حاملها حتى يُحضر مستندًا مقبولًا أو يردّه.'),
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, tbl)),
    h('div', { class: 'field', style: { marginTop: '14px' } }, h('label', {}, 'النقد من عهدة شركة والمستند باسم شركة أخرى'), cross));
  cells.push({ key: 'custody.cross_company', company: null, s: cross, cur: find('custody.cross_company', null) });
  m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
    try {
      for (const c of cells) {
        const v = c.s.value;
        if (c.cur) {
          const active = c.cur.status === 'active';
          if (v === '') { if (active) await updateRow('settings', c.cur.id, { status: 'cancelled', cancel_reason: 'رجع للافتراضي' }, 'core'); }
          else if (!active || c.cur.value !== v) await updateRow('settings', c.cur.id, { value: v, status: 'active', cancel_reason: null }, 'core');
        } else if (v !== '') {
          const { error: e } = await core.from('settings').insert({ key: c.key, company_id: c.company, value: v, description: 'تسوية العهد' });
          if (e) throw new Error(e.message);
        }
      }
      toast('حُفظت القواعد', 'ok'); m.close();
    } catch (e) { toast(e.message, 'bad'); }
  } }, 'حفظ'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

// بطاقة لوحة التحكم
async function widget(el) {
  const [cs, ex] = await Promise.all([
    q('v_custodies', (x) => x.eq('state', 'open').in('company_id', ids())).catch(() => []),
    q('v_custody_expenses', (x) => x.in('state', ['submitted', 'gm_approved']).in('company_id', ids())).catch(() => []),
  ]);
  const mine = cs.filter((c) => c.user_id === state.profile.id);
  const gm = ex.filter((r) => (r.my_actions || []).includes('approve')).length;
  const post = ex.filter((r) => (r.my_actions || []).includes('post')).length;
  put(el, h('div', { class: 'kpis' },
    mine.length ? h('a', { class: 'kpi main', href: '#/custody/list' }, h('small', {}, 'رصيد عهدتي'), h('b', {}, num(mine.reduce((s, c) => s + Number(c.balance), 0)))) : null,
    isGm() ? h('a', { class: 'kpi', href: '#/custody/approvals' }, h('small', {}, 'مصروفات عهد بانتظار موافقتك'), h('b', {}, String(gm))) : null,
    isAcc(2) ? h('a', { class: 'kpi', href: '#/custody/post' }, h('small', {}, 'بانتظار الترحيل'), h('b', {}, String(post))) : null,
    isAcc(1) || isGm() ? h('a', { class: 'kpi', href: '#/custody/list' }, h('small', {}, 'عهد مفتوحة'), h('b', {}, String(cs.length)), h('span', {}, num(cs.reduce((s, c) => s + Number(c.balance), 0)))) : null));
}

export default {
  code: 'custody',
  title: 'العهد',
  tabs: [
    { path: 'list', title: 'العهد', wide: true, subtitle: 'العهدة مبلغ عند حاملها: تنقص بمصروفات معتمدة ومرحَّلة، أو بردّ الباقي', render: renderList },
    { path: 'approvals', title: 'بانتظار موافقتي', visible: isGm, wide: true, subtitle: 'مصروفات العهد المقدَّمة: وافق، أو أرجع للتعديل، أو ارفض', render: renderApprovals },
    { path: 'post', title: 'بانتظار الترحيل', group: 'المحاسبة', visible: () => isAcc(1), wide: true, subtitle: 'المعتمدة من المدير العام: راجع الحسابات ورحّل قيد التسوية', render: renderPost },
  ],
  widgets: [{ id: 'custody', title: 'العهد', size: 'sm', visible: () => C().holder || isGm() || isAcc(1), render: widget }],
};

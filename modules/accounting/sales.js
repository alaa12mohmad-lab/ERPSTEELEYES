// فواتير المبيعات والإشعارات الدائنة
//   الفاتورة الرسمية من المنارة: هنا بتتسجل برقمها وتتربط بالعقد أو أمر الشراء والمشروع.
//   مسودة ← إرسال للاعتماد (تظهر في القيود المقترحة) ← اعتماد = قيد + تتحسب على العقد/أمر الشراء
import { acc, rpc } from '../../shared/sb.js';
import { h, fmt, modal, toast, confirmDialog } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { loadLookups, picker, today } from './lookups.js';
import { N, dateInput } from './reports.js';
import { openEntry } from './register.js';

const ids = () => (state.selectedCompanies.length ? state.selectedCompanies : state.companies().map((c) => c.id));
const STATE = {
  draft: ['مسودة', ''], submitted: ['بانتظار الاعتماد', 'warn'], approved: ['معتمدة', 'ok'], rejected: ['مرفوضة', 'bad'], cancelled: ['ملغية', 'bad'],
};
const BK = { normal: 'فاتورة', progress: 'مستخلص', advance: 'دفعة مقدمة', release: 'فك محتجز' };
const REF = { customer: 'عقد', po: 'أمر شراء' };
const badge = (s) => h('span', { class: 'badge ' + (STATE[s]?.[1] || '') }, STATE[s]?.[0] || s);
const accId = (id) => (id && String(id).startsWith('p:') ? String(id).split(':')[2] : id || null);

// ---------------------------------------------------------------------
// القائمة
// ---------------------------------------------------------------------
export function renderSales(el) {
  const y = new Date().getFullYear();
  const from = dateInput(`${y}-01-01`), to = dateInput(`${y}-12-31`);
  const typeSel = h('select', { class: 'input', style: { width: 'auto' } },
    h('option', { value: '' }, 'الفواتير والإشعارات'), h('option', { value: 'invoice' }, 'الفواتير'), h('option', { value: 'credit_note' }, 'الإشعارات الدائنة'));
  const stSel = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, 'كل الحالات'),
    Object.entries(STATE).map(([k, [t]]) => h('option', { value: k }, t)));
  const q = h('input', { class: 'input', placeholder: 'رقم الفاتورة أو العميل أو المشروع', style: { width: '240px' } });
  const out = h('div');
  const lvl2 = state.can('accounting', 2);
  el.replaceChildren(
    h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'toolbar' },
      h('label', {}, 'من'), from, h('label', {}, 'إلى'), to, typeSel, stSel, q, h('div', { class: 'grow' }),
      lvl2 ? h('button', { class: 'btn primary', onclick: () => salesEditor({ onDone: load }) }, '＋ فاتورة') : null,
      lvl2 ? h('button', { class: 'btn', onclick: () => salesEditor({ doc_type: 'credit_note', onDone: load }) }, '＋ إشعار دائن') : null)),
    out);
  [from, to, typeSel, stSel].forEach((x) => x.addEventListener('change', load));
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 200); });
  let rows = [];

  async function load() {
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    let qq = acc.from('v_sales_invoices').select('*').in('company_id', ids()).gte('invoice_date', from.value).lte('invoice_date', to.value)
      .order('invoice_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000);
    if (typeSel.value) qq = qq.eq('doc_type', typeSel.value);
    const { data, error } = await qq;
    if (error) { out.replaceChildren(h('div', { class: 'notice bad' }, error.message)); return; }
    rows = data;
    draw();
  }
  function draw() {
    const nq = q.value.trim().toLowerCase();
    const list = rows.filter((r) => (!stSel.value || r.display_state === stSel.value)
      && (!nq || [r.invoice_no, r.party_name, r.project_code, r.project_name, r.contract_no].some((v) => String(v || '').toLowerCase().includes(nq))));
    const cnt = (s) => rows.filter((r) => r.display_state === s).length;
    const appr = rows.filter((r) => r.display_state === 'approved');
    const sgn = (r) => (r.doc_type === 'credit_note' ? -1 : 1);
    const remaining = appr.filter((r) => r.doc_type === 'invoice').reduce((s, r) => s + Number(r.net_amount) - Number(r.settled || 0), 0);
    out.replaceChildren(
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, 'مسودات'), h('b', {}, String(cnt('draft') + cnt('rejected'))), h('span', {}, cnt('rejected') ? `منها ${cnt('rejected')} مرفوضة` : '')),
        h('div', { class: 'kpi' }, h('small', {}, 'بانتظار الاعتماد'), h('b', {}, String(cnt('submitted')))),
        h('div', { class: 'kpi' }, h('small', {}, 'صافي المعتمد في الفترة'), h('b', {}, fmt.num(appr.reduce((s, r) => s + sgn(r) * Number(r.net_amount), 0)))),
        h('div', { class: 'kpi main' }, h('small', {}, 'الباقي على العملاء من فواتير الفترة'), h('b', {}, fmt.num(remaining)))),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الرقم', 'التاريخ', 'العميل', 'المشروع', 'المرجع', 'النوع', 'الصافي', 'المسدد', 'الباقي', 'الحالة'].map((x) => h('th', {}, x)))),
        h('tbody', {}, list.length ? list.map((r) => {
          const left = r.doc_type === 'invoice' && r.display_state === 'approved' ? Number(r.net_amount) - Number(r.settled || 0) : null;
          return h('tr', { class: r.display_state === 'cancelled' ? 'cancelled' : '', onclick: () => salesEditor({ id: r.id, onDone: load }) },
            h('td', {}, h('b', { class: 'ltr' }, r.invoice_no), ids().length > 1 ? h('div', { class: 'help' }, state.companyName(r.company_id)) : null),
            h('td', {}, fmt.date(r.invoice_date)), h('td', {}, r.party_name), h('td', {}, r.project_code ? `${r.project_code} — ${r.project_name}` : ''),
            h('td', {}, r.contract_no ? `${REF[r.contract_kind] || ''} ${r.contract_no}` : r.original_no ? `على فاتورة ${r.original_no}` : ''),
            h('td', {}, r.doc_type === 'credit_note' ? h('span', { class: 'badge warn' }, 'إشعار دائن') : BK[r.bill_kind]),
            h('td', { class: 'num' }, h('b', {}, N(sgn(r) * r.net_amount))), h('td', { class: 'num' }, r.settled != null ? N(r.settled) : ''),
            h('td', { class: 'num' }, left != null ? (Math.abs(left) < 0.005 ? h('span', { class: 'badge ok' }, 'مسددة') : N(left)) : ''),
            h('td', {}, badge(r.display_state), r.display_state === 'rejected' && r.reject_reason ? h('div', { class: 'help' }, r.reject_reason) : null));
        }) : h('tr', {}, h('td', { colspan: 10, class: 'empty' }, rows.length ? 'مفيش نتايج' : 'مفيش فواتير في الفترة دي')))))));
  }
  load();
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) load(); else off(); });
}

// ---------------------------------------------------------------------
// المحرر: فاتورة جديدة/مسودة/عرض فاتورة، أو إشعار دائن
//   opts: { id?, doc_type?, company_id?, contract_id?, bill_kind?, original_id?, onDone }
// ---------------------------------------------------------------------
export async function salesEditor(opts = {}) {
  let inv = null;
  if (opts.id) {
    const { data, error } = await acc.from('v_sales_invoices').select('*').eq('id', opts.id).single();
    if (error) { toast(error.message, 'bad'); return; }
    inv = data;
  }
  const docType = inv?.doc_type || opts.doc_type || 'invoice';
  const credit = docType === 'credit_note';
  const st = inv?.display_state || 'new';
  const editable = (!inv || ['draft', 'rejected'].includes(inv.state)) && state.can('accounting', 2);
  const title = (credit ? 'إشعار دائن' : 'فاتورة مبيعات') + (inv ? ' ' + inv.invoice_no : ' جديدة');
  const m = modal({ title, size: 'full' });
  const done = () => opts.onDone?.();

  // الحقول
  const companies = ids();
  const coSel = h('select', { class: 'input', disabled: !!inv || !editable },
    companies.map((id) => h('option', { value: id, selected: (inv?.company_id || opts.company_id) === id }, state.companyName(id))));
  const no = h('input', { class: 'input ltr', value: inv?.invoice_no || '', placeholder: 'نفس رقم المنارة' });
  const date = h('input', { class: 'input', type: 'date', value: inv?.invoice_date || today() });
  const due = h('input', { class: 'input', type: 'date', value: inv?.due_date && inv?.state !== 'draft' ? inv.due_date : '', title: 'فاضي = من مدة سداد العميل' });
  const refSel = h('select', { class: 'input' });
  const kindSel = h('select', { class: 'input' });
  const origSel = h('select', { class: 'input' });
  const rec = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'تلقائي', value: inv?.recovery ?? '' });
  const ret = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'تلقائي', value: inv?.retention ?? '' });
  const notes = h('input', { class: 'input', value: inv?.notes || '' });
  const slot = { party: h('div'), project: h('div'), partyAcc: h('div'), vat: h('div') };
  const itemsBox = h('div');
  const prev = h('div');
  const err = h('p', { class: 'notice bad', style: { display: 'none', marginTop: '10px' } });
  let lk; let pk = {}; let contracts = []; let originals = []; let items = [];

  const F = (label, input, o = {}) => h('div', { class: 'field' + (o.wide ? ' wide' : ''), style: o.hide ? { display: 'none' } : {} },
    h('label', {}, label, o.req ? h('span', { class: 'req' }, '*') : ''), input, o.help ? h('div', { class: 'help' }, o.help) : null);
  const fields = {};

  async function loadCompany() {
    const co = coSel.value;
    lk = await loadLookups(co);
    const [{ data: cs }, { data: os }] = await Promise.all([
      acc.from('contracts').select('*').eq('company_id', co).in('kind', ['customer', 'po']).order('contract_no'),
      credit ? acc.from('v_sales_invoices').select('*').eq('company_id', co).eq('doc_type', 'invoice').eq('display_state', 'approved').order('invoice_date', { ascending: false }).limit(1000) : { data: [] },
    ]);
    contracts = cs || []; originals = os || [];
    const A = (f) => lk.postable.filter((a) => f(a.row));
    pk.party = picker({ options: lk.customers, listKey: 'si-party', value: inv?.party_id || null, placeholder: 'العميل', onChange: () => { fillRefs(); refresh(); } });
    pk.project = picker({ options: lk.projects, listKey: 'si-proj-' + co, value: inv?.project_id || null, placeholder: 'بدون مشروع', onChange: refresh });
    const partyAccs = A((r) => r.account_type === 'asset' && ['customer', 'any'].includes(r.party_kind) && r.vat_role === 'none');
    pk.partyAcc = picker({ options: partyAccs, listKey: 'si-pacc-' + co, value: inv?.party_account_id || partyAccs[0]?.id || null, onChange: refresh });
    const vats = A((r) => r.vat_role === 'output');
    pk.vat = picker({ options: vats, listKey: 'si-vat-' + co, value: inv ? inv.vat_account_id : vats[0]?.id || null, placeholder: 'بدون ضريبة', onChange: refresh });
    lk.revenue = A((r) => r.account_type === 'revenue');
    Object.keys(slot).forEach((k) => slot[k].replaceChildren(pk[k].el));
    if (credit) {
      origSel.replaceChildren(h('option', { value: '' }, '— اختار الفاتورة —'), ...originals.map((o) => h('option', { value: o.id, selected: (inv?.original_id || opts.original_id) === o.id },
        `${o.invoice_no} — ${o.party_name} — ${fmt.date(o.invoice_date)} — ${fmt.num(o.net_amount)}`)));
    }
    fillRefs();
    items = (inv?.items?.length ? inv.items : [{ description: '', qty: 1, price: '' }]).map((x) => ({ ...x }));
    if (!inv && opts.contract_id) refSel.value = opts.contract_id;
    if (!inv && opts.bill_kind) kindSel.value = opts.bill_kind;
    applyRef(true);
  }

  function fillRefs() {
    const party = pk.party?.id;
    const keep = refSel.value || inv?.contract_id || opts.contract_id || '';
    const list = contracts.filter((c) => (!party || c.party_id === party) && (c.status === 'active' || c.id === keep));
    refSel.replaceChildren(h('option', { value: '' }, 'بدون (فاتورة عادية)'),
      ...list.map((c) => h('option', { value: c.id, selected: c.id === keep }, `${REF[c.kind]} ${c.contract_no}${c.title ? ' — ' + c.title : ''}`)));
  }

  // المرجع بيحدد العميل والمشروع والحسابات ونوع الفاتورة
  function applyRef(first) {
    const c = contracts.find((x) => x.id === refSel.value);
    if (c) {
      pk.party.set(c.party_id); pk.project.set(c.project_id); pk.partyAcc.set(c.party_account_id); pk.vat.set(c.vat_account_id);
      const kinds = [['progress', c.kind === 'po' ? 'فاتورة على أمر الشراء' : 'مستخلص أعمال']];
      if (Number(c.advance_amount) > 0 || c.advance_account_id) kinds.push(['advance', 'دفعة مقدمة']);
      if (c.retention_account_id) kinds.push(['release', 'فك محتجز']);
      const cur = kindSel.value || inv?.bill_kind;
      kindSel.replaceChildren(...kinds.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
    } else {
      kindSel.replaceChildren(h('option', { value: 'normal' }, 'فاتورة'));
    }
    const locked = !!c || credit;
    [pk.project, pk.partyAcc, pk.vat].forEach((p) => { p.el.disabled = locked || !editable; });
    pk.party.el.disabled = credit || !editable;
    fields.kind.style.display = c ? '' : 'none';
    fields.rec.style.display = fields.ret.style.display = c && kindSel.value === 'progress' && c.kind !== 'po' ? '' : 'none';
    if (c && kindSel.value === 'progress') items.forEach((x) => { if (!x.account_id) x.account_id = c.main_account_id; });
    if (!first) refresh();
    drawItems();
  }

  function applyOriginal() {
    const o = originals.find((x) => x.id === origSel.value);
    if (!o) return;
    pk.party.set(o.party_id); pk.project.set(o.project_id); pk.partyAcc.set(o.party_account_id); pk.vat.set(o.vat_account_id);
    items.forEach((x) => { if (!x.account_id) x.account_id = o.items?.[0]?.account_id; });
    drawItems(); refresh();
  }

  function drawItems() {
    const c = contracts.find((x) => x.id === refSel.value);
    const kind = c ? kindSel.value : 'normal';
    const showAcc = kind === 'progress' || kind === 'normal';
    const total = items.reduce((s, x) => s + Math.round((Number(x.qty) || 0) * (Number(x.price) || 0) * 100) / 100, 0);
    const row = (x, i) => {
      const accPk = showAcc ? picker({ options: lk.revenue, listKey: 'si-rev-' + coSel.value, value: x.account_id || null, placeholder: 'حساب الإيراد',
        onChange: (o) => { x.account_id = o?.id || null; refresh(); } }) : null;
      if (accPk) accPk.el.disabled = !editable;
      const inp = (k, o = {}) => {
        const e = h('input', { class: 'input' + (o.num ? '' : ''), type: o.num ? 'number' : 'text', step: '0.01', value: x[k] ?? '', disabled: !editable, placeholder: o.ph || '' });
        e.addEventListener('input', () => { x[k] = o.num ? e.value : e.value; sumCell.textContent = fmt.num(Math.round((Number(x.qty) || 0) * (Number(x.price) || 0) * 100) / 100); refresh(); drawTotal(); });
        return e;
      };
      const sumCell = h('td', { class: 'num' }, fmt.num(Math.round((Number(x.qty) || 0) * (Number(x.price) || 0) * 100) / 100));
      return h('tr', {},
        h('td', {}, inp('description', { ph: kind === 'advance' ? 'دفعة مقدمة' : kind === 'release' ? 'فك محتجز' : 'البيان' })),
        h('td', { style: { width: '90px' } }, inp('qty', { num: true })), h('td', { style: { width: '140px' } }, inp('price', { num: true })), sumCell,
        showAcc ? h('td', { style: { minWidth: '220px' } }, accPk.el) : null,
        h('td', {}, editable && items.length > 1 ? h('button', { class: 'btn ghost', title: 'حذف السطر', onclick: () => { items.splice(i, 1); drawItems(); refresh(); } }, '×') : null));
    };
    const totalCell = h('b', {}, fmt.num(total));
    const drawTotal = () => { totalCell.textContent = fmt.num(items.reduce((s, x) => s + Math.round((Number(x.qty) || 0) * (Number(x.price) || 0) * 100) / 100, 0)); };
    itemsBox.replaceChildren(h('table', { class: 'grid report' },
      h('thead', {}, h('tr', {}, ['البيان', 'الكمية', 'السعر', 'الإجمالي', showAcc ? 'حساب الإيراد' : null, ''].filter((x) => x !== null).map((x) => h('th', {}, x)))),
      h('tbody', {}, items.map(row)),
      h('tfoot', {}, h('tr', {}, h('td', { colspan: 3 }, kind === 'progress' && c?.kind !== 'po' ? 'قيمة الأعمال (قبل الاسترداد والمحتجز والضريبة)' : 'الإجمالي قبل الضريبة'),
        h('td', { class: 'num' }, totalCell), showAcc ? h('td') : null, h('td')))),
    editable && (kind === 'progress' || kind === 'normal') ? h('button', { class: 'btn ghost', style: { marginTop: '6px' }, onclick: () => { items.push({ description: '', qty: 1, price: '', account_id: items[items.length - 1]?.account_id }); drawItems(); } }, '＋ سطر') : null);
  }

  const payload = () => {
    const c = contracts.find((x) => x.id === refSel.value);
    return {
      id: inv?.id, company_id: coSel.value, doc_type: docType, invoice_no: no.value.trim(), invoice_date: date.value, due_date: due.value || null,
      party_id: pk.party.id, party_account_id: accId(pk.partyAcc.id), project_id: pk.project.id || null,
      contract_id: credit ? null : c?.id || null, bill_kind: credit ? 'normal' : c ? kindSel.value : 'normal', original_id: credit ? origSel.value || null : null,
      items: items.map((x) => ({ description: x.description || null, qty: Number(x.qty) || 1, price: Number(x.price) || 0, account_id: accId(x.account_id) })),
      recovery: rec.value === '' ? null : Number(rec.value), retention: ret.value === '' ? null : Number(ret.value),
      vat_account_id: accId(pk.vat.id), notes: notes.value,
    };
  };

  let pt;
  function refresh() {
    clearTimeout(pt);
    pt = setTimeout(async () => {
      const p = payload();
      if (!p.items.some((x) => x.price > 0) || !p.party_id || !p.invoice_no) { prev.replaceChildren(h('div', { class: 'help', style: { marginTop: '10px' } }, 'اكتب رقم الفاتورة والعميل والمبالغ عشان تظهر الحسبة والقيد.')); return; }
      try {
        const r = await rpc('save_sales_invoice', { p, p_preview: true }, 'accounting');
        drawCalc(r.calc, r.due_date);
      } catch (e) { prev.replaceChildren(h('div', { class: 'notice bad', style: { marginTop: '10px' } }, e.message)); }
    }, 300);
  }

  function drawCalc(r, dueAuto) {
    const c = contracts.find((x) => x.id === refSel.value);
    const accName = (id) => lk.accounts.find((a) => a.id === id)?.label || '';
    const sum = (k) => r.lines.reduce((x, l) => x + Number(l[k] || 0), 0);
    prev.replaceChildren(
      Number(r.over) > 0 ? h('div', { class: 'notice warn', style: { marginTop: '12px' } },
        `⚠ الفاتورة دي هتعدّي قيمة أمر الشراء بـ ${fmt.num(r.over)} — هيتعلّم "محتاج تعديل من العميل". لما يوصل التعديل سجّله من صفحة العقود وأوامر الشراء.`) : null,
      h('div', { class: 'kpis', style: { marginTop: '12px' } },
        h('div', { class: 'kpi' }, h('small', {}, c && kindSel.value === 'progress' && c.kind !== 'po' ? 'قيمة الأعمال' : 'قبل الضريبة'), h('b', {}, fmt.num(r.work))),
        Number(r.recovery) || Number(r.retention) ? h('div', { class: 'kpi' }, h('small', {}, 'استرداد الدفعة / المحتجز'), h('b', {}, `${fmt.num(r.recovery)} / ${fmt.num(r.retention)}`)) : null,
        h('div', { class: 'kpi' }, h('small', {}, 'الخاضع / الضريبة'), h('b', {}, `${fmt.num(r.vat_base)} / ${fmt.num(r.vat)}`)),
        h('div', { class: 'kpi main' }, h('small', {}, credit ? 'الصافي المخصوم من العميل' : 'الصافي على العميل'), h('b', {}, fmt.num(r.net)),
          !credit && dueAuto ? h('span', {}, 'الاستحقاق ' + fmt.date(dueAuto)) : null)),
      h('div', { class: 'help', style: { margin: '6px 0' } }, inv?.state === 'approved' ? 'القيد:' : 'القيد اللي هيتعمل بعد الاعتماد:'),
      h('table', { class: 'grid report' }, h('thead', {}, h('tr', {}, ['الحساب', 'مدين', 'دائن', 'بيان'].map((x) => h('th', {}, x)))),
        h('tbody', {}, r.lines.map((l) => h('tr', {}, h('td', {}, accName(l.account_id)), h('td', { class: 'num' }, Number(l.debit) ? N(l.debit) : ''),
          h('td', { class: 'num' }, Number(l.credit) ? N(l.credit) : ''), h('td', { class: 'help' }, l.description || (l.invoice_no ? 'فاتورة ' + l.invoice_no : ''))))),
        h('tfoot', {}, h('tr', {}, h('td', {}, 'الإجمالي'), h('td', { class: 'num' }, N(sum('debit'))), h('td', { class: 'num' }, N(sum('credit'))), h('td')))));
  }

  // الشكل
  fields.kind = F('نوع الفاتورة', kindSel);
  fields.rec = F('استرداد الدفعة المقدمة', rec, { help: 'فاضي = حسب نسبة العقد' });
  fields.ret = F('المحتجز', ret, { help: 'فاضي = حسب نسبة العقد' });
  const status = inv ? h('div', { class: 'toolbar', style: { marginBottom: '10px' } }, badge(st),
    inv.entry_ref ? h('a', { href: 'javascript:void 0', onclick: () => openEntry(inv.entry_id, { onChange: () => { m.close(); done(); } }) }, 'القيد ' + inv.entry_ref) : null,
    inv.state === 'rejected' && inv.reject_reason ? h('span', { class: 'notice bad', style: { margin: 0, padding: '4px 10px' } }, 'سبب الرفض: ' + inv.reject_reason) : null,
    inv.settled != null ? h('span', { class: 'help' }, `المسدد ${fmt.num(inv.settled)} — الباقي ${fmt.num(Number(inv.net_amount) - Number(inv.settled))}`) : null) : null;
  m.body.append(status || '',
    h('div', { class: 'form-grid' },
      F('الشركة', coSel, { req: true }),
      credit ? F('الفاتورة الأصلية', origSel, { req: true, wide: true }) : F('العميل', slot.party, { req: true }),
      credit ? null : F('المرجع', refSel, { help: 'عقد أو أمر شراء من العميل — الفاتورة بتنقّص الباقي منه بعد الاعتماد' }),
      credit ? null : fields.kind,
      F(credit ? 'رقم الإشعار (من المنارة)' : 'رقم الفاتورة (من المنارة)', no, { req: true }), F('التاريخ', date, { req: true }),
      credit ? null : F('ميعاد الاستحقاق', due, { help: 'فاضي = حسب مدة سداد العميل' }),
      F('المشروع', slot.project), F('حساب العميل', slot.partyAcc, { req: true }), F('حساب الضريبة', slot.vat, { help: 'فاضي = بدون ضريبة' }),
      fields.rec, fields.ret, F('ملاحظات', notes, { wide: true })),
    h('div', { class: 'section-title' }, credit ? 'المرتجع / الخصم' : 'البنود'), itemsBox, prev, err);
  [no, date, due, rec, ret].forEach((x) => { x.disabled = !editable; x.addEventListener('input', refresh); });
  notes.disabled = !editable; coSel.disabled = !!inv || !editable; refSel.disabled = !editable; kindSel.disabled = !editable; origSel.disabled = !!inv || !editable;
  coSel.addEventListener('change', loadCompany);
  refSel.addEventListener('change', () => applyRef(false));
  kindSel.addEventListener('change', () => applyRef(false));
  origSel.addEventListener('change', applyOriginal);
  await loadCompany();
  if (credit && !inv && opts.original_id) applyOriginal();
  if (inv) refresh(); else setTimeout(() => (credit ? origSel : no).focus(), 0);

  // الأزرار
  const run = async (fn, ok) => { err.style.display = 'none'; try { const r = await fn(); if (ok) toast(ok, 'ok'); return r ?? true; } catch (e) { err.textContent = e.message; err.style.display = ''; return null; } };
  const save = async (submit) => {
    const r = await run(() => rpc('save_sales_invoice', { p: payload(), p_preview: false }, 'accounting'));
    if (!r) return;
    if (submit) { if (!(await run(() => rpc('submit_sales_invoice', { p_id: r.id }, 'accounting'), 'اتبعتت للاعتماد — هتلاقيها في القيود المقترحة'))) { inv = { ...(inv || {}), id: r.id, state: 'draft' }; done(); return; } }
    else toast('اتحفظت مسودة', 'ok');
    m.close(); done();
  };
  const btns = [];
  if (editable) {
    btns.push(h('button', { class: 'btn primary', onclick: () => save(true) }, 'حفظ وإرسال للاعتماد'), h('button', { class: 'btn', onclick: () => save(false) }, 'حفظ مسودة'));
    if (inv) btns.push(h('button', { class: 'btn ghost', onclick: async () => {
      if (!(await confirmDialog(`حذف مسودة ${inv.invoice_no}؟`, { ok: 'حذف', danger: true }))) return;
      if (await run(() => rpc('discard_sales_invoice', { p_id: inv.id, p_reason: 'حذف مسودة' }, 'accounting'), 'اتحذفت المسودة')) { m.close(); done(); }
    } }, 'حذف المسودة'));
  }
  if (inv?.state === 'submitted' && state.can('accounting', 2)) {
    btns.push(h('button', { class: 'btn', onclick: async () => { if (await run(() => rpc('withdraw_sales_invoice', { p_id: inv.id }, 'accounting'), 'اتسحبت — عدّلها وابعتها تاني')) { m.close(); done(); salesEditor({ id: inv.id, onDone: opts.onDone }); } } }, 'سحب للتعديل'));
    if (state.can('accounting', 4)) btns.push(h('button', { class: 'btn primary', onclick: async () => {
      if (await run(() => rpc('approve_proposed', { p_id: inv.proposed_id }, 'accounting'), 'اتعتمدت واتعمل القيد')) { m.close(); done(); }
    } }, 'اعتماد'));
  }
  if (inv?.display_state === 'approved' && !credit && state.can('accounting', 2)) {
    btns.push(h('button', { class: 'btn', onclick: () => { m.close(); salesEditor({ doc_type: 'credit_note', company_id: inv.company_id, original_id: inv.id, onDone: opts.onDone }); } }, 'إشعار دائن على الفاتورة'));
  }
  btns.push(h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
  m.foot.append(...btns);
}

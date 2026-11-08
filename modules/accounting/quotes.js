// عروض الأسعار: مسودة ← مُرسَل ← مقبول / مرفوض ← محوّل إلى فاتورة مبيعات أو أمر شراء
//   تُطبع على ترويسة الشركة (صورة A4) وتُحفظ PDF من نافذة الطباعة باسم العرض.
//   العرض المرسل لا يُعدَّل: تُنشأ منه «مراجعة» بالرقم نفسه، وتبقى السابقة محفوظة.
//   عرض السعر ليس مستندًا ضريبيًا ولا ينشئ أي قيد.
import { acc, core, rpc } from '../../shared/sb.js';
import { h, fmt, modal, toast, confirmDialog, askReason } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { brand, companyInfo, refreshCompanies, hijri } from '../../shared/branding.js';
import { loadLookups, picker, today } from './lookups.js';
import { amountInWords } from './print.js';
import { salesEditor } from './sales.js';
import { contractForm } from './contracts.js';

const ids = () => (state.selectedCompanies.length ? state.selectedCompanies : state.companies().map((c) => c.id));
export const QSTATE = {
  draft: ['مسودة', ''], sent: ['مُرسَل', 'warn'], accepted: ['مقبول', 'ok'], rejected: ['مرفوض', 'bad'],
  expired: ['منتهي', 'bad'], superseded: ['مُستبدَل', ''], converted: ['محوّل', 'ok'],
};
const badge = (s) => h('span', { class: 'badge ' + (QSTATE[s]?.[1] || '') }, QSTATE[s]?.[0] || s);
const num = (v) => fmt.num(v);
const qty = (v) => (Number(v) % 1 === 0 ? String(Number(v)) : fmt.num(v, 3).replace(/0+$/, ''));
const ref = (q) => q.quote_no + (q.revision > 1 ? ` (مراجعة ${q.revision})` : '');
const UNITS = ['طن', 'كجم', 'م²', 'م', 'م³', 'قطعة', 'مقطوعية', 'يوم', 'ساعة', 'شهر', 'رحلة', 'لتر'];

async function settingsVal(key, fallback) {
  const { data } = await core.from('settings').select('value').eq('key', key).is('company_id', null).eq('status', 'active').maybeSingle();
  return data?.value ?? fallback;
}

// ---------------------------------------------------------------------
// القائمة
// ---------------------------------------------------------------------
export function renderQuotes(el) {
  const y = new Date().getFullYear();
  const from = h('input', { class: 'input', type: 'date', value: `${y}-01-01`, style: { width: 'auto' } });
  const to = h('input', { class: 'input', type: 'date', value: `${y}-12-31`, style: { width: 'auto' } });
  const stSel = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, 'كل الحالات'),
    Object.entries(QSTATE).filter(([k]) => k !== 'superseded').map(([k, [t]]) => h('option', { value: k }, t)));
  const q = h('input', { class: 'input', placeholder: 'الرقم أو الاسم أو العميل أو المشروع', style: { width: '240px' } });
  const old = h('input', { type: 'checkbox' });
  const out = h('div');
  const lvl2 = state.can('accounting', 2);
  const admin = state.profile?.is_admin;
  el.replaceChildren(
    h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'toolbar' },
      h('label', {}, 'من'), from, h('label', {}, 'إلى'), to, stSel, q, h('label', { class: 'check' }, old, 'إظهار المراجعات السابقة'), h('div', { class: 'grow' }),
      admin ? h('button', { class: 'btn ghost', onclick: () => letterheadDialog() }, 'ترويسة الشركات') : null,
      admin ? h('button', { class: 'btn ghost', onclick: () => termsDialog() }, 'قوالب الشروط') : null,
      lvl2 ? h('button', { class: 'btn primary', onclick: () => quoteEditor({ onDone: load }) }, '＋ عرض سعر') : null)),
    out);
  [from, to, stSel, old].forEach((x) => x.addEventListener('change', x === stSel || x === old ? draw : load));
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 200); });
  let rows = [];

  async function load() {
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    const { data, error } = await acc.from('v_quotations').select('*').in('company_id', ids()).gte('quote_date', from.value).lte('quote_date', to.value)
      .order('quote_date', { ascending: false }).order('quote_no', { ascending: false }).order('revision', { ascending: false }).limit(2000);
    if (error) { out.replaceChildren(h('div', { class: 'notice bad' }, error.message)); return; }
    rows = data; draw();
  }
  function draw() {
    const nq = q.value.trim().toLowerCase();
    const latest = rows.filter((r) => r.is_latest);
    const list = rows.filter((r) => (old.checked || r.is_latest) && (!stSel.value || r.display_state === stSel.value)
      && (!nq || [r.quote_no, r.title, r.customer_name, r.project_code, r.project_name].some((v) => String(v || '').toLowerCase().includes(nq))));
    const cnt = (s) => latest.filter((r) => r.display_state === s);
    const sum = (l) => l.reduce((s, r) => s + Number(r.total), 0);
    const won = [...cnt('accepted'), ...cnt('converted')], lost = cnt('rejected');
    const rate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;
    out.replaceChildren(
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, 'مسودات'), h('b', {}, String(cnt('draft').length))),
        h('div', { class: 'kpi' }, h('small', {}, 'بانتظار رد العميل'), h('b', {}, String(cnt('sent').length)), h('span', {}, num(sum(cnt('sent'))))),
        h('div', { class: 'kpi' }, h('small', {}, 'مقبولة / محوّلة'), h('b', {}, String(won.length)), h('span', {}, num(sum(won)))),
        h('div', { class: 'kpi main' }, h('small', {}, 'نسبة الفوز في الفترة'), h('b', {}, rate === null ? '—' : rate + '%'), h('span', {}, `${won.length} مقبول من ${won.length + lost.length} بُتّ فيها`))),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الرقم', 'التاريخ', 'الاسم', 'العميل', 'المشروع', 'الإجمالي', 'صالح حتى', 'الحالة', 'التحويل'].map((x) => h('th', {}, x)))),
        h('tbody', {}, list.length ? list.map((r) => h('tr', { class: r.is_latest ? '' : 'cancelled', onclick: () => quoteEditor({ id: r.id, onDone: load }) },
          h('td', {}, h('b', { class: 'ltr' }, r.quote_no), r.revision > 1 ? h('span', { class: 'help' }, ` م${r.revision}`) : null,
            ids().length > 1 ? h('div', { class: 'help' }, state.companyName(r.company_id)) : null),
          h('td', {}, fmt.date(r.quote_date)), h('td', {}, r.title),
          h('td', {}, r.customer_name, r.is_prospect ? h('span', { class: 'badge', style: { marginInlineStart: '6px' } }, 'محتمل') : null),
          h('td', {}, r.project_code ? `${r.project_code} — ${r.project_name}` : ''),
          h('td', { class: 'num' }, h('b', {}, num(r.total))), h('td', {}, fmt.date(r.valid_until)),
          h('td', {}, badge(r.display_state), r.display_state === 'rejected' && r.reject_reason ? h('div', { class: 'help' }, r.reject_reason) : null),
          h('td', {}, r.converted_ref ? `${r.converted_kind === 'invoice' ? 'فاتورة' : 'أمر شراء'} ${r.converted_ref}` : '')))
          : h('tr', {}, h('td', { colspan: 9, class: 'empty' }, rows.length ? 'لا توجد نتائج' : 'لا توجد عروض أسعار في هذه الفترة')))))));
  }
  load();
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) load(); else off(); });
}

// ---------------------------------------------------------------------
// المحرر: جديد / مسودة (قابل للتعديل) أو عرض (للقراءة مع أزرار الحالة)
//   opts: { id?, company_id?, onDone }
// ---------------------------------------------------------------------
export async function quoteEditor(opts = {}) {
  let q = null;
  if (opts.id) {
    const { data, error } = await acc.from('v_quotations').select('*').eq('id', opts.id).single();
    if (error) { toast(error.message, 'bad'); return; }
    q = data;
  }
  const editable = (!q || q.state === 'draft') && state.can('accounting', 2);
  const st = q?.display_state || 'new';
  const m = modal({ title: q ? `عرض سعر ${ref(q)}` : 'عرض سعر جديد', size: 'full' });
  const done = () => opts.onDone?.();
  const [templates, introDef, validDef] = await Promise.all([settingsVal('quote.terms', []), settingsVal('quote.intro', ''), settingsVal('quote.valid_days', 30)]);

  const companies = ids();
  const coSel = h('select', { class: 'input', disabled: !!q || !editable },
    companies.map((id) => h('option', { value: id, selected: (q?.company_id || opts.company_id) === id }, state.companyName(id))));
  const title = h('input', { class: 'input', value: q?.title || '', placeholder: 'مثال: توريد وتركيب هنجر 30×60 — الخمرة' });
  const prospect = h('input', { type: 'checkbox', checked: !!q?.is_prospect });
  const pName = h('input', { class: 'input', value: q?.prospect_name || '', placeholder: 'اسم العميل المحتمل' });
  const pPhone = h('input', { class: 'input ltr', value: q?.prospect_phone || '', placeholder: 'الجوال (اختياري)' });
  const attention = h('input', { class: 'input', value: q?.attention || '', placeholder: 'مثال: م. أحمد — مدير المشتريات' });
  const date = h('input', { class: 'input', type: 'date', value: q?.quote_date || today() });
  const valid = h('input', { class: 'input', type: 'number', min: 1, max: 365, value: q?.valid_days ?? validDef });
  const intro = h('textarea', { class: 'input', rows: 2 }, q ? q.intro || '' : introDef);
  const discount = h('input', { class: 'input', type: 'number', step: '0.01', min: 0, value: q?.discount ?? 0 });
  const vatOn = h('input', { type: 'checkbox', checked: q ? Number(q.vat_rate) > 0 : true });
  const tplSel = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, '— إدراج قالب شروط —'),
    (templates || []).map((x, i) => h('option', { value: i }, x.name)));
  const terms = h('textarea', { class: 'input', rows: 5 }, q?.terms || '');
  const notes = h('input', { class: 'input', value: q?.notes || '', placeholder: 'لا تُطبع' });
  tplSel.onchange = () => { const x = templates[tplSel.value]; if (x) terms.value = terms.value.trim() ? terms.value.trim() + '\n' + x.text : x.text; tplSel.value = ''; };
  const slot = { party: h('div'), project: h('div') };
  const itemsBox = h('div'); const totalsBox = h('div');
  const err = h('p', { class: 'notice bad', style: { display: 'none', marginTop: '10px' } });
  let items = (q?.items?.length ? q.items : [{ description: '', unit: '', qty: 1, price: '' }]).map((x) => ({ ...x }));
  let pk = {};
  const rate = () => (vatOn.checked ? Number(q && Number(q.vat_rate) > 0 ? q.vat_rate : 0.15) : 0);

  async function loadCompany() {
    const lk = await loadLookups(coSel.value);
    pk.party = picker({ options: lk.customers, listKey: 'qt-party', value: q?.party_id || null, placeholder: 'العميل المسجّل' });
    pk.project = picker({ options: lk.projects, listKey: 'qt-proj-' + coSel.value, value: q?.project_id || null, placeholder: 'بدون مشروع' });
    pk.party.el.disabled = pk.project.el.disabled = !editable;
    slot.party.replaceChildren(pk.party.el); slot.project.replaceChildren(pk.project.el);
    showParty();
  }
  const partyField = h('div'); const prospectField = h('div', { class: 'form-grid', style: { gridColumn: '1 / -1' } });
  function showParty() {
    partyField.style.display = prospect.checked ? 'none' : '';
    prospectField.style.display = prospect.checked ? '' : 'none';
  }
  prospect.onchange = showParty; coSel.onchange = loadCompany;
  [prospect, pName, pPhone, attention, date, valid, intro, discount, vatOn, title, terms, notes].forEach((x) => { x.disabled = !editable; });
  tplSel.disabled = !editable;
  discount.oninput = drawTotals; vatOn.onchange = drawTotals;

  const amount = (x) => Math.round((Number(x.qty) || 0) * (Number(x.price) || 0) * 100) / 100;
  function drawItems() {
    const unitList = h('datalist', { id: 'qt-units' }, UNITS.map((u) => h('option', { value: u })));
    const row = (x, i) => {
      const inp = (k, o = {}) => {
        const e = h(o.area ? 'textarea' : 'input', { class: 'input', type: o.num ? 'number' : 'text', step: o.num ? 'any' : null, rows: o.area ? 1 : null,
          value: x[k] ?? '', disabled: !editable, placeholder: o.ph || '', list: o.list || null, style: o.area ? { resize: 'vertical', minHeight: '34px' } : {} });
        if (o.area) e.value = x[k] ?? '';
        e.addEventListener('input', () => { x[k] = e.value; sumCell.textContent = num(amount(x)); drawTotals(); });
        return e;
      };
      const sumCell = h('td', { class: 'num' }, num(amount(x)));
      return h('tr', {},
        h('td', { style: { width: '34px', textAlign: 'center' } }, String(i + 1)),
        h('td', {}, inp('description', { ph: 'البيان', area: true })),
        h('td', { style: { width: '110px' } }, inp('unit', { ph: 'الوحدة', list: 'qt-units' })),
        h('td', { style: { width: '100px' } }, inp('qty', { num: true })), h('td', { style: { width: '140px' } }, inp('price', { num: true })), sumCell,
        h('td', { style: { width: '70px' } }, editable ? h('div', { style: { display: 'flex', gap: '2px' } },
          i > 0 ? h('button', { class: 'btn ghost', title: 'لأعلى', onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; drawItems(); } }, '↑') : null,
          items.length > 1 ? h('button', { class: 'btn ghost', title: 'حذف السطر', onclick: () => { items.splice(i, 1); drawItems(); } }, '×') : null) : null));
    };
    itemsBox.replaceChildren(unitList, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
      h('thead', {}, h('tr', {}, ['م', 'البيان', 'الوحدة', 'الكمية', 'سعر الوحدة', 'الإجمالي', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, items.map(row)))),
    editable ? h('button', { class: 'btn ghost', style: { marginTop: '6px' }, onclick: () => { items.push({ description: '', unit: items[items.length - 1]?.unit || '', qty: 1, price: '' }); drawItems(); } }, '＋ بند') : null);
    drawTotals();
  }
  function calc() {
    const sub = items.reduce((s, x) => s + amount(x), 0);
    const d = Number(discount.value) || 0;
    const base = sub - d; const vat = Math.round(base * rate() * 100) / 100;
    return { sub, d, base, vat, total: base + vat };
  }
  function drawTotals() {
    const c = calc();
    const R = (label, v, b) => h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, b ? h('b', {}, num(v)) : num(v)));
    totalsBox.replaceChildren(h('table', { class: 'grid report', style: { maxWidth: '420px', marginInlineStart: 'auto' } }, h('tbody', {},
      R('الإجمالي', c.sub), c.d ? R('الخصم', -c.d) : null, c.d ? R('الإجمالي بعد الخصم', c.base) : null,
      R(rate() ? `ضريبة القيمة المضافة ${Math.round(rate() * 100)}%` : 'بدون ضريبة', c.vat), R('الإجمالي شامل الضريبة', c.total, true))),
    h('div', { class: 'help', style: { textAlign: 'end', marginTop: '4px' } }, c.total > 0 ? amountInWords(c.total) : ''));
  }

  const F = (label, input, o = {}) => h('div', { class: 'field' + (o.wide ? ' wide' : '') }, h('label', {}, label, o.req ? h('span', { class: 'req' }, '*') : ''), input,
    o.help ? h('div', { class: 'help' }, o.help) : null);
  partyField.append(F('العميل', slot.party, { req: true }));
  prospectField.append(F('اسم العميل المحتمل', pName, { req: true, help: 'يُسجَّل عميلًا عند تحويل العرض' }), F('جوال العميل', pPhone));
  if (q) {
    const info = [badge(st), ` ${ref(q)} — ${state.companyName(q.company_id)}`,
      q.converted_ref ? ` — حُوّل إلى ${q.converted_kind === 'invoice' ? 'فاتورة' : 'أمر شراء'} ${q.converted_ref}` : '',
      q.display_state === 'rejected' && q.reject_reason ? ` — سبب الرفض: ${q.reject_reason}` : '',
      !q.is_latest ? ' — توجد مراجعة أحدث من هذا العرض' : ''];
    m.body.append(h('div', { class: 'notice', style: { marginBottom: '12px' } }, ...info));
  }
  m.body.append(
    h('div', { class: 'form-grid' },
      F('الشركة', coSel, { req: true }), F('اسم العرض', title, { req: true, help: 'يظهر في الموضوع وفي اسم ملف PDF' }),
      h('div', { class: 'field' }, h('label', { class: 'check' }, prospect, 'عميل محتمل (غير مسجّل)')), partyField, prospectField,
      F('عناية', attention), F('المشروع', slot.project),
      F('تاريخ العرض', date, { req: true }), F('مدة الصلاحية (يوم)', valid),
      F('المقدمة', intro, { wide: true })),
    h('div', { class: 'section-title' }, 'البنود'), itemsBox,
    h('div', { class: 'toolbar', style: { margin: '10px 0' } }, h('label', {}, 'خصم (مبلغ)'), discount, h('label', { class: 'check' }, vatOn, 'إضافة ضريبة القيمة المضافة'), h('div', { class: 'grow' })),
    totalsBox,
    h('div', { class: 'section-title' }, 'الشروط والأحكام'), h('div', { class: 'toolbar', style: { marginBottom: '6px' } }, tplSel), terms,
    h('div', { class: 'form-grid', style: { marginTop: '10px' } }, F('ملاحظات داخلية', notes, { wide: true })), err);
  await loadCompany();
  drawItems();

  const payload = () => ({
    id: q?.id, company_id: coSel.value, title: title.value, quote_date: date.value, valid_days: Number(valid.value) || 30,
    party_id: prospect.checked ? null : pk.party.id || null, prospect_name: prospect.checked ? pName.value : null, prospect_phone: prospect.checked ? pPhone.value : null,
    attention: attention.value, project_id: pk.project.id || null, intro: intro.value, discount: Number(discount.value) || 0, vat_rate: rate(),
    items: items.map((x) => ({ description: x.description, unit: x.unit, qty: x.qty, price: x.price })), terms: terms.value, notes: notes.value,
  });
  const run = async (fn, ok) => { err.style.display = 'none'; try { const r = await fn(); if (ok) toast(ok, 'ok'); return r ?? true; } catch (e) { err.textContent = e.message; err.style.display = ''; return null; } };
  const reopen = (id) => { m.close(); done(); quoteEditor({ id, onDone: opts.onDone }); };
  const save = async (then) => {
    const r = await run(() => rpc('save_quotation', { p: payload() }, 'accounting'));
    if (!r) return;
    if (then === 'send') { if (!(await run(() => rpc('set_quotation_state', { p_id: r.id, p_state: 'sent' }, 'accounting'), `أُرسل العرض ${r.quote_no}`))) return; }
    else toast(`حُفظ العرض ${r.quote_no}`, 'ok');
    if (then === 'print' || then === 'send') { const { data } = await acc.from('v_quotations').select('*').eq('id', r.id).single(); if (data) printQuote(data); }
    reopen(r.id);
  };
  const setState = async (s, okMsg, reason) => { if (await run(() => rpc('set_quotation_state', { p_id: q.id, p_state: s, p_reason: reason || null }, 'accounting'), okMsg)) reopen(q.id); };

  const btns = [];
  const lvl2 = state.can('accounting', 2);
  if (editable) {
    btns.push(h('button', { class: 'btn primary', onclick: () => save('send') }, 'حفظ وطباعة وتعليم كمُرسَل'),
      h('button', { class: 'btn', onclick: () => save('print') }, 'حفظ وطباعة'), h('button', { class: 'btn', onclick: () => save() }, 'حفظ مسودة'));
    if (q) btns.push(h('button', { class: 'btn ghost', onclick: async () => {
      if (!(await confirmDialog(`حذف مسودة العرض ${ref(q)}؟`, { ok: 'حذف', danger: true }))) return;
      if (await run(() => rpc('discard_quotation', { p_id: q.id }, 'accounting'), 'حُذفت المسودة')) { m.close(); done(); }
    } }, 'حذف المسودة'));
  }
  if (q && !editable) btns.push(h('button', { class: 'btn primary', onclick: () => printQuote(q) }, 'طباعة / PDF'));
  if (q && lvl2 && ['sent', 'expired', 'draft'].includes(st) && !editable) {
    btns.push(h('button', { class: 'btn', onclick: () => setState('accepted', 'سُجّل قبول العميل') }, 'قبِله العميل'),
      h('button', { class: 'btn', onclick: async () => { const r = await askReason('سبب الرفض', { ok: 'تسجيل الرفض', note: 'السبب يساعدك في متابعة العروض لاحقًا (السعر، المدة، اختار منافسًا…)' }); if (r) setState('rejected', 'سُجّل الرفض', r); } }, 'رفضه العميل'));
  }
  if (q && lvl2 && ['sent', 'expired', 'accepted', 'rejected'].includes(st) && q.is_latest) {
    btns.push(h('button', { class: 'btn', onclick: async () => { const id = await run(() => rpc('revise_quotation', { p_id: q.id }, 'accounting'), 'أُنشئت مراجعة جديدة — عدّلها ثم أرسلها'); if (id) reopen(id); } }, 'مراجعة جديدة'));
  }
  if (q && lvl2 && ['accepted', 'sent', 'expired'].includes(st)) {
    btns.push(h('button', { class: 'btn accent', onclick: () => convert(q, 'invoice', () => { m.close(); done(); }) }, 'تحويل إلى فاتورة'),
      h('button', { class: 'btn accent', onclick: () => convert(q, 'po', () => { m.close(); done(); }) }, 'تحويل إلى أمر شراء'));
  }
  btns.push(h('button', { class: 'btn', onclick: m.close }, 'إغلاق'));
  m.foot.append(...btns);
}

// ---------------------------------------------------------------------
// التحويل: العميل المحتمل يُسجَّل أولًا، ثم تُفتح الفاتورة / أمر الشراء معبّأة، وعند الحفظ يُربط العرض
// ---------------------------------------------------------------------
async function convert(q, kind, closed) {
  let party = q.party_id;
  if (!party) {
    if (!(await confirmDialog(`«${q.customer_name}» عميل محتمل غير مسجّل. سيُسجَّل عميلًا جديدًا ثم يُفتح ${kind === 'invoice' ? 'الفاتورة' : 'أمر الشراء'}. متابعة؟`, { ok: 'تسجيل ومتابعة' }))) return;
    try {
      const r = await rpc('quick_add_party', { p_name: q.customer_name, p_customer: true, p_supplier: false, p_tax: null }, 'accounting');
      party = r.id;
      toast(`سُجّل العميل ${r.code || ''}`, 'ok');
    } catch (e) { toast(e.message, 'bad'); return; }
  }
  const base = Number(q.subtotal) - Number(q.discount);
  const link = async (id) => {
    if (!id) return;
    await rpc('link_quotation', { p_id: q.id, p_kind: kind, p_target: id }, 'accounting');
    toast(`رُبط العرض ${q.quote_no} بما حُوّل إليه`, 'ok');
  };
  closed();
  if (kind === 'invoice') {
    // الخصم يُوزَّع على أسعار البنود بالنسبة نفسها (لا تقبل الفاتورة أسطرًا سالبة)
    const f = Number(q.subtotal) ? base / Number(q.subtotal) : 1;
    const items = q.items.map((x) => ({ description: [x.description, x.unit ? `(${x.unit})` : ''].filter(Boolean).join(' '), qty: Number(x.qty), price: Math.round(Number(x.price) * f * 100) / 100 }));
    // فرق التقريب يُحمَّل على بند كميته 1 إن وُجد (ليطابق الإجمالي العرض بالهللة)، وإلا على آخر بند
    const diff = Math.round((base - items.reduce((s, x) => s + Math.round(x.qty * x.price * 100) / 100, 0)) * 100) / 100;
    if (Math.abs(diff) >= 0.01) {
      const t = items.find((x) => x.qty === 1) || items[items.length - 1];
      t.price = Math.round((t.price + diff / t.qty) * 100) / 100;
    }
    if (Number(q.discount)) toast('وُزّع خصم العرض على أسعار البنود — راجع الإجمالي قبل الحفظ', '');
    salesEditor({ company_id: q.company_id, prefill: { party_id: party, project_id: q.project_id, items, no_vat: Number(q.vat_rate) === 0, notes: `من عرض السعر ${ref(q)}` }, onSaved: link });
  } else {
    contractForm(null, link, { company_id: q.company_id, kind: 'po', title: q.title, contract_value: base, project_id: q.project_id, party_id: party, notes: `من عرض السعر ${ref(q)}` });
  }
}

// ---------------------------------------------------------------------
// الطباعة على ترويسة الشركة → PDF (اسم الملف = رقم العرض واسمه)
// ---------------------------------------------------------------------
export async function printQuote(q) {
  await refreshCompanies();
  const { data: lh } = await core.from('company_letterheads').select('*').eq('company_id', q.company_id).eq('status', 'active').maybeSingle();
  const co = companyInfo(q.company_id) || {};
  const hasLh = !!lh?.image;
  const top = hasLh ? Number(lh.top_mm) : 12, bottom = hasLh ? Number(lh.bottom_mm) : 12, side = hasLh ? Number(lh.side_mm) : 14;
  document.getElementById('print-area')?.remove();
  document.getElementById('print-page')?.remove();
  const d = new Date(q.quote_date + 'T12:00:00');
  const meta = (k, v) => h('tr', {}, h('th', {}, k), h('td', {}, v));
  const vatPct = Math.round(Number(q.vat_rate) * 100);
  const content = h('div', { class: 'qt-body' },
    hasLh ? null : h('div', { class: 'qt-plainhead' },
      brand.logo ? h('img', { class: 'rp-logo', src: brand.logo, alt: '' }) : null,
      h('div', {}, h('div', { class: 'rp-co' }, co.name || ''), h('div', { class: 'rp-meta' },
        [co.cr_number && 'س.ت: ' + co.cr_number, co.vat_number && 'الرقم الضريبي: ' + co.vat_number, co.address, co.phone && 'هاتف: ' + co.phone].filter(Boolean).join(' — ')))),
    h('div', { class: 'qt-title' }, 'عرض سعر'),
    h('div', { class: 'qt-top' },
      h('div', { class: 'qt-to' },
        h('div', {}, 'السادة / ', h('b', {}, q.customer_name), ' المحترمين'),
        q.attention ? h('div', {}, 'عناية: ', q.attention) : null,
        q.customer_vat ? h('div', { class: 'qt-small' }, 'الرقم الضريبي: ', h('span', { class: 'ltr' }, q.customer_vat)) : null,
        q.project_name ? h('div', {}, 'المشروع: ', q.project_name) : null),
      h('table', { class: 'qt-meta' }, h('tbody', {},
        meta('رقم العرض', h('span', { class: 'ltr' }, q.quote_no + (q.revision > 1 ? ` / R${q.revision}` : ''))),
        meta('التاريخ', fmt.date(q.quote_date) + (brand.hijri ? ` — ${hijri(d)}` : '')),
        meta('صالح حتى', fmt.date(q.valid_until))))),
    h('div', { class: 'qt-subject' }, 'الموضوع: ', h('b', {}, q.title)),
    q.intro ? h('div', { class: 'qt-intro' }, q.intro) : null,
    h('table', { class: 'qt-items' },
      h('thead', {}, h('tr', {}, ['م', 'البيان', 'الوحدة', 'الكمية', 'سعر الوحدة', 'الإجمالي'].map((x) => h('th', {}, x)))),
      h('tbody', {}, q.items.map((x, i) => h('tr', {},
        h('td', { class: 'c' }, String(i + 1)), h('td', { class: 'desc' }, x.description), h('td', { class: 'c' }, x.unit || ''),
        h('td', { class: 'n' }, qty(x.qty)), h('td', { class: 'n' }, num(x.price)), h('td', { class: 'n' }, num(x.amount ?? Number(x.qty) * Number(x.price))))))),
    h('div', { class: 'qt-sum' },
      h('div', { class: 'qt-words' }, h('b', {}, 'المبلغ كتابةً: '), amountInWords(q.total)),
      h('table', { class: 'qt-totals' }, h('tbody', {},
        h('tr', {}, h('th', {}, 'الإجمالي'), h('td', {}, num(q.subtotal))),
        Number(q.discount) ? h('tr', {}, h('th', {}, 'الخصم'), h('td', {}, '(' + num(q.discount) + ')')) : null,
        Number(q.discount) ? h('tr', {}, h('th', {}, 'الإجمالي بعد الخصم'), h('td', {}, num(Number(q.subtotal) - Number(q.discount)))) : null,
        h('tr', {}, h('th', {}, vatPct ? `ضريبة القيمة المضافة ${vatPct}%` : 'ضريبة القيمة المضافة'), h('td', {}, vatPct ? num(q.vat_amount) : 'لا تشمل')),
        h('tr', { class: 'grand' }, h('th', {}, vatPct ? 'الإجمالي شامل الضريبة' : 'الإجمالي'), h('td', {}, num(q.total)))))),
    q.terms ? h('div', { class: 'qt-terms' }, h('div', { class: 'qt-h' }, 'الشروط والأحكام'), h('div', { class: 'qt-pre' }, q.terms)) : null,
    h('div', { class: 'qt-sign' },
      h('div', {}, 'وتفضلوا بقبول فائق الاحترام والتقدير،'),
      h('div', { class: 'qt-signer' }, h('div', {}, co.name || ''), lh?.signer ? h('b', {}, lh.signer) : null, lh?.signer_title ? h('div', {}, lh.signer_title) : null,
        h('div', { class: 'qt-line' }, 'التوقيع والختم'))));
  const area = h('div', { id: 'print-area', class: 'qt' },
    hasLh ? h('img', { class: 'qt-bg', src: lh.image, alt: '' }) : null,
    h('table', { class: 'qt-frame' },
      h('thead', {}, h('tr', {}, h('td', { style: { height: top + 'mm' } }))),
      h('tfoot', {}, h('tr', {}, h('td', { style: { height: bottom + 'mm' } }))),
      h('tbody', {}, h('tr', {}, h('td', { style: { padding: `0 ${side}mm` } }, content)))));
  const page = h('style', { id: 'print-page' }, '@media print { @page { size: A4 portrait; margin: 0; } }');
  document.head.append(page);
  document.body.append(area);
  const oldTitle = document.title;
  document.title = `${q.quote_no}${q.revision > 1 ? '-R' + q.revision : ''} ${q.title}`.replace(/[\\/:*?"<>|]/g, '-');
  document.body.classList.add('printing');
  const fin = () => { document.body.classList.remove('printing'); area.remove(); page.remove(); document.title = oldTitle; window.removeEventListener('afterprint', fin); };
  window.addEventListener('afterprint', fin);
  // انتظار تحميل صورة الترويسة قبل الطباعة
  const img = area.querySelector('.qt-bg');
  if (img && !img.complete) await new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 3000); });
  setTimeout(() => window.print(), 80);
}

// ---------------------------------------------------------------------
// الترويسة: صورة A4 لكل شركة + هوامش منطقة الكتابة (معاينة مباشرة)
// ---------------------------------------------------------------------
function resizeA4(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const W = 1240, H = 1754;   // A4 بدقة 150 نقطة/بوصة
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.drawImage(img, 0, 0, W, H);
      resolve({ url: c.toDataURL('image/jpeg', 0.85), ratio: img.height / img.width });
    };
    img.onerror = () => reject(new Error('تعذّرت قراءة الصورة — ارفع PNG أو JPG'));
    img.src = URL.createObjectURL(file);
  });
}

export async function letterheadDialog() {
  const m = modal({ title: 'ترويسة الشركات لعروض الأسعار', size: 'wide' });
  const coSel = h('select', { class: 'input', style: { width: 'auto' } }, state.companies().map((c) => h('option', { value: c.id }, c.name)));
  const box = h('div');
  m.body.append(h('div', { class: 'toolbar', style: { marginBottom: '10px' } }, h('label', {}, 'الشركة'), coSel,
    h('span', { class: 'help' }, 'صورة صفحة A4 كاملة (طولية) فيها الشعار والبيانات. حدّد المساحة الفارغة التي يكتب فيها النظام.')), box);
  m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'إغلاق'));
  async function build() {
    const co = coSel.value;
    const { data: cur } = await core.from('company_letterheads').select('*').eq('company_id', co).maybeSingle();
    let image = cur?.image || null;
    const N = (v, max) => h('input', { class: 'input', type: 'number', step: '0.5', min: 0, max, value: v, style: { width: '90px' } });
    const top = N(cur?.top_mm ?? 45, 150), bottom = N(cur?.bottom_mm ?? 25, 150), side = N(cur?.side_mm ?? 15, 60);
    const signer = h('input', { class: 'input', value: cur?.signer || '' }), signerT = h('input', { class: 'input', value: cur?.signer_title || '' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg', style: { display: 'none' } });
    const warn = h('div', { class: 'help' });
    const prev = h('div', { class: 'lh-prev' });
    const draw = () => {
      prev.replaceChildren(image ? h('img', { src: image, alt: '' }) : h('div', { class: 'lh-empty' }, 'لا توجد صورة — يُطبع العرض بترويسة بسيطة من بيانات الشركة'),
        h('div', { class: 'lh-area', style: { top: (Number(top.value) / 297 * 100) + '%', bottom: (Number(bottom.value) / 297 * 100) + '%', left: (Number(side.value) / 210 * 100) + '%', right: (Number(side.value) / 210 * 100) + '%' } },
          h('span', {}, 'منطقة الكتابة')));
    };
    [top, bottom, side].forEach((x) => x.addEventListener('input', draw));
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try {
        const r = await resizeA4(f);
        image = r.url;
        warn.textContent = Math.abs(r.ratio - 297 / 210) > 0.05 ? '⚠ أبعاد الصورة ليست بنسبة A4 الطولية — مُدّت لتملأ الصفحة. الأفضل تصديرها من Word كصفحة A4 كاملة.' : '';
        draw();
      } catch (e) { toast(e.message, 'bad'); }
    });
    const F = (label, input, help) => h('div', { class: 'field' }, h('label', {}, label), input, help ? h('div', { class: 'help' }, help) : null);
    const save = h('button', { class: 'btn primary', onclick: async () => {
      const row = { company_id: co, image, top_mm: Number(top.value) || 0, bottom_mm: Number(bottom.value) || 0, side_mm: Number(side.value) || 0,
        signer: signer.value.trim() || null, signer_title: signerT.value.trim() || null };
      save.disabled = true;
      const { error } = cur ? await core.from('company_letterheads').update(row).eq('id', cur.id) : await core.from('company_letterheads').insert(row);
      save.disabled = false;
      if (error) toast(error.message, 'bad'); else { toast('حُفظت الترويسة', 'ok'); build(); }
    } }, 'حفظ');
    box.replaceChildren(h('div', { class: 'lh-grid' },
      prev,
      h('div', {},
        h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: () => file.click() }, image ? 'تغيير الصورة' : 'رفع صورة الترويسة'),
          image ? h('button', { class: 'btn ghost', onclick: () => { image = null; draw(); } }, 'إزالة') : null, file),
        warn,
        h('div', { class: 'form-grid', style: { marginTop: '10px' } },
          F('الهامش العلوي (مم)', top, 'ارتفاع منطقة الشعار في الأعلى'), F('الهامش السفلي (مم)', bottom, 'ارتفاع التذييل في الأسفل'),
          F('الهامش الجانبي (مم)', side), h('div'),
          F('اسم الموقِّع', signer), F('صفة الموقِّع', signerT, 'مثال: المدير المالي')),
        h('p', { class: 'help' }, 'نصيحة: من Word افتح الترويسة ← حفظ باسم ← PDF، ثم حوّل الصفحة إلى صورة (أو التقط لها صورة بدقة عالية).'),
        h('div', { class: 'toolbar', style: { marginTop: '10px' } }, save))));
    draw();
  }
  coSel.onchange = build;
  build();
}

// قوالب الشروط والأحكام والمقدمة الافتراضية
export async function termsDialog() {
  const m = modal({ title: 'قوالب الشروط لعروض الأسعار', size: 'wide' });
  const { data: rows } = await core.from('settings').select('*').is('company_id', null).in('key', ['quote.terms', 'quote.intro', 'quote.valid_days']);
  const get = (k) => rows?.find((r) => r.key === k);
  let list = (get('quote.terms')?.value || []).map((x) => ({ ...x }));
  const intro = h('textarea', { class: 'input', rows: 2 }, get('quote.intro')?.value || '');
  const valid = h('input', { class: 'input', type: 'number', min: 1, max: 365, value: get('quote.valid_days')?.value ?? 30, style: { width: '100px' } });
  const box = h('div');
  const draw = () => box.replaceChildren(...list.map((x, i) => h('div', { class: 'card', style: { marginBottom: '8px' } },
    h('div', { class: 'toolbar' }, (() => { const e = h('input', { class: 'input', value: x.name, placeholder: 'اسم القالب' }); e.oninput = () => { x.name = e.value; }; return e; })(),
      h('div', { class: 'grow' }), h('button', { class: 'btn ghost', onclick: () => { list.splice(i, 1); draw(); } }, 'حذف')),
    (() => { const e = h('textarea', { class: 'input', rows: 5, style: { marginTop: '6px' } }, x.text); e.oninput = () => { x.text = e.value; }; return e; })())),
  h('button', { class: 'btn', onclick: () => { list.push({ name: 'قالب جديد', text: '' }); draw(); } }, '＋ قالب'));
  draw();
  m.body.append(h('div', { class: 'form-grid' },
    h('div', { class: 'field wide' }, h('label', {}, 'المقدمة الافتراضية'), intro), h('div', { class: 'field' }, h('label', {}, 'مدة الصلاحية الافتراضية (يوم)'), valid)),
  h('div', { class: 'section-title' }, 'قوالب الشروط والأحكام'), box);
  const upsert = async (key, value, description) => {
    const r = get(key);
    const { error } = r ? await core.from('settings').update({ value }).eq('id', r.id) : await core.from('settings').insert({ key, value, description });
    if (error) throw new Error(error.message);
  };
  m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
    try {
      await upsert('quote.terms', list.filter((x) => x.name.trim() && x.text.trim()), 'قوالب الشروط والأحكام لعروض الأسعار');
      await upsert('quote.intro', intro.value, 'المقدمة الافتراضية لعروض الأسعار');
      await upsert('quote.valid_days', Number(valid.value) || 30, 'مدة صلاحية عرض السعر الافتراضية (بالأيام)');
      toast('حُفظت القوالب', 'ok'); m.close();
    } catch (e) { toast(e.message, 'bad'); }
  } }, 'حفظ'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

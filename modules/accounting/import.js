// استيراد القيود والأرصدة الافتتاحية من Excel (مثلًا من المنارة)
//   كل صف = سطر قيد. الصفوف اللي ليها نفس "رقم القيد" = قيد واحد. القيد بيتحفظ بنفس قواعد صفحة القيود بالظبط.
//   رقم القيد بيتسجل كمرجع: القيد اللي اتستورد قبل كده بيتخطى (تقدر ترفع نفس الملف تاني بعد ما تصلّح الغلط)
import { acc, rpc } from '../../shared/sb.js';
import { h, fmt, toast } from '../../shared/ui.js';
import { norm } from '../../shared/combo.js';
import { loadLookups, companySelect } from './lookups.js';
import { state } from '../../shared/state.js';

const COLS = [
  ['ref', 'رقم القيد', true, 'مرجع القيد في النظام القديم — الصفوف اللي ليها نفس الرقم قيد واحد'],
  ['date', 'التاريخ', true, 'تاريخ القيد'],
  ['desc', 'البيان', true, 'بيان القيد (من أول صف في القيد)'],
  ['type', 'النوع', false, 'عادي / افتتاحي / تسوية (فاضي = عادي)'],
  ['account', 'كود الحساب', true, 'كود حساب تفصيلي في الشجرة'],
  ['debit', 'مدين', false, ''], ['credit', 'دائن', false, ''],
  ['party', 'الطرف', false, 'كود أو اسم العميل/المورد كما في البيانات الأساسية'],
  ['employee', 'الموظف', false, 'رقم الموظف (لحسابات الموظفين)'],
  ['inv', 'رقم الفاتورة', false, ''], ['invdate', 'تاريخ الفاتورة', false, ''], ['due', 'تاريخ الاستحقاق', false, 'اختياري'],
  ['base', 'المبلغ الخاضع', false, 'لسطر حساب الضريبة (فاضي = الضريبة ÷ 15%)'],
  ['cat', 'الفئة الضريبية', false, 'صفري / معفى (لسطر الإيراد أو المصروف)'],
  ['project', 'المشروع', false, 'كود المشروع'], ['cc', 'مركز التكلفة', false, 'كود المركز'], ['eq', 'المعدة', false, 'كود المعدة'],
  ['note', 'بيان السطر', false, ''],
];
const TYPES = { 'عادي': 'regular', '': 'regular', 'افتتاحي': 'opening', 'تسوية': 'adjustment', regular: 'regular', opening: 'opening', adjustment: 'adjustment' };
const CATS = { 'صفري': 'zero', 'معفى': 'exempt', 'معفي': 'exempt', zero: 'zero', exempt: 'exempt' };
const CHUNK = 200;

function toDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) { const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); }
  if (typeof v === 'number' && window.XLSX?.SSF) { const d = window.XLSX.SSF.parse_date_code(v); if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
  const s = String(v).trim().replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return 'غلط:' + s;
}
const toNum = (v) => { if (v === null || v === undefined || v === '') return 0; const n = Number(String(v).replace(/[,\s]/g, '').replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };

function template() {
  const wb = window.XLSX.utils.book_new();
  const head = COLS.map((c) => c[1]);
  const ex = [
    ['OB-1', '2026-01-01', 'رصيد افتتاحي', 'افتتاحي', '1102', 500000, '', '', '', '', '', '', '', '', '', '', '', ''],
    ['OB-1', '2026-01-01', 'رصيد افتتاحي', 'افتتاحي', '1201', 115000, '', 'C-001', '', 'INV-2025-9', '2025-12-20', '', '', '', '', '', '', 'فاتورة مرحّلة'],
    ['OB-1', '2026-01-01', 'رصيد افتتاحي', 'افتتاحي', '3101', '', 615000, '', '', '', '', '', '', '', '', '', '', ''],
    ['1532', '2026-01-05', 'فاتورة مواد', '', '5101', 1000, '', '', '', '', '', '', '', '', 'PRJ-101', '', '', ''],
    ['1532', '2026-01-05', 'فاتورة مواد', '', '1301', 150, '', 'S-001', '', 'F-77', '2026-01-05', '', '', '', '', '', '', ''],
    ['1532', '2026-01-05', 'فاتورة مواد', '', '2101', '', 1150, 'S-001', '', 'F-77', '2026-01-05', '2026-02-04', '', '', '', '', '', ''],
  ];
  const ws = window.XLSX.utils.aoa_to_sheet([head, ...ex]);
  ws['!cols'] = head.map(() => ({ wch: 16 }));
  window.XLSX.utils.book_append_sheet(wb, ws, 'القيود');
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet([['العمود', 'مطلوب', 'ملاحظات'], ...COLS.map((c) => [c[1], c[2] ? 'نعم' : '', c[3]]),
    [], ['ملاحظات عامة'], ['كل صف = سطر قيد. الصفوف اللي ليها نفس رقم القيد = قيد واحد ولازم يكون متوازن.'],
    ['القيود بتتحفظ بترتيب التاريخ، وبنفس قواعد صفحة القيود (الطرف والمشروع والمركز الإجبارية، الفواتير، الضريبة، منع الرصيد السالب للنقدية).'],
    ['القيد اللي رقمه اتستورد قبل كده بيتخطى — تقدر ترفع نفس الملف تاني بعد التصحيح.'],
    ['الأرصدة الافتتاحية: قيد واحد نوعه "افتتاحي" فيه كل حسابات الميزانية، والعملاء والموردين بفواتيرهم المفتوحة.']]), 'تعليمات');
  window.XLSX.writeFile(wb, 'قالب استيراد القيود.xlsx');
}

export function renderImport(el) {
  let company; let lk; let parsed = null;
  const sel = companySelect(async (v) => { company = v; lk = await loadLookups(company); reset(); }); company = sel.value;
  const file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'input', style: { width: 'auto' } });
  const out = h('div');
  const reset = () => { parsed = null; file.value = ''; out.replaceChildren(h('div', { class: 'notice' }, 'نزّل القالب، املأه (أو حط فيه تصدير المنارة بنفس الأعمدة)، وارفعه هنا. هتشوف مراجعة كاملة قبل أي حفظ.')); };
  el.replaceChildren(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'toolbar' },
    h('label', { style: { fontWeight: 600 } }, 'الشركة:'), sel, file, h('div', { class: 'grow' }),
    h('button', { class: 'btn', onclick: template }, 'تنزيل القالب'))), out);
  loadLookups(company).then((x) => { lk = x; reset(); });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ قراءة الملف…'));
    try {
      const wb = window.XLSX.read(await f.arrayBuffer(), { cellDates: false });   // التواريخ كأرقام Excel (التحويل لـ Date بيزحلق يوم حسب المنطقة الزمنية)
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      parsed = await parse(aoa);
      show();
    } catch (e) { out.replaceChildren(h('div', { class: 'notice bad' }, 'تعذر قراءة الملف: ' + e.message)); }
  });

  async function parse(aoa) {
    const head = (aoa[0] || []).map((x) => norm(x));
    const idx = {}; const missing = [];
    for (const [k, label, req] of COLS) { const i = head.indexOf(norm(label)); idx[k] = i; if (i < 0 && req) missing.push(label); }
    if (missing.length) throw new Error('أعمدة ناقصة في الصف الأول: ' + missing.join('، '));
    const get = (row, k) => (idx[k] >= 0 ? row[idx[k]] : '');
    const findBy = (list, v, ...keys) => { const n = norm(v); if (!n) return null; for (const k of keys) { const o = list.find((x) => norm(x[k]) === n); if (o) return o; } return null; };
    const postable = lk.accounts.filter((a) => a.row.is_postable);
    const errors = []; const entries = []; const byRef = new Map();
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r]; if (!row || row.every((x) => x === '' || x === null)) continue;
      const rn = r + 1; const err = (m) => errors.push({ row: rn, msg: m });
      const ref = String(get(row, 'ref') ?? '').trim();
      if (!ref) { err('رقم القيد فاضي'); continue; }
      let e = byRef.get(ref);
      if (!e) {
        const date = toDate(get(row, 'date')); const typ = TYPES[String(get(row, 'type') || '').trim()];
        e = { ref, date, desc: String(get(row, 'desc') || '').trim(), type: typ || 'regular', lines: [], rows: [] };
        if (!date || date.startsWith('غلط')) err('تاريخ القيد غلط: ' + (date || 'فاضي'));
        if (!e.desc) err('البيان فاضي');
        if (!typ) err('النوع غلط: ' + get(row, 'type'));
        byRef.set(ref, e); entries.push(e);
      }
      e.rows.push(rn);
      const a = findBy(postable, get(row, 'account'), 'code');
      if (!a) { err(`كود الحساب "${get(row, 'account')}" مش موجود (أو حساب مجمّع)`); continue; }
      const dr = toNum(get(row, 'debit')), cr = toNum(get(row, 'credit'));
      if (Number.isNaN(dr) || Number.isNaN(cr)) { err('المبلغ مش رقم'); continue; }
      const l = { account_id: a.id, debit: dr, credit: cr };
      const pv = get(row, 'party'); if (String(pv).trim()) { const p = findBy(lk.parties, pv, 'code', 'name'); if (p) l.party_id = p.id; else err(`الطرف "${pv}" مش موجود في البيانات الأساسية`); }
      const ev = get(row, 'employee'); if (String(ev).trim()) { const p = findBy(lk.employees, ev, 'code', 'name'); if (p) l.employee_id = p.id; else err(`الموظف "${ev}" مش موجود في الشركة دي`); }
      const pj = get(row, 'project'); if (String(pj).trim()) { const p = findBy(lk.projects, pj, 'code', 'name'); if (p) l.project_id = p.id; else err(`المشروع "${pj}" مش موجود أو الشركة مش مشاركة فيه`); }
      const cc = get(row, 'cc'); if (String(cc).trim()) { const p = findBy(lk.costCenters, cc, 'code', 'name'); if (p) l.cost_center_id = p.id; else err(`مركز التكلفة "${cc}" مش موجود`); }
      const eq = get(row, 'eq'); if (String(eq).trim()) { const p = findBy(lk.equipment, eq, 'code'); if (p) l.equipment_id = p.id; else err(`المعدة "${eq}" مش موجودة`); }
      const inv = String(get(row, 'inv') ?? '').trim(); if (inv) l.invoice_no = inv;
      const id = toDate(get(row, 'invdate')); if (id) { if (id.startsWith('غلط')) err('تاريخ الفاتورة غلط'); else l.invoice_date = id; }
      const du = toDate(get(row, 'due')); if (du) { if (du.startsWith('غلط')) err('تاريخ الاستحقاق غلط'); else l.due_date = du; }
      const b = toNum(get(row, 'base')); if (b) l.tax_base = b;
      const ct = String(get(row, 'cat') || '').trim(); if (ct) { if (CATS[ct]) l.tax_category = CATS[ct]; else err('الفئة الضريبية غلط: ' + ct); }
      const nt = String(get(row, 'note') || '').trim(); if (nt) l.description = nt;
      l._row = rn; e.lines.push(l);
    }
    for (const e of entries) {
      const d = e.lines.reduce((s, l) => s + l.debit, 0), c = e.lines.reduce((s, l) => s + l.credit, 0);
      e.total = Math.round(d * 100) / 100;
      if (e.lines.length < 2) errors.push({ row: e.rows[0], msg: `القيد ${e.ref}: محتاج سطرين على الأقل` });
      if (Math.round((d - c) * 100) !== 0) errors.push({ row: e.rows[0], msg: `القيد ${e.ref}: غير متوازن (مدين ${fmt.num(d)} — دائن ${fmt.num(c)})` });
    }
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // المستورد قبل كده
    const done = new Map();
    const refs = entries.map((e) => e.ref);
    for (let i = 0; i < refs.length; i += 300) {
      const { data, error } = await acc.from('journal_entries').select('external_ref, fiscal_year, entry_no').eq('company_id', company).eq('status', 'active').in('external_ref', refs.slice(i, i + 300));
      if (error) throw new Error('تعذر فحص القيود المستوردة قبل كده: ' + error.message);
      for (const r of data || []) done.set(r.external_ref, `${r.fiscal_year}-${r.entry_no}`);
    }
    return { entries, errors, done };
  }

  function show() {
    const { entries, errors, done } = parsed;
    const todo = entries.filter((e) => !done.has(e.ref));
    const lines = entries.reduce((s, e) => s + e.lines.length, 0);
    const total = todo.reduce((s, e) => s + e.total, 0);
    const go = h('button', { class: 'btn primary', disabled: errors.length > 0 || !todo.length, onclick: () => run(todo, go) }, `استيراد ${todo.length} قيد`);
    out.replaceChildren(
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, 'قيود في الملف'), h('b', {}, String(entries.length)), h('span', {}, lines + ' سطر')),
        h('div', { class: 'kpi' }, h('small', {}, 'هتتستورد'), h('b', {}, String(todo.length)), h('span', {}, 'بإجمالي ' + fmt.num(total))),
        h('div', { class: 'kpi' }, h('small', {}, 'مستوردة قبل كده'), h('b', {}, String(done.size)), h('span', {}, 'هتتخطى')),
        h('div', { class: 'kpi' + (errors.length ? ' bad' : '') }, h('small', {}, 'أخطاء'), h('b', {}, String(errors.length)), h('span', {}, errors.length ? 'صلّحها في الملف وارفعه تاني' : 'الملف سليم'))),
      errors.length ? h('div', { class: 'card', style: { margin: '12px 0' } }, h('div', { class: 'toolbar' }, h('strong', {}, 'الأخطاء')),
        h('div', { class: 'table-wrap', style: { maxHeight: '320px' } }, h('table', { class: 'grid report' },
          h('thead', {}, h('tr', {}, h('th', {}, 'الصف في Excel'), h('th', {}, 'المشكلة'))),
          h('tbody', {}, errors.slice(0, 500).map((x) => h('tr', {}, h('td', { class: 'num' }, x.row), h('td', {}, x.msg))))))) : '',
      h('div', { class: 'toolbar', style: { margin: '12px 0' } }, go, h('span', { class: 'help' }, `كل ${CHUNK} قيد بيتحفظوا كصفحة واحدة. لو صفحة وقفت بسبب قاعدة (فاتورة مكررة، رصيد سالب…) اللي قبلها بيفضل محفوظ، وتصلّح وترفع الملف تاني.`)),
      h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('strong', {}, 'معاينة (أول 50 قيد)')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
          h('thead', {}, h('tr', {}, ['رقم القيد', 'التاريخ', 'النوع', 'البيان', 'أسطر', 'الإجمالي', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, entries.slice(0, 50).map((e) => h('tr', { class: done.has(e.ref) ? 'dim' : '' },
            h('td', { class: 'ltr' }, e.ref), h('td', {}, e.date), h('td', {}, { regular: 'عادي', opening: 'افتتاحي', adjustment: 'تسوية' }[e.type]),
            h('td', {}, e.desc), h('td', { class: 'num' }, e.lines.length), h('td', { class: 'num' }, fmt.num(e.total)),
            h('td', {}, done.has(e.ref) ? h('span', { class: 'badge' }, 'مستورد: ' + done.get(e.ref)) : ''))))))));
  }

  async function run(todo, btn) {
    btn.disabled = true;
    const prog = h('div', { class: 'help' }); btn.after(prog);
    let ok = 0;
    for (let i = 0; i < todo.length; i += CHUNK) {
      const part = todo.slice(i, i + CHUNK);
      prog.textContent = `جارٍ الحفظ: ${i} من ${todo.length}…`;
      const payload = part.map((e) => ({ external_ref: e.ref, entry_date: e.date, description: e.desc, entry_type: e.type,
        lines: e.lines.map(({ _row, ...l }) => l) }));
      try {
        await rpc('import_batch', { p_company: company, p_entries: payload, p_notes: 'استيراد من Excel' }, 'accounting');
        ok += part.length;
      } catch (err) {
        // "القيد 3، السطر 2: …" ← رقم القيد في الملف وصفه
        const m = String(err.message).match(/القيد (\d+)(?:، السطر (\d+))?/);
        let where = '';
        if (m) { const e = part[Number(m[1]) - 1]; if (e) { const l = m[2] ? e.lines[Number(m[2]) - 1] : null; where = ` — رقم القيد في الملف ${e.ref}` + (l ? ` (صف ${l._row} في Excel)` : ` (صف ${e.rows[0]})`); } }
        prog.replaceWith(h('div', { class: 'notice bad', style: { marginTop: '8px' } }, `اتحفظ ${ok} قيد. وقف عند: ${err.message}${where}`));
        toast('الاستيراد وقف — شوف الرسالة', 'bad');
        return;
      }
    }
    prog.replaceWith(h('div', { class: 'notice ok', style: { marginTop: '8px' } }, `تم استيراد ${ok} قيد في ${state.companyName(company)}.`));
    toast(`تم استيراد ${ok} قيد`, 'ok');
  }
}

// مطابقة البنك: رفع كشف الحساب (Excel/CSV)، والمطابقة التلقائية واليدوية مع قيود حساب البنك، وتسجيل البنود الموجودة في البنك وغير المسجّلة في الدفاتر
import { acc, rpc } from '../../shared/sb.js';
import { readWorkbook } from '../../shared/xlsx-safe.js';
import { h, fmt, modal, toast, askReason } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { norm } from '../../shared/combo.js';
import { loadLookups, companySelect, today } from './lookups.js';
import { dateInput, N } from './reports.js';
import { createEditor, emptyLine } from './editor.js';
import { openEntry } from './register.js';

const FIELDS = [
  ['date', 'التاريخ', /تاريخ|date/i, true],
  ['desc', 'البيان', /بيان|وصف|تفاصيل|شرح|description|details|narrative|particular/i, false],
  ['ref', 'المرجع', /مرجع|رقم العمليه|رقم المرجع|ref/i, false],
  ['out', 'سحب (مدين في كشف البنك)', /مدين|سحب|مسحوب|خصم|debit|withdraw/i, false],
  ['in', 'إيداع (دائن في كشف البنك)', /دائن|ايداع|إيداع|مودع|اضافه|credit|deposit/i, false],
  ['amount', 'المبلغ بإشارته (إن كان عمودًا واحدًا)', /^المبلغ$|^amount$/i, false],
  ['bal', 'الرصيد', /رصيد|balance/i, false],
];

function toDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && window.XLSX?.SSF) { const d = window.XLSX.SSF.parse_date_code(v); if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
  const s = String(v).trim().replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
const toNum = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[,\s]/g, '').replace('٫', '.');
  let neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); } if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  const n = Number(s.replace(/[^\d.-]/g, '')); return isFinite(n) ? (neg ? -Math.abs(n) : n) : 0;
};

export function renderBank(el) {
  let company; let lk; let account = null;
  const sel = companySelect(async (v) => { company = v; await accounts(); load(); }); company = sel.value;
  const accSel = h('select', { class: 'input', style: { width: 'auto', minWidth: '200px' } });
  accSel.onchange = () => { account = accSel.value || null; load(); };
  const asOf = dateInput(today()); asOf.onchange = () => load();
  const days = h('select', { class: 'input', style: { width: 'auto' }, title: 'فرق التاريخ المسموح في المطابقة التلقائية' },
    [0, 3, 7, 15].map((d) => h('option', { value: d, selected: d === 3 }, d ? `± ${d} أيام` : 'نفس اليوم')));
  const out = h('div');
  el.replaceChildren(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'toolbar' },
    sel, accSel, h('span', {}, 'في'), asOf, h('div', { class: 'grow' }),
    h('button', { class: 'btn primary', onclick: () => upload() }, 'رفع كشف حساب'),
    days, h('button', { class: 'btn', onclick: () => auto() }, 'مطابقة تلقائية'))), out);

  async function accounts() {
    lk = await loadLookups(company);
    const cash = lk.accounts.filter((a) => a.row.is_cash_account && a.row.is_postable);
    accSel.replaceChildren(...cash.map((a) => h('option', { value: a.id }, a.label)));
    const bank = cash.find((a) => /بنك|bank|الراجحي|الأهلي|الانماء|الإنماء|الرياض|البلاد/i.test(a.name)) || cash[0];
    account = bank?.id || null; if (bank) accSel.value = bank.id;
  }

  async function auto() {
    if (!account) return;
    try { const n = await rpc('auto_match_bank', { p_account: account, p_days: Number(days.value) }, 'accounting'); toast(`طوبق ${n} سطرًا`, 'ok'); load(); }
    catch (e) { toast(e.message, 'bad'); }
  }

  let sStmt = null; let sBook = null;
  async function load() {
    if (!account) { out.replaceChildren(h('div', { class: 'notice' }, 'لا توجد حسابات نقدية في هذه الشركة.')); return; }
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    sStmt = null; sBook = null;
    const [sum, stmt, book] = await Promise.all([
      rpc('bank_recon_summary', { p_account: account, p_as_of: asOf.value }, 'accounting'),
      acc.from('bank_statement_lines').select('*').eq('account_id', account).eq('status', 'active').lte('txn_date', asOf.value).order('txn_date').limit(5000),
      acc.from('v_bank_book_lines').select('*').eq('account_id', account).lte('entry_date', asOf.value).order('entry_date').limit(10000),
    ]);
    const S = sum[0]; const stl = stmt.data || []; const bl = book.data || [];
    if (!stl.length) {
      out.replaceChildren(h('div', { class: 'notice' }, 'لم يُرفع أي كشف لهذا الحساب بعد. اضغط «رفع كشف حساب» واختر ملف Excel أو CSV من البنك.'));
      return;
    }
    const first = S.first_stmt_date;
    const bankOnly = stl.filter((x) => !x.matched_line_id);
    const bookOnly = bl.filter((x) => !x.stmt_line_id && x.entry_date >= first);
    const matched = stl.filter((x) => x.matched_line_id);
    const bookById = new Map(bl.map((b) => [b.line_id, b]));
    const expected = Number(S.book_balance) - Number(S.book_only_in) + Number(S.book_only_out) + Number(S.bank_only_in) - Number(S.bank_only_out);
    const diff = Math.round((expected - Number(S.bank_balance)) * 100) / 100;
    const q = h('input', { class: 'input', placeholder: 'بحث بالمبلغ أو البيان…', style: { maxWidth: '260px' } });
    const matchBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => manual() }, 'مطابقة المختارين');
    const hint = h('span', { class: 'help' }, 'اختر سطرًا من كل جانب بالمبلغ نفسه.');
    const refreshSel = () => {
      const a = bankOnly.find((x) => x.id === sStmt); const b = bookOnly.find((x) => x.line_id === sBook);
      matchBtn.disabled = !(a && b && Number(a.amount) === Number(b.amount));
      hint.textContent = a && b && Number(a.amount) !== Number(b.amount) ? `المبلغان مختلفان: ${fmt.num(a.amount)} و${fmt.num(b.amount)}` : 'اختر سطرًا من كل جانب بالمبلغ نفسه.';
      listA.querySelectorAll('tr[data-id]').forEach((tr) => tr.classList.toggle('picked', tr.dataset.id === sStmt));
      listB.querySelectorAll('tr[data-id]').forEach((tr) => tr.classList.toggle('picked', tr.dataset.id === sBook));
    };
    const filt = (txt, amt) => { const v = norm(q.value); if (!v) return true; return norm(txt).includes(v) || String(Math.abs(amt)).includes(v.replace(/,/g, '')); };
    const listA = h('tbody'); const listB = h('tbody');
    const drawLists = () => {
      listA.replaceChildren(...(bankOnly.filter((x) => filt(`${x.description || ''} ${x.ref || ''}`, x.amount)).map((x) => h('tr', { 'data-id': x.id, onclick: () => { sStmt = sStmt === x.id ? null : x.id; refreshSel(); } },
        h('td', {}, fmt.date(x.txn_date)), h('td', { class: 'wrap' }, x.description || '', x.ref ? h('small', { class: 'ltr', style: { color: 'var(--ink-3)', marginInlineStart: '6px' } }, x.ref) : ''),
        h('td', { class: Number(x.amount) < 0 ? 'num neg' : 'num pos' }, N(x.amount)),
        h('td', { class: 'acts' }, h('button', { class: 'btn sm', title: 'سجّل قيدًا بهذا البند (عمولة، فوائد، تحويل…)', onclick: (ev) => { ev.stopPropagation(); bookIt(x); } }, 'تسجيل قيد'),
          h('button', { class: 'btn ghost sm', title: 'رُفع السطر بالخطأ', onclick: async (ev) => { ev.stopPropagation(); const r = await askReason('إلغاء سطر الكشف', { ok: 'إلغاء السطر' }); if (!r) return; try { await rpc('cancel_bank_line', { p_stmt_line: x.id, p_reason: r }, 'accounting'); load(); } catch (e) { toast(e.message, 'bad'); } } }, '×')))))
        .concat(bankOnly.length ? [] : [h('tr', {}, h('td', { colspan: 4, class: 'empty' }, 'كل أسطر الكشف متطابقة ✓'))]));
      listB.replaceChildren(...(bookOnly.filter((x) => filt(`${x.description || ''} ${x.party_name || ''} ${x.entry_ref}`, x.amount)).map((x) => h('tr', { 'data-id': x.line_id, onclick: () => { sBook = sBook === x.line_id ? null : x.line_id; refreshSel(); } },
        h('td', {}, fmt.date(x.entry_date)), h('td', { class: 'wrap' }, x.description || '', x.party_name ? ' — ' + x.party_name : ''),
        h('td', { class: Number(x.amount) < 0 ? 'num neg' : 'num pos' }, N(x.amount)),
        h('td', { class: 'acts' }, h('button', { class: 'btn ghost sm', onclick: (ev) => { ev.stopPropagation(); openEntry(x.entry_id); } }, x.entry_ref)))))
        .concat(bookOnly.length ? [] : [h('tr', {}, h('td', { colspan: 4, class: 'empty' }, 'لا توجد حركات في الدفاتر بانتظار البنك'))]));
      refreshSel();
    };
    q.oninput = drawLists;
    const table = (head, body) => h('div', { class: 'table-wrap', style: { maxHeight: '520px' } }, h('table', { class: 'grid report bank-list' },
      h('thead', {}, h('tr', {}, head.map((t) => h('th', {}, t)))), body));
    out.replaceChildren(
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('small', {}, 'رصيد الدفاتر'), h('b', {}, fmt.num(S.book_balance)), h('span', {}, 'في ' + asOf.value)),
        h('div', { class: 'kpi' }, h('small', {}, 'رصيد كشف البنك'), h('b', {}, fmt.num(S.bank_balance)), h('span', {}, `الكشوف من ${S.first_stmt_date} إلى ${S.last_stmt_date}`)),
        h('div', { class: 'kpi' }, h('small', {}, 'متطابق'), h('b', {}, String(S.matched_count)), h('span', {}, `المتبقي ${bankOnly.length} في البنك، و${bookOnly.length} في الدفاتر`)),
        h('div', { class: 'kpi' + (diff ? ' bad' : ' main') }, h('small', {}, 'فرق غير مفسَّر'), h('b', {}, fmt.num(diff)), h('span', {}, diff ? 'رصيد الكشف أو رصيد أول المدة غير صحيح' : 'المطابقة متسقة ✓'))),
      h('div', { class: 'card recon-sheet' }, h('table', { class: 'grid report' }, h('tbody', {},
        h('tr', {}, h('td', {}, 'رصيد الدفاتر'), h('td', { class: 'num' }, N(S.book_balance))),
        h('tr', {}, h('td', {}, '− إيداعات في الدفاتر لم تظهر في البنك بعد'), h('td', { class: 'num' }, N(-S.book_only_in || 0))),
        h('tr', {}, h('td', {}, '+ مدفوعات/شيكات في الدفاتر لم تُصرف من البنك بعد'), h('td', { class: 'num' }, N(S.book_only_out))),
        h('tr', {}, h('td', {}, '+ إيداعات في البنك غير مسجّلة في الدفاتر'), h('td', { class: 'num' }, N(S.bank_only_in))),
        h('tr', {}, h('td', {}, '− خصومات في البنك غير مسجّلة (عمولات، رسوم…)'), h('td', { class: 'num' }, N(-S.bank_only_out || 0))),
        h('tr', { class: 'fin-grand' }, h('td', {}, '= رصيد البنك المتوقع'), h('td', { class: 'num' }, N(expected))),
        h('tr', {}, h('td', {}, 'رصيد كشف البنك الفعلي'), h('td', { class: 'num' }, N(S.bank_balance)))))),
      h('div', { class: 'toolbar', style: { margin: '12px 0' } }, q, matchBtn, hint),
      h('div', { class: 'bank-cols' },
        h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('strong', {}, `في البنك وليست في الدفاتر (${bankOnly.length})`)), table(['التاريخ', 'البيان', 'المبلغ', ''], listA)),
        h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('strong', {}, `في الدفاتر وليست في البنك (${bookOnly.length})`), h('span', { class: 'help' }, 'من أول تاريخ في الكشوف')), table(['التاريخ', 'البيان', 'المبلغ', 'القيد'], listB))),
      h('details', { class: 'card', style: { marginTop: '12px', padding: '10px 14px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, `المتطابق (${matched.length})`),
        h('div', { class: 'table-wrap', style: { maxHeight: '420px', marginTop: '8px' } }, h('table', { class: 'grid report' },
          h('thead', {}, h('tr', {}, ['تاريخ البنك', 'بيان البنك', 'المبلغ', 'القيد', 'تاريخ القيد', 'النوع', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, matched.map((x) => { const b = bookById.get(x.matched_line_id); return h('tr', {},
            h('td', {}, fmt.date(x.txn_date)), h('td', { class: 'wrap' }, x.description || ''), h('td', { class: 'num' }, N(x.amount)),
            h('td', {}, b ? h('a', { href: 'javascript:void 0', onclick: () => openEntry(b.entry_id) }, b.entry_ref) : '—'), h('td', {}, b ? fmt.date(b.entry_date) : ''),
            h('td', {}, x.match_kind === 'manual' ? 'يدوي' : 'تلقائي'),
            h('td', {}, h('button', { class: 'btn ghost sm', onclick: async () => { try { await rpc('match_bank_line', { p_stmt_line: x.id, p_book: null }, 'accounting'); load(); } catch (e) { toast(e.message, 'bad'); } } }, 'فك المطابقة'))); }))))));
    drawLists();
  }

  async function manual() {
    try { await rpc('match_bank_line', { p_stmt_line: sStmt, p_book: sBook }, 'accounting'); toast('تمت المطابقة', 'ok'); load(); } catch (e) { toast(e.message, 'bad'); }
  }

  // بند في البنك غير مسجّل في الدفاتر ← قيد جاهز بسطر البنك، تُكمل الحساب المقابل، وبعد الحفظ يُطابَق تلقائيًا
  async function bookIt(x) {
    const lk2 = await loadLookups(company, { force: true });
    const amt = Math.abs(Number(x.amount));
    const bankLine = { ...emptyLine(), account_id: account, debit: Number(x.amount) > 0 ? String(amt) : '', credit: Number(x.amount) < 0 ? String(amt) : '' };
    const other = { ...emptyLine(), debit: Number(x.amount) < 0 ? String(amt) : '', credit: Number(x.amount) > 0 ? String(amt) : '' };
    const entry = { entry_date: x.txn_date, description: x.description || 'بند من كشف البنك', entry_type: 'regular', lines: [bankLine, other] };
    const m = modal({ title: 'تسجيل قيد من كشف البنك', size: 'full' });
    const editor = createEditor({ lk: lk2, company, entries: [entry], single: true });
    m.body.append(h('p', { class: 'notice', style: { marginBottom: '10px' } }, `سطر البنك جاهز (${fmt.num(x.amount)}). اختر الحساب المقابل — مثل العمولات البنكية أو عميل — ثم احفظ، وسيُطابَق القيد مع سطر الكشف تلقائيًا.`), editor.el);
    const save = h('button', { class: 'btn primary', onclick: async () => {
      document.activeElement?.blur(); await new Promise((r) => setTimeout(r, 20));
      let c; try { c = editor.collect(); } catch (err) { editor.showError(err.message, err.at); toast(err.message, 'bad'); return; }
      save.disabled = true;
      try {
        const res = await rpc('post_batch', { p_company: company, p_entries: c.payload }, 'accounting');
        const id = res.entries[0].id;
        const { data } = await acc.from('v_bank_book_lines').select('line_id, amount').eq('entry_id', id).eq('account_id', account);
        const line = (data || []).find((l) => Number(l.amount) === Number(x.amount));
        if (line) await rpc('match_bank_line', { p_stmt_line: x.id, p_book: line.line_id }, 'accounting');
        toast(`سُجّل القيد ${res.fiscal_year}-${res.entries[0].entry_no}` + (line ? ' وطوبق' : ''), 'ok');
        m.close(); load();
      } catch (err) { editor.showServerError(err.message, c.clean); toast(err.message, 'bad'); } finally { save.disabled = false; }
    } }, 'حفظ القيد');
    m.foot.append(save, h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
  }

  // رفع الكشف: قراءة الملف ← تحديد الأعمدة (تلقائيًا مع إمكانية التغيير) ← المعاينة ← الرفع والمطابقة التلقائية
  function upload() {
    if (!account) return;
    const m = modal({ title: 'رفع كشف حساب البنك', size: 'wide' });
    const file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'input' });
    const area = h('div');
    m.body.append(h('p', { class: 'help', style: { marginTop: 0 } }, `الحساب: ${accSel.selectedOptions[0]?.textContent || ''}. نزّل كشف الحساب من موقع البنك بصيغة Excel أو CSV. الأسطر المرفوعة سابقًا تُتخطّى تلقائيًا.`), file, area);
    let rows = []; let headIdx = 0; let map = {};
    file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      const wb = await readWorkbook(f, { cellDates: false });
      rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      // صف العناوين: أول صف يحتوي «تاريخ» وكلمة أخرى من العناوين المعروفة
      headIdx = Math.max(0, rows.findIndex((r) => r.some((c) => /تاريخ|date/i.test(String(c))) && r.filter((c) => String(c).trim()).length >= 3));
      const head = rows[headIdx].map((c) => String(c).trim());
      map = {};
      for (const [k, , rx] of FIELDS) { const i = head.findIndex((c, j) => (rx.test(c) || rx.test(norm(c))) && !Object.values(map).includes(j)); if (i >= 0) map[k] = i; }
      if (map.amount !== undefined && (map.in !== undefined || map.out !== undefined)) delete map.amount;
      drawMap(head);
    };
    function parsed() {
      const out = [];
      for (const r of rows.slice(headIdx + 1)) {
        const d = toDate(r[map.date]); if (!d) continue;
        const amt = map.amount !== undefined ? toNum(r[map.amount]) : toNum(r[map.in]) - Math.abs(toNum(r[map.out]));
        if (!amt) continue;
        out.push({ txn_date: d, description: map.desc !== undefined ? String(r[map.desc] || '').trim() : '', ref: map.ref !== undefined ? String(r[map.ref] || '').trim() : '',
          amount: Math.round(amt * 100) / 100, bank_balance: map.bal !== undefined && String(r[map.bal]).trim() !== '' ? toNum(r[map.bal]) : null });
      }
      return out;
    }
    function drawMap(head) {
      const sels = FIELDS.map(([k, t, , req]) => {
        const s = h('select', { class: 'input' }, h('option', { value: '' }, '—'), head.map((c, i) => h('option', { value: i, selected: map[k] === i }, c || `عمود ${i + 1}`)));
        s.onchange = () => { if (s.value === '') delete map[k]; else map[k] = Number(s.value); preview(); };
        return h('div', { class: 'field' }, h('label', {}, t, req ? h('span', { class: 'req' }, '*') : ''), s);
      });
      const prev = h('div');
      const preview = () => {
        const p = parsed();
        const byDate = [...p].sort((a, b) => a.txn_date.localeCompare(b.txn_date));
        const ins = p.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0), outs = p.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0);
        prev.replaceChildren(
          h('div', { class: 'notice', style: { margin: '10px 0' } }, p.length ? `${p.length} سطرًا من ${byDate[0].txn_date} إلى ${byDate[byDate.length - 1].txn_date} — إيداعات ${fmt.num(ins)}، وسحوبات ${fmt.num(outs)}` : 'لا توجد أسطر مفهومة — راجع الأعمدة'),
          h('div', { class: 'table-wrap', style: { maxHeight: '260px' } }, h('table', { class: 'grid report' },
            h('thead', {}, h('tr', {}, ['التاريخ', 'البيان', 'المرجع', 'المبلغ', 'الرصيد'].map((t) => h('th', {}, t)))),
            h('tbody', {}, p.slice(0, 12).map((x) => h('tr', {}, h('td', {}, x.txn_date), h('td', {}, x.description), h('td', { class: 'ltr' }, x.ref),
              h('td', { class: x.amount < 0 ? 'num neg' : 'num pos' }, fmt.num(x.amount)), h('td', { class: 'num' }, x.bank_balance === null ? '' : fmt.num(x.bank_balance))))))));
        go.disabled = !p.length;
      };
      area.replaceChildren(h('p', { class: 'help' }, 'حدّد النظام الأعمدة تلقائيًا — راجعها. في كشوف البنوك: «مدين» = سحب من حسابك، و«دائن» = إيداع.'), h('div', { class: 'form-grid' }, ...sels), prev);
      preview();
    }
    const go = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
      const p = parsed(); if (!p.length) return;
      go.disabled = true;
      try {
        const sorted = [...p].sort((a, b) => a.txn_date.localeCompare(b.txn_date));
        const withBal = p.filter((x) => x.bank_balance !== null);
        let opening = null, closing = null;
        if (withBal.length) {
          // تعرض البنوك الأحدث في الأعلى أو في الأسفل — الرصيد الأول = رصيد أقدم سطر − مبلغه
          const oldest = withBal.reduce((a, b) => (b.txn_date < a.txn_date ? b : a)), newest = withBal.reduce((a, b) => (b.txn_date >= a.txn_date ? b : a));
          opening = Math.round((oldest.bank_balance - oldest.amount) * 100) / 100; closing = newest.bank_balance;
        }
        const r = await rpc('import_bank_statement', { p_account: account, p_file: file.files[0]?.name || '', p_lines: sorted, p_opening: opening, p_closing: closing }, 'accounting');
        const n = await rpc('auto_match_bank', { p_account: account, p_days: Number(days.value) }, 'accounting');
        toast(`رُفع ${r.added} سطرًا (وتُخطّي ${r.skipped} مرفوعًا سابقًا) — وطوبق تلقائيًا ${n}`, 'ok');
        m.close(); load();
      } catch (e) { toast(e.message, 'bad'); go.disabled = false; }
    } }, 'رفع ومطابقة');
    m.foot.append(go, h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
  }

  accounts().then(load);
}

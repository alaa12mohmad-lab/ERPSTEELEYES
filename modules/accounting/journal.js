// صفحات القيود: إدخال شبه Excel (صفحة فيها قيود كثيرة)، والتنقل بين الصفحات المحفوظة
import { acc, core, rpc } from '../../shared/sb.js';
import { h, toast, fmt, store, confirmDialog } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { loadLookups, companySelect, ENTRY_TYPES, TAX_CATEGORIES } from './lookups.js';
import { openEntry, entryBadges } from './register.js';
import { createEditor, emptyEntry, emptyLine } from './editor.js';
import { printEntries } from './print.js';

// الصفحة المحفوظة: الأعمدة الفاضية في كل الأسطر تختفي
function emptyCols(lines) {
  const has = { party: (l) => l.party_name, inv: (l) => l.invoice_no, invdate: (l) => l.invoice_date, tax: (l) => l.tax_base || (l.tax_category && l.tax_category !== 'standard'),
    project: (l) => l.project_name, cc: (l) => l.cost_center_name, eq: (l) => l.equipment_name, note: (l) => l.line_description };
  return Object.entries(has).filter(([, f]) => !lines.some(f)).map(([k]) => 'hide-' + k).join(' ');
}

export function renderJournal(el, { focusEntry } = {}) {
  let company = null; let lk = null;
  let mode = 'new'; let batches = []; let idx = -1;
  const body = h('div');
  const pageInput = h('input', { class: 'input', style: { width: '90px', textAlign: 'center' }, placeholder: 'رقم الصفحة', title: 'اكتب رقم الصفحة واضغط Enter (مثال: 3 أو 2026/3)' });
  const entrySearch = h('input', { class: 'input', style: { width: '130px' }, placeholder: 'بحث برقم قيد', title: 'مثال: 15 أو 2026-15' });
  const pageLabel = h('span', { class: 'help', style: { minWidth: '120px' } });
  const prevBtn = h('button', { class: 'btn', title: 'الصفحة السابقة', onclick: () => go(idx === -1 ? batches.length - 1 : idx - 1) }, '→ السابقة');
  const nextBtn = h('button', { class: 'btn', title: 'الصفحة التالية', onclick: () => go(idx + 1) }, 'التالية ←');
  const newBtn = h('button', { class: 'btn primary', onclick: () => openNew() }, '+ صفحة جديدة');
  const sel = companySelect(async (v) => { company = v; await init(); });
  company = sel.value;

  el.replaceChildren(
    h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'toolbar' },
      h('label', { style: { fontWeight: 600 } }, 'الشركة:'), sel,
      h('span', { style: { width: '12px' } }),
      prevBtn, pageInput, nextBtn, pageLabel, h('div', { class: 'grow' }), entrySearch, newBtn)),
    body);

  pageInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = pageInput.value.trim(); if (!t) return;
    const m = t.match(/^(\d{4})\s*[/\-]\s*(\d+)$/);
    const year = m ? Number(m[1]) : (batches[idx]?.fiscal_year || new Date().getFullYear());
    const no = Number(m ? m[2] : t);
    const i = batches.findIndex((b) => b.fiscal_year === year && b.batch_no === no);
    if (i === -1) toast(`لا توجد صفحة رقم ${no} في ${year}`, 'bad'); else go(i);
  });
  entrySearch.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const t = entrySearch.value.trim(); if (!t) return;
    const m = t.match(/^(\d{4})\s*[/\-]\s*(\d+)$/);
    const year = m ? Number(m[1]) : new Date().getFullYear();
    const no = Number(m ? m[2] : t);
    const { data } = await acc.from('journal_entries').select('id, batch_id').eq('company_id', company).eq('fiscal_year', year).eq('entry_no', no).maybeSingle();
    if (!data) { toast(`لا يوجد قيد رقم ${year}-${no}`, 'bad'); return; }
    const i = batches.findIndex((b) => b.id === data.batch_id);
    if (i === -1) openEntry(data.id, { onChange: () => init(true) }); else go(i, data.id);
  });

  async function init(keepView = false) {
    body.replaceChildren(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    lk = await loadLookups(company, { force: true });
    const { data } = await acc.from('batches').select('id, fiscal_year, batch_no, created_at, created_by, notes').eq('company_id', company)
      .order('fiscal_year').order('batch_no');
    batches = data || [];
    if (focusEntry) { const f = focusEntry; focusEntry = null; const b = batches.findIndex((x) => x.id === f.batch_id); if (b !== -1) return go(b, f.id); }
    if (keepView && mode === 'view' && idx >= 0) return go(Math.min(idx, batches.length - 1));
    openNew();
  }

  function updateNav() {
    prevBtn.disabled = batches.length === 0 || idx === 0;
    nextBtn.disabled = idx === -1 || idx >= batches.length - 1;
    newBtn.style.display = mode === 'new' ? 'none' : '';
    pageInput.value = idx >= 0 ? batches[idx].batch_no : '';
    pageLabel.textContent = idx >= 0 ? `صفحة ${batches[idx].batch_no} من سنة ${batches[idx].fiscal_year} — ${idx + 1} / ${batches.length}`
      : `صفحة جديدة — ${batches.length} صفحة محفوظة`;
  }

  // ===================================================================
  // صفحة جديدة
  // ===================================================================
  const draftKey = () => 'erp-je-draft-' + company;
  let saveTimer = null;
  const saveDraft = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(draftKey(), editor?.entries), 400); };
  let editor = null;

  function openNew() {
    mode = 'new'; idx = -1;
    const d = store.get(draftKey(), null);
    const list = Array.isArray(d) && d.length ? d.map((e) => ({ ...emptyEntry(), ...e, lines: (e.lines || []).map((l) => ({ ...emptyLine(), ...l })) })) : [emptyEntry()];
    if (!state.can('accounting', 2)) {
      body.replaceChildren(h('div', { class: 'notice' }, 'صلاحيتك عرض القيود فقط. استخدم أزرار التنقل لعرض الصفحات المحفوظة.'));
      if (batches.length) go(batches.length - 1);
      updateNav(); return;
    }
    const saveBtn = h('button', { class: 'btn primary', onclick: savePage }, 'حفظ الصفحة');
    editor = createEditor({ lk, company, entries: list, onChange: saveDraft,
      notice: Array.isArray(d) && d.length ? 'استُرجعت مسودة محفوظة في هذا المتصفح لم تُحفظ بعد.' : null,
      footExtras: () => [
        h('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog('مسح كل ما في الصفحة؟', { ok: 'مسح', danger: true })) { store.set(draftKey(), null); editor.load([emptyEntry()]); } } }, 'مسح الصفحة'),
        saveBtn] });
    body.replaceChildren(editor.el);
    updateNav();
  }

  async function savePage() {
    document.activeElement?.blur();
    await new Promise((r) => setTimeout(r, 20));
    let c;
    try { c = editor.collect(); } catch (err) { editor.showError(err.message, err.at); toast(err.message, 'bad'); return; }
    const btn = body.querySelector('.btn.primary'); if (btn) btn.disabled = true;
    try {
      const res = await rpc('post_batch', { p_company: company, p_entries: c.payload }, 'accounting');
      store.set(draftKey(), null);
      const nos = res.entries.map((x) => x.entry_no);
      toast(`حُفظت الصفحة ${res.batch_no} — القيود ${Math.min(...nos)} إلى ${Math.max(...nos)}`, 'ok');
      const { data } = await acc.from('batches').select('id, fiscal_year, batch_no, created_at, created_by, notes').eq('company_id', company).order('fiscal_year').order('batch_no');
      batches = data || [];
      go(batches.findIndex((b) => b.id === res.batch_id));
    } catch (err) {
      editor.showServerError(err.message, c.clean);
      toast(err.message, 'bad');
    } finally { if (btn) btn.disabled = false; }
  }

  // ===================================================================
  // عرض صفحة محفوظة
  // ===================================================================
  async function go(i, highlightEntry) {
    if (i < 0 || i >= batches.length) return;
    mode = 'view'; idx = i; updateNav();
    const b = batches[i];
    body.replaceChildren(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    const [{ data: lines }, { data: ents }, { data: users }] = await Promise.all([
      acc.from('v_lines').select('*').eq('batch_id', b.id).order('entry_no').order('line_no'),
      acc.from('v_entries').select('*').eq('batch_id', b.id).order('entry_no'),
      core.from('v_user_names').select('id, full_name'),
    ]);
    const ent = Object.fromEntries((ents || []).map((x) => [x.id, x]));
    const byEntry = {};
    (lines || []).forEach((l) => { (byEntry[l.entry_id] = byEntry[l.entry_id] || []).push(l); });
    const who = (users || []).find((u) => u.id === b.created_by)?.full_name || '';
    const tbody = h('tbody');
    let totD = 0, totC = 0, nCancelled = 0;
    (ents || []).forEach((info, k) => {
      const ls = byEntry[info.id] || [];
      const cancelled = info.status === 'cancelled';
      if (cancelled) nCancelled++;
      ls.forEach((l, j) => {
        if (!cancelled) { totD += Number(l.debit); totC += Number(l.credit); }
        const tr = h('tr', { class: 'je-row' + (k % 2 ? ' alt' : '') + (j === 0 ? ' first' : '') + (info.id === highlightEntry ? ' hl' : '') + (cancelled ? ' cancelled' : ''),
          onclick: () => openEntry(info.id, { onChange: () => go(idx) }) });
        if (j === 0) {
          tr.append(h('td', { rowspan: ls.length, class: 'je-no' },
            h('div', { class: 'je-num ltr' }, `${l.fiscal_year}-${l.entry_no}`), ...entryBadges(info)),
          h('td', { rowspan: ls.length }, fmt.date(info.entry_date)),
          h('td', { rowspan: ls.length, class: 'je-desc-cell' }, info.description));
        }
        tr.append(h('td', {}, `${l.account_code} — ${l.account_name}`), h('td', { class: 'num' }, Number(l.debit) ? fmt.num(l.debit) : ''),
          h('td', { class: 'num' }, Number(l.credit) ? fmt.num(l.credit) : ''), h('td', { class: 'c-party' }, l.party_name || ''),
          h('td', { class: 'ltr c-inv' }, l.invoice_no || ''), h('td', { class: 'c-invdate' }, fmt.date(l.invoice_date)),
          h('td', { class: 'c-tax' + (l.tax_base ? ' num' : '') }, l.tax_base ? fmt.num(l.tax_base) : l.tax_category && l.tax_category !== 'standard' ? TAX_CATEGORIES[l.tax_category] : ''),
          h('td', { class: 'c-project' }, l.project_name || ''), h('td', { class: 'c-cc' }, l.cost_center_name || ''), h('td', { class: 'c-eq' }, l.equipment_name || ''), h('td', { class: 'c-note' }, l.line_description || ''));
        tbody.append(tr);
      });
    });
    const printBtn = h('button', { class: 'btn', onclick: (ev) => { ev.stopPropagation(); printEntries((ents || []).map((e) => ({ entry: e, lines: byEntry[e.id] || [] })), users || []); } }, 'طباعة الصفحة');
    body.replaceChildren(
      h('div', { class: 'notice', style: { marginBottom: '10px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' } },
        h('strong', {}, `صفحة رقم ${b.batch_no} — ${b.fiscal_year}`), h('span', {}, `حُفظت ${fmt.datetime(b.created_at)}`), who && h('span', {}, 'بواسطة ' + who),
        h('span', {}, `${(ents || []).length} قيد` + (nCancelled ? ` (${nCancelled} ملغي)` : '')), h('span', { class: 'help' }, 'اضغط على أي قيد لفتحه: طباعة، تعديل، إلغاء، عكس، حذف.'),
        h('span', { class: 'grow' }), printBtn),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap je-wrap' }, h('table', { class: 'grid je-grid view ' + emptyCols(lines || []) },
        h('thead', {}, h('tr', {}, [['', 'القيد'], ['', 'التاريخ'], ['', 'البيان'], ['', 'الحساب'], ['', 'مدين'], ['', 'دائن'], ['party', 'الطرف'], ['inv', 'رقم الفاتورة'],
          ['invdate', 'تاريخ الفاتورة'], ['tax', 'الضريبة'], ['project', 'المشروع'], ['cc', 'مركز التكلفة'], ['eq', 'المعدة'], ['note', 'بيان السطر']].map(([k, t]) => h('th', { class: k ? 'c-' + k : '' }, t)))),
        tbody,
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 4, style: { fontWeight: 700 } }, 'الإجمالي' + (nCancelled ? ' (بدون الملغي)' : '')),
          h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totD)), h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totC)), h('td', { colspan: 8 })))))));
    if (highlightEntry) setTimeout(() => body.querySelector('tr.hl')?.scrollIntoView({ block: 'center' }), 50);
  }

  init();
}

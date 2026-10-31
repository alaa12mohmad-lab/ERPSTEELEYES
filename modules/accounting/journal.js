// صفحات القيود: إدخال شبه Excel (صفحة فيها قيود كثيرة)، والتنقل بين الصفحات المحفوظة
import { acc, core, rpc } from '../../shared/sb.js';
import { h, toast, fmt, store, confirmDialog } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { loadLookups, picker, companySelect, today, ENTRY_TYPES } from './lookups.js';
import { openEntry } from './register.js';

const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;
const emptyLine = () => ({ account_id: null, debit: '', credit: '', party_id: null, employee_id: null, project_id: null, cost_center_id: null, equipment_id: null, description: '' });
const emptyEntry = (date) => ({ entry_date: date || today(), description: '', entry_type: 'regular', lines: [emptyLine(), emptyLine()] });

export function renderJournal(el, { focusEntry } = {}) {
  let company = null; let lk = null;
  let mode = 'new'; let batches = []; let idx = -1;
  let entries = []; let errorAt = null;
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
  const saveDraft = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(draftKey(), entries), 400); };

  function openNew() {
    mode = 'new'; idx = -1; errorAt = null;
    const d = store.get(draftKey(), null);
    entries = Array.isArray(d) && d.length ? d : [emptyEntry()];
    if (!state.can('accounting', 2)) {
      body.replaceChildren(h('div', { class: 'notice' }, 'صلاحيتك عرض القيود فقط. استخدم أزرار التنقل لعرض الصفحات المحفوظة.'));
      if (batches.length) go(batches.length - 1);
      updateNav(); return;
    }
    drawGrid(Array.isArray(d) && d.length ? 'استُرجعت مسودة محفوظة في هذا المتصفح لم تُحفظ بعد.' : null);
    updateNav();
  }

  function entryDiff(e) {
    const d = e.lines.reduce((s, l) => s + num(l.debit), 0);
    const c = e.lines.reduce((s, l) => s + num(l.credit), 0);
    return { d: round2(d), c: round2(c), diff: round2(d - c) };
  }

  function drawGrid(notice, focus) {
    const tbody = h('tbody');
    entries.forEach((e, ei) => {
      const { d, c, diff } = entryDiff(e);
      const n = e.lines.length;
      e.lines.forEach((l, li) => {
        const tr = h('tr', { 'data-e': ei, 'data-l': li, class: 'je-row' + (ei % 2 ? ' alt' : '') + (li === 0 ? ' first' : '') + (errorAt && errorAt.e === ei && (errorAt.l === null || errorAt.l === li) ? ' err' : '') });
        if (li === 0) {
          const typeSel = h('select', { class: 'input cell-input', 'data-f': 'type', title: 'نوع القيد' },
            ['regular', 'opening', 'adjustment'].map((t) => h('option', { value: t, selected: e.entry_type === t }, ENTRY_TYPES[t])));
          typeSel.addEventListener('change', () => { e.entry_type = typeSel.value; saveDraft(); });
          tr.append(h('td', { rowspan: n, class: 'je-no' },
            h('div', { class: 'je-num' }, ei + 1),
            h('span', { class: 'badge ' + (diff === 0 && d > 0 ? 'ok' : d === 0 && c === 0 ? '' : 'bad'), 'data-diff': ei },
              diff === 0 && d > 0 ? 'متوازن' : d === 0 && c === 0 ? 'فارغ' : 'فرق ' + fmt.num(Math.abs(diff))),
            typeSel));
          const dateIn = h('input', { class: 'input cell-input', type: 'date', value: e.entry_date || '', 'data-f': 'date' });
          dateIn.addEventListener('change', () => { e.entry_date = dateIn.value; saveDraft(); });
          const descIn = h('textarea', { class: 'input cell-input je-desc', rows: 1, placeholder: 'بيان القيد', 'data-f': 'desc' }, e.description || '');
          descIn.addEventListener('input', () => { e.description = descIn.value; saveDraft(); });
          tr.append(h('td', { rowspan: n }, dateIn), h('td', { rowspan: n, class: 'je-desc-cell' }, descIn));
        }
        tr.append(...lineCells(e, ei, l, li));
        tbody.append(tr);
      });
    });

    const totals = entries.reduce((s, e) => { const x = entryDiff(e); s.d += x.d; s.c += x.c; return s; }, { d: 0, c: 0 });
    const table = h('table', { class: 'grid je-grid' },
      h('thead', {}, h('tr', {}, ['القيد', 'التاريخ', 'البيان', 'الحساب', 'مدين', 'دائن', 'الطرف', 'المشروع', 'مركز التكلفة', 'المعدة', 'بيان السطر', ''].map((t) => h('th', {}, t)))),
      tbody,
      h('tfoot', {}, h('tr', {}, h('td', { colspan: 4, style: { fontWeight: 700 } }, `${entries.length} قيد`),
        h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totals.d)), h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totals.c)),
        h('td', { colspan: 6 }))));
    table.addEventListener('keydown', onKey);

    body.replaceChildren(
      notice ? h('div', { class: 'notice warn', style: { marginBottom: '10px' } }, notice) : '',
      h('div', { class: 'card' },
        h('div', { class: 'table-wrap je-wrap' }, table),
        h('div', { class: 'toolbar', style: { borderTop: '1px solid var(--line)', borderBottom: 0 } },
          h('button', { class: 'btn', onclick: () => { entries[entries.length - 1].lines.push(emptyLine()); redraw({ e: entries.length - 1, l: entries[entries.length - 1].lines.length - 1, f: 'account' }); } }, '+ سطر'),
          h('button', { class: 'btn', onclick: addEntry }, '+ قيد جديد'),
          h('span', { class: 'help' }, 'Enter: الخانة التالية • في آخر السطر: سطر جديد • Ctrl+Enter: قيد جديد'),
          h('div', { class: 'grow' }),
          h('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog('مسح كل ما في الصفحة؟', { ok: 'مسح', danger: true })) { store.set(draftKey(), null); entries = [emptyEntry()]; errorAt = null; redraw(); } } }, 'مسح الصفحة'),
          h('button', { class: 'btn primary', onclick: savePage }, 'حفظ الصفحة'))));
    if (focus) focusCell(focus);
  }

  function redraw(focus) { saveDraft(); drawGrid(null, focus); }

  function addEntry() {
    const last = entries[entries.length - 1];
    entries.push(emptyEntry(last?.entry_date));
    redraw({ e: entries.length - 1, l: 0, f: 'desc' });
  }

  function focusCell({ e, l, f }) {
    const sel = f === 'date' || f === 'desc' || f === 'type'
      ? `tr[data-e="${e}"][data-l="0"] [data-f="${f}"]`
      : `tr[data-e="${e}"][data-l="${l}"] [data-f="${f}"]`;
    setTimeout(() => body.querySelector(sel)?.focus(), 0);
  }

  function updateBadge(ei) {
    const b = body.querySelector(`[data-diff="${ei}"]`); if (!b) return;
    const { d, c, diff } = entryDiff(entries[ei]);
    b.className = 'badge ' + (diff === 0 && d > 0 ? 'ok' : d === 0 && c === 0 ? '' : 'bad');
    b.textContent = diff === 0 && d > 0 ? 'متوازن' : d === 0 && c === 0 ? 'فارغ' : 'فرق ' + fmt.num(Math.abs(diff));
    const totals = entries.reduce((s, x) => { const t = entryDiff(x); s.d += t.d; s.c += t.c; return s; }, { d: 0, c: 0 });
    const tf = body.querySelectorAll('tfoot td.num');
    if (tf[0]) tf[0].textContent = fmt.num(totals.d);
    if (tf[1]) tf[1].textContent = fmt.num(totals.c);
  }

  function lineCells(e, ei, l, li) {
    const accP = picker({ options: lk.postable, listKey: 'acc-' + company, value: l.account_id, placeholder: 'الحساب', cls: 'acc' });
    accP.el.dataset.f = 'account';
    const dr = h('input', { class: 'input cell-input num', inputmode: 'decimal', value: l.debit, 'data-f': 'debit' });
    const cr = h('input', { class: 'input cell-input num', inputmode: 'decimal', value: l.credit, 'data-f': 'credit' });
    const partyP = picker({ options: lk.parties, listKey: 'party', value: l.party_id || l.employee_id, placeholder: 'الطرف' }); partyP.el.dataset.f = 'party';
    const projP = picker({ options: lk.projects, listKey: 'proj-' + company, value: l.project_id, placeholder: 'المشروع' }); projP.el.dataset.f = 'project';
    const ccP = picker({ options: lk.costCenters, listKey: 'cc-' + company, value: l.cost_center_id, placeholder: 'المركز' }); ccP.el.dataset.f = 'cc';
    const eqP = picker({ options: lk.equipment, listKey: 'eq-' + company, value: l.equipment_id, placeholder: 'المعدة' }); eqP.el.dataset.f = 'equipment';
    const note = h('input', { class: 'input cell-input', value: l.description || '', placeholder: '', 'data-f': 'note' });

    const applyRules = (a) => {
      const r = a?.row;
      const setRule = (p, rule) => {
        p.el.classList.toggle('req', rule === 'required');
        if (rule === 'forbidden') { p.setDisabled(true); } else { p.el.disabled = false; }
      };
      if (!r) { [partyP, projP, ccP, eqP].forEach((p) => { p.el.disabled = false; p.el.classList.remove('req'); }); return; }
      const kind = r.party_kind;
      const list = kind === 'employee' ? [lk.employees, 'emp-' + company] : kind === 'customer' ? [lk.customers, 'cust'] : kind === 'supplier' ? [lk.suppliers, 'supp'] : [lk.parties, 'party'];
      if (r.party_rule !== 'forbidden') partyP.setOptions(list[0], list[1]);
      setRule(partyP, r.party_rule); setRule(projP, r.project_rule); setRule(ccP, r.cost_center_rule); setRule(eqP, r.equipment_rule);
      partyP.el.placeholder = r.party_rule === 'forbidden' ? '' : ({ employee: 'الموظف', customer: 'العميل', supplier: 'المورد' }[kind] || 'الطرف');
      syncParty();
    };
    const syncParty = () => {
      const kind = accP.id ? lk.byId('accounts', accP.id)?.row.party_kind : null;
      if (kind === 'employee') { l.employee_id = partyP.id; l.party_id = null; } else { l.party_id = partyP.id; l.employee_id = null; }
    };

    const initialAcc = l.account_id ? lk.byId('accounts', l.account_id) : null;
    // الأسطر المحفوظة كمسودة: نعيد اختيار الطرف بعد تحديد القائمة
    if (initialAcc) { applyRules(initialAcc); partyP.set(l.party_id || l.employee_id); }

    accP.el.addEventListener('change', () => setTimeout(() => { l.account_id = accP.id; applyRules(lk.byId('accounts', accP.id)); saveDraft(); }, 0));
    dr.addEventListener('input', () => { l.debit = dr.value; if (dr.value.trim()) { cr.value = ''; l.credit = ''; } updateBadge(ei); saveDraft(); });
    cr.addEventListener('input', () => { l.credit = cr.value; if (cr.value.trim()) { dr.value = ''; l.debit = ''; } updateBadge(ei); saveDraft(); });
    partyP.el.addEventListener('change', () => setTimeout(() => { syncParty(); saveDraft(); }, 0));
    projP.el.addEventListener('change', () => setTimeout(() => { l.project_id = projP.id; saveDraft(); }, 0));
    ccP.el.addEventListener('change', () => setTimeout(() => { l.cost_center_id = ccP.id; saveDraft(); }, 0));
    eqP.el.addEventListener('change', () => setTimeout(() => { l.equipment_id = eqP.id; saveDraft(); }, 0));
    note.addEventListener('input', () => { l.description = note.value; saveDraft(); });

    // اقتراح المبلغ المتبقي للتوازن عند الدخول لخانة فاضية
    const suggest = (input, side) => input.addEventListener('focus', () => {
      if (input.value || (side === 'debit' ? cr.value : dr.value)) return;
      const { diff } = entryDiff(e);
      if (side === 'credit' && diff > 0) input.placeholder = fmt.num(diff);
      else if (side === 'debit' && diff < 0) input.placeholder = fmt.num(-diff);
      else input.placeholder = '';
    });
    suggest(dr, 'debit'); suggest(cr, 'credit');
    [dr, cr].forEach((inp) => inp.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === 'Tab') && !inp.value && inp.placeholder) { inp.value = inp.placeholder.replace(/,/g, ''); inp.dispatchEvent(new Event('input')); }
    }));

    const delBtn = h('button', { class: 'btn ghost sm', title: 'حذف السطر', tabindex: -1, onclick: () => {
      e.lines.splice(li, 1);
      if (e.lines.length === 0) entries.splice(ei, 1);
      if (entries.length === 0) entries.push(emptyEntry());
      redraw();
    } }, '×');

    return [h('td', { class: 'acc-cell' }, accP.el), h('td', {}, dr), h('td', {}, cr), h('td', {}, partyP.el), h('td', {}, projP.el),
      h('td', {}, ccP.el), h('td', {}, eqP.el), h('td', {}, note), h('td', {}, delBtn)];
  }

  function onKey(ev) {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement)) return;
    const tr = t.closest('tr'); if (!tr || tr.dataset.e === undefined) return;
    const ei = Number(tr.dataset.e), li = Number(tr.dataset.l);
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); t.blur(); addEntry(); return; }
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    ev.preventDefault();
    setTimeout(() => {
      const inputs = [...tr.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea')];
      const i = inputs.indexOf(t);
      if (i >= 0 && i < inputs.length - 1) { inputs[i + 1].focus(); inputs[i + 1].select?.(); return; }
      // آخر خانة في السطر: السطر التالي أو سطر جديد
      const e = entries[ei];
      if (li < e.lines.length - 1) focusCell({ e: ei, l: li + 1, f: 'account' });
      else { e.lines.push(emptyLine()); redraw({ e: ei, l: li + 1, f: 'account' }); }
    }, 0);
  }

  async function savePage() {
    document.activeElement?.blur();
    await new Promise((r) => setTimeout(r, 20));
    // تنظيف: تجاهل الأسطر الفاضية تمامًا، مع الاحتفاظ بمكان كل قيد وسطر في الصفحة
    const clean = entries.map((e, src) => ({ ...e, src, lines: e.lines.map((l, lsrc) => ({ ...l, lsrc })).filter((l) => l.account_id || num(l.debit) || num(l.credit)) }))
      .filter((e) => e.lines.length || (e.description || '').trim());
    if (!clean.length) { toast('الصفحة فاضية', 'bad'); return; }
    for (let i = 0; i < clean.length; i++) {
      const e = clean[i]; const label = `القيد ${i + 1}`;
      const fail = (msg, j = null) => { errorAt = { e: e.src, l: j === null ? null : e.lines[j].lsrc }; drawGrid(`${label}: ${msg}`); toast(`${label}: ${msg}`, 'bad'); };
      if (!e.entry_date) return fail('التاريخ مطلوب');
      if (!(e.description || '').trim()) return fail('البيان مطلوب');
      if (e.lines.length < 2) return fail('يحتاج سطرين على الأقل');
      for (let j = 0; j < e.lines.length; j++) {
        const l = e.lines[j];
        if (!l.account_id) return fail(`السطر ${j + 1}: الحساب مطلوب`, j);
        if (!num(l.debit) && !num(l.credit)) return fail(`السطر ${j + 1}: المبلغ مطلوب`, j);
      }
      if (entryDiff(e).diff !== 0) return fail('غير متوازن (فرق ' + fmt.num(Math.abs(entryDiff(e).diff)) + ')');
    }
    const payload = clean.map((e) => ({
      entry_date: e.entry_date, description: e.description.trim(), entry_type: e.entry_type || 'regular',
      lines: e.lines.map((l) => ({
        account_id: l.account_id, debit: num(l.debit) || 0, credit: num(l.credit) || 0,
        party_id: l.party_id, employee_id: l.employee_id, project_id: l.project_id, cost_center_id: l.cost_center_id,
        equipment_id: l.equipment_id, description: (l.description || '').trim() || null,
      })),
    }));
    const btn = body.querySelector('.btn.primary'); if (btn) btn.disabled = true;
    try {
      const res = await rpc('post_batch', { p_company: company, p_entries: payload }, 'accounting');
      store.set(draftKey(), null);
      const nos = res.entries.map((x) => x.entry_no);
      toast(`حُفظت الصفحة ${res.batch_no} — القيود ${Math.min(...nos)} إلى ${Math.max(...nos)}`, 'ok');
      entries = [emptyEntry()];
      const { data } = await acc.from('batches').select('id, fiscal_year, batch_no, created_at, created_by, notes').eq('company_id', company).order('fiscal_year').order('batch_no');
      batches = data || [];
      go(batches.findIndex((b) => b.id === res.batch_id));
    } catch (err) {
      const m = String(err.message).match(/القيد (\d+)(?:، السطر (\d+))?/);
      if (m && clean[Number(m[1]) - 1]) {
        const target = clean[Number(m[1]) - 1];
        errorAt = { e: target.src, l: m[2] ? target.lines[Number(m[2]) - 1]?.lsrc ?? null : null };
      }
      drawGrid(err.message);
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
      acc.from('v_entries').select('id, entry_no, fiscal_year, in_manara, manara_no, reversed_by_no, entry_type').eq('batch_id', b.id),
      core.from('v_user_names').select('id, full_name'),
    ]);
    const ent = Object.fromEntries((ents || []).map((x) => [x.id, x]));
    const byEntry = {};
    (lines || []).forEach((l) => { (byEntry[l.entry_id] = byEntry[l.entry_id] || []).push(l); });
    const who = (users || []).find((u) => u.id === b.created_by)?.full_name || '';
    const tbody = h('tbody');
    let totD = 0, totC = 0;
    Object.entries(byEntry).forEach(([eid, ls], k) => {
      const info = ent[eid];
      ls.forEach((l, j) => {
        totD += Number(l.debit); totC += Number(l.credit);
        const tr = h('tr', { class: 'je-row' + (k % 2 ? ' alt' : '') + (j === 0 ? ' first' : '') + (eid === highlightEntry ? ' hl' : ''), onclick: () => openEntry(eid, { onChange: () => go(idx) }) });
        if (j === 0) {
          tr.append(h('td', { rowspan: ls.length, class: 'je-no' },
            h('div', { class: 'je-num ltr' }, `${l.fiscal_year}-${l.entry_no}`),
            l.entry_type !== 'regular' && h('span', { class: 'badge accent' }, ENTRY_TYPES[l.entry_type]),
            info?.reversed_by_no && h('span', { class: 'badge bad' }, 'معكوس'),
            info?.in_manara && h('span', { class: 'badge ok' }, 'بالمنارة')),
          h('td', { rowspan: ls.length }, fmt.date(l.entry_date)),
          h('td', { rowspan: ls.length, class: 'je-desc-cell' }, l.entry_description));
        }
        tr.append(h('td', {}, `${l.account_code} — ${l.account_name}`), h('td', { class: 'num' }, Number(l.debit) ? fmt.num(l.debit) : ''),
          h('td', { class: 'num' }, Number(l.credit) ? fmt.num(l.credit) : ''), h('td', {}, l.party_name || ''), h('td', {}, l.project_name || ''),
          h('td', {}, l.cost_center_name || ''), h('td', {}, l.equipment_name || ''), h('td', {}, l.line_description || ''));
        tbody.append(tr);
      });
    });
    body.replaceChildren(
      h('div', { class: 'notice', style: { marginBottom: '10px', display: 'flex', gap: '16px', flexWrap: 'wrap' } },
        h('strong', {}, `صفحة رقم ${b.batch_no} — ${b.fiscal_year}`), h('span', {}, `حُفظت ${fmt.datetime(b.created_at)}`), who && h('span', {}, 'بواسطة ' + who),
        h('span', {}, `${Object.keys(byEntry).length} قيد`), h('span', { class: 'help' }, 'الصفحة المحفوظة لا تُعدَّل. اضغط على أي قيد لعكسه أو تعليمه في المنارة.')),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap je-wrap' }, h('table', { class: 'grid je-grid view' },
        h('thead', {}, h('tr', {}, ['القيد', 'التاريخ', 'البيان', 'الحساب', 'مدين', 'دائن', 'الطرف', 'المشروع', 'مركز التكلفة', 'المعدة', 'بيان السطر'].map((t) => h('th', {}, t)))),
        tbody,
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 4, style: { fontWeight: 700 } }, 'الإجمالي'),
          h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totD)), h('td', { class: 'num', style: { fontWeight: 700 } }, fmt.num(totC)), h('td', { colspan: 5 })))))));
    if (highlightEntry) setTimeout(() => body.querySelector('tr.hl')?.scrollIntoView({ block: 'center' }), 50);
  }

  init();
}

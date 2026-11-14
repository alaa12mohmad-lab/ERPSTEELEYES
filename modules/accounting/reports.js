// تقارير المحاسبة
import { printHeader, printFooter, refreshCompanies } from '../../shared/branding.js';
import { acc, core, rpc, errMsg } from '../../shared/sb.js';
import { h, modal, toast, fmt } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { loadLookups, picker, companySelect, yearStart, today, typeLabel, parseAcc } from './lookups.js';
import { openEntry } from './register.js';

export const N = (v) => (v === null || v === undefined || v === '' ? '' : fmt.num(v));
export const neg = (v) => (Number(v) < 0 ? 'num neg' : 'num');

export function dateInput(v) { return h('input', { class: 'input', type: 'date', value: v, style: { width: 'auto' } }); }

export function exportAoa(name, aoa) {
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = aoa[0].map(() => ({ wch: 18 }));
  const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'تقرير');
  window.XLSX.writeFile(wb, name + '.xlsx');
}

// إعدادات الطباعة لكل تقرير (الاتجاه وحجم الخط) — تُحفظ على الجهاز
const PRINT_KEY = 'erp-print-prefs';
function printPrefs(name) {
  try { return JSON.parse(localStorage.getItem(PRINT_KEY) || '{}')[name] || {}; } catch { return {}; }
}
function savePrintPrefs(name, p) {
  try { const all = JSON.parse(localStorage.getItem(PRINT_KEY) || '{}'); all[name] = { ...(all[name] || {}), ...p }; localStorage.setItem(PRINT_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

// طباعة تقرير: ترويسة فيها الشركة والعنوان والفترة، ثم المحتوى، وسطر توقيعات اختياري.
//   fit: يصغّر التقرير حتى يتسع في صفحة واحدة (حتى 62% ليبقى مقروءًا)، وإذا كان أطول يُقسَّم ويتكرر رأس الجدول
//   orient: portrait | landscape ، fs: s | m | l (حجم الخط)
export async function printReport(content, { title, company, period, fit = false, sign = false, orient = 'portrait', fs = 'm' } = {}) {
  document.getElementById('print-area')?.remove();
  document.getElementById('print-page')?.remove();
  await refreshCompanies();
  const body = content.cloneNode(true);
  body.querySelectorAll('button, .fin-title, .no-print').forEach((x) => x.remove());
  const land = orient === 'landscape';
  const area = h('div', { id: 'print-area', class: 'rp fs-' + fs + (fit ? ' fit' : '') + (land ? ' land' : '') },
    printHeader(company, title, period),
    body,
    sign ? h('div', { class: 'pv-sign rp-sign' }, ['أعدّه', 'راجعه', 'اعتمده'].map((t) => h('div', {}, h('div', { class: 'pv-sl' }, t), h('div', { class: 'pv-line' }), h('div', { class: 'rp-sd' }, 'التاريخ: ..../..../........')))) : null,
    h('div', { class: 'pv-foot' }, printFooter(state.profile?.full_name, fmt.datetime)));
  const page = h('style', { id: 'print-page' }, `@media print { @page { size: A4 ${land ? 'landscape' : 'portrait'}; margin: ${land ? '10mm' : '12mm'}; } }`);
  document.head.append(page);
  document.body.append(area);
  if (fit) {
    // قياس بعرض الصفحة بعد الهوامش ومقارنة بارتفاعها: طولي 186×273 مم، عرضي 277×190 مم
    const [w, hh] = land ? [277, 188] : [186, 271];
    Object.assign(area.style, { display: 'block', position: 'absolute', top: '0', left: '-10000px', width: w + 'mm', visibility: 'hidden' });
    const mm = 96 / 25.4; const hgt = area.scrollHeight;
    const scale = Math.max(0.62, Math.min(1, (hh * mm) / hgt));
    Object.assign(area.style, { display: '', position: '', top: '', left: '', width: '', visibility: '' });
    if (scale < 1) area.style.zoom = String(Math.floor(scale * 100) / 100);
  }
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.remove(); page.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
}

// اختيارات الطباعة بجانب الزر: الاتجاه وحجم الخط
function printControls(key) {
  const p = printPrefs(key);
  const orient = h('select', { class: 'input', title: 'اتجاه الورقة', style: { width: 'auto' } },
    h('option', { value: 'portrait', selected: p.orient !== 'landscape' }, 'طولي'), h('option', { value: 'landscape', selected: p.orient === 'landscape' }, 'عرضي'));
  const fs = h('select', { class: 'input', title: 'حجم خط الطباعة', style: { width: 'auto' } },
    [['s', 'خط صغير'], ['m', 'خط عادي'], ['l', 'خط كبير']].map(([v, t]) => h('option', { value: v, selected: (p.fs || 'm') === v }, t)));
  orient.onchange = () => savePrintPrefs(key, { orient: orient.value });
  fs.onchange = () => savePrintPrefs(key, { fs: fs.value });
  return { orient, fs };
}

export function frame(el, controls, onRun) {
  const out = h('div');
  const run = h('button', { class: 'btn primary', onclick: () => go() }, 'عرض');
  const exp = h('button', { class: 'btn', disabled: true }, 'تصدير Excel');
  const key = location.hash || 'report';
  const pc = printControls(key);
  let last = null;
  const prn = h('button', { class: 'btn', onclick: () => {
    if (!out.childNodes.length) return window.print();
    // الشركة: من اختيار الشركة داخل التقرير، وإلا الشركات المختارة في الأعلى
    const coCtl = controls.find((c) => c?.dataset?.co);
    const all = state.companies().map((c) => c.id);
    const company = coCtl ? (coCtl.value || all) : (state.selectedCompanies.length ? state.selectedCompanies : all);
    printReport(out, { title: last?.name || document.title, company: company.length === 1 ? company[0] : company, orient: pc.orient.value, fs: pc.fs.value, ...(last?.print || {}) });
  } }, 'طباعة');
  el.replaceChildren(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'toolbar' }, ...controls, h('div', { class: 'grow' }), run, exp, pc.orient, pc.fs, prn)), out);
  let seq = 0;
  async function go() {
    const my = ++seq;   // إذا تغيّر الاختيار أثناء الحساب تُتجاهل النتيجة القديمة
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ الحساب…'));
    try {
      const tmp = h('div');
      const r = await onRun(tmp);
      if (my !== seq) return;
      out.replaceChildren(...tmp.childNodes);
      last = r || null;
      exp.disabled = !r?.aoa;
      exp.onclick = () => r?.aoa && exportAoa(r.name, r.aoa);
    } catch (e) { if (my === seq) out.replaceChildren(h('div', { class: 'notice bad' }, e.message)); }
  }
  return go;
}

// ---------------------------------------------------------------------
// ميزان المراجعة
// ---------------------------------------------------------------------
export function renderTrialBalance(el) {
  let company;
  const sel = companySelect((v) => { company = v; go(); }, { includeAll: CONSOL }); company = sel.value;
  const from = dateInput(yearStart()); const to = dateInput(today());
  const groups = h('input', { type: 'checkbox', checked: true });
  const go = frame(el, [sel, h('span', {}, 'من'), from, h('span', {}, 'إلى'), to, h('label', { class: 'check' }, groups, 'إظهار الحسابات المجمّعة')], async (out) => {
    const K = ['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'];
    let rows; let elim = null;
    if (company) rows = await rpc('trial_balance', { p_company: company, p_from: from.value, p_to: to.value }, 'accounting');
    else {
      // المجمّع: الحسابات تُجمع بالكود، والاستبعاد بين الشركات يُوزَّع على الحساب وآبائه
      const cos = allIds();
      const y0 = from.value.slice(0, 4) + '-01-01';
      const [per, ic] = await Promise.all([
        Promise.all(cos.map((id) => rpc('trial_balance', { p_company: id, p_from: from.value, p_to: to.value }, 'accounting'))),
        rpc('intercompany_amounts', { p_companies: cos, p_from: y0, p_to: to.value }, 'accounting')]);
      const m = new Map();
      per.flat().forEach((r) => {
        const x = m.get(r.code) || { ...r, account_id: null, ...Object.fromEntries(K.map((k) => [k, 0])) };
        K.forEach((k) => { x[k] += Number(r[k]); });
        if (!r.is_postable) x.is_postable = false;
        m.set(r.code, x);
      });
      rows = [...m.values()].sort((a, b) => (a.sort_path < b.sort_path ? -1 : a.sort_path > b.sort_path ? 1 : 0));
      // أرصدة أول وآخر المدة صافية على جهة واحدة (قد يكون الحساب مدينًا في شركة ودائنًا في أخرى)
      rows.forEach((r) => [['opening_debit', 'opening_credit'], ['closing_debit', 'closing_credit']].forEach(([d, c]) => {
        const n = r[d] - r[c]; r[d] = Math.max(n, 0); r[c] = Math.max(-n, 0);
      }));
      elim = new Map();
      ic.forEach((x) => {
        const r = m.get(x.code); if (!r) return;
        r.sort_path.split('/').forEach((c) => elim.set(c, (elim.get(c) || 0) + Number(x.net)));
      });
    }
    const shown = rows.filter((r) => groups.checked || r.is_postable);
    const tot = rows.filter((r) => r.is_postable).reduce((s, r) => { ['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].forEach((k) => { s[k] = (s[k] || 0) + Number(r[k]); }); return s; }, {});
    const balanced = Math.abs((tot.closing_debit || 0) - (tot.closing_credit || 0)) < 0.005;
    const after = (r) => { const n = Number(r.closing_debit) - Number(r.closing_credit) - (elim?.get(r.code) || 0); return { d: Math.max(n, 0), c: Math.max(-n, 0) }; };
    const elimCells = (r) => { const e = -(elim.get(r.code) || 0); const a = after(r);
      return [h('td', { class: neg(e) }, Math.abs(e) > 0.004 ? N(e) : ''), h('td', { class: 'num' }, a.d ? N(a.d) : ''), h('td', { class: 'num' }, a.c ? N(a.c) : '')]; };
    const afterTot = elim ? rows.filter((r) => r.is_postable).reduce((t, r) => { const a = after(r); t.d += a.d; t.c += a.c; return t; }, { d: 0, c: 0 }) : null;
    out.replaceChildren(
      elim ? h('p', { class: 'help', style: { margin: '0 0 8px' } }, 'ميزان مجمّع للشركات: الحسابات تُجمع بالكود. ' + ELIM_NOTE) : '',
      elim && Math.abs(afterTot.d - afterTot.c) > 0.005 ? h('div', { class: 'notice bad', style: { marginBottom: '10px' } }, `الميزان بعد الاستبعاد غير متوازن بفرق ${N(afterTot.d - afterTot.c)} — راجع «مطابقة بين الشركات»`) : '',
      balanced ? '' : h('div', { class: 'notice bad', style: { marginBottom: '10px' } }, 'الميزان غير متوازن — راجع فحص سلامة البيانات'),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {},
          h('tr', {}, h('th', { rowspan: 2 }, 'الكود'), h('th', { rowspan: 2 }, 'الحساب'), h('th', { colspan: 2 }, 'أول المدة'), h('th', { colspan: 2 }, 'حركة الفترة'), h('th', { colspan: 2 }, 'آخر المدة'),
            elim ? h('th', { rowspan: 2, title: 'التعاملات بين الشركات الشقيقة (صافي مدين+ / دائن−)' }, 'الاستبعاد') : null, elim ? h('th', { colspan: 2 }, 'المجمّع بعد الاستبعاد') : null),
          h('tr', {}, [...['مدين', 'دائن', 'مدين', 'دائن', 'مدين', 'دائن'], ...(elim ? ['مدين', 'دائن'] : [])].map((t) => h('th', {}, t)))),
        h('tbody', {}, shown.length ? shown.map((r) => h('tr', { class: r.is_postable ? '' : 'group', onclick: () => r.account_id && r.is_postable && openStatement(company, r.account_id, from.value, to.value) },
          h('td', { class: 'ltr' }, r.code), h('td', { style: { paddingInlineStart: (12 + r.depth * 18) + 'px' } }, r.name),
          ...['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].map((k) => h('td', { class: 'num' }, Number(r[k]) ? N(r[k]) : '')),
          ...(elim ? elimCells(r) : [])))
          : h('tr', {}, h('td', { colspan: elim ? 11 : 8, class: 'empty' }, 'لا توجد حركات'))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 2 }, 'الإجمالي'),
          ...['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].map((k) => h('td', { class: 'num' }, N(tot[k] || 0))),
          ...(elim ? [h('td'), h('td', { class: 'num' }, N(afterTot.d)), h('td', { class: 'num' }, N(afterTot.c))] : [])))))));
    return { name: elim ? 'ميزان المراجعة المجمّع' : 'ميزان المراجعة', print: { period: `من ${from.value} إلى ${to.value}` },
      aoa: [['الكود', 'الحساب', 'أول المدة مدين', 'أول المدة دائن', 'الفترة مدين', 'الفترة دائن', 'آخر المدة مدين', 'آخر المدة دائن', ...(elim ? ['الاستبعاد', 'المجمّع مدين', 'المجمّع دائن'] : [])],
        ...shown.map((r) => [r.code, r.name, ...['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].map((k) => Number(r[k])),
          ...(elim ? [-(elim.get(r.code) || 0), after(r).d, after(r).c] : [])])] };
  });
  groups.addEventListener('change', go);
  go();
}

// فتح كشف حساب من تقرير آخر (ميزان المراجعة)
let pendingStatement = null;
export function openStatement(company, account, from = yearStart(), to = today()) {
  pendingStatement = { company, account, from, to };
  if (location.hash === '#/accounting/statement') window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#/accounting/statement';
}

// ---------------------------------------------------------------------
// كشف حساب / كشف طرف
// ---------------------------------------------------------------------
export async function renderStatement(el) {
  let company; let lk;
  const sel = companySelect(async (v) => { company = v; await reload(); }); company = sel.value;
  const kind = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: 'account' }, 'كشف حساب'), h('option', { value: 'party' }, 'كشف طرف / موظف'));
  const from = dateInput(yearStart()); const to = dateInput(today());
  const slot = h('span', { style: { display: 'contents' } });
  let accP, partyP, projP, eqP;
  async function reload() {
    lk = await loadLookups(company);
    // الحساب أو اسم المورد/العميل (يختار حسابه والطرف معًا)
    accP = picker({ options: [...lk.accounts, ...lk.accountOptions.filter((x) => x.combo)], listKey: 'allaccx-' + company, placeholder: 'الحساب أو المورد/العميل', meta: lk.balText, onOpen: lk.loadBalances,
      onChange: (o) => { if (o?.combo) partyP.set(o.party); } });
    accP.el.style.minWidth = '260px';
    partyP = picker({ options: [...lk.parties, ...lk.employees.map((x) => ({ ...x, label: x.label + ' (موظف)', emp: true }))], listKey: 'partyemp-' + company, placeholder: 'الطرف أو الموظف (اختياري)' });
    partyP.el.style.minWidth = '220px';
    projP = picker({ options: lk.allProjects, listKey: 'allproj', placeholder: 'المشروع (اختياري)' });
    eqP = picker({ options: lk.equipment, listKey: 'eq-' + company, placeholder: 'المعدة (اختياري)' });
    drawSlot();
  }
  function drawSlot() { slot.replaceChildren(...(kind.value === 'account' ? [accP.el, partyP.el, projP.el, eqP.el] : [partyP.el])); }
  kind.addEventListener('change', drawSlot);
  await reload();

  const go = frame(el, [sel, kind, slot, h('span', {}, 'من'), from, h('span', {}, 'إلى'), to], async (out) => {
    accP.resolve(); partyP.resolve(); projP.resolve(); eqP.resolve();
    const pOpt = partyP.id ? [...lk.parties, ...lk.employees].find((x) => x.id === partyP.id) : null;
    const isEmp = pOpt && lk.employees.some((x) => x.id === pOpt.id);
    let rows; let title; let extra = [];
    if (kind.value === 'account') {
      if (!accP.id) throw new Error('اختر الحساب');
      const accId = parseAcc(accP.id).account;
      rows = await rpc('account_statement', { p_account: accId, p_from: from.value, p_to: to.value,
        p_party: isEmp ? null : partyP.id, p_employee: isEmp ? partyP.id : null, p_project: projP.id, p_equipment: eqP.id }, 'accounting');
      title = 'كشف حساب ' + lk.byId('accounts', accId).label + (pOpt ? ' — ' + pOpt.name : '');
    } else {
      if (!partyP.id) throw new Error('اختر الطرف أو الموظف');
      const all = await rpc('party_statement', { p_company: company, p_party: isEmp ? null : partyP.id, p_employee: isEmp ? partyP.id : null, p_from: from.value, p_to: to.value }, 'accounting');
      // الرصيد الجاري على الحساب الرئيسي، والمحتجزات والدفعات المقدمة كلٌّ على حدة تحته
      rows = all.filter((r) => (r.bucket || 'main') === 'main');
      extra = all.filter((r) => (r.bucket || 'main') !== 'main');
      title = 'كشف ' + pOpt.label;
    }
    const lines = rows.filter((r) => r.row_kind === 'line');
    const last = rows[rows.length - 1];
    const totD = lines.reduce((s, r) => s + Number(r.debit), 0), totC = lines.reduce((s, r) => s + Number(r.credit), 0);
    const isAcc = kind.value === 'account';
    out.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, h('strong', {}, title), h('span', { class: 'help' }, `من ${from.value} إلى ${to.value} — ${state.companyName(company)}`)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['التاريخ', 'القيد', 'الحساب', 'البيان', 'الفاتورة', isAcc ? 'الطرف' : 'المشروع', isAcc ? 'المشروع' : '', 'مدين', 'دائن', 'الرصيد'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.map((r) => h('tr', { class: r.row_kind === 'opening' ? 'group' : '', onclick: () => r.entry_id && openEntry(r.entry_id) },
          h('td', {}, fmt.date(r.entry_date)), h('td', { class: 'ltr' }, r.entry_ref || ''), h('td', {}, isAcc ? (r.account_code || '') : (r.account_name || '')),
          h('td', { style: { whiteSpace: 'normal', maxWidth: '360px' } }, r.description), h('td', { class: 'ltr' }, r.invoice_no || ''),
          h('td', {}, isAcc ? (r.party_name || '') : (r.project_name || '')), h('td', {}, isAcc ? (r.project_name || '') : ''),
          h('td', { class: 'num' }, Number(r.debit) ? N(r.debit) : ''), h('td', { class: 'num' }, Number(r.credit) ? N(r.credit) : ''),
          h('td', { class: neg(r.balance) }, N(r.balance))))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 7 }, `حركة الفترة (${lines.length})`), h('td', { class: 'num' }, N(totD)), h('td', { class: 'num' }, N(totC)),
          h('td', { class: neg(last?.balance) }, N(last?.balance))))))));
    // ملخص: الرصيد الرئيسي + المحتجزات + الدفعات المقدمة (كل حساب برصيده آخر الفترة)
    const BK = { retention: 'محتجزات', advance: 'دفعات مقدمة' };
    const groups = [];
    for (const r of extra) {
      let g = groups.find((x) => x.code === r.account_code);
      if (!g) { g = { code: r.account_code, name: r.account_name, bucket: r.bucket, rows: [] }; groups.push(g); }
      g.rows.push(r); if (r.account_name) g.name = r.account_name;
    }
    const summary = [];
    if (groups.length) {
      const mainBal = Number(last?.balance || 0);
      const parts = groups.map((g) => ({ ...g, bal: Number(g.rows[g.rows.length - 1].balance) }));
      summary.push(['الرصيد (' + (lines[0]?.account_name || 'الحساب الرئيسي') + ')', mainBal],
        ...parts.map((g) => [g.name + ' — ' + BK[g.bucket], g.bal]), ['إجمالي المستحق', mainBal + parts.reduce((s, g) => s + g.bal, 0)]);
      out.append(h('div', { class: 'card', style: { marginTop: '12px' } },
        h('div', { class: 'toolbar' }, h('strong', {}, 'الملخص'), h('span', { class: 'help' }, 'الرصيد أعلاه بدون المحتجزات والدفعات المقدمة — هذه أرصدتها')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' }, h('tbody', {},
          summary.map((x, i) => h('tr', { class: i === summary.length - 1 ? 'group' : '' }, h('td', {}, x[0]), h('td', { class: neg(x[1]) }, N(x[1]))))))),
        ...parts.map((g) => h('details', { style: { marginTop: '8px' } }, h('summary', {}, `حركة ${g.name} (${g.rows.filter((r) => r.row_kind === 'line').length})`),
          h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
            h('thead', {}, h('tr', {}, ['التاريخ', 'القيد', 'البيان', 'الفاتورة', 'المشروع', 'مدين', 'دائن', 'الرصيد'].map((t) => h('th', {}, t)))),
            h('tbody', {}, g.rows.map((r) => h('tr', { class: r.row_kind === 'opening' ? 'group' : '', onclick: () => r.entry_id && openEntry(r.entry_id) },
              h('td', {}, fmt.date(r.entry_date)), h('td', { class: 'ltr' }, r.entry_ref || ''), h('td', { style: { whiteSpace: 'normal', maxWidth: '360px' } }, r.description),
              h('td', { class: 'ltr' }, r.invoice_no || ''), h('td', {}, r.project_name || ''),
              h('td', { class: 'num' }, Number(r.debit) ? N(r.debit) : ''), h('td', { class: 'num' }, Number(r.credit) ? N(r.credit) : ''),
              h('td', { class: neg(r.balance) }, N(r.balance)))))))))));
    }
    return { name: title, aoa: [['التاريخ', 'القيد', 'الحساب', 'البيان', 'الفاتورة', 'الطرف/المشروع', 'المشروع', 'مدين', 'دائن', 'الرصيد'],
      ...rows.map((r) => [r.entry_date, r.entry_ref || '', isAcc ? r.account_code : r.account_name, r.description, r.invoice_no || '', isAcc ? r.party_name : r.project_name, isAcc ? r.project_name : '', Number(r.debit), Number(r.credit), Number(r.balance)]),
      ...(summary.length ? [[], ['الملخص'], ...summary.map((x) => [x[0], '', '', '', '', '', '', '', '', x[1]])] : [])] };
  });
  if (pendingStatement) {
    const d = pendingStatement; pendingStatement = null;
    if (d.company !== company) { sel.value = d.company; company = d.company; await reload(); }
    kind.value = 'account'; drawSlot(); accP.set(d.account); from.value = d.from; to.value = d.to; go();
  }
}

// ---------------------------------------------------------------------
// قائمة الدخل والمركز المالي
// ---------------------------------------------------------------------
function statementTable(rows, hasCmp, labels) {
  return h('div', { class: 'card fin' }, h('table', { class: 'grid report fin-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'البند'), h('th', {}, labels[0]), hasCmp && h('th', {}, labels[1]))),
    h('tbody', {}, rows.map((r) => h('tr', { class: 'fin-' + r.row_type, style: { cursor: 'default' } },
      h('td', {}, r.label, r.account_code ? h('span', { class: 'help', style: { marginInlineStart: '10px', fontSize: 'calc(12px * var(--fs, 1))' } }, '(' + r.account_code + ')') : ''),
      h('td', { class: neg(r.amount) }, r.row_type === 'header' ? '' : N(r.amount)),
      hasCmp && h('td', { class: neg(r.cmp_amount) }, r.row_type === 'header' ? '' : N(r.cmp_amount)))))));
}

// ---------------------------------------------------------------------
// التقارير المجمّعة: عمود لكل شركة + المجموع + الاستبعاد بين الشركات + المجمّع
// ---------------------------------------------------------------------
export const CONSOL = 'كل الشركات (مجمّع)';
const allIds = () => state.companies().map((c) => c.id);
const rowKey = (r) => `${r.sort}|${r.row_type}|${r.account_code || r.label}`;

async function groupStatement(kind, args) {
  const cos = allIds();
  const fn = kind === 'is' ? 'income_statement' : 'balance_sheet';
  const [per, sum, cons] = await Promise.all([
    Promise.all(cos.map((id) => rpc(fn, { p_company: id, ...args }, 'accounting'))),
    rpc(fn + '_group', { p_companies: cos, ...args, p_eliminate: false }, 'accounting'),
    rpc(fn + '_group', { p_companies: cos, ...args, p_eliminate: true }, 'accounting'),
  ]);
  const maps = per.map((rows) => new Map(rows.map((r) => [rowKey(r), r])));
  const consMap = new Map(cons.map((r) => [rowKey(r), r]));
  return {
    cos,
    rows: sum.map((r) => {
      const k = rowKey(r); const hdr = r.row_type === 'header';
      const c = hdr ? null : Number(consMap.get(k)?.amount || 0);
      return { ...r, per: maps.map((m) => (hdr ? null : Number(m.get(k)?.amount || 0))), sum: hdr ? null : Number(r.amount), elim: hdr ? null : c - Number(r.amount), cons: c };
    }),
  };
}

function groupTable({ cos, rows }) {
  const cell = (v, hdr, cls = '') => h('td', { class: neg(v) + cls }, hdr ? '' : Math.abs(v) < 0.005 && cls ? '' : N(v));
  return h('div', { class: 'card fin fin-wide' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report fin-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'البند'), ...cos.map((id) => h('th', {}, state.companyName(id))), h('th', {}, 'المجموع'),
      h('th', { title: 'التعاملات بين الشركات الشقيقة' }, 'استبعاد بين الشركات'), h('th', {}, 'المجمّع'))),
    h('tbody', {}, rows.map((r) => {
      const hdr = r.row_type === 'header';
      return h('tr', { class: 'fin-' + r.row_type, style: { cursor: 'default' } },
        h('td', {}, r.label, r.account_code ? h('span', { class: 'help', style: { marginInlineStart: '10px', fontSize: 'calc(12px * var(--fs, 1))' } }, '(' + r.account_code + ')') : ''),
        ...r.per.map((v) => cell(v, hdr)), cell(r.sum, hdr), cell(r.elim, hdr, ' elim'), h('td', { class: neg(r.cons) }, hdr ? '' : h('b', {}, N(r.cons))));
    })))));
}
const groupAoa = ({ cos, rows }) => [['البند', 'الكود', ...cos.map((id) => state.companyName(id)), 'المجموع', 'استبعاد بين الشركات', 'المجمّع'],
  ...rows.map((r) => [r.label, r.account_code || '', ...(r.row_type === 'header' ? cos.map(() => '') : r.per), r.sum ?? '', r.elim ?? '', r.cons ?? ''])];
const ELIM_NOTE = 'الاستبعاد: الذمم والإيرادات والمصروفات بين الشركات الشقيقة (الأطراف المعلَّمة «شركة شقيقة» في العملاء والموردين). الضريبة لا تُستبعد.';

export function renderIncome(el) {
  let company;
  const sel = companySelect((v) => { company = v; cmp.disabled = !v; go(); }, { includeAll: CONSOL }); company = sel.value;
  const from = dateInput(yearStart()); const to = dateInput(today());
  const cmp = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, 'بدون مقارنة'),
    h('option', { value: 'prev_year' }, 'نفس الفترة من السنة السابقة'), h('option', { value: 'prev_period' }, 'الفترة السابقة'));
  const go = frame(el, [sel, h('span', {}, 'من'), from, h('span', {}, 'إلى'), to, cmp], async (out) => {
    let cf = null, ct = null;
    if (cmp.value === 'prev_year') {
      const sh = (d) => { const x = new Date(d); x.setFullYear(x.getFullYear() - 1); return x.toISOString().slice(0, 10); };
      cf = sh(from.value); ct = sh(to.value);
    } else if (cmp.value === 'prev_period') {
      const f = new Date(from.value), t = new Date(to.value); const days = Math.round((t - f) / 864e5) + 1;
      const pt = new Date(f - 864e5), pf = new Date(pt - (days - 1) * 864e5);
      cf = pf.toISOString().slice(0, 10); ct = pt.toISOString().slice(0, 10);
    }
    if (!company) {
      const g = await groupStatement('is', { p_from: from.value, p_to: to.value });
      out.replaceChildren(h('p', { class: 'help', style: { margin: '0 0 8px' } }, ELIM_NOTE), groupTable(g));
      return { name: 'قائمة الدخل المجمّعة', print: { period: `من ${from.value} إلى ${to.value}`, fit: true, sign: true }, aoa: groupAoa(g) };
    }
    const rows = await rpc('income_statement', { p_company: company, p_from: from.value, p_to: to.value, p_cmp_from: cf, p_cmp_to: ct }, 'accounting');
    const hasCmp = !!cf;
    const labels = [`${from.value} — ${to.value}`, hasCmp ? `${cf} — ${ct}` : ''];
    out.replaceChildren(h('h2', { class: 'fin-title' }, `قائمة الدخل — ${state.companyName(company)}`), statementTable(rows, hasCmp, labels));
    return { name: 'قائمة الدخل', print: { period: `من ${from.value} إلى ${to.value}` + (hasCmp ? ` — مقارنة بـ ${cf} إلى ${ct}` : ''), fit: true, sign: true }, aoa: [['البند', 'الكود', labels[0], ...(hasCmp ? [labels[1]] : [])], ...rows.map((r) => [r.label, r.account_code || '', r.amount === null ? '' : Number(r.amount), ...(hasCmp ? [r.cmp_amount === null ? '' : Number(r.cmp_amount)] : [])])] };
  });
  go();
}

export function renderBalanceSheet(el) {
  let company;
  const sel = companySelect((v) => { company = v; cmp.disabled = !v; go(); }, { includeAll: CONSOL }); company = sel.value;
  const asOf = dateInput(today());
  const cmp = h('input', { class: 'input', type: 'date', style: { width: 'auto' }, title: 'تاريخ المقارنة (اختياري)' });
  const go = frame(el, [sel, h('span', {}, 'في'), asOf, h('span', {}, 'مقارنة بـ'), cmp], async (out) => {
    if (!company) {
      const g = await groupStatement('bs', { p_as_of: asOf.value });
      const chk = g.rows.find((r) => r.row_type === 'check');
      out.replaceChildren(h('p', { class: 'help', style: { margin: '0 0 8px' } }, ELIM_NOTE),
        Math.abs(chk?.cons || 0) > 0.005 ? h('div', { class: 'notice bad', style: { marginBottom: '10px' } },
          `المجمّع غير متوازن بفرق ${N(chk.cons)} — غالبًا تعامل بين الشركات مسجّل في شركة دون الأخرى أو بمبلغ مختلف. راجع تقرير «مطابقة بين الشركات».`) : '',
        groupTable(g));
      return { name: 'المركز المالي المجمّع', print: { period: `في ${asOf.value}`, fit: true, sign: true }, aoa: groupAoa(g) };
    }
    const rows = await rpc('balance_sheet', { p_company: company, p_as_of: asOf.value, p_cmp_as_of: cmp.value || null }, 'accounting');
    const hasCmp = !!cmp.value;
    const check = rows.find((r) => r.row_type === 'check');
    out.replaceChildren(h('h2', { class: 'fin-title' }, `المركز المالي — ${state.companyName(company)}`),
      Number(check?.amount) !== 0 ? h('div', { class: 'notice bad', style: { marginBottom: '10px' } }, 'المركز المالي غير متوازن') : '',
      statementTable(rows, hasCmp, [asOf.value, cmp.value]));
    return { name: 'المركز المالي', print: { period: `في ${asOf.value}` + (hasCmp ? ` — مقارنة بـ ${cmp.value}` : ''), fit: true, sign: true }, aoa: [['البند', 'الكود', asOf.value, ...(hasCmp ? [cmp.value] : [])], ...rows.map((r) => [r.label, r.account_code || '', r.amount === null ? '' : Number(r.amount), ...(hasCmp ? [r.cmp_amount === null ? '' : Number(r.cmp_amount)] : [])])] };
  });
  go();
}

// ---------------------------------------------------------------------
// أرصدة العملاء والموردين والموظفين
// ---------------------------------------------------------------------
export function renderPartyBalances(el) {
  let company;
  const sel = companySelect((v) => { company = v; go(); }, { includeAll: CONSOL }); company = sel.value;
  const asOf = dateInput(today());
  const kind = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, 'الكل'), h('option', { value: 'customer' }, 'العملاء'),
    h('option', { value: 'supplier' }, 'الموردون'), h('option', { value: 'employee' }, 'الموظفون (عهد وسلف)'));
  const go = frame(el, [sel, h('span', {}, 'في'), asOf, kind], async (out) => {
    let rows;
    if (company) rows = await rpc('party_balances', { p_company: company, p_as_of: asOf.value }, 'accounting');
    else {
      // المجمّع: رصيد الطرف في كل الشركات معًا (الطرف بطاقة واحدة مشتركة)
      const per = await Promise.all(allIds().map((id) => rpc('party_balances', { p_company: id, p_as_of: asOf.value }, 'accounting')));
      const m = new Map();
      per.flat().forEach((r) => {
        const k = (r.party_id || '') + '|' + (r.employee_id || '');
        const x = m.get(k) || { ...r, debit: 0, credit: 0, balance: 0, n: 0 };
        x.debit += Number(r.debit); x.credit += Number(r.credit); x.balance += Number(r.balance); x.n += 1; m.set(k, x);
      });
      rows = [...m.values()];
    }
    const { data: sis } = await core.from('parties').select('id, sister_company_id').not('sister_company_id', 'is', null);
    const sister = new Map((sis || []).map((p) => [p.id, p.sister_company_id]));
    if (kind.value) rows = rows.filter((r) => r.kind === kind.value || (r.kind === 'both' && kind.value !== 'employee'));
    rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    const kl = { customer: 'عميل', supplier: 'مورد', both: 'عميل ومورد', employee: 'موظف' };
    const sum = rows.reduce((s, r) => s + Number(r.balance), 0);
    out.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
      h('thead', {}, h('tr', {}, ['الطرف', 'النوع', 'مدين', 'دائن', 'الرصيد', 'الاتجاه'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', { style: { cursor: 'default' } }, h('td', {}, r.party_name, sister.get(r.party_id) ? h('span', { class: 'badge', style: { marginInlineStart: '6px' }, title: 'شركة شقيقة — تُستبعد من المجمّع' }, 'شقيقة') : null), h('td', {}, kl[r.kind]),
        h('td', { class: 'num' }, N(r.debit)), h('td', { class: 'num' }, N(r.credit)), h('td', { class: neg(r.balance) }, N(Math.abs(r.balance))),
        h('td', {}, Number(r.balance) > 0 ? 'مدين' : Number(r.balance) < 0 ? 'دائن' : '—')))),
      h('tfoot', {}, h('tr', {}, h('td', { colspan: 4 }, `${rows.length} طرف — صافي`), h('td', { class: neg(sum) }, N(sum)), h('td', {})))))));
    return { name: 'أرصدة الأطراف', aoa: [['الطرف', 'النوع', 'مدين', 'دائن', 'الرصيد'], ...rows.map((r) => [r.party_name, kl[r.kind], Number(r.debit), Number(r.credit), Number(r.balance)])] };
  });
  go();
}

// ---------------------------------------------------------------------
// المشاريع والمعدات (لشركة أو أكثر أو الكل — من اختيار الشركات أعلى الشاشة)
// ---------------------------------------------------------------------
function companiesArg() { return state.allCompaniesSelected() ? null : state.selectedCompanies; }

export function renderProjects(el) {
  const from = h('input', { class: 'input', type: 'date', style: { width: 'auto' } });
  const to = h('input', { class: 'input', type: 'date', style: { width: 'auto' } });
  const onlyActive = h('input', { type: 'checkbox', checked: true });
  const go = frame(el, [h('span', { class: 'help' }, 'الشركات حسب اختيارك أعلى الشاشة'), h('span', {}, 'من'), from, h('span', {}, 'إلى'), to, h('label', { class: 'check' }, onlyActive, 'مشاريع لها حركة فقط')], async (out) => {
    let rows = await rpc('project_summary', { p_companies: companiesArg(), p_from: from.value || null, p_to: to.value || null }, 'accounting');
    if (onlyActive.checked) rows = rows.filter((r) => Number(r.revenue) || Number(r.direct_cost) || Number(r.other_cost));
    const t = rows.reduce((s, r) => { s.r += Number(r.revenue); s.d += Number(r.direct_cost); s.o += Number(r.other_cost); s.p += Number(r.profit); return s; }, { r: 0, d: 0, o: 0, p: 0 });
    const scope = state.allCompaniesSelected() ? 'كل الشركات' : state.selectedCompanies.map((id) => state.companyName(id)).join(' + ');
    out.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('strong', {}, 'ربحية المشاريع'), h('span', { class: 'help' }, scope + ' — مجمل الربح قبل المصروفات الإدارية العامة')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الكود', 'المشروع', 'الشركة الرئيسية', 'قيمة العقد', 'الإيراد', 'التكلفة المباشرة', 'تكاليف أخرى', 'الربح', 'الهامش', 'شركات لها قيود'].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.length ? rows.map((r) => h('tr', { onclick: () => projectDetail(r, from.value, to.value) },
          h('td', { class: 'ltr' }, r.code), h('td', {}, r.name), h('td', {}, state.companyName(r.lead_company_id)), h('td', { class: 'num' }, N(r.contract_value)),
          h('td', { class: 'num' }, N(r.revenue)), h('td', { class: 'num' }, N(r.direct_cost)), h('td', { class: 'num' }, N(r.other_cost)),
          h('td', { class: neg(r.profit) }, N(r.profit)), h('td', { class: 'num' }, Number(r.revenue) ? (Number(r.profit) / Number(r.revenue) * 100).toFixed(1) + '%' : ''),
          h('td', {}, r.companies_with_entries))) : h('tr', {}, h('td', { colspan: 10, class: 'empty' }, 'لا توجد حركات على المشاريع'))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 4 }, 'الإجمالي'), h('td', { class: 'num' }, N(t.r)), h('td', { class: 'num' }, N(t.d)), h('td', { class: 'num' }, N(t.o)),
          h('td', { class: neg(t.p) }, N(t.p)), h('td', { colspan: 2 })))))));
    return { name: 'ربحية المشاريع', aoa: [['الكود', 'المشروع', 'الإيراد', 'التكلفة المباشرة', 'تكاليف أخرى', 'الربح'], ...rows.map((r) => [r.code, r.name, Number(r.revenue), Number(r.direct_cost), Number(r.other_cost), Number(r.profit)])] };
  });
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) go(); else off(); });
  go();
}

async function projectDetail(p, from, to) {
  const m = modal({ title: `المشروع ${p.code} — ${p.name}`, size: 'wide' });
  const rows = await rpc('project_detail', { p_project: p.project_id, p_companies: companiesArg(), p_from: from || null, p_to: to || null }, 'accounting');
  const comps = [...new Set(rows.map((r) => r.company_id))];
  m.body.append(...comps.map((c) => {
    const rs = rows.filter((r) => r.company_id === c);
    const rev = rs.filter((r) => r.account_type === 'revenue').reduce((s, r) => s + Number(r.amount), 0);
    const exp = rs.filter((r) => r.account_type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
    return h('div', { style: { marginBottom: '18px' } }, h('h3', { style: { fontSize: 'calc(15px * var(--fs, 1))', margin: '0 0 6px' } }, state.companyName(c) || 'شركة', ` — إيراد ${N(rev)} • تكلفة ${N(exp)} • ربح ${N(rev - exp)}`),
      h('table', { class: 'grid report' }, h('tbody', {}, rs.map((r) => h('tr', { style: { cursor: 'default' } },
        h('td', { class: 'ltr', style: { width: '90px' } }, r.account_code), h('td', {}, r.account_name), h('td', {}, typeLabel(r.account_type)), h('td', { class: 'num' }, N(r.amount)))))));
  }), rows.length ? '' : h('div', { class: 'empty' }, 'لا توجد حركات'));
}

export function renderEquipment(el) {
  const from = h('input', { class: 'input', type: 'date', style: { width: 'auto' } });
  const to = h('input', { class: 'input', type: 'date', style: { width: 'auto' } });
  const onlyActive = h('input', { type: 'checkbox', checked: true });
  const go = frame(el, [h('span', { class: 'help' }, 'الشركات حسب اختيارك أعلى الشاشة'), h('span', {}, 'من'), from, h('span', {}, 'إلى'), to, h('label', { class: 'check' }, onlyActive, 'معدات لها حركة فقط')], async (out) => {
    let rows = await rpc('equipment_summary', { p_companies: companiesArg(), p_from: from.value || null, p_to: to.value || null }, 'accounting');
    if (onlyActive.checked) rows = rows.filter((r) => Number(r.revenue) || Number(r.expense));
    const t = rows.reduce((s, r) => { s.r += Number(r.revenue); s.e += Number(r.expense); s.n += Number(r.net); return s; }, { r: 0, e: 0, n: 0 });
    out.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('strong', {}, 'المعدات: الإيراد والمصروف'),
      h('span', { class: 'help' }, 'العرض المحاسبي. الإيراد الداخلي يُضاف مع قسم تشغيل المعدات.')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الكود', 'المعدة', 'النوع', 'الملكية', 'الشركة', 'الإيراد', 'المصروف', 'الصافي', 'صرفت عليها شركات أخرى'].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.length ? rows.map((r) => h('tr', { onclick: () => equipmentDetail(r, from.value, to.value) },
          h('td', { class: 'ltr' }, r.code), h('td', {}, r.name), h('td', {}, r.kind === 'vehicle' ? 'سيارة' : 'معدة'),
          h('td', {}, r.ownership === 'rented' ? h('span', { class: 'badge warn' }, 'مستأجرة') : 'مملوكة'), h('td', {}, state.companyName(r.company_id)),
          h('td', { class: 'num' }, N(r.revenue)), h('td', { class: 'num' }, N(r.expense)), h('td', { class: neg(r.net) }, N(r.net)),
          h('td', { class: 'num' }, Number(r.other_company_expense) ? h('span', { class: 'badge warn' }, N(r.other_company_expense)) : '')))
          : h('tr', {}, h('td', { colspan: 9, class: 'empty' }, 'لا توجد حركات على المعدات'))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 5 }, 'الإجمالي'), h('td', { class: 'num' }, N(t.r)), h('td', { class: 'num' }, N(t.e)), h('td', { class: neg(t.n) }, N(t.n)), h('td', {})))))));
    return { name: 'تقرير المعدات', aoa: [['الكود', 'المعدة', 'الشركة', 'الإيراد', 'المصروف', 'الصافي', 'صرفت عليها شركات أخرى'],
      ...rows.map((r) => [r.code, r.name, state.companyName(r.company_id), Number(r.revenue), Number(r.expense), Number(r.net), Number(r.other_company_expense)])] };
  });
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) go(); else off(); });
  go();
}

async function equipmentDetail(q, from, to) {
  const m = modal({ title: `المعدة ${q.code} — ${q.name}`, size: 'wide' });
  const rows = await rpc('equipment_detail', { p_equipment: q.equipment_id, p_companies: companiesArg(), p_from: from || null, p_to: to || null }, 'accounting');
  m.body.append(rows.length ? h('table', { class: 'grid report' },
    h('thead', {}, h('tr', {}, ['الشركة', 'المشروع', 'الحساب', 'النوع', 'المبلغ'].map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.map((r) => h('tr', { style: { cursor: 'default' } },
      h('td', {}, state.companyName(r.company_id), r.company_id !== q.company_id ? h('span', { class: 'badge warn', style: { marginInlineStart: '6px' } }, 'شركة أخرى') : ''),
      h('td', {}, r.project_name || 'بدون مشروع (على الشركة المالكة)'), h('td', {}, `${r.account_code} — ${r.account_name}`), h('td', {}, typeLabel(r.account_type)),
      h('td', { class: 'num' }, N(r.amount))))))
    : h('div', { class: 'empty' }, 'لا توجد حركات'));
}

// ---------------------------------------------------------------------
// الإقرار الضريبي (ربع سنوي أو شهري حسب إعداد الشركة)
// ---------------------------------------------------------------------
const CAT = { standard: 'الأساسية', zero: 'الصفرية', exempt: 'المعفاة' };

function periodRange(year, period, n) {
  const pad = (x) => String(x).padStart(2, '0');
  const m1 = period === 'monthly' ? n : (n - 1) * 3 + 1;
  const m2 = period === 'monthly' ? n : m1 + 2;
  const last = new Date(Date.UTC(year, m2, 0)).getUTCDate();
  return [`${year}-${pad(m1)}-01`, `${year}-${pad(m2)}-${pad(last)}`];
}

export async function renderVatReturn(el) {
  let company; let lk;
  const sel = companySelect(async (v) => { company = v; await setup(); go(); }); company = sel.value;
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const year = h('select', { class: 'input', style: { width: 'auto' } },
    [now.getUTCFullYear() + 1, now.getUTCFullYear(), now.getUTCFullYear() - 1, now.getUTCFullYear() - 2].map((y) => h('option', { value: y, selected: y === now.getUTCFullYear() }, y)));
  const period = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: 'quarterly' }, 'ربع سنوي'), h('option', { value: 'monthly' }, 'شهري'));
  const part = h('select', { class: 'input', style: { width: 'auto' } });
  const fillPart = () => {
    const cur = period.value === 'monthly' ? now.getUTCMonth() + 1 : Math.floor(now.getUTCMonth() / 3) + 1;
    const keep = Number(part.value) || cur;
    part.replaceChildren(...(period.value === 'monthly'
      ? Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === keep }, `شهر ${i + 1}`))
      : [1, 2, 3, 4].map((q) => h('option', { value: q, selected: q === Math.min(keep, 4) }, `الربع ${['الأول', 'الثاني', 'الثالث', 'الرابع'][q - 1]}`))));
  };
  async function setup() {
    lk = await loadLookups(company);
    period.value = lk.vatPeriod === 'monthly' ? 'monthly' : 'quarterly';
    part.value = ''; fillPart();
  }
  period.addEventListener('change', () => { part.value = ''; fillPart(); });
  await setup();

  const go = frame(el, [sel, year, period, part], async (out) => {
    const [from, to] = periodRange(Number(year.value), period.value, Number(part.value));
    const [rows, mov] = await Promise.all([
      rpc('vat_return', { p_company: company, p_from: from, p_to: to }, 'accounting'),
      rpc('vat_accounts_movement', { p_company: company, p_from: from, p_to: to }, 'accounting'),
    ]);
    const sum = (kind, cat, f, sign) => rows.filter((r) => r.kind === kind && r.category === cat && (sign === undefined || (sign > 0 ? Number(r.base) >= 0 : Number(r.base) < 0)))
      .reduce((s, r) => s + Number(r[f]), 0);
    const box = (kind, cat) => ({ amount: sum(kind, cat, 'base', 1), adj: sum(kind, cat, 'base', -1), vat: sum(kind, cat, 'vat') });
    const section = (kind) => ['standard', 'zero', 'exempt'].map((c) => ({ cat: c, ...box(kind, c) }));
    const sales = section('sales'), purch = section('purchases');
    const tot = (list) => list.reduce((s, b) => ({ amount: s.amount + b.amount, adj: s.adj + b.adj, vat: s.vat + b.vat }), { amount: 0, adj: 0, vat: 0 });
    const ts = tot(sales), tp = tot(purch);
    const net = ts.vat - tp.vat;
    const movOut = mov.filter((m) => m.vat_role === 'output').reduce((s, m) => s + Number(m.credit) - Number(m.debit), 0);
    const movIn = mov.filter((m) => m.vat_role === 'input').reduce((s, m) => s + Number(m.debit) - Number(m.credit), 0);
    const okOut = Math.abs(movOut - ts.vat) < 0.005, okIn = Math.abs(movIn - tp.vat) < 0.005;
    const incomplete = rows.filter((r) => r.incomplete);
    const offRate = rows.filter((r) => r.category === 'standard' && Number(r.base) && Math.abs(Number(r.base) * lk.vatRate - Number(r.vat)) > 0.1);

    const boxRow = (label, b) => h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, N(b.amount)), h('td', { class: neg(b.adj) }, b.adj ? N(b.adj) : ''), h('td', { class: 'num' }, N(b.vat)));
    const detailTable = (kind) => {
      const list = rows.filter((r) => r.kind === kind);
      return h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الفئة', 'القيد', 'تاريخ القيد', kind === 'sales' ? 'العميل' : 'المورد', 'الرقم الضريبي', 'رقم الفاتورة', 'تاريخ الفاتورة', 'المبلغ الخاضع', 'الضريبة'].map((t) => h('th', {}, t)))),
        h('tbody', {}, list.length ? list.map((r) => h('tr', { class: r.incomplete ? 'warnrow' : '', onclick: () => openEntry(r.entry_id) },
          h('td', {}, CAT[r.category]), h('td', { class: 'ltr' }, r.entry_ref), h('td', {}, fmt.date(r.entry_date)), h('td', {}, r.party_name || h('span', { class: 'badge warn' }, 'ناقص')),
          h('td', { class: 'ltr' }, r.tax_number || ''), h('td', { class: 'ltr' }, r.invoice_no || (r.incomplete ? h('span', { class: 'badge warn' }, 'ناقص') : '')),
          h('td', {}, fmt.date(r.invoice_date)), h('td', { class: neg(r.base) }, N(r.base)), h('td', { class: neg(r.vat) }, N(r.vat))))
          : h('tr', {}, h('td', { colspan: 9, class: 'empty' }, 'لا توجد فواتير'))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 7 }, `${list.length} فاتورة`), h('td', { class: 'num' }, N(list.reduce((s, r) => s + Number(r.base), 0))),
          h('td', { class: 'num' }, N(list.reduce((s, r) => s + Number(r.vat), 0))))));
    };
    const tabsBox = h('div');
    const showTab = (kind) => { tabsBox.replaceChildren(h('div', { class: 'table-wrap' }, detailTable(kind))); btnS.classList.toggle('primary', kind === 'sales'); btnP.classList.toggle('primary', kind === 'purchases'); };
    const btnS = h('button', { class: 'btn', onclick: () => showTab('sales') }, 'فواتير المبيعات');
    const btnP = h('button', { class: 'btn', onclick: () => showTab('purchases') }, 'فواتير المشتريات');

    out.replaceChildren(
      incomplete.length ? h('div', { class: 'notice warn', style: { marginBottom: '10px' } },
        `${incomplete.length} سطر ضريبة بلا بيانات كاملة (غالبًا قيود قديمة قبل إضافة خانات الفاتورة) — افتحها من الكشف وعدّلها.`) : '',
      offRate.length ? h('div', { class: 'notice warn', style: { marginBottom: '10px' } },
        `${offRate.length} فاتورة ضريبتها لا تساوي ${lk.vatRate * 100}% من المبلغ الخاضع — راجعها.`) : '',
      h('div', { class: 'card fin', style: { marginBottom: '12px' } },
        h('div', { class: 'toolbar' }, h('strong', {}, `الإقرار الضريبي — ${state.companyName(company)}`), h('span', { class: 'help' }, `من ${from} إلى ${to} (بتاريخ القيد)`)),
        h('table', { class: 'grid report vat-sum' },
          h('thead', {}, h('tr', {}, ['البند', 'المبلغ', 'التعديلات (إشعارات)', 'الضريبة'].map((t) => h('th', {}, t)))),
          h('tbody', {},
            ...sales.map((b) => boxRow('المبيعات ' + CAT[b.cat], b)), h('tr', { class: 'sub' }, ...boxRow('إجمالي المبيعات', ts).children),
            ...purch.map((b) => boxRow('المشتريات ' + CAT[b.cat], b)), h('tr', { class: 'sub' }, ...boxRow('إجمالي المشتريات', tp).children),
            h('tr', { class: 'net' }, h('td', { colspan: 3 }, net >= 0 ? 'صافي الضريبة المستحقة' : 'صافي الضريبة المستردة'), h('td', { class: 'num' }, N(Math.abs(net)))))),
        h('div', { style: { padding: '10px 14px', display: 'flex', gap: '24px', flexWrap: 'wrap' } },
          h('span', {}, 'مطابقة حساب ضريبة المخرجات: ', h('span', { class: okOut ? 'stat-ok' : 'stat-bad' }, okOut ? `مطابق ✓ (${N(movOut)})` : `فرق ${N(movOut - ts.vat)}`)),
          h('span', {}, 'مطابقة حساب ضريبة المدخلات: ', h('span', { class: okIn ? 'stat-ok' : 'stat-bad' }, okIn ? `مطابق ✓ (${N(movIn)})` : `فرق ${N(movIn - tp.vat)}`)),
          h('span', { class: 'help' }, 'المطابقة تقارن الكشف بحركة حسابات الضريبة في الدفاتر.'))),
      h('div', { class: 'card' }, h('div', { class: 'toolbar' }, btnS, btnP), tabsBox));
    showTab('sales');

    const head = ['النوع', 'الفئة', 'القيد', 'تاريخ القيد', 'الطرف', 'الرقم الضريبي', 'رقم الفاتورة', 'تاريخ الفاتورة', 'المبلغ الخاضع', 'الضريبة', 'بيانات ناقصة'];
    return { name: `الإقرار الضريبي ${from} - ${to}`, aoa: [
      ['البند', 'المبلغ', 'التعديلات', 'الضريبة'],
      ...sales.map((b) => ['المبيعات ' + CAT[b.cat], b.amount, b.adj, b.vat]), ['إجمالي المبيعات', ts.amount, ts.adj, ts.vat],
      ...purch.map((b) => ['المشتريات ' + CAT[b.cat], b.amount, b.adj, b.vat]), ['إجمالي المشتريات', tp.amount, tp.adj, tp.vat],
      [net >= 0 ? 'صافي الضريبة المستحقة' : 'صافي الضريبة المستردة', '', '', Math.abs(net)], [],
      head, ...rows.map((r) => [r.kind === 'sales' ? 'مبيعات' : 'مشتريات', CAT[r.category], r.entry_ref, r.entry_date, r.party_name || '', r.tax_number || '',
        r.invoice_no || '', r.invoice_date || '', Number(r.base), Number(r.vat), r.incomplete ? 'نعم' : ''])] };
  });
  [year, part].forEach((x) => x.addEventListener('change', go));
  period.addEventListener('change', go);
  go();
}

// ---------------------------------------------------------------------
// الفواتير: المفتوح والمسدد لكل طرف (من رقم الفاتورة على سطر حساب الطرف)
// ---------------------------------------------------------------------
export async function renderInvoices(el) {
  let company; let lk; let partyP;
  const sel = companySelect(async (v) => { company = v; await reload(); go(); }); company = sel.value;
  const asOf = dateInput(today());
  const show = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: 'open' }, 'المفتوحة فقط'), h('option', { value: 'all' }, 'الكل'));
  const slot = h('span', { style: { display: 'contents' } });
  async function reload() {
    lk = await loadLookups(company);
    partyP = picker({ options: lk.parties, listKey: 'party-' + company, placeholder: 'كل الأطراف' }); partyP.el.style.minWidth = '220px';
    slot.replaceChildren(partyP.el);
  }
  await reload();
  const go = frame(el, [sel, slot, h('span', {}, 'حتى'), asOf, show], async (out) => {
    partyP.resolve();
    const all = await rpc('open_invoices', { p_company: company, p_as_of: asOf.value, p_party: partyP.id }, 'accounting');
    const rows = show.value === 'open' ? all.filter((r) => Math.abs(Number(r.remaining)) >= 0.005) : all;
    const unalloc = (r) => !r.invoice_no;
    const st = (r) => (unalloc(r) ? h('span', { class: 'badge warn' }, Number(r.remaining) < 0 ? 'دفعة غير موزعة' : 'غير موزع')
      : Number(r.amount) === 0 ? h('span', { class: 'badge warn' }, 'لا توجد فاتورة بهذا الرقم')
      : Math.abs(Number(r.remaining)) < 0.005 ? h('span', { class: 'badge ok' }, 'مسددة') : Number(r.settled) > 0 ? h('span', { class: 'badge warn' }, 'جزئي') : h('span', { class: 'badge' }, 'مفتوحة'));
    const sum = (k) => rows.reduce((s, r) => s + Number(r[k]), 0);
    out.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, h('strong', {}, `الفواتير — ${state.companyName(company)}`),
        h('span', { class: 'help' }, 'من رقم الفاتورة المكتوب على سطر حساب العميل أو المورد. يُربط السداد بالفاتورة بكتابة الرقم نفسه على سطر السداد، والسداد بلا رقم يظهر «غير موزع» — وتوزّعه بتعديل القيد وتقسيم السطر على أرقام الفواتير.')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الطرف', 'الحساب', 'رقم الفاتورة', 'تاريخ الفاتورة', 'القيد', 'القيمة', 'المسدد', 'المتبقي', 'العمر (يوم)', 'الحالة'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.length ? rows.map((r) => h('tr', { onclick: () => openEntry(r.entry_id) },
          h('td', {}, r.party_name), h('td', {}, `${r.account_code} — ${r.account_name}`), unalloc(r) ? h('td', { class: 'muted' }, 'بدون رقم فاتورة') : h('td', { class: 'ltr' }, r.invoice_no), h('td', {}, r.invoice_date ? fmt.date(r.invoice_date) : ''),
          h('td', { class: 'ltr' }, r.entry_ref), h('td', { class: 'num' }, N(r.amount)), h('td', { class: 'num' }, N(r.settled)), h('td', { class: neg(r.remaining) }, N(r.remaining)),
          h('td', { class: 'num' }, Math.abs(Number(r.remaining)) < 0.005 ? '' : r.age_days), h('td', {}, st(r))))
          : h('tr', {}, h('td', { colspan: 10, class: 'empty' }, 'لا توجد فواتير'))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 5 }, `${rows.length} فاتورة`), h('td', { class: 'num' }, N(sum('amount'))), h('td', { class: 'num' }, N(sum('settled'))),
          h('td', { class: 'num' }, N(sum('remaining'))), h('td', { colspan: 2 })))))));
    return { name: 'الفواتير', aoa: [['الطرف', 'الحساب', 'رقم الفاتورة', 'تاريخ الفاتورة', 'القيد', 'القيمة', 'المسدد', 'المتبقي', 'العمر'],
      ...rows.map((r) => [r.party_name, `${r.account_code} — ${r.account_name}`, r.invoice_no || 'بدون رقم فاتورة (غير موزع)', r.invoice_date || '', r.entry_ref, Number(r.amount), Number(r.settled), Number(r.remaining), r.age_days])] };
  });
  show.addEventListener('change', go);
  go();
}

// ---------------------------------------------------------------------
// مطابقة بين الشركات الشقيقة: ما تسجّله كل شركة على الأخرى يجب أن يتقابل (المجموع صفر)
// ---------------------------------------------------------------------
export function renderIntercompany(el) {
  const asOf = dateInput(today());
  const go = frame(el, [h('span', {}, 'في'), asOf, h('span', { class: 'help' }, 'كل الشركات')], async (out) => {
    const cos = allIds();
    const [rec, amts, { data: sis }, mixed] = await Promise.all([
      rpc('intercompany_reconciliation', { p_companies: cos, p_as_of: asOf.value }, 'accounting'),
      rpc('intercompany_amounts', { p_companies: cos, p_from: asOf.value, p_to: asOf.value }, 'accounting'),
      core.from('parties').select('code, name, sister_company_id, is_customer, is_supplier').not('sister_company_id', 'is', null).eq('status', 'active'),
      rpc('intercompany_mixed_entries', { p_companies: cos }, 'accounting'),
    ]);
    const nm = (id) => state.companyName(id);
    const side = (v) => (Number(v) > 0 ? 'لها (مدين)' : Number(v) < 0 ? 'عليها (دائن)' : '—');
    const bal = amts.filter((x) => x.kind === 'balance');
    out.replaceChildren(
      (sis || []).length ? '' : h('div', { class: 'notice warn', style: { marginBottom: '10px' } },
        'لم يُعلَّم أي طرف «شركة شقيقة» بعد. من البيانات الأساسية ← العملاء والموردون: افتح الطرف الذي يمثّل إحدى شركاتنا واختر الشركة في خانة «شركة شقيقة».'),
      h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الشركة أ', 'رصيدها على ب', 'الشركة ب', 'رصيدها على أ', 'الفرق', 'النتيجة'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rec.length ? rec.map((r) => {
          const ok = Math.abs(Number(r.difference)) < 0.005;
          return h('tr', { style: { cursor: 'default' } },
            h('td', {}, h('b', {}, nm(r.company_a))), h('td', { class: neg(r.a_net) }, N(r.a_net) + ' ', h('span', { class: 'help' }, side(r.a_net))),
            h('td', {}, h('b', {}, nm(r.company_b))), h('td', { class: neg(r.b_net) }, N(r.b_net) + ' ', h('span', { class: 'help' }, side(r.b_net))),
            h('td', { class: neg(r.difference) }, ok ? '' : N(r.difference)),
            h('td', {}, ok ? h('span', { class: 'badge ok' }, 'متطابق ✓') : h('span', { class: 'badge bad' }, 'غير متطابق')));
        }) : h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'لا توجد أرصدة بين الشركات'))))),
        h('p', { class: 'help', style: { margin: '8px 0 0' } }, 'الفرق غالبًا فاتورة أو سداد مسجّل في شركة دون الأخرى، أو بمبلغ أو تاريخ مختلف. افتح كشف الطرف الشقيق في الشركتين وقارن.')),
      h('div', { class: 'section-title' }, 'التفاصيل حسب الحساب'),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الشركة', 'على الشركة', 'الحساب', 'الرصيد'].map((t) => h('th', {}, t)))),
        h('tbody', {}, bal.map((x) => h('tr', { style: { cursor: 'default' } }, h('td', {}, nm(x.company_id)), h('td', {}, nm(x.sister_company_id)),
          h('td', {}, `${x.code} — ${x.name}`), h('td', { class: neg(x.net) }, N(x.net) + ' ', h('span', { class: 'help' }, side(x.net))))))))),
      mixed.length ? h('div', { class: 'section-title' }, `قيود مختلطة تحتاج مراجعة (${mixed.length})`) : '',
      mixed.length ? h('div', { class: 'card' }, h('p', { class: 'help', style: { margin: '0 0 8px' } },
        'قيود فيها طرف شقيق مع عميل أو مورد خارجي، وسطر إيراد أو مصروف بلا طرف: لا يُعرف أي جزء منه بين الشركات، فلا يُستبعد تلقائيًا. ',
        'الحل: اكتب الطرف على سطر الإيراد أو المصروف الخاص بالشقيقة، أو افصل القيد إلى قيدين.'),
        h('table', { class: 'grid report' }, h('tbody', {}, mixed.map((x) => h('tr', { onclick: () => openEntry(x.entry_id, { onChange: go }) },
          h('td', {}, h('b', { class: 'ltr' }, x.entry_ref)), h('td', {}, nm(x.company_id)), h('td', {}, x.entry_date), h('td', {}, x.description)))))) : '',
      (sis || []).length ? h('p', { class: 'help', style: { marginTop: '10px' } }, 'الأطراف المعلَّمة شركات شقيقة: ' + sis.map((p) => `${p.name} (${nm(p.sister_company_id)})`).join('، ')) : '');
    return { name: 'مطابقة بين الشركات', print: { period: `في ${asOf.value}` },
      aoa: [['الشركة أ', 'رصيدها على ب', 'الشركة ب', 'رصيدها على أ', 'الفرق'], ...rec.map((r) => [nm(r.company_a), Number(r.a_net), nm(r.company_b), Number(r.b_net), Number(r.difference)])] };
  });
  go();
}

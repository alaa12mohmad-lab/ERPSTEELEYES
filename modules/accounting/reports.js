// تقارير المحاسبة
import { acc, rpc, errMsg } from '../../shared/sb.js';
import { h, modal, toast, fmt } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { loadLookups, picker, companySelect, yearStart, today, typeLabel } from './lookups.js';
import { openEntry } from './register.js';

const N = (v) => (v === null || v === undefined || v === '' ? '' : fmt.num(v));
const neg = (v) => (Number(v) < 0 ? 'num neg' : 'num');

function dateInput(v) { return h('input', { class: 'input', type: 'date', value: v, style: { width: 'auto' } }); }

function exportAoa(name, aoa) {
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = aoa[0].map(() => ({ wch: 18 }));
  const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'تقرير');
  window.XLSX.writeFile(wb, name + '.xlsx');
}

function frame(el, controls, onRun) {
  const out = h('div');
  const run = h('button', { class: 'btn primary', onclick: () => go() }, 'عرض');
  const exp = h('button', { class: 'btn', disabled: true }, 'تصدير Excel');
  const prn = h('button', { class: 'btn', onclick: () => window.print() }, 'طباعة');
  el.replaceChildren(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'toolbar' }, ...controls, h('div', { class: 'grow' }), run, exp, prn)), out);
  async function go() {
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ الحساب…'));
    try {
      const r = await onRun(out);
      exp.disabled = !r?.aoa;
      exp.onclick = () => r?.aoa && exportAoa(r.name, r.aoa);
    } catch (e) { out.replaceChildren(h('div', { class: 'notice bad' }, e.message)); }
  }
  return go;
}

// ---------------------------------------------------------------------
// ميزان المراجعة
// ---------------------------------------------------------------------
export function renderTrialBalance(el) {
  let company;
  const sel = companySelect((v) => { company = v; go(); }); company = sel.value;
  const from = dateInput(yearStart()); const to = dateInput(today());
  const groups = h('input', { type: 'checkbox', checked: true });
  const go = frame(el, [sel, h('span', {}, 'من'), from, h('span', {}, 'إلى'), to, h('label', { class: 'check' }, groups, 'إظهار الحسابات المجمّعة')], async (out) => {
    const rows = await rpc('trial_balance', { p_company: company, p_from: from.value, p_to: to.value }, 'accounting');
    const shown = rows.filter((r) => groups.checked || r.is_postable);
    const tot = rows.filter((r) => r.is_postable).reduce((s, r) => { ['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].forEach((k) => { s[k] = (s[k] || 0) + Number(r[k]); }); return s; }, {});
    const balanced = Math.abs(tot.closing_debit - tot.closing_credit) < 0.005;
    out.replaceChildren(
      balanced ? '' : h('div', { class: 'notice bad', style: { marginBottom: '10px' } }, 'الميزان غير متوازن — راجع فحص سلامة البيانات'),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {},
          h('tr', {}, h('th', { rowspan: 2 }, 'الكود'), h('th', { rowspan: 2 }, 'الحساب'), h('th', { colspan: 2 }, 'أول المدة'), h('th', { colspan: 2 }, 'حركة الفترة'), h('th', { colspan: 2 }, 'آخر المدة')),
          h('tr', {}, ['مدين', 'دائن', 'مدين', 'دائن', 'مدين', 'دائن'].map((t) => h('th', {}, t)))),
        h('tbody', {}, shown.length ? shown.map((r) => h('tr', { class: r.is_postable ? '' : 'group', onclick: () => r.account_id && r.is_postable && openStatement(company, r.account_id, from.value, to.value) },
          h('td', { class: 'ltr' }, r.code), h('td', { style: { paddingInlineStart: (12 + r.depth * 18) + 'px' } }, r.name),
          ...['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].map((k) => h('td', { class: 'num' }, Number(r[k]) ? N(r[k]) : ''))))
          : h('tr', {}, h('td', { colspan: 8, class: 'empty' }, 'لا توجد حركات'))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 2 }, 'الإجمالي'),
          ...['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].map((k) => h('td', { class: 'num' }, N(tot[k] || 0)))))))));
    return { name: 'ميزان المراجعة', aoa: [['الكود', 'الحساب', 'أول المدة مدين', 'أول المدة دائن', 'الفترة مدين', 'الفترة دائن', 'آخر المدة مدين', 'آخر المدة دائن'],
      ...shown.map((r) => [r.code, r.name, ...['opening_debit', 'opening_credit', 'period_debit', 'period_credit', 'closing_debit', 'closing_credit'].map((k) => Number(r[k]))])] };
  });
  groups.addEventListener('change', go);
  go();
}

// فتح كشف حساب من تقرير آخر (ميزان المراجعة)
let pendingStatement = null;
function openStatement(company, account, from, to) {
  pendingStatement = { company, account, from, to };
  location.hash = '#/accounting/statement';
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
    accP = picker({ options: lk.accounts, listKey: 'allacc-' + company, placeholder: 'اختر الحساب' }); accP.el.style.minWidth = '240px';
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
    let rows; let title;
    if (kind.value === 'account') {
      if (!accP.id) throw new Error('اختر الحساب');
      rows = await rpc('account_statement', { p_account: accP.id, p_from: from.value, p_to: to.value,
        p_party: isEmp ? null : partyP.id, p_employee: isEmp ? partyP.id : null, p_project: projP.id, p_equipment: eqP.id }, 'accounting');
      title = 'كشف حساب ' + lk.byId('accounts', accP.id).label;
    } else {
      if (!partyP.id) throw new Error('اختر الطرف أو الموظف');
      rows = await rpc('party_statement', { p_company: company, p_party: isEmp ? null : partyP.id, p_employee: isEmp ? partyP.id : null, p_from: from.value, p_to: to.value }, 'accounting');
      title = 'كشف ' + pOpt.label;
    }
    const lines = rows.filter((r) => r.row_kind === 'line');
    const last = rows[rows.length - 1];
    const totD = lines.reduce((s, r) => s + Number(r.debit), 0), totC = lines.reduce((s, r) => s + Number(r.credit), 0);
    const isAcc = kind.value === 'account';
    out.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, h('strong', {}, title), h('span', { class: 'help' }, `من ${from.value} إلى ${to.value} — ${state.companyName(company)}`)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['التاريخ', 'القيد', isAcc ? 'الحساب' : 'الحساب', 'البيان', isAcc ? 'الطرف' : 'المشروع', isAcc ? 'المشروع' : '', 'مدين', 'دائن', 'الرصيد'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.map((r) => h('tr', { class: r.row_kind === 'opening' ? 'group' : '', onclick: () => r.entry_id && openEntry(r.entry_id) },
          h('td', {}, fmt.date(r.entry_date)), h('td', { class: 'ltr' }, r.entry_ref || ''), h('td', {}, isAcc ? (r.account_code || '') : (r.account_name || '')),
          h('td', { style: { whiteSpace: 'normal', maxWidth: '360px' } }, r.description),
          h('td', {}, isAcc ? (r.party_name || '') : (r.project_name || '')), h('td', {}, isAcc ? (r.project_name || '') : ''),
          h('td', { class: 'num' }, Number(r.debit) ? N(r.debit) : ''), h('td', { class: 'num' }, Number(r.credit) ? N(r.credit) : ''),
          h('td', { class: neg(r.balance) }, N(r.balance))))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 6 }, `حركة الفترة (${lines.length})`), h('td', { class: 'num' }, N(totD)), h('td', { class: 'num' }, N(totC)),
          h('td', { class: neg(last?.balance) }, N(last?.balance))))))));
    return { name: title, aoa: [['التاريخ', 'القيد', 'الحساب', 'البيان', 'الطرف/المشروع', 'المشروع', 'مدين', 'دائن', 'الرصيد'],
      ...rows.map((r) => [r.entry_date, r.entry_ref || '', isAcc ? r.account_code : r.account_name, r.description, isAcc ? r.party_name : r.project_name, isAcc ? r.project_name : '', Number(r.debit), Number(r.credit), Number(r.balance)])] };
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
      h('td', {}, r.label, r.account_code ? h('span', { class: 'help', style: { marginInlineStart: '10px', fontSize: '12px' } }, '(' + r.account_code + ')') : ''),
      h('td', { class: neg(r.amount) }, r.row_type === 'header' ? '' : N(r.amount)),
      hasCmp && h('td', { class: neg(r.cmp_amount) }, r.row_type === 'header' ? '' : N(r.cmp_amount)))))));
}

export function renderIncome(el) {
  let company;
  const sel = companySelect((v) => { company = v; go(); }); company = sel.value;
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
    const rows = await rpc('income_statement', { p_company: company, p_from: from.value, p_to: to.value, p_cmp_from: cf, p_cmp_to: ct }, 'accounting');
    const hasCmp = !!cf;
    const labels = [`${from.value} — ${to.value}`, hasCmp ? `${cf} — ${ct}` : ''];
    out.replaceChildren(h('h2', { class: 'fin-title' }, `قائمة الدخل — ${state.companyName(company)}`), statementTable(rows, hasCmp, labels));
    return { name: 'قائمة الدخل', aoa: [['البند', 'الكود', labels[0], ...(hasCmp ? [labels[1]] : [])], ...rows.map((r) => [r.label, r.account_code || '', r.amount === null ? '' : Number(r.amount), ...(hasCmp ? [r.cmp_amount === null ? '' : Number(r.cmp_amount)] : [])])] };
  });
  go();
}

export function renderBalanceSheet(el) {
  let company;
  const sel = companySelect((v) => { company = v; go(); }); company = sel.value;
  const asOf = dateInput(today());
  const cmp = h('input', { class: 'input', type: 'date', style: { width: 'auto' }, title: 'تاريخ المقارنة (اختياري)' });
  const go = frame(el, [sel, h('span', {}, 'في'), asOf, h('span', {}, 'مقارنة بـ'), cmp], async (out) => {
    const rows = await rpc('balance_sheet', { p_company: company, p_as_of: asOf.value, p_cmp_as_of: cmp.value || null }, 'accounting');
    const hasCmp = !!cmp.value;
    const check = rows.find((r) => r.row_type === 'check');
    out.replaceChildren(h('h2', { class: 'fin-title' }, `المركز المالي — ${state.companyName(company)}`),
      Number(check?.amount) !== 0 ? h('div', { class: 'notice bad', style: { marginBottom: '10px' } }, 'المركز المالي غير متوازن') : '',
      statementTable(rows, hasCmp, [asOf.value, cmp.value]));
    return { name: 'المركز المالي', aoa: [['البند', 'الكود', asOf.value, ...(hasCmp ? [cmp.value] : [])], ...rows.map((r) => [r.label, r.account_code || '', r.amount === null ? '' : Number(r.amount), ...(hasCmp ? [r.cmp_amount === null ? '' : Number(r.cmp_amount)] : [])])] };
  });
  go();
}

// ---------------------------------------------------------------------
// أرصدة العملاء والموردين والموظفين
// ---------------------------------------------------------------------
export function renderPartyBalances(el) {
  let company;
  const sel = companySelect((v) => { company = v; go(); }); company = sel.value;
  const asOf = dateInput(today());
  const kind = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, 'الكل'), h('option', { value: 'customer' }, 'العملاء'),
    h('option', { value: 'supplier' }, 'الموردون'), h('option', { value: 'employee' }, 'الموظفون (عهد وسلف)'));
  const go = frame(el, [sel, h('span', {}, 'في'), asOf, kind], async (out) => {
    let rows = await rpc('party_balances', { p_company: company, p_as_of: asOf.value }, 'accounting');
    if (kind.value) rows = rows.filter((r) => r.kind === kind.value || (r.kind === 'both' && kind.value !== 'employee'));
    rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    const kl = { customer: 'عميل', supplier: 'مورد', both: 'عميل ومورد', employee: 'موظف' };
    const sum = rows.reduce((s, r) => s + Number(r.balance), 0);
    out.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
      h('thead', {}, h('tr', {}, ['الطرف', 'النوع', 'مدين', 'دائن', 'الرصيد', 'الاتجاه'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', { style: { cursor: 'default' } }, h('td', {}, r.party_name), h('td', {}, kl[r.kind]),
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
    return h('div', { style: { marginBottom: '18px' } }, h('h3', { style: { fontSize: '15px', margin: '0 0 6px' } }, state.companyName(c) || 'شركة', ` — إيراد ${N(rev)} • تكلفة ${N(exp)} • ربح ${N(rev - exp)}`),
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

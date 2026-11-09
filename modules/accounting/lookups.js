// قوائم الاختيار للمحاسبة (الحسابات، الأطراف، الموظفون، المشاريع، المراكز، المعدات) + مكوّن الاختيار
import { core, acc, rpcListeners } from '../../shared/sb.js';
import { h, store } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { combo } from '../../shared/combo.js';

const cache = new Map();
// أي حفظ أو تعديل أو إلغاء أو حذف لقيد ← تتحدّث الأرصدة في القوائم عند فتحها التالي
const MUTATE = new Set(['post_batch', 'edit_entry', 'cancel_entry', 'delete_entry', 'reverse_entry', 'approve_proposed']);
rpcListeners.add((fn) => { if (MUTATE.has(fn)) for (const lk of cache.values()) lk.staleBalances?.(); });

export function clearLookups() { cache.clear(); }

export async function loadLookups(company, { force = false } = {}) {
  // المفتاح يشمل المستخدم: قوائم مستخدم لا تُعاد لغيره أبدًا (احتياطًا فوق إعادة تحميل الصفحة عند الخروج)
  const key = `${state.profile?.id || ''}|${company}`;
  if (!force && cache.has(key)) return cache.get(key);
  const [accounts, parties, employees, projects, costCenters, equipment, settings] = await Promise.all([
    acc.from('accounts').select('*').eq('company_id', company).eq('status', 'active').order('code'),
    core.from('parties').select('id, code, name, is_customer, is_supplier, tax_number').eq('status', 'active').order('code'),
    core.from('employees').select('id, employee_no, full_name, company_id, end_date').eq('company_id', company).eq('status', 'active').order('employee_no'),
    core.from('v_projects').select('id, code, name, companies, phase').eq('status', 'active').order('code'),
    core.from('cost_centers').select('id, code, name, company_id').eq('status', 'active').order('code'),
    core.from('equipment').select('id, code, name, company_id').eq('status', 'active').order('code'),
    core.from('settings').select('key, company_id, value').in('key', ['vat.rate', 'vat.period']).eq('status', 'active'),
  ]);
  const setting = (k, d) => {
    const rows = (settings.data || []).filter((r) => r.key === k);
    const r = rows.find((x) => x.company_id === company) || rows.find((x) => !x.company_id);
    return r ? r.value : d;
  };
  const opt = (r, code, name, group, kind) => ({ id: r.id, code, name, label: `${code} — ${name}`, row: r, group, kind });
  const pkind = (r) => (r.is_customer && r.is_supplier ? 'عميل ومورد' : r.is_customer ? 'عميل' : 'مورد');
  const lk = {
    company,
    accounts: (accounts.data || []).map((r) => opt(r, r.code, r.name, 'الحسابات', r.is_postable ? null : 'مجمّع')),
    parties: (parties.data || []).map((r) => opt(r, r.code, r.name, null, pkind(r))),
    employees: (employees.data || []).map((r) => opt(r, r.employee_no, r.full_name, null, 'موظف')),
    projects: (projects.data || []).filter((p) => p.companies.some((c) => c.id === company)).map((r) => opt(r, r.code, r.name)),
    allProjects: (projects.data || []).map((r) => opt(r, r.code, r.name)),
    costCenters: (costCenters.data || []).filter((c) => !c.company_id || c.company_id === company).map((r) => opt(r, r.code, r.name)),
    equipment: (equipment.data || []).map((r) => opt(r, r.code, r.name + (r.company_id !== company ? ` (${state.companyName(r.company_id)})` : ''))),
  };
  lk.vatRate = Number(setting('vat.rate', 0.15)) || 0.15;
  lk.vatPeriod = setting('vat.period', 'quarterly');
  lk.postable = lk.accounts.filter((a) => a.row.is_postable);
  lk.customers = lk.parties.filter((p) => p.row.is_customer);
  lk.suppliers = lk.parties.filter((p) => p.row.is_supplier);
  lk.byId = (list, id) => lk[list].find((o) => o.id === id);
  buildPartyCombos(lk);
  attachBalances(lk);
  cache.set(key, lk);
  return lk;
}

// ---------------------------------------------------------------------
// الأرصدة بجانب الأسماء في القوائم: رصيد الحساب من أول السنة حتى اليوم، ورصيد الطرف/الموظف.
//   تُحمَّل عند أول فتح لقائمة، وتتجدد إذا مرّت عليها أكثر من دقيقة
// ---------------------------------------------------------------------
const money = (n) => Math.abs(n).toLocaleString('en', { maximumFractionDigits: 2 });
function attachBalances(lk) {
  const bal = { acc: new Map(), party: new Map(), at: 0, loading: null };
  lk.loadBalances = async () => {
    if (Date.now() - bal.at < 60000) return false;
    if (bal.loading) return bal.loading;
    bal.loading = (async () => {
      const [tb, pb] = await Promise.all([
        acc.rpc('trial_balance', { p_company: lk.company, p_from: yearStart(), p_to: today() }),
        acc.rpc('party_balances', { p_company: lk.company, p_as_of: today() }),
      ]);
      bal.acc.clear(); bal.party.clear();
      for (const r of tb.data || []) bal.acc.set(r.account_id, Number(r.closing_debit) - Number(r.closing_credit));
      for (const r of pb.data || []) bal.party.set(r.party_id || r.employee_id, Number(r.balance));
      bal.at = Date.now(); bal.loading = null;
      return true;
    })().catch(() => { bal.loading = null; return false; });
    return bal.loading;
  };
  lk.staleBalances = () => { bal.at = 0; };
  // النص الجانبي: «130,000 مدين» أو «15,000 دائن» (فارغ إذا كان صفرًا أو لم يُحمَّل بعد)
  lk.balText = (o) => {
    if (!bal.at || !o) return '';
    const v = o.combo || o.kind === 'موظف' || (o.row && 'is_customer' in o.row) ? bal.party.get(o.party || o.id) : bal.acc.get(o.id);
    if (!v || Math.abs(v) < 0.005) return '';
    return money(v) + (v > 0 ? ' مدين' : ' دائن');
  };
}

// ---------------------------------------------------------------------
// الطرف داخل خانة الحساب: كتابة اسم المورد/العميل في خانة الحساب تختار حسابه وتسجّل الطرف معًا.
//   كل طرف يظهر مرة واحدة (لكل دور) بحسابه الافتراضي: آخر حساب استُخدم معه، وإلا أول حساب يقبل نوعه.
//   المعرّف: p:<الطرف>:<الحساب>
// ---------------------------------------------------------------------
export const NEW_PARTY = { id: '__new', code: '+', name: 'إضافة طرف جديد', label: '＋ إضافة طرف جديد', special: true };
const DEF_KEY = 'erp-party-acc';
export const comboId = (party, account) => `p:${party}:${account}`;
export function parseAcc(id) {
  if (!id || !String(id).startsWith('p:')) return { account: id || null, party: null };
  const [, party, account] = String(id).split(':');
  return { account, party };
}
// حساب أطراف = حساب ميزانية (أصل/التزام) نوعه عميل/مورد/أي طرف وليس حساب ضريبة
const partyAccount = (a) => !!a && ['customer', 'supplier', 'any'].includes(a.row.party_kind) && (a.row.vat_role || 'none') === 'none' && ['asset', 'liability'].includes(a.row.account_type);

export function rememberPartyAccount(company, party, role, account) {
  const m = store.get(DEF_KEY, {}) || {};
  m[company] = { ...(m[company] || {}), [party + ':' + role]: account };
  store.set(DEF_KEY, m);
}

function defaultAccount(lk, party, role) {
  const saved = (store.get(DEF_KEY, {}) || {})[lk.company]?.[party + ':' + role];
  if (saved && lk.postable.some((a) => a.id === saved)) return saved;
  const pref = role === 'supplier' ? 'liability' : 'asset';
  const cands = lk.postable.filter((a) => partyAccount(a) && (a.row.party_kind === role || a.row.party_kind === 'any'));
  const pick = cands.find((a) => a.row.party_kind === role && a.row.account_type === pref) || cands.find((a) => a.row.party_kind === role) || cands[0];
  return pick?.id || null;
}

function comboOpt(lk, p, accountId) {
  const a = lk.postable.find((x) => x.id === accountId) || lk.accounts.find((x) => x.id === accountId);
  if (!a) return null;
  const role = a.row.party_kind === 'customer' ? 'عميل' : a.row.party_kind === 'supplier' ? 'مورد' : (p.row?.is_supplier ? 'مورد' : 'عميل');
  return { id: comboId(p.id, accountId), code: p.code, name: p.name, comboName: `${p.name} ← ${a.name}`, label: `${p.code} — ${p.name} ← ${a.name}`,
    combo: true, party: p.id, account: accountId, row: a.row, group: 'الموردون والعملاء', kind: role };
}

function buildPartyCombos(lk) {
  const combos = [];
  for (const p of lk.parties) {
    const roles = [p.row.is_supplier && 'supplier', p.row.is_customer && 'customer'].filter(Boolean);
    const seen = new Set();
    for (const role of roles) {
      const acc = defaultAccount(lk, p.id, role);
      if (acc && !seen.has(acc)) { seen.add(acc); combos.push(comboOpt(lk, p, acc)); }
    }
  }
  lk.accountOptions = [...lk.postable, ...combos.filter(Boolean), NEW_PARTY];
  lk.partyLists = {
    party: [...lk.parties, NEW_PARTY],
    cust: [...lk.customers, NEW_PARTY],
    supp: [...lk.suppliers, NEW_PARTY],
  };
  // خيار مركّب لطرف وحساب محددين (لسطر محفوظ على حساب غير الافتراضي)
  lk.ensureCombo = (party, account) => {
    const id = comboId(party, account);
    if (lk.accountOptions.some((o) => o.id === id)) return id;
    const p = lk.parties.find((x) => x.id === party);
    const o = p && comboOpt(lk, p, account);
    if (!o) return account;
    lk.accountOptions.splice(lk.accountOptions.length - 1, 0, o);
    ensureDatalist('accx-' + lk.company, lk.accountOptions);
    return id;
  };
  lk.isPartyAccount = (account) => partyAccount(lk.postable.find((a) => a.id === account) || lk.accounts.find((a) => a.id === account));
  // طرف جديد أُضيف: يدخل كل القوائم المفتوحة فورًا
  lk.addParty = (r) => {
    const o = { id: r.id, code: r.code, name: r.name, label: `${r.code} — ${r.name}`, row: r, kind: r.is_customer && r.is_supplier ? 'عميل ومورد' : r.is_customer ? 'عميل' : 'مورد' };
    const ins = (arr) => arr.splice(arr[arr.length - 1] === NEW_PARTY ? arr.length - 1 : arr.length, 0, o);
    ins(lk.parties); ins(lk.partyLists.party);
    if (r.is_customer) { ins(lk.customers); ins(lk.partyLists.cust); }
    if (r.is_supplier) { ins(lk.suppliers); ins(lk.partyLists.supp); }
    for (const role of [r.is_supplier && 'supplier', r.is_customer && 'customer'].filter(Boolean)) {
      const acc = defaultAccount(lk, r.id, role);
      const c = acc && comboOpt(lk, o, acc);
      if (c && !lk.accountOptions.some((x) => x.id === c.id)) lk.accountOptions.splice(lk.accountOptions.length - 1, 0, c);
    }
    ensureDatalist('party+', lk.partyLists.party); ensureDatalist('cust+', lk.partyLists.cust); ensureDatalist('supp+', lk.partyLists.supp);
    ensureDatalist('accx-' + lk.company, lk.accountOptions);
    for (const c of cache.values()) if (c !== lk && !c.parties.some((x) => x.id === r.id)) cache.delete(c.company);
    return o;
  };
}

// (للتوافق مع الكود القديم: أصبحت القوائم عائمة ولا تحتاج إلى datalist)
export function ensureDatalist() { return ''; }

// حقل اختيار بالبحث: يقبل الكود أو الاسم. القائمة العائمة في shared/combo.js
//   meta(o): نص جانبي (الرصيد)، onOpen(): يُستدعى عند فتح القائمة (لتحميل الأرصدة)
export function picker(opts) { return combo(opts); }

// اختيار شركة واحدة داخل شاشة المحاسبة
export function companySelect(onChange, { includeAll = false } = {}) {
  const comps = state.companies();
  const initial = state.selectedCompanies.length === 1 ? state.selectedCompanies[0] : (state.selectedCompanies[0] || comps[0]?.id);
  const sel = h('select', { class: 'input', style: { width: 'auto', minWidth: '180px' } },
    includeAll && h('option', { value: '' }, typeof includeAll === 'string' ? includeAll : 'كل الشركات'),
    comps.map((c) => h('option', { value: c.id, selected: c.id === initial }, c.name)));
  sel.dataset.co = '1';   // تقرأه الطباعة لتحديد ترويسة الشركة
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export const ACCOUNT_TYPES = [['asset', 'أصل'], ['liability', 'التزام'], ['equity', 'حقوق ملكية'], ['revenue', 'إيراد'], ['expense', 'مصروف']];
export const RULES = [['forbidden', 'ممنوع'], ['optional', 'اختياري'], ['required', 'إجباري']];
export const PARTY_RULES = [['optional', 'اختياري'], ['required', 'إجباري']];
export const typeLabel = (t) => (ACCOUNT_TYPES.find((x) => x[0] === t) || [t, t])[1];
export const ENTRY_TYPES = { regular: 'عادي', opening: 'افتتاحي', reversal: 'عكسي', adjustment: 'تسوية', vat_settlement: 'تسوية ضريبة', closing: 'إقفال' };
export const SOURCES = { manual: 'يدوي', proposed: 'مقترح', reversal: 'عكس' };
export const TAX_CATEGORIES = { standard: 'أساسي', zero: 'صفري', exempt: 'معفى' };

export function yearStart() { return new Date().getFullYear() + '-01-01'; }
export function today() { return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10); }

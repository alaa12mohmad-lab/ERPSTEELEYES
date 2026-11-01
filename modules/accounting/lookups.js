// قوائم الاختيار للمحاسبة (الحسابات، الأطراف، الموظفون، المشاريع، المراكز، المعدات) + مكوّن الاختيار
import { core, acc } from '../../shared/sb.js';
import { h, store } from '../../shared/ui.js';
import { state } from '../../shared/state.js';

const cache = new Map();

export function clearLookups() { cache.clear(); }

export async function loadLookups(company, { force = false } = {}) {
  if (!force && cache.has(company)) return cache.get(company);
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
  const opt = (r, code, name) => ({ id: r.id, code, name, label: `${code} — ${name}`, row: r });
  const lk = {
    company,
    accounts: (accounts.data || []).map((r) => opt(r, r.code, r.name)),
    parties: (parties.data || []).map((r) => opt(r, r.code, r.name)),
    employees: (employees.data || []).map((r) => opt(r, r.employee_no, r.full_name)),
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
  cache.set(company, lk);
  return lk;
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
  return { id: comboId(p.id, accountId), code: p.code, name: p.name, label: `${p.code} — ${p.name} ← ${a.name}`, combo: true, party: p.id, account: accountId, row: a.row };
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
  // طرف جديد اتضاف: يدخل كل القوائم المفتوحة فورًا
  lk.addParty = (r) => {
    const o = { id: r.id, code: r.code, name: r.name, label: `${r.code} — ${r.name}`, row: r };
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

// datalist مشتركة لكل نوع قائمة (حتى لا تتكرر مع كل خلية)
export function ensureDatalist(key, options) {
  const id = 'dl-' + key;
  let dl = document.getElementById(id);
  if (!dl) { dl = h('datalist', { id }); document.body.append(dl); }
  const sig = String(options.length) + (options[0]?.id || '') + (options[options.length - 1]?.id || '');
  if (dl.dataset.sig !== sig) {
    dl.replaceChildren(...options.map((o) => h('option', { value: o.label })));
    dl.dataset.sig = sig;
  }
  return id;
}

// حقل اختيار بالبحث: يقبل الكود أو الاسم أو "الكود — الاسم"
//   خيار special (مثل "إضافة طرف جديد") لا يُختار بالبحث الجزئي، واختياره يستدعي onSpecial
export function picker({ options, listKey, value = null, placeholder = '', cls = '', onChange, onSpecial, disabled = false }) {
  const input = h('input', { class: 'input cell-input ' + cls, placeholder, disabled, autocomplete: 'off' });
  let opts = options; let id = null;
  const setList = (o, key) => { opts = o; input.setAttribute('list', ensureDatalist(key, o)); };
  setList(options, listKey);
  const set = (v) => {
    id = v || null;
    const o = id ? opts.find((x) => x.id === id) : null;
    input.value = o ? o.label : '';
    input.title = input.value;
    input.classList.remove('invalid');
    input.dataset.id = id || '';
  };
  const resolve = () => {
    const t = input.value.trim();
    if (!t) { if (id !== null) { id = null; input.dataset.id = ''; onChange?.(null); } input.classList.remove('invalid'); return; }
    const low = t.toLowerCase();
    const sp = opts.find((x) => x.special && x.label === t);
    if (sp) { set(id); onSpecial?.(sp, t); return; }
    const real = opts.filter((x) => !x.special);
    // الحساب العادي يسبق خيار الطرف المركّب عند تطابق الكود
    const byCode = real.filter((x) => String(x.code).toLowerCase() === low);
    const part = real.filter((x) => x.label.toLowerCase().includes(low));
    const o = real.find((x) => x.label === t) || byCode.find((x) => !x.combo) || byCode[0] || real.find((x) => x.name === t)
      || (part.length === 1 ? part[0] : null);
    if (o) {
      input.value = o.label; input.title = o.label; input.classList.remove('invalid');
      if (o.id !== id) { id = o.id; input.dataset.id = id; onChange?.(o); }
    } else { input.classList.add('invalid'); if (id !== null) { id = null; input.dataset.id = ''; onChange?.(null); } }
  };
  input.addEventListener('change', resolve);
  input.addEventListener('blur', resolve);
  set(value);
  return {
    el: input,
    get id() { return id; },
    set, resolve,
    setOptions(o, key) { const keep = id; setList(o, key); set(o.some((x) => x.id === keep) ? keep : null); },
    setDisabled(d) { input.disabled = d; if (d) set(null); },
  };
}

// اختيار شركة واحدة داخل شاشة المحاسبة
export function companySelect(onChange, { includeAll = false } = {}) {
  const comps = state.companies();
  const initial = state.selectedCompanies.length === 1 ? state.selectedCompanies[0] : (state.selectedCompanies[0] || comps[0]?.id);
  const sel = h('select', { class: 'input', style: { width: 'auto', minWidth: '180px' } },
    includeAll && h('option', { value: '' }, 'كل الشركات'),
    comps.map((c) => h('option', { value: c.id, selected: c.id === initial }, c.name)));
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

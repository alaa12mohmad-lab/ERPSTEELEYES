// قوائم الاختيار للمحاسبة (الحسابات، الأطراف، الموظفون، المشاريع، المراكز، المعدات) + مكوّن الاختيار
import { core, acc } from '../../shared/sb.js';
import { h } from '../../shared/ui.js';
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
  cache.set(company, lk);
  return lk;
}

// datalist مشتركة لكل نوع قائمة (حتى لا تتكرر مع كل خلية)
export function ensureDatalist(key, options) {
  const id = 'dl-' + key;
  let dl = document.getElementById(id);
  if (!dl) { dl = h('datalist', { id }); document.body.append(dl); }
  if (dl.dataset.sig !== String(options.length) + (options[0]?.id || '')) {
    dl.replaceChildren(...options.map((o) => h('option', { value: o.label })));
    dl.dataset.sig = String(options.length) + (options[0]?.id || '');
  }
  return id;
}

// حقل اختيار بالبحث: يقبل الكود أو الاسم أو "الكود — الاسم"
export function picker({ options, listKey, value = null, placeholder = '', cls = '', onChange, disabled = false }) {
  const input = h('input', { class: 'input cell-input ' + cls, placeholder, disabled, autocomplete: 'off' });
  let opts = options; let id = null;
  const setList = (o, key) => { opts = o; input.setAttribute('list', ensureDatalist(key, o)); };
  setList(options, listKey);
  const set = (v) => {
    id = v || null;
    const o = id ? opts.find((x) => x.id === id) : null;
    input.value = o ? o.label : '';
    input.classList.remove('invalid');
    input.dataset.id = id || '';
  };
  const resolve = () => {
    const t = input.value.trim();
    if (!t) { if (id !== null) { id = null; input.dataset.id = ''; onChange?.(null); } input.classList.remove('invalid'); return; }
    const low = t.toLowerCase();
    const o = opts.find((x) => x.label === t) || opts.find((x) => String(x.code).toLowerCase() === low) || opts.find((x) => x.name === t)
      || (opts.filter((x) => x.label.toLowerCase().includes(low)).length === 1 ? opts.find((x) => x.label.toLowerCase().includes(low)) : null);
    if (o) {
      input.value = o.label; input.classList.remove('invalid');
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
export const typeLabel = (t) => (ACCOUNT_TYPES.find((x) => x[0] === t) || [t, t])[1];
export const ENTRY_TYPES = { regular: 'عادي', opening: 'افتتاحي', reversal: 'عكسي', adjustment: 'تسوية', closing: 'إقفال' };
export const SOURCES = { manual: 'يدوي', proposed: 'مقترح', reversal: 'عكس' };
export const TAX_CATEGORIES = { standard: 'أساسي', zero: 'صفري', exempt: 'معفى' };

export function yearStart() { return new Date().getFullYear() + '-01-01'; }
export function today() { return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10); }

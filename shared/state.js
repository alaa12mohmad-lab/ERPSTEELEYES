// حالة التطبيق: المستخدم الحالي والشركات المختارة
import { rpc } from './sb.js';
import { store } from './ui.js';

const listeners = new Set();

export const state = {
  profile: null,
  selectedCompanies: [],   // معرّفات الشركات المختارة في الشريط العلوي

  async loadProfile() {
    this.profile = await rpc('my_profile');
    const all = (this.profile.companies || []).map((c) => c.id);
    const saved = store.get('erp-companies', null);
    this.selectedCompanies = Array.isArray(saved) ? saved.filter((id) => all.includes(id)) : all;
    if (this.selectedCompanies.length === 0) this.selectedCompanies = all;
    return this.profile;
  },

  level(module) {
    const m = (this.profile?.modules || []).find((x) => x.code === module);
    return m ? m.level : 0;
  },
  can(module, lvl = 1) { return this.level(module) >= lvl; },
  sensitive(item) { return !!this.profile?.sensitive?.[item]; },

  companies() { return this.profile?.companies || []; },
  companyName(id) { return this.companies().find((c) => c.id === id)?.name || ''; },
  allCompaniesSelected() { return this.selectedCompanies.length === this.companies().length; },

  setCompanies(ids) {
    this.selectedCompanies = ids.length ? ids : this.companies().map((c) => c.id);
    store.set('erp-companies', this.selectedCompanies);
    listeners.forEach((fn) => fn());
  },
  onCompaniesChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

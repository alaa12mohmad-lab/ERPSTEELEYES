// بطاقات المحاسبة في لوحة التحكم (أساس — المحتوى النهائي يتحدد لاحقًا)
import { acc, rpc } from '../../shared/sb.js';
import { h, fmt } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { yearStart, today } from './lookups.js';

const count = async (q) => { const { count: n, error } = await q; if (error) throw new Error(error.message); return n || 0; };
const entries = () => acc.from('journal_entries').select('id', { count: 'exact', head: true }).in('company_id', state.selectedCompanies);

export const widgets = [
  {
    id: 'acc-cash', title: 'أرصدة النقدية', size: 'sm',
    async render(el) {
      const { data: cash } = await acc.from('accounts').select('id, company_id, code, name').eq('is_cash_account', true).eq('status', 'active').in('company_id', state.selectedCompanies);
      if (!cash?.length) { el.replaceChildren(h('div', { class: 'help', style: { color: 'var(--ink-3)' } }, 'لا توجد حسابات نقدية بعد (علّم الصندوق والبنوك "حساب نقدية" في الشجرة).')); return; }
      const companies = [...new Set(cash.map((a) => a.company_id))];
      const tbs = await Promise.all(companies.map((c) => rpc('trial_balance', { p_company: c, p_from: yearStart(), p_to: today() }, 'accounting')));
      const bal = {};
      tbs.flat().forEach((r) => { if (r.account_id) bal[r.account_id] = Number(r.closing_debit) - Number(r.closing_credit); });
      const total = cash.reduce((s, a) => s + (bal[a.id] || 0), 0);
      el.replaceChildren(h('div', { class: 'kpi' }, fmt.num(total), h('small', {}, 'ريال')),
        h('div', { class: 'kpi-list' }, cash.map((a) => h('div', {}, h('span', {}, a.name + (state.selectedCompanies.length > 1 ? ' — ' + state.companyName(a.company_id) : '')), h('b', {}, fmt.num(bal[a.id] || 0))))));
    },
  },
  {
    id: 'acc-attention', title: 'تحتاج انتباه', size: 'sm',
    async render(el) {
      const [review, proposed, notManara] = await Promise.all([
        count(entries().eq('manara_review', true)),
        count(acc.from('proposed_entries').select('id', { count: 'exact', head: true }).in('company_id', state.selectedCompanies).eq('state', 'pending')),
        count(entries().eq('status', 'active').eq('in_manara', false)),
      ]);
      el.replaceChildren(h('div', { class: 'kpi-list' },
        h('a', { href: '#/accounting/register' }, h('span', {}, 'قيود تحتاج مراجعة في المنارة'), h('b', {}, review)),
        h('a', { href: '#/accounting/proposed' }, h('span', {}, 'قيود مقترحة بانتظار الاعتماد'), h('b', {}, proposed)),
        h('a', { href: '#/accounting/register' }, h('span', {}, 'قيود لم تُدخل في المنارة'), h('b', {}, notManara))));
    },
  },
  {
    id: 'acc-month', title: 'قيود هذا الشهر', size: 'sm',
    async render(el) {
      const from = today().slice(0, 8) + '01';
      const { data } = await acc.from('v_entries').select('total, status').in('company_id', state.selectedCompanies).gte('entry_date', from).lte('entry_date', today());
      const act = (data || []).filter((e) => e.status === 'active');
      el.replaceChildren(h('div', { class: 'kpi' }, act.length, h('small', {}, 'قيد')),
        h('div', { class: 'kpi-list' },
          h('div', {}, h('span', {}, 'إجمالي القيود'), h('b', {}, fmt.num(act.reduce((s, e) => s + Number(e.total || 0), 0)))),
          h('div', {}, h('span', {}, 'ملغاة'), h('b', {}, (data || []).length - act.length))));
    },
  },
];

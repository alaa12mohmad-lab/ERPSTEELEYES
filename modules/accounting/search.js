// نتائج المحاسبة في البحث السريع (Ctrl+K): رقم قيد، أو حساب بالكود أو الاسم
import { acc } from '../../shared/sb.js';
import { state } from '../../shared/state.js';
import { openEntry } from './register.js';
import { openStatement } from './reports.js';

export async function search(q) {
  const out = [];
  const m = q.match(/^(?:(\d{4})\s*[-/]\s*)?(\d{1,6})$/);
  if (m) {
    let qq = acc.from('journal_entries').select('id, company_id, fiscal_year, entry_no, description, status').in('company_id', state.selectedCompanies).eq('entry_no', Number(m[2]));
    if (m[1]) qq = qq.eq('fiscal_year', Number(m[1]));
    const { data } = await qq.order('fiscal_year', { ascending: false }).limit(6);
    (data || []).forEach((e) => out.push({ label: `قيد ${e.fiscal_year}-${e.entry_no} — ${e.description}`, hint: state.companyName(e.company_id) + (e.status === 'cancelled' ? ' • ملغي' : ''), icon: 'hash', run: () => openEntry(e.id) }));
  }
  if (q.length >= 2) {
    const safe = q.replace(/[%,()]/g, ' ');
    const { data } = await acc.from('accounts').select('id, company_id, code, name, is_postable').in('company_id', state.selectedCompanies)
      .or(`code.ilike.${safe}%,name.ilike.%${safe}%`).eq('status', 'active').order('code').limit(6);
    (data || []).forEach((a) => out.push({ label: `${a.code} — ${a.name}`, hint: 'كشف حساب • ' + state.companyName(a.company_id), icon: 'ledger', run: () => openStatement(a.company_id, a.id) }));
  }
  return out;
}

// إقفال السنة: قيد إقفال بتاريخ 31/12 يصفّر الإيرادات والمصروفات في حساب الأرباح المحتجزة
import { acc, rpc } from '../../shared/sb.js';
import { h, fmt, toast, confirmDialog } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { loadLookups, picker, companySelect } from './lookups.js';
import { openEntry } from './register.js';

export function renderClosing(el) {
  let co = state.selectedCompanies.length === 1 ? state.selectedCompanies[0] : (state.selectedCompanies[0] || state.companies()[0]?.id);
  const coSel = companySelect((v) => { co = v; build(); });
  const accSlot = h('div', { style: { minWidth: '260px' } });
  const out = h('div');
  let pk;
  el.replaceChildren(
    h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { class: 'toolbar' }, h('label', {}, 'الشركة '), coSel, h('label', {}, 'حساب الإقفال '), accSlot),
      h('p', { class: 'help', style: { margin: '8px 0 0' } },
        'الإقفال بيعمل قيد بتاريخ 31/12 ينقل صافي ربح أو خسارة السنة من الإيرادات والمصروفات لحساب الأرباح المحتجزة (أو جاري الشركاء). ',
        'قائمة الدخل وربحية المشاريع والمعدات بتفضل زي ما هي لأنها بتتجاهل قيد الإقفال. ',
        'لو احتجت تعدّل في سنة مقفولة: افتح قيد الإقفال وألغِه، عدّل، واقفل تاني.')),
    out);

  async function build() {
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    const lk = await loadLookups(co);
    const eq = lk.postable.filter((a) => a.row.account_type === 'equity');
    const def = eq.find((a) => /محتجز|مبقا|مرحل/.test(a.name))?.id || eq[0]?.id || null;
    pk = picker({ options: eq, listKey: `closing-${co}`, value: def, placeholder: 'اختار حساب حقوق ملكية' });
    accSlot.replaceChildren(pk.el);
    await load();
  }

  async function load() {
    const [{ data: first }, { data: closings }] = await Promise.all([
      acc.from('journal_entries').select('entry_date').eq('company_id', co).eq('status', 'active').order('entry_date').limit(1),
      acc.from('journal_entries').select('id, entry_no, fiscal_year, entry_date').eq('company_id', co).eq('entry_type', 'closing').eq('status', 'active'),
    ]);
    const nowY = new Date().getFullYear();
    const fromY = first?.[0] ? Number(first[0].entry_date.slice(0, 4)) : nowY;
    const years = []; for (let y = nowY; y >= fromY; y--) years.push(y);
    const rows = await Promise.all(years.map(async (y) => {
      const closed = (closings || []).find((e) => e.entry_date.slice(0, 4) === String(y));
      if (closed) return { y, closed };
      try {
        const r = await rpc('close_year', { p_company: co, p_year: y, p_equity_account: null, p_preview: true }, 'accounting');
        return { y, profit: Number(r.profit), lines: r.lines_count };
      } catch (e) { return { y, err: e.message }; }
    }));
    const lvl4 = state.can('accounting', 4);
    out.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
      h('thead', {}, h('tr', {}, ['السنة', 'صافي الربح (الخسارة)', 'الحالة', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, h('b', {}, String(r.y))),
        h('td', { class: 'num' }, r.profit != null ? fmt.num(r.profit) : ''),
        h('td', {}, r.closed ? h('span', { class: 'badge ok' }, `مقفولة — قيد ${r.closed.fiscal_year}-${r.closed.entry_no}`)
          : r.profit != null ? h('span', { class: 'badge warn' }, 'مفتوحة') : h('span', { class: 'help' }, /مفيش إيرادات/.test(r.err) ? 'مفيش إيرادات أو مصروفات' : r.err)),
        h('td', {}, r.closed ? h('button', { class: 'btn ghost', onclick: () => openEntry(r.closed.id, { onChange: load }) }, 'فتح القيد')
          : r.profit != null && r.y >= nowY ? h('span', { class: 'help' }, 'السنة لسه ما خلصتش') : r.profit != null && lvl4 ? h('button', { class: 'btn primary', onclick: () => close(r) }, 'إقفال السنة') : null))))))),
    lvl4 ? null : h('p', { class: 'help' }, 'الإقفال يتطلب صلاحية "يعتمد" في المحاسبة.'));
  }

  const pkId = () => { const id = pk?.id; return id && String(id).startsWith('p:') ? String(id).split(':')[2] : id || null; };

  async function close(r) {
    const eqId = pkId();
    if (!eqId) { toast('اختار حساب الإقفال الأول', 'bad'); return; }
    const name = pk.el.value || 'حساب الإقفال';
    const msg = `إقفال سنة ${r.y}: هيتعمل قيد بتاريخ 31/12/${r.y} فيه ${r.lines} سطر، وصافي ${r.profit >= 0 ? 'الربح' : 'الخسارة'} ${fmt.num(Math.abs(r.profit))} هيتحوّل لـ "${name}". متأكد؟`;
    if (!(await confirmDialog(msg, { ok: 'إقفال' }))) return;
    try {
      await rpc('close_year', { p_company: co, p_year: r.y, p_equity_account: eqId }, 'accounting');
      toast(`سنة ${r.y} اتقفلت`, 'ok');
      load();
    } catch (e) { toast(e.message, 'bad'); }
  }

  build();
}

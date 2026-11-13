// إقفال السنة: قيد إقفال بتاريخ 31/12 يصفّر الإيرادات والمصروفات في حساب الأرباح المحتجزة
// قفل الفترات: لا تسجيل ولا تعديل ولا إلغاء ولا حذف لقيد بتاريخ حتى تاريخ القفل (للمدير، بسبب مكتوب)
import { acc, rpc } from '../../shared/sb.js';
import { h, fmt, toast, confirmDialog, askReason } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { loadLookups, picker, companySelect } from './lookups.js';
import { openEntry } from './register.js';

export function renderClosing(el) {
  let co = state.selectedCompanies.length === 1 ? state.selectedCompanies[0] : (state.selectedCompanies[0] || state.companies()[0]?.id);
  const coSel = companySelect((v) => { co = v; build(); });
  const accSlot = h('div', { style: { minWidth: '260px' } });
  const out = h('div');
  const lockBox = h('div', { class: 'card', style: { marginBottom: '12px' } });
  let pk;
  el.replaceChildren(lockBox,
    h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { class: 'toolbar' }, h('label', {}, 'الشركة '), coSel, h('label', {}, 'حساب الإقفال '), accSlot),
      h('p', { class: 'help', style: { margin: '8px 0 0' } },
        'ينشئ الإقفال قيدًا بتاريخ 31/12 ينقل صافي ربح السنة أو خسارتها من الإيرادات والمصروفات إلى حساب الأرباح المحتجزة (أو جاري الشركاء). ',
        'تبقى قائمة الدخل وربحية المشاريع والمعدات كما هي لأنها تتجاهل قيد الإقفال. ',
        'والإقفال يقفل الفترة حتى 31/12 تلقائيًا. لتعديل سنة مقفلة: يفتح المدير الفترة (أعلاه) بسبب مكتوب، ثم يُلغى قيد الإقفال، ثم التعديل، ثم الإقفال من جديد.')),
    out);

  // قفل الفترات
  async function drawLock() {
    const { data } = await acc.from('period_locks').select('*').eq('company_id', co).maybeSingle();
    const active = data && data.status === 'active';
    const admin = state.profile?.is_admin;
    const date = h('input', { class: 'input', type: 'date', value: active ? data.locked_until : '', style: { width: 'auto' } });
    const set = async (until) => {
      const reason = await askReason(until ? `قفل الفترة حتى ${until}` : 'فتح الفترة المقفلة', { ok: until ? 'قفل' : 'فتح', note: until ? 'مثال: تقديم إقرار الربع الأول، أو إصدار القوائم المالية' : 'مثال: تصحيح طلبه المراجع — يُسجَّل في سجل المراجعة' });
      if (!reason) return;
      try { await rpc('set_period_lock', { p_company: co, p_until: until, p_reason: reason }, 'accounting'); toast(until ? `أُقفلت الفترة حتى ${until}` : 'فُتحت الفترة', 'ok'); drawLock(); }
      catch (e) { toast(e.message, 'bad'); }
    };
    lockBox.replaceChildren(
      h('div', { class: 'section-title', style: { marginTop: 0 } }, 'قفل الفترات'),
      h('div', { class: 'toolbar' },
        active ? h('span', { class: 'badge warn' }, `مقفلة حتى ${data.locked_until}`) : h('span', { class: 'badge' }, 'لا توجد فترة مقفلة'),
        active ? h('span', { class: 'help' }, `السبب: ${data.reason}`) : null, h('div', { class: 'grow' }),
        admin ? h('label', {}, 'قفل حتى') : null, admin ? date : null,
        admin ? h('button', { class: 'btn primary', onclick: () => { if (!date.value) return toast('اختر تاريخ القفل', 'bad'); set(date.value); } }, active ? 'تغيير القفل' : 'قفل') : null,
        admin && active ? h('button', { class: 'btn ghost', onclick: () => set(null) }, 'فتح الفترة') : null),
      h('p', { class: 'help', style: { margin: '8px 0 0' } },
        'بعد تقديم إقرار الضريبة أو إصدار القوائم: أقفل الفترة حتى آخر يوم فيها، فلا يُسجَّل أو يُعدَّل أو يُلغى أو يُحذف أي قيد بتاريخ قبله من أي شاشة أو استيراد. ',
        admin ? 'الفتح بسبب مكتوب، ويبقى أثره في سجل المراجعة.' : 'القفل والفتح للمدير فقط.'));
  }

  async function build() {
    drawLock();
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    const lk = await loadLookups(co);
    const eq = lk.postable.filter((a) => a.row.account_type === 'equity');
    const def = eq.find((a) => /محتجز|مبقا|مرحل/.test(a.name))?.id || eq[0]?.id || null;
    pk = picker({ options: eq, listKey: `closing-${co}`, value: def, placeholder: 'اختر حساب حقوق ملكية' });
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
        h('td', {}, r.closed ? h('span', { class: 'badge ok' }, `مقفلة — قيد ${r.closed.fiscal_year}-${r.closed.entry_no}`)
          : r.profit != null ? h('span', { class: 'badge warn' }, 'مفتوحة') : h('span', { class: 'help' }, /لا توجد إيرادات/.test(r.err) ? 'لا توجد إيرادات أو مصروفات' : r.err)),
        h('td', {}, r.closed ? h('button', { class: 'btn ghost', onclick: () => openEntry(r.closed.id, { onChange: load }) }, 'فتح القيد')
          : r.profit != null && r.y >= nowY ? h('span', { class: 'help' }, 'السنة لم تنتهِ بعد') : r.profit != null && lvl4 ? h('button', { class: 'btn primary', onclick: () => close(r) }, 'إقفال السنة') : null))))))),
    lvl4 ? null : h('p', { class: 'help' }, 'يتطلب الإقفال صلاحية «يعتمد» في المحاسبة.'));
  }

  const pkId = () => { const id = pk?.id; return id && String(id).startsWith('p:') ? String(id).split(':')[2] : id || null; };

  async function close(r) {
    const eqId = pkId();
    if (!eqId) { toast('اختر حساب الإقفال أولًا', 'bad'); return; }
    const name = pk.el.value || 'حساب الإقفال';
    const msg = `إقفال سنة ${r.y}: سيُنشأ قيد بتاريخ 31/12/${r.y} فيه ${r.lines} سطرًا، ويُحوَّل صافي ${r.profit >= 0 ? 'الربح' : 'الخسارة'} ${fmt.num(Math.abs(r.profit))} إلى «${name}»، وتُقفل الفترة حتى 31/12/${r.y} فلا يُسجَّل أو يُعدَّل قيد قبلها. هل أنت متأكد؟`;
    if (!(await confirmDialog(msg, { ok: 'إقفال' }))) return;
    try {
      const res = await rpc('close_year', { p_company: co, p_year: r.y, p_equity_account: eqId }, 'accounting');
      toast(`أُقفلت سنة ${r.y}` + (res.locked_until ? ` والفترة مقفلة حتى ${res.locked_until}` : ''), 'ok');
      drawLock(); load();
    } catch (e) { toast(e.message, 'bad'); }
  }

  build();
}

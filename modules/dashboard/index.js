// لوحة التحكم: بطاقات مالية وتشغيلية، يرى كل مستخدم البطاقات التي منحه إياها المدير فقط.
//   الأرقام كلها تُحسب في قاعدة البيانات (accounting.dash_data) التي ترفض البطاقة غير الممنوحة وتقصر الشركات والمشاريع على نطاق المستخدم.
//   الشركات: حسب الاختيار في الشريط العلوي (شركة أو أكثر أو الكل). الفترة: اختصارات أو تاريخان.
// للتعديل لاحقًا: حدود الحكم على النسب في RATIOS أدناه، ودليل البطاقات في core.dash_catalog (024).
import { core, rpc } from '../../shared/sb.js';
import { h, fmt } from '../../shared/ui.js';
import { state } from '../../shared/state.js';

const ids = () => (state.selectedCompanies.length ? state.selectedCompanies : state.companies().map((c) => c.id));
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
const num = (v) => fmt.num(Number(v) || 0);
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const store = { get: (k) => { try { return localStorage.getItem('erp-dash-' + k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('erp-dash-' + k, v); } catch { /* ignore */ } } };

const PERIODS = [['1m', 'آخر شهر', 1], ['2m', 'آخر شهرين', 2], ['3m', 'آخر 3 شهور', 3], ['12m', 'آخر سنة', 12], ['ytd', 'من بداية السنة', 0]];
function periodOf(code) {
  const p = PERIODS.find((x) => x[0] === code) || PERIODS[0]; const to = new Date();
  if (code === 'ytd') return { from: ymd(new Date(to.getFullYear(), 0, 1)), to: ymd(to) };
  const y = to.getFullYear(), m = to.getMonth() - p[2];
  const last = new Date(y, m + 1, 0).getDate();
  const from = new Date(y, m, Math.min(to.getDate(), last)); from.setDate(from.getDate() + 1);
  return { from: ymd(from), to: ymd(to) };
}
let CMP = 'prev';   // prev: الفترة السابقة بالطول نفسه | yoy: نفس الفترة من السنة الماضية
const cmpName = () => (CMP === 'yoy' ? 'السنة الماضية' : 'الفترة السابقة');

// التقرير الذي يُفتح من كل بطاقة (يظهر الرابط لمن له صلاحية القسم)
const LINKS = {
  cash: ['accounting', '#/accounting/liquidity'], cashflow: ['accounting', '#/accounting/cash-flow'], receivables: ['accounting', '#/accounting/aging'],
  payables: ['accounting', '#/accounting/aging'], commitments: ['accounting', '#/accounting/liquidity'], vat: ['accounting', '#/accounting/vat'],
  pl: ['accounting', '#/accounting/income'], trend: ['accounting', '#/accounting/income'], top_expenses: ['accounting', '#/accounting/income'],
  top_customers: ['accounting', '#/accounting/parties'], projects: ['accounting', '#/accounting/projects'], project_risk: ['accounting', '#/accounting/projects'],
  contracts: ['accounting', '#/accounting/contracts'], payreq: ['payments', '#/payments/all'], custody: ['custody', '#/custody/list'],
  overdue_inv: ['accounting', '#/accounting/aging'], equipment: ['accounting', '#/accounting/equipment'],
  r_current: ['accounting', '#/accounting/balance-sheet'], r_quick: ['accounting', '#/accounting/balance-sheet'], r_debt: ['accounting', '#/accounting/balance-sheet'],
  r_gross: ['accounting', '#/accounting/income'], r_net: ['accounting', '#/accounting/income'], r_dso: ['accounting', '#/accounting/aging'],
  r_dpo: ['accounting', '#/accounting/aging'], r_retention: ['accounting', '#/accounting/parties'],
};
const byCo = (rows, cols) => (rows && rows.length > 1 ? h('details', { class: 'dash-table' }, h('summary', {}, 'كل شركة وحدها (قبل الاستبعاد)'),
  list(rows, [{ t: 'الشركة', v: (r) => r.company }, ...cols])) : null);

// الحكم على النسب: [جيد إذا، مقبول إذا] — والشرح يُعرض تحت كل نسبة
const RATIOS = {
  r_current: { unit: '×', fmt: (v) => v.toFixed(2), judge: (v) => (v >= 1.5 ? 'ok' : v >= 1 ? 'warn' : 'bad'),
    explain: (v) => `كل ريال من الالتزامات قصيرة الأجل يقابله ${v.toFixed(2)} ريال من الأصول المتداولة. فوق 1.5 مريح، وتحت 1 يعني أن الالتزامات القريبة أكبر من الأصول التي تتحول إلى نقد قريبًا.`,
    parts: (d) => `أصول متداولة ${num(d.a)} ÷ التزامات متداولة ${num(d.b)}`, none: 'لا التزامات متداولة في آخر الفترة' },
  r_quick: { unit: '×', fmt: (v) => v.toFixed(2), judge: (v) => (v >= 1 ? 'ok' : v >= 0.7 ? 'warn' : 'bad'),
    explain: () => 'مثل نسبة التداول لكن بالنقدية ومستحقات العملاء فقط (دون المخزون والدفعات المقدمة). 1 فأكثر يعني القدرة على سداد الالتزامات القريبة دون انتظار بيع أو توريد.',
    parts: (d) => `نقدية وعملاء ${num(d.a)} ÷ التزامات متداولة ${num(d.b)}`, none: 'لا التزامات متداولة في آخر الفترة' },
  r_gross: { unit: '%', fmt: (v) => v.toFixed(1), judge: (v) => (v >= 20 ? 'ok' : v >= 10 ? 'warn' : 'bad'),
    explain: () => 'ما يبقى من كل 100 ريال إيراد بعد التكاليف المباشرة للمشاريع (مواد وعمالة ومقاولي باطن ومعدات). في المقاولات والهياكل المعدنية 20% فأكثر جيد، وتحت 10% يعني أن التكاليف المباشرة تأكل الإيراد.',
    parts: (d) => `مجمل الربح ${num(d.a)} ÷ الإيرادات ${num(d.b)}`, none: 'لا إيرادات في الفترة' },
  r_net: { unit: '%', fmt: (v) => v.toFixed(1), judge: (v) => (v >= 10 ? 'ok' : v >= 3 ? 'warn' : 'bad'),
    explain: () => 'ما يبقى من كل 100 ريال إيراد بعد كل المصروفات. 10% فأكثر جيد، وبين 3% و10% مقبول، وتحته يعني أن المصروفات الإدارية أو التمويلية مرتفعة أو أن التسعير منخفض.',
    parts: (d) => `صافي الربح ${num(d.a)} ÷ الإيرادات ${num(d.b)}`, none: 'لا إيرادات في الفترة' },
  r_dso: { unit: 'يوم', fmt: (v) => String(Math.round(v)), judge: (v) => (v <= 60 ? 'ok' : v <= 90 ? 'warn' : 'bad'),
    explain: (v) => `بمعدل إيرادات الفترة، يحتاج تحصيل رصيد العملاء الحالي نحو ${Math.round(v)} يومًا. حتى 60 يومًا جيد، وفوق 90 يعني أن النقد محبوس عند العملاء.`,
    parts: (d) => `العملاء ${num(d.a)} ÷ إيرادات ${d.days} يومًا ${num(d.b)}`, none: 'لا إيرادات في الفترة' },
  r_dpo: { unit: 'يوم', fmt: (v) => String(Math.round(v)), judge: (v) => (v <= 90 ? 'ok' : v <= 120 ? 'warn' : 'bad'),
    explain: (v) => `بمعدل مصروفات الفترة، يغطي رصيد الموردين الحالي نحو ${Math.round(v)} يومًا. قارنه بأيام التحصيل: الأفضل أن تحصّل قبل أن تدفع. فوق 120 يومًا قد يضر العلاقة بالموردين.`,
    parts: (d) => `الموردون ${num(d.a)} ÷ مصروفات ${d.days} يومًا ${num(d.b)}`, none: 'لا مصروفات في الفترة' },
  r_debt: { unit: '%', fmt: (v) => v.toFixed(1), judge: (v) => (v <= 50 ? 'ok' : v <= 70 ? 'warn' : 'bad'),
    explain: () => 'نسبة ما تموّله الالتزامات من أصول الشركة. حتى 50% متوازن، وفوق 70% يعني اعتمادًا كبيرًا على الموردين أو التمويل.',
    parts: (d) => `الالتزامات ${num(d.a)} ÷ الأصول ${num(d.b)}`, none: 'لا أصول في آخر الفترة' },
  r_retention: { unit: '%', fmt: (v) => v.toFixed(1), judge: (v) => (v >= 70 ? 'ok' : v >= 50 ? 'warn' : 'bad'),
    explain: () => 'من العملاء الذين فُوتروا في الفترة السابقة، كم منهم فُوتر مرة أخرى في هذه الفترة. 70% فأكثر يعني عملاء متكررين.',
    parts: (d) => `${d.a} من ${d.b} عميلًا استمروا — وعملاء جدد ${d.new}`, none: 'لا عملاء في الفترة السابقة للمقارنة' },
};
const VERDICT = { ok: ['جيد', 'ok'], warn: ['مقبول', 'warn'], bad: ['يحتاج انتباهًا', 'bad'] };

const delta = (cur, prev, lowerIsBetter = false) => {
  if (!prev) return cur ? h('span', { class: 'dash-delta' }, `لا أرقام في ${cmpName()}`) : null;
  const p = ((cur - prev) / Math.abs(prev)) * 100; const good = lowerIsBetter ? p <= 0 : p >= 0;
  return h('span', { class: 'dash-delta ' + (good ? 'up' : 'down') }, `${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}% عن ${cmpName()} (${num(prev)})`);
};
const big = (v, cls = '') => h('div', { class: 'dash-big ' + cls }, num(v));
const count = (v, cls = '') => h('div', { class: 'dash-big ' + cls }, String(Number(v) || 0));
const line = (label, value, cls = '') => h('div', { class: 'dash-line ' + cls }, h('span', {}, label), h('b', {}, value));
const list = (rows, cols) => (rows.length ? h('table', { class: 'dash-list' },
  h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: c.num ? 'num' : '' }, c.t)))),
  h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => h('td', { class: c.num ? 'num' : '' }, c.v(r))))))) : h('div', { class: 'help' }, 'لا شيء في الفترة'));

// ---------------------------------------------------------------------
// رسم كل بطاقة من أرقامها
// ---------------------------------------------------------------------
const DRAW = {
  cash: (d) => [big(d.value, 'accent'), h('span', { class: 'dash-delta ' + (d.value >= d.open ? 'up' : 'down') },
      `${d.value >= d.open ? '▲' : '▼'} ${num(Math.abs(d.value - d.open))} خلال الفترة (أولها ${num(d.open)})`),
    d.by_company.length > 1 ? d.by_company.map((c) => line(c.company, num(c.value))) : null,
    d.by_company.length > 1 ? h('div', { class: 'help' }, 'التحويلات بين الشركات لا تغيّر مجموع النقدية.') : null],
  receivables: (d) => [big(d.value), line('منه متأخر عن الاستحقاق', `${num(d.overdue)} (${d.overdue_count} فاتورة)`, d.overdue > 0 ? 'bad' : ''),
    list(d.top, [{ t: 'أكبر الأرصدة', v: (r) => r.name }, { t: 'الرصيد', num: true, v: (r) => num(r.amount) }, { t: 'متأخر', num: true, v: (r) => (r.overdue ? num(r.overdue) : '') }]),
    byCo(d.by_company, [{ t: 'العملاء', num: true, v: (r) => num(r.value) }])],
  payables: (d) => [big(d.value), line('منه متأخر عن الاستحقاق', `${num(d.overdue)} (${d.overdue_count} فاتورة)`, d.overdue > 0 ? 'warn' : ''),
    list(d.top, [{ t: 'أكبر الأرصدة', v: (r) => r.name }, { t: 'الرصيد', num: true, v: (r) => num(r.amount) }, { t: 'متأخر', num: true, v: (r) => (r.overdue ? num(r.overdue) : '') }]),
    byCo(d.by_company, [{ t: 'الموردون', num: true, v: (r) => num(r.value) }])],
  commitments: (d) => {
    const gap = Number(d.cash) + Number(d.fixed_in) - Number(d.total);
    return [big(d.total), h('div', { class: 'help' }, `من ${fmt.date(d.from)} إلى ${fmt.date(d.to)}`),
      line('فواتير موردين متأخرة', num(d.suppliers_overdue), d.suppliers_overdue > 0 ? 'warn' : ''), line('فواتير موردين تستحق', num(d.suppliers_due)),
      line('طلبات تحويل معتمدة (غير مسجّلة كفواتير)', num(d.requests)), line('التزامات ثابتة', num(d.fixed_out)),
      Number(d.fixed_in) ? line('داخل ثابت متوقع', num(d.fixed_in)) : null,
      line('النقدية الآن', num(d.cash)), line(gap >= 0 ? 'الفائض بعد الالتزامات' : 'العجز بعد الالتزامات', num(Math.abs(gap)), gap >= 0 ? 'ok' : 'bad'),
      h('div', { class: 'help' }, 'لا تشمل فواتير العملاء المتوقع تحصيلها ولا ضريبة القيمة المضافة — انظر «السيولة» في المحاسبة للتوقع الكامل.')];
  },
  pl: (d) => {
    const c = d.cur, p = d.prev; const exp = (x) => Number(x.direct) + Number(x.opex) + Number(x.unclassified);
    return [h('div', { class: 'dash-trio' },
      h('div', {}, h('small', {}, 'الإيرادات'), big(Number(c.revenue) + Number(c.other_income)), delta(Number(c.revenue) + Number(c.other_income), Number(p.revenue) + Number(p.other_income))),
      h('div', {}, h('small', {}, 'المصروفات'), big(exp(c)), delta(exp(c), exp(p), true)),
      h('div', {}, h('small', {}, 'صافي الربح'), big(c.net, Number(c.net) < 0 ? 'neg' : 'pos'), delta(Number(c.net), Number(p.net)))),
      line('مجمل الربح (الإيرادات − التكاليف المباشرة)', num(c.gross)), line('التكاليف المباشرة', num(c.direct)), line('المصروفات الإدارية والتمويلية والزكاة', num(c.opex)),
      Number(c.unclassified) ? line('مصروفات على حسابات بلا مستوى في قائمة الدخل', num(c.unclassified), 'warn') : null,
      d.eliminated && (Number(d.eliminated.revenue) || Number(d.eliminated.expense))
        ? h('div', { class: 'help' }, `استُبعد بين الشركات: إيرادات ${num(d.eliminated.revenue)} ومصروفات ${num(d.eliminated.expense)}`) : null,
      byCo(d.by_company, [{ t: 'الإيرادات', num: true, v: (r) => num(r.revenue) }, { t: 'المصروفات', num: true, v: (r) => num(r.expense) },
        { t: 'الصافي', num: true, v: (r) => h('span', { class: Number(r.net) < 0 ? 'neg' : '' }, num(r.net)) }])];
  },
  alerts: (d) => (d.items.length ? h('div', { class: 'dash-alerts' }, d.items.map((a) => {
    const lbl = { bad: 'عاجل', warn: 'تنبيه', info: 'للعلم' }[a.lvl];
    return h('a', { class: 'dash-alert ' + a.lvl, href: a.href }, h('span', { class: 'badge ' + (a.lvl === 'info' ? '' : a.lvl) }, lbl), h('span', {}, a.text));
  })) : h('div', { class: 'dash-ok' }, '✓ لا شيء يحتاج تصرفًا الآن')),
  cashflow: (d) => {
    const C = { operating: 'التشغيلي', investing: 'الاستثماري', financing: 'التمويلي' };
    const inn = d.classes.reduce((s, c) => s + Number(c.in), 0), out = d.classes.reduce((s, c) => s + Number(c.out), 0);
    return [h('div', { class: 'dash-trio' },
      h('div', {}, h('small', {}, 'المحصّل'), big(inn, 'pos')), h('div', {}, h('small', {}, 'المدفوع'), big(out, 'neg')),
      h('div', {}, h('small', {}, 'الصافي'), big(inn - out, inn - out < 0 ? 'neg' : 'pos'))),
      list(d.classes, [{ t: 'النشاط', v: (r) => C[r.class] || r.class }, { t: 'داخل', num: true, v: (r) => num(r.in) }, { t: 'خارج', num: true, v: (r) => num(r.out) },
        { t: 'الصافي', num: true, v: (r) => num(Number(r.in) - Number(r.out)) }]),
      d.top_out.length ? list(d.top_out, [{ t: 'أكبر المدفوعات', v: (r) => r.name }, { t: 'المبلغ', num: true, v: (r) => num(r.amount) }]) : null,
      line('النقدية أول الفترة ← آخرها', `${num(d.open)} ← ${num(d.close)}`)];
  },
  vat: (d) => d.rows.map((r) => {
    const late = r.prev_due < ymd(new Date()); const net = Number(r.prev.net);
    return h('div', { class: 'dash-vat' }, d.rows.length > 1 ? h('b', {}, r.company) : null,
      line(`${r.period === 'monthly' ? 'الشهر' : 'الربع'} المنتهي (${fmt.date(r.prev_from)} — ${fmt.date(r.prev_to)})`, (net >= 0 ? 'مستحق ' : 'مسترد ') + num(Math.abs(net)), net > 0 ? 'warn' : ''),
      line('آخر موعد للإقرار والسداد', fmt.date(r.prev_due) + (late ? ' (مضى)' : ''), !late && net > 0 ? 'warn' : ''),
      line(`الحالي حتى اليوم (مخرجات ${num(r.cur.output)} − مدخلات ${num(r.cur.input)})`, num(r.cur.net)),
      line('رصيد حسابات الضريبة غير المسدد', num(r.balance)));
  }),
  top_expenses: (d) => [big(d.total), list(d.rows, [{ t: 'البند', v: (r) => `${r.code} — ${r.name}` }, { t: 'الفترة', num: true, v: (r) => num(r.cur) },
    { t: cmpName(), num: true, v: (r) => num(r.prev) },
    { t: 'التغير', num: true, v: (r) => (Number(r.prev) ? h('span', { class: Number(r.cur) > Number(r.prev) ? 'neg' : '' }, `${(((r.cur - r.prev) / Math.abs(r.prev)) * 100).toFixed(0)}%`) : 'جديد') }])],
  top_customers: (d) => {
    const top = d.rows[0]; const share = top && Number(d.total) ? (Number(top.amount) / Number(d.total)) * 100 : 0;
    return [big(d.total), h('div', { class: 'help' }, `مفوتر لـ ${d.count} عميل في الفترة (شامل الضريبة)`),
      share >= 40 ? line(`${top.name} وحده`, `${share.toFixed(0)}% من المفوتر — تركّز عالٍ`, 'bad') : null,
      list(d.rows, [{ t: 'العميل', v: (r) => r.name }, { t: 'المفوتر', num: true, v: (r) => num(r.amount) },
        { t: 'النصيب', num: true, v: (r) => (Number(d.total) ? `${((r.amount / d.total) * 100).toFixed(0)}%` : '') }])];
  },
  contracts: (d) => [h('div', { class: 'dash-trio' },
      h('div', {}, h('small', {}, `قيمة ${d.count} عقدًا`), big(d.value)), h('div', {}, h('small', {}, 'المنفّذ'), big(d.work),
        h('span', { class: 'help' }, Number(d.value) ? `${((d.work / d.value) * 100).toFixed(0)}%` : '')),
      h('div', {}, h('small', {}, 'الباقي تنفيذه'), big(d.backlog, 'accent'))),
    line('مفوتر غير محصّل', num(d.outstanding)), line('محتجزات لدى العملاء', num(d.retention)), Number(d.advance_left) ? line('دفعات مقدمة لم تُسترد بعد', num(d.advance_left)) : null,
    list(d.rows, [{ t: 'العقد', v: (r) => `${r.no} — ${r.party}` }, { t: 'القيمة', num: true, v: (r) => num(r.value) },
      { t: 'المنفّذ', num: true, v: (r) => `${num(r.work)}${Number(r.value) ? ` (${((r.work / r.value) * 100).toFixed(0)}%)` : ''}` }, { t: 'الباقي', num: true, v: (r) => num(r.backlog) }]),
    d.sub_count ? line(`مقاولو الباطن (${d.sub_count}): المنفّذ ${num(d.sub_work)} من ${num(d.sub_value)}`, `مستحق لهم ${num(d.sub_outstanding)} — محتجز ${num(d.sub_retention)}`) : null,
    h('div', { class: 'help' }, 'حتى اليوم، من العقود السارية ومستخلصاتها.')],
  project_risk: (d) => {
    const L = { bad: ['خسارة', 'bad'], warn: ['هامش ضعيف', 'warn'], ok: ['سليم', 'ok'] };
    return [h('div', { class: 'dash-trio' },
      h('div', {}, h('small', {}, 'مصروفه أكبر من المكتسب'), count(d.bad, d.bad ? 'neg' : '')), h('div', {}, h('small', {}, 'هامش أقل من 15%'), count(d.warn)),
      h('div', {}, h('small', {}, 'سليمة'), count(d.ok, 'pos'))),
      list(d.rows, [{ t: 'المشروع', v: (r) => `${r.code} — ${r.name}` }, { t: 'المكتسب', num: true, v: (r) => num(r.earned) }, { t: 'المصروف', num: true, v: (r) => num(r.cost) },
        { t: 'المصروف ÷ المكتسب', num: true, v: (r) => (Number(r.earned) ? `${((r.cost / r.earned) * 100).toFixed(0)}%` : '—') },
        { t: '', v: (r) => h('span', { class: 'badge ' + L[r.lvl][1] }, L[r.lvl][0]) }]),
      h('div', { class: 'help' }, 'المكتسب: المنفّذ في مستخلصات العقد، وإلا الإيراد المسجّل على المشروع. المصروف: كل ما حُمّل على المشروع حتى آخر الفترة. حين تُضاف الموازنات يُقارن المصروف بالتكلفة المقدّرة.')];
  },
  trend: (d) => trendChart(d.months),
  projects: (d) => [h('div', { class: 'dash-trio' },
      h('div', {}, h('small', {}, 'إيراد المشاريع'), big(d.revenue)), h('div', {}, h('small', {}, 'مصروف المشاريع'), big(d.expense)),
      h('div', {}, h('small', {}, 'الهامش'), big(Number(d.revenue) - Number(d.expense), Number(d.revenue) - Number(d.expense) < 0 ? 'neg' : 'pos'))),
    list(d.rows, [{ t: 'المشروع', v: (r) => `${r.code} — ${r.name}` }, { t: 'الإيراد', num: true, v: (r) => num(r.revenue) }, { t: 'المصروف', num: true, v: (r) => num(r.expense) },
      { t: 'الهامش', num: true, v: (r) => { const m = Number(r.revenue) - Number(r.expense); return h('span', { class: m < 0 ? 'neg' : '' }, num(m) + (Number(r.revenue) > 0 ? ` (${((m / r.revenue) * 100).toFixed(0)}%)` : '')); } }]),
    d.count > d.rows.length ? h('div', { class: 'help' }, `أعلى ${d.rows.length} من ${d.count} مشروعًا صرفًا`) : null],
  payreq: (d) => [h('div', { class: 'dash-trio' },
      h('a', { href: '#/payments/approvals' }, h('small', {}, 'بانتظار الاعتماد'), big(d.waiting), h('span', { class: 'help' }, `${d.waiting_n} طلب`)),
      h('a', { href: '#/payments/pay' }, h('small', {}, 'معتمدة بانتظار السداد'), big(d.topay), h('span', { class: 'help' }, `${d.topay_n} طلب`)),
      h('div', {}, h('small', {}, 'موقوفة'), big(d.hold), h('span', { class: 'help' }, `${d.hold_n} طلب`))),
    line('تجاوزت آخر موعد للتحويل', `${num(d.overdue)} (${d.overdue_n} طلب)`, d.overdue_n ? 'bad' : ''), d.urgent_n ? line('عاجلة', String(d.urgent_n), 'warn') : null],
  custody: (d) => [h('div', { class: 'dash-trio' },
      h('a', { href: '#/custody/list' }, h('small', {}, 'عهد مفتوحة'), count(d.count)), h('div', {}, h('small', {}, 'أرصدتها'), big(d.balance)),
      h('div', {}, h('small', {}, 'مصروفات لم تُرحَّل'), big(d.pending))),
    d.old_n ? line('مفتوحة منذ أكثر من 30 يومًا', String(d.old_n), 'warn') : null,
    list(d.rows, [{ t: 'أقدم العهد', v: (r) => `${r.no} — ${r.holder}` }, { t: 'الرصيد', num: true, v: (r) => num(r.balance) }, { t: 'معلّق', num: true, v: (r) => (Number(r.pending) ? num(r.pending) : '') }, { t: 'منذ', num: true, v: (r) => `${r.days} يوم` }])],
  overdue_inv: (d) => [big(d.overdue, d.overdue > 0 ? 'neg' : ''), h('div', { class: 'help' }, `${d.overdue_count} فاتورة تجاوزت تاريخ استحقاقها حتى اليوم`),
    list(d.top, [{ t: 'العميل', v: (r) => r.name }, { t: 'المتأخر', num: true, v: (r) => num(r.amount) }, { t: 'أقدم تأخير', num: true, v: (r) => `${r.max_days} يوم` }])],
  equipment: (d) => [h('div', { class: 'dash-trio' },
      h('div', {}, h('small', {}, 'تكلفة المعدات'), big(d.expense)), h('div', {}, h('small', {}, 'إيرادها'), big(d.revenue)),
      h('div', {}, h('small', {}, 'الصافي'), big(Number(d.revenue) - Number(d.expense), Number(d.revenue) - Number(d.expense) < 0 ? 'neg' : 'pos'))),
    list(d.rows, [{ t: 'المعدة', v: (r) => `${r.code} — ${r.name}` }, { t: 'التكلفة', num: true, v: (r) => num(r.expense) }, { t: 'الإيراد', num: true, v: (r) => num(r.revenue) }]),
    h('div', { class: 'help' }, 'من القيود المحمّلة على المعدة. التشغيل والصيانة والمستندات تأتي مع قسم المعدات.')],
};
for (const [code, r] of Object.entries(RATIOS)) {
  DRAW[code] = (d) => {
    if (d.value === null || d.value === undefined) return [h('div', { class: 'dash-big muted' }, '—'), h('div', { class: 'help' }, r.none), h('div', { class: 'dash-parts' }, r.parts(d))];
    const v = Number(d.value); const j = VERDICT[r.judge(v)];
    return [h('div', { class: 'dash-ratio' }, h('div', { class: 'dash-big' }, r.fmt(v), h('small', {}, ' ' + r.unit)), h('span', { class: 'badge ' + j[1] }, j[0])),
      d.prev !== undefined && d.prev !== null ? h('div', { class: 'help' }, `الفترة السابقة: ${r.fmt(Number(d.prev))} ${r.unit}`) : null,
      h('p', { class: 'dash-explain' }, r.explain(v)), h('div', { class: 'dash-parts' }, r.parts(d))];
  };
}

// الأداء الشهري: أعمدة متجاورة للإيراد والمصروف، مع تلميح لكل شهر وجدول بديل
function trendChart(months) {
  if (!months.length) return h('div', { class: 'help' }, 'لا أرقام');
  const W = 640, H = 200, padB = 26, padT = 10;
  const vals = months.flatMap((m) => [Number(m.revenue), Number(m.expense)]);
  const max = Math.max(1, ...vals); const min = Math.min(0, ...vals);
  const slot = W / months.length; const bw = Math.max(4, Math.min(22, slot / 3 - 2));
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, ...kids) => { const e = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); kids.forEach((k) => e.append(k)); return e; };
  const y = (v) => padT + ((max - v) / (max - min)) * (H - padB - padT);   // خط الصفر عند y(0)
  const bar = (v, x, cls) => el('rect', { x, y: Math.min(y(v), y(0)), width: bw, height: Math.max(1, Math.abs(y(v) - y(0))), rx: 3, class: cls + (v < 0 ? ' neg' : '') });
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'dash-chart', role: 'img', 'aria-label': 'الإيرادات والمصروفات شهرًا بشهر' });
  svg.append(el('line', { x1: 0, x2: W, y1: y(0), y2: y(0), class: 'axis' }));
  const label = (mo) => new Intl.DateTimeFormat('ar-EG', { month: 'short' }).format(new Date(mo + '-01T00:00:00'));
  months.forEach((m, i) => {
    const cx = W - (i + 0.5) * slot;   // من اليمين لليسار
    const g = el('g', { class: 'bar-grp' });
    const tip = el('title', {}); tip.textContent = `${m.month}: إيرادات ${num(m.revenue)} — مصروفات ${num(m.expense)} — صافي ${num(Number(m.revenue) - Number(m.expense))}`;
    g.append(tip, el('rect', { x: cx - slot / 2, y: 0, width: slot, height: H - padB, class: 'hit' }),
      bar(Number(m.revenue), cx + 1, 'rev'), bar(Number(m.expense), cx - bw - 1, 'exp'));
    if (months.length <= 14 || i % 2 === 0) { const tx = el('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }); tx.textContent = label(m.month); g.append(tx); }
    svg.append(g);
  });
  const table = h('details', { class: 'dash-table' }, h('summary', {}, 'عرض كجدول'),
    list(months, [{ t: 'الشهر', v: (r) => r.month }, { t: 'الإيرادات', num: true, v: (r) => num(r.revenue) }, { t: 'المصروفات', num: true, v: (r) => num(r.expense) },
      { t: 'الصافي', num: true, v: (r) => num(Number(r.revenue) - Number(r.expense)) }]));
  return [h('div', { class: 'dash-legend' }, h('span', { class: 'k rev' }, 'الإيرادات'), h('span', { class: 'k exp' }, 'المصروفات')), svg, table];
}

// ---------------------------------------------------------------------
// الصفحة
// ---------------------------------------------------------------------
async function renderBoard(el) {
  let cards = []; let catalog = []; let details = [];
  try {
    [cards, catalog, details] = await Promise.all([rpc('my_dash_cards'), rpc('dash_catalog'), rpc('my_dash_details')]);
  } catch (e) { put(el, h('div', { class: 'notice bad' }, e.message)); return; }
  if (!cards.length) { put(el, h('div', { class: 'notice' }, 'لم تُمنح لحسابك بطاقات في لوحة التحكم. يحددها المدير من شاشة المستخدمين.')); return; }
  const meta = Object.fromEntries(catalog.map((c) => [c.code, c]));
  let period = store.get('period') || '1m';
  const range = period === 'custom' ? { from: store.get('from'), to: store.get('to') } : periodOf(period);
  const from = h('input', { class: 'input', type: 'date', value: range.from || periodOf('1m').from, style: { width: 'auto' } });
  const to = h('input', { class: 'input', type: 'date', value: range.to || periodOf('1m').to, style: { width: 'auto' } });
  const seg = h('div', { class: 'dash-seg' });
  const drawSeg = () => put(seg, PERIODS.map(([code, t]) => h('button', { class: 'seg-btn' + (period === code ? ' on' : ''), onclick: () => {
    period = code; store.set('period', code); const r = periodOf(code); from.value = r.from; to.value = r.to; drawSeg(); load();
  } }, t)), h('button', { class: 'seg-btn' + (period === 'custom' ? ' on' : ''), onclick: () => { period = 'custom'; store.set('period', 'custom'); drawSeg(); from.focus(); } }, 'تحديد يدوي'));
  const onDate = () => { period = 'custom'; store.set('period', 'custom'); store.set('from', from.value); store.set('to', to.value); drawSeg(); load(); };
  from.onchange = onDate; to.onchange = onDate;
  drawSeg();
  CMP = store.get('cmp') === 'yoy' ? 'yoy' : 'prev';
  const cmpSel = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: 'prev', selected: CMP === 'prev' }, 'مقارنة بالفترة السابقة'),
    h('option', { value: 'yoy', selected: CMP === 'yoy' }, 'مقارنة بنفس الفترة من السنة الماضية'));
  cmpSel.onchange = () => { CMP = cmpSel.value; store.set('cmp', CMP); load(); };
  const coLbl = h('span', { class: 'help' });
  const printHead = h('div', { class: 'dash-print-head' });
  const body = h('div');
  put(el, h('div', { class: 'card dash-bar' }, h('div', { class: 'toolbar' }, seg, h('label', {}, 'من'), from, h('label', {}, 'إلى'), to,
    cmpSel, h('div', { class: 'grow' }), coLbl, h('button', { class: 'btn ghost', onclick: () => load() }, 'تحديث'),
    h('button', { class: 'btn', onclick: () => window.print() }, 'طباعة / PDF'))), printHead, body);

  let seq = 0;
  async function load() {
    const my = ++seq;
    if (!from.value || !to.value || from.value > to.value) { put(body, h('div', { class: 'notice bad' }, 'حدد الفترة: من تاريخ إلى تاريخ')); return; }
    const sel = ids(); const all = state.allCompaniesSelected();
    coLbl.textContent = all ? 'كل الشركات' : sel.map((id) => state.companyName(id)).join(' + ');
    put(body, h('div', { class: 'empty' }, 'جارٍ الحساب…'));
    let data;
    try { data = await rpc('dash_data', { p_cards: cards, p_companies: sel, p_from: from.value, p_to: to.value, p_compare: CMP }, 'accounting'); }
    catch (e) { if (my === seq) put(body, h('div', { class: 'notice bad' }, e.message)); return; }
    if (my !== seq) return;
    put(printHead, h('h2', {}, 'لوحة التحكم — ' + coLbl.textContent), h('div', {}, `الفترة ${fmt.date(data._meta.from)} — ${fmt.date(data._meta.to)} — طُبعت ${fmt.date(ymd(new Date()))}`));
    const groups = [];
    for (const code of cards) {
      const m = meta[code]; let g = groups.find((x) => x.name === m.grp);
      if (!g) groups.push(g = { name: m.grp, items: [] });
      g.items.push(code);
    }
    put(body, groups.map((g) => [h('div', { class: 'section-title' }, g.name),
      h('div', { class: 'dash-grid' }, g.items.map((code) => {
        const m = meta[code]; let inner;
        try { inner = DRAW[code](data[code] || {}); } catch (e) { inner = h('div', { class: 'notice bad' }, e.message); }
        const lk = LINKS[code]; const tag = scopeTag(code, data._meta.multi);
        const more = details.includes(code)
          ? h('button', { class: 'dash-more', onclick: () => detailDialog(code, m.title, { from: from.value, to: to.value, companies: ids() }) }, 'القائمة ←')
          : lk && state.can(lk[0], 1) ? h('a', { class: 'dash-more', href: lk[1] }, 'التفاصيل ←') : null;
        return h('section', { class: 'dash-card' + (['pl', 'trend', 'projects', 'equipment', 'alerts', 'contracts', 'project_risk', 'top_expenses'].includes(code) ? ' wide' : '') },
          h('header', {}, h('div', { class: 'dash-head' }, h('h3', {}, m.title), more),
            h('small', {}, m.hint), tag ? h('span', { class: 'dash-tag' }, tag) : null), h('div', { class: 'dash-body' }, inner));
      }))]),
    h('p', { class: 'help', style: { marginTop: '14px' } },
      `الفترة ${fmt.date(data._meta.from)} — ${fmt.date(data._meta.to)} (${data._meta.days} يومًا)، والمقارنة بـ ${fmt.date(data._meta.prev_from)} — ${fmt.date(data._meta.prev_to)}. `,
      data._meta.multi ? 'أكثر من شركة: بطاقات «مجمّع بعد الاستبعاد» تستبعد التعاملات بين الشركات (الذمم المتبادلة والبيع والشراء بينها)، وبطاقات «بأرقام كل شركة» تجمع أرقام الشركات كما هي (الشراء من شقيقة تكلفة حقيقية على المشروع). ' : '',
      'الأرصدة في آخر الفترة، والإيرادات والمصروفات خلالها، من القيود السارية فقط (دون قيود الافتتاح والإقفال).'));
  }
  load();
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) load(); else off(); });
}

export default {
  code: 'dashboard',
  title: 'لوحة التحكم',
  tabs: [{ path: 'board', title: 'لوحة التحكم', wide: true, subtitle: 'أرقام الشركة في الفترة المختارة — للشركات المختارة في الشريط العلوي', render: renderBoard }],
  widgets: [],
};

// قائمة البطاقات للمدير (شاشة المستخدمين)
export async function cardPicker(userId) {
  const [catalog, detailable, res] = await Promise.all([rpc('dash_catalog'), rpc('dash_detail_cards'),
    core.from('user_dashboard_cards').select('card_code, with_details').eq('user_id', userId).eq('status', 'active')]);
  // تعذّر قراءة البطاقات الحالية: لا تُعرض القائمة ولا تُحفظ (حتى لا تُسحب بطاقات المستخدم بالخطأ)
  if (res.error) throw new Error('تعذّر تحميل بطاقات المستخدم — لن تُغيَّر: ' + res.error.message);
  const mine = new Set((res.data || []).map((r) => r.card_code));
  const mineDet = new Set((res.data || []).filter((r) => r.with_details).map((r) => r.card_code));
  const boxes = []; const dets = {};
  const groups = [...new Set(catalog.map((c) => c.grp))];
  const ui = h('div', { class: 'field wide' },
    h('div', { class: 'section-title', style: { marginTop: '6px' } }, 'بطاقات لوحة التحكم'),
    h('div', { class: 'help', style: { marginBottom: '6px' } }, 'يرى المستخدم البطاقات المحددة فقط، بأرقام شركاته (ومشاريعه في بطاقتي المشاريع والطلبات). بلا بطاقات لا تظهر له لوحة التحكم.'),
    h('div', { class: 'dash-pick' }, groups.map((g) => {
      const items = catalog.filter((c) => c.grp === g).map((c) => { const b = h('input', { type: 'checkbox', value: c.code, checked: mine.has(c.code) }); boxes.push(b); return { c, b }; });
      return h('fieldset', {}, h('legend', {}, g, ' ', h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { const on = !items.every((x) => x.b.checked); items.forEach((x) => { x.b.checked = on; }); } }, 'الكل')),
        items.map(({ c, b }) => {
          if (!detailable.includes(c.code)) return h('label', { class: 'check', title: c.hint }, b, c.title);
          const d = h('input', { type: 'checkbox', checked: mineDet.has(c.code), title: 'يفتح قائمة ما وراء الرقم' }); dets[c.code] = d;
          d.onchange = () => { if (d.checked) b.checked = true; };
          b.addEventListener('change', () => { if (!b.checked) d.checked = false; });
          return h('div', { class: 'dash-pick-row' }, h('label', { class: 'check', title: c.hint }, b, c.title), h('label', { class: 'check sub' }, d, 'بالقائمة'));
        }));
    })),
    h('div', { class: 'help' }, '«بالقائمة»: يفتح المستخدم قائمة ما وراء الرقم (مثل الفواتير المتأخرة أو الطلبات) دون صلاحية على القسم نفسه، وبنطاق شركاته ومشاريعه.'));
  return { ui, save: (id) => rpc('set_user_dash_cards', { p_user: id, p_codes: boxes.filter((b) => b.checked).map((b) => b.value),
    p_details: Object.entries(dets).filter(([, d]) => d.checked).map(([c]) => c) }) };
}

// نطاق رقم كل بطاقة (يظهر وسمًا عليها)
const TODAY_CARDS = ['alerts', 'commitments', 'vat', 'contracts', 'project_risk', 'overdue_inv', 'payreq', 'custody'];
const COMPANY_CARDS = ['projects', 'equipment', 'cash'];
function scopeTag(code, multi) {
  if (TODAY_CARDS.includes(code)) return 'حتى اليوم';
  if (!multi) return null;
  return COMPANY_CARDS.includes(code) ? 'بأرقام كل شركة' : 'مجمّع بعد الاستبعاد';
}

// نافذة تفاصيل البطاقة: القائمة التي وراء الرقم (لمن مُنح البطاقة «بالقائمة»)
const STATE_AR = { pending: 'بانتظار الاعتماد', returned: 'مُرجَع للتعديل', approved: 'معتمد', on_hold: 'موقوف', transferred: 'حُوِّل' };
const DETAIL_COLS = {
  inv: [{ t: 'الطرف', v: (r) => r.party }, { t: 'الفاتورة', v: (r) => r.invoice }, { t: 'التاريخ', v: (r) => fmt.date(r.date) }, { t: 'الاستحقاق', v: (r) => fmt.date(r.due) },
    { t: 'القيمة', num: true, v: (r) => num(r.amount) }, { t: 'المتبقي', num: true, v: (r) => num(r.remaining) }, { t: 'التأخير', num: true, v: (r) => (r.late ? `${r.late} يوم` : '') }],
  payreq: [{ t: 'الطلب', v: (r) => r.no + (r.urgent ? ' (عاجل)' : '') }, { t: 'المستفيد', v: (r) => r.payee }, { t: 'المشروع', v: (r) => r.project || '' },
    { t: 'الحالة', v: (r) => STATE_AR[r.state] || r.state }, { t: 'آخر موعد', v: (r) => h('span', { class: r.late ? 'neg' : '' }, fmt.date(r.due)) }, { t: 'المبلغ', num: true, v: (r) => num(r.amount) }],
  custody: [{ t: 'العهدة', v: (r) => `${r.no} — ${r.holder}` }, { t: 'الرصيد', num: true, v: (r) => num(r.balance) }, { t: 'معلّق', num: true, v: (r) => num(r.pending) }, { t: 'منذ', num: true, v: (r) => `${r.days} يوم` }],
  projects: [{ t: 'المشروع', v: (r) => `${r.code} — ${r.name}` }, { t: 'الإيراد', num: true, v: (r) => num(r.revenue) }, { t: 'المصروف', num: true, v: (r) => num(r.expense) },
    { t: 'الهامش', num: true, v: (r) => num(Number(r.revenue) - Number(r.expense)) }],
  equipment: [{ t: 'المعدة', v: (r) => `${r.code} — ${r.name}` }, { t: 'التكلفة', num: true, v: (r) => num(r.expense) }, { t: 'الإيراد', num: true, v: (r) => num(r.revenue) }],
  contracts: [{ t: 'العقد', v: (r) => r.no }, { t: 'الطرف', v: (r) => r.party }, { t: 'المشروع', v: (r) => r.project }, { t: 'القيمة', num: true, v: (r) => num(r.value) },
    { t: 'المنفّذ', num: true, v: (r) => num(r.work) }, { t: 'الباقي', num: true, v: (r) => num(r.backlog) }, { t: 'غير محصّل', num: true, v: (r) => num(r.outstanding) }, { t: 'محتجز', num: true, v: (r) => num(r.retention) }],
  top_expenses: [{ t: 'البند', v: (r) => `${r.code} — ${r.name}` }, { t: 'الفترة', num: true, v: (r) => num(r.cur) }, { t: 'المقارنة', num: true, v: (r) => num(r.prev) }],
  top_customers: [{ t: 'العميل', v: (r) => `${r.code || ''} ${r.name}` }, { t: 'المفوتر', num: true, v: (r) => num(r.amount) }],
  project_risk: [{ t: 'المشروع', v: (r) => `${r.code} — ${r.name}` }, { t: 'المكتسب', num: true, v: (r) => num(r.earned) }, { t: 'المصروف', num: true, v: (r) => num(r.cost) },
    { t: 'الحالة', v: (r) => ({ bad: 'خسارة', warn: 'هامش ضعيف', ok: 'سليم' })[r.lvl] }],
};
async function detailDialog(code, title, p) {
  const { modal } = await import('../../shared/ui.js');
  const m = modal({ title: 'تفاصيل: ' + title, size: 'wide' });
  put(m.body, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  try {
    const res = await rpc('dash_detail', { p_card: code, p_companies: p.companies, p_from: p.from, p_to: p.to }, 'accounting');
    let cols = DETAIL_COLS[['receivables', 'payables', 'overdue_inv'].includes(code) ? 'inv' : code];
    if (res.multi && res.rows.length && res.rows[0].company) cols = [{ t: 'الشركة', v: (r) => r.company }, ...cols];
    put(m.body, h('div', { class: 'help', style: { marginBottom: '8px' } }, `${res.rows.length} سطر${res.rows.length >= 1000 ? ' (أول 1,000)' : ''}`),
      h('div', { class: 'table-wrap' }, list(res.rows, cols)));
  } catch (e) { put(m.body, h('div', { class: 'notice bad' }, e.message)); }
  m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'إغلاق'));
}

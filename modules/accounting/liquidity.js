// السيولة: الرصيد اللحظي، السيولة المتوقعة، التدفقات النقدية، أعمار الديون، الالتزامات الثابتة
import { acc, rpc } from '../../shared/sb.js';
import { h, fmt, modal } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { renderMaster, opts } from '../../shared/master.js';
import { loadLookups, companySelect, yearStart, today } from './lookups.js';
import { frame, dateInput, N, neg } from './reports.js';
import { openEntry } from './register.js';

const ymd = (d) => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return ymd(x); };
const monthEnd = (y, m) => ymd(new Date(y, m + 1, 0));   // m: 0-11
const companyIds = () => state.selectedCompanies.length ? state.selectedCompanies : state.companies().map((c) => c.id);
const cname = (id) => state.companyName(id);

// ---------------------------------------------------------------------
// صفحة السيولة: الرصيد دلوقتي + المتوقع
// ---------------------------------------------------------------------
export function renderLiquidity(el) {
  const asOf = dateInput(today());
  const go = frame(el, [h('span', {}, 'في'), asOf, h('span', { class: 'help' }, 'الشركات حسب الاختيار في الشريط العلوي')], async (out) => {
    const ids = companyIds();
    const rows = await rpc('cash_position', { p_companies: ids, p_as_of: asOf.value }, 'accounting');
    const byCo = ids.map((id) => ({ id, rows: rows.filter((r) => r.company_id === id) })).filter((g) => g.rows.length);
    const sum = (list, k) => list.reduce((s, r) => s + Number(r[k]), 0);
    const total = sum(rows, 'balance');
    const delta = (a, b) => { const d = a - b; return h('span', { class: d < 0 ? 'neg' : d > 0 ? 'pos' : '' }, (d > 0 ? '+' : '') + fmt.num(d)); };
    const low = rows.filter((r) => r.min_balance !== null && Number(r.balance) < Number(r.min_balance));
    const forecastBox = h('div');
    out.replaceChildren(...[
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi main' }, h('small', {}, 'إجمالي النقدية'), h('b', {}, fmt.num(total)), h('span', {}, 'مقابل الأسبوع اللي فات: ', delta(total, sum(rows, 'balance_7d')))),
        ...byCo.map((g) => h('div', { class: 'kpi' }, h('small', {}, cname(g.id)), h('b', {}, fmt.num(sum(g.rows, 'balance'))), h('span', {}, 'مقابل الشهر اللي فات: ', delta(sum(g.rows, 'balance'), sum(g.rows, 'balance_30d')))))),
      low.length ? h('div', { class: 'notice bad', style: { margin: '10px 0' } }, 'تحت حد الأمان: ' + low.map((r) => `${r.name} (${cname(r.company_id)}) ${fmt.num(r.balance)} من ${fmt.num(r.min_balance)}`).join('، ')) : null,
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الحساب', 'الرصيد', 'قبل أسبوع', 'التغير', 'قبل شهر', 'التغير', 'حد الأمان'].map((t) => h('th', {}, t)))),
        h('tbody', {}, byCo.flatMap((g) => [
          h('tr', { class: 'group' }, h('td', { colspan: 7 }, cname(g.id))),
          ...g.rows.map((r) => h('tr', { class: r.min_balance !== null && Number(r.balance) < Number(r.min_balance) ? 'warnrow' : '' },
            h('td', {}, `${r.code} — ${r.name}`), h('td', { class: neg(r.balance) }, N(r.balance)),
            h('td', { class: 'num' }, N(r.balance_7d)), h('td', { class: 'num' }, delta(Number(r.balance), Number(r.balance_7d))),
            h('td', { class: 'num' }, N(r.balance_30d)), h('td', { class: 'num' }, delta(Number(r.balance), Number(r.balance_30d))),
            h('td', { class: 'num' }, r.min_balance === null ? '' : N(r.min_balance)))),
          byCo.length > 1 ? h('tr', { class: 'sub' }, h('td', {}, 'إجمالي ' + cname(g.id)), h('td', { class: 'num' }, N(sum(g.rows, 'balance'))), h('td', { class: 'num' }, N(sum(g.rows, 'balance_7d'))), h('td'), h('td', { class: 'num' }, N(sum(g.rows, 'balance_30d'))), h('td'), h('td')) : null,
        ].filter(Boolean))),
        h('tfoot', {}, h('tr', {}, h('td', {}, 'الإجمالي'), h('td', { class: 'num' }, N(total)), h('td', { class: 'num' }, N(sum(rows, 'balance_7d'))), h('td', { class: 'num' }, delta(total, sum(rows, 'balance_7d'))),
          h('td', { class: 'num' }, N(sum(rows, 'balance_30d'))), h('td', { class: 'num' }, delta(total, sum(rows, 'balance_30d'))), h('td')))))),
      h('p', { class: 'help' }, 'حد الأمان يتحدد من شاشة الحساب في شجرة الحسابات (حسابات النقدية).'),
      forecastBox].filter(Boolean));
    renderForecast(forecastBox, ids, asOf.value, total);
    return { name: 'السيولة', print: { title: 'السيولة', company: ids.map(cname).join(' + '), period: 'في ' + asOf.value },
      aoa: [['الشركة', 'الحساب', 'الرصيد', 'قبل أسبوع', 'قبل شهر', 'حد الأمان'], ...rows.map((r) => [cname(r.company_id), `${r.code} — ${r.name}`, Number(r.balance), Number(r.balance_7d), Number(r.balance_30d), r.min_balance === null ? '' : Number(r.min_balance)])] };
  });
  go();
  const off = state.onCompaniesChange(() => { if (document.body.contains(el)) go(); else off(); });
}

// ---------------------------------------------------------------------
// السيولة المتوقعة: الفواتير المفتوحة بميعاد استحقاقها + الالتزامات الثابتة + الضريبة المستحقة
//   "ماذا لو": تأجيل أي حركة يتعمل من التفاصيل ويتحسب فورًا (من غير ما يتحفظ)
// ---------------------------------------------------------------------
async function collectEvents(ids, from, to) {
  const events = [];
  const comms = await acc.from('cash_commitments').select('*').in('company_id', ids).eq('status', 'active');
  for (const c of comms.data || []) {
    const step = { monthly: 1, quarterly: 3, yearly: 12, once: 0 }[c.frequency];
    let d = c.start_date; let guard = 0;
    while (d <= to && guard++ < 400) {
      if (d >= from && (!c.end_date || d <= c.end_date)) events.push({ date: d, company: c.company_id, kind: 'commit', label: c.name, amount: c.direction === 'in' ? Number(c.amount) : -Number(c.amount) });
      if (!step) break;
      const x = new Date(c.start_date + 'T00:00:00'); const n = guard * step;
      const y = x.getFullYear(), m = x.getMonth() + n; const day = Math.min(x.getDate(), new Date(y, m + 1, 0).getDate());
      d = ymd(new Date(y, m, day));
    }
  }
  // المحتجزات: تتفك في نهاية العقد (داخل من العملاء، خارج لمقاولي الباطن)
  try {
    const cs = await rpc('contract_status', { p_companies: ids }, 'accounting');
    for (const k of cs) {
      if (k.status !== 'active' || !k.end_date || Number(k.retention_held) < 0.005 || k.end_date > to) continue;
      events.push({ date: k.end_date < from ? from : k.end_date, origDue: k.end_date, overdue: k.end_date < from, company: k.company_id, kind: k.kind === 'customer' ? 'in' : 'out',
        label: `فك محتجز — عقد ${k.contract_no} (${k.party_name})`, amount: k.kind === 'customer' ? Number(k.retention_held) : -Number(k.retention_held) });
    }
  } catch { /* العقود مش متفعلة (010/011 ما اتشغلتش) */ }
  for (const id of ids) {
    const inv = await rpc('open_invoices', { p_company: id, p_as_of: today(), p_party: null }, 'accounting');
    for (const r of inv) {
      const rem = Number(r.remaining);
      if (!r.invoice_no || Math.abs(rem) < 0.005) continue;
      const due = r.due_date || r.invoice_date || today();
      events.push({ date: due < from ? from : due, origDue: due, overdue: due < from, company: id, kind: r.side === 'customer' ? 'in' : 'out',
        label: `${r.party_name} — ${r.invoice_no}`, amount: r.side === 'customer' ? rem : -rem, entry: r.entry_id });
    }
    // الضريبة المستحقة: صافي حسابات الضريبة لحد النهارده، في ميعاد الإقرار
    const lk = await loadLookups(id);
    const vatIds = new Set(lk.accounts.filter((a) => a.row.vat_role && a.row.vat_role !== 'none').map((a) => a.id));
    if (vatIds.size) {
      const tb = await rpc('trial_balance', { p_company: id, p_from: yearStart(), p_to: today() }, 'accounting');
      const net = tb.filter((r) => vatIds.has(r.account_id)).reduce((s, r) => s + Number(r.closing_credit) - Number(r.closing_debit), 0);
      if (net > 0.005) {
        const t = new Date(today() + 'T00:00:00'); const m = t.getMonth();
        const endM = lk.vatPeriod === 'monthly' ? m : Math.floor(m / 3) * 3 + 2;
        const due = monthEnd(t.getFullYear(), endM + 1);
        if (due <= to) events.push({ date: due, company: id, kind: 'vat', label: 'ضريبة القيمة المضافة المستحقة', amount: -net });
      }
    }
  }
  return events;
}

function renderForecast(box, ids, asOf, opening) {
  let grain = 'week'; let events = []; const shift = new Map();
  const grainSel = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: 'week' }, '12 أسبوع'), h('option', { value: 'month' }, '6 شهور'));
  const resetBtn = h('button', { class: 'btn ghost', onclick: () => { shift.clear(); draw(); } }, 'إلغاء التأجيلات');
  const body = h('div', { class: 'empty' }, 'جارٍ حساب المتوقع…');
  box.replaceChildren(h('div', { class: 'card', style: { marginTop: '16px' } },
    h('div', { class: 'toolbar' }, h('strong', {}, 'السيولة المتوقعة'), grainSel, resetBtn, h('div', { class: 'grow' }),
      h('span', { class: 'help' }, 'من الفواتير المفتوحة بميعاد استحقاقها، والالتزامات الثابتة، والضريبة المستحقة. اضغط على أي فترة لتفاصيلها.')), body));
  grainSel.onchange = () => { grain = grainSel.value; load(); };

  const periods = () => {
    const list = []; const start = asOf;
    if (grain === 'week') for (let i = 0; i < 12; i++) list.push({ from: addDays(start, i * 7), to: addDays(start, i * 7 + 6), label: `أسبوع ${i + 1}` });
    else {
      const t = new Date(start + 'T00:00:00');
      for (let i = 0; i < 6; i++) { const y = t.getFullYear(), m = t.getMonth() + i; list.push({ from: i ? ymd(new Date(y, m, 1)) : start, to: monthEnd(y, m), label: new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(new Date(y, m, 1)) }); }
    }
    return list;
  };
  async function load() {
    body.replaceChildren(h('div', { class: 'empty' }, 'جارٍ حساب المتوقع…'));
    const ps = periods();
    try { events = await collectEvents(ids, ps[0].from, ps[ps.length - 1].to); draw(); } catch (e) { body.replaceChildren(h('div', { class: 'notice bad' }, e.message)); }
  }
  const dateOf = (ev, i) => shift.get(i) || ev.date;
  function draw() {
    const ps = periods(); let bal = opening; let minBal = Infinity; let minAt = null;
    const rows = ps.map((p) => {
      const evs = events.map((ev, i) => ({ ev, i, d: dateOf(ev, i) })).filter((x) => x.d >= p.from && x.d <= p.to);
      const inn = evs.filter((x) => x.ev.amount > 0).reduce((s, x) => s + x.ev.amount, 0);
      const out = evs.filter((x) => x.ev.amount < 0).reduce((s, x) => s - x.ev.amount, 0);
      const open = bal; bal = bal + inn - out;
      if (bal < minBal) { minBal = bal; minAt = p; }
      return { p, evs, open, inn, out, close: bal };
    });
    const beyond = events.filter((ev, i) => dateOf(ev, i) > ps[ps.length - 1].to).length;
    body.replaceChildren(...[
      minBal < 0 ? h('div', { class: 'notice bad', style: { margin: '8px 0' } }, `السيولة هتبقى بالسالب في ${minAt.label} (${minAt.from} — ${minAt.to}): ${fmt.num(minBal)}`)
        : h('div', { class: 'notice', style: { margin: '8px 0' } }, `أقل رصيد متوقع: ${fmt.num(minBal)} في ${minAt.label}`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid report fc' },
        h('thead', {}, h('tr', {}, ['الفترة', 'من', 'إلى', 'أول الفترة', 'داخل متوقع', 'خارج متوقع', 'آخر الفترة', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.map((r) => h('tr', { class: r.close < 0 ? 'warnrow' : '', onclick: () => details(r) },
          h('td', {}, r.p.label), h('td', {}, r.p.from), h('td', {}, r.p.to), h('td', { class: neg(r.open) }, N(r.open)),
          h('td', { class: 'num pos' }, r.inn ? N(r.inn) : ''), h('td', { class: 'num neg' }, r.out ? N(r.out) : ''),
          h('td', { class: neg(r.close) }, h('b', {}, N(r.close))),
          h('td', {}, r.evs.some((x) => x.ev.overdue && !shift.has(x.i)) ? h('span', { class: 'badge warn' }, 'فيها متأخرات') : '')))))),
      beyond ? h('p', { class: 'help' }, `${beyond} حركة استحقاقها بعد آخر فترة معروضة.`) : null,
      shift.size ? h('p', { class: 'help', style: { color: 'var(--accent)' } }, `فيه ${shift.size} تأجيل "ماذا لو" — مش محفوظ.`) : null].filter(Boolean));
  }
  function details(r) {
    const m = modal({ title: `${r.p.label}: ${r.p.from} — ${r.p.to}`, size: 'wide' });
    const kinds = { in: 'تحصيل متوقع', out: 'سداد متوقع', commit: 'التزام ثابت', vat: 'ضريبة' };
    m.body.append(r.evs.length ? h('table', { class: 'grid report' },
      h('thead', {}, h('tr', {}, ['الشركة', 'النوع', 'البيان', 'الاستحقاق', 'المبلغ', 'تأجيل (ماذا لو)'].map((t) => h('th', {}, t)))),
      h('tbody', {}, r.evs.sort((a, b) => a.d.localeCompare(b.d)).map((x) => {
        const inp = h('input', { class: 'input', type: 'date', value: x.d, style: { width: 'auto' } });
        inp.onchange = () => { if (inp.value && inp.value !== x.ev.date) shift.set(x.i, inp.value); else shift.delete(x.i); draw(); };
        return h('tr', { style: { cursor: x.ev.entry ? 'pointer' : 'default' } },
          h('td', {}, cname(x.ev.company)), h('td', {}, kinds[x.ev.kind] + (x.ev.overdue ? ' (متأخر من ' + x.ev.origDue + ')' : '')),
          h('td', { onclick: () => x.ev.entry && openEntry(x.ev.entry) }, x.ev.label), h('td', {}, x.ev.origDue || x.ev.date),
          h('td', { class: x.ev.amount < 0 ? 'num neg' : 'num pos' }, N(x.ev.amount)), h('td', {}, inp));
      }))) : h('div', { class: 'empty' }, 'مفيش حركات متوقعة في الفترة دي'));
    m.foot.append(h('button', { class: 'btn primary', onclick: m.close }, 'تم'));
  }
  load();
}

// ---------------------------------------------------------------------
// قائمة التدفقات النقدية (الطريقة المباشرة) — بالشهور
// ---------------------------------------------------------------------
const CLASSES = [['operating', 'الأنشطة التشغيلية'], ['investing', 'الأنشطة الاستثمارية'], ['financing', 'الأنشطة التمويلية']];
export function renderCashFlow(el) {
  const sel = companySelect(() => go(), { includeAll: true });
  const from = dateInput(yearStart()); const to = dateInput(today());
  const go = frame(el, [sel, h('span', {}, 'من'), from, h('span', {}, 'إلى'), to], async (out) => {
    const ids = sel.value ? [sel.value] : state.companies().map((c) => c.id);
    const [rows, open, close] = await Promise.all([
      rpc('cash_flow_direct', { p_companies: ids, p_from: from.value, p_to: to.value }, 'accounting'),
      rpc('cash_total', { p_companies: ids, p_date: addDays(from.value, -1) }, 'accounting'),
      rpc('cash_total', { p_companies: ids, p_date: to.value }, 'accounting'),
    ]);
    const months = [...new Set(rows.map((r) => r.period))].sort();
    const mlabel = (d) => new Intl.DateTimeFormat('ar-EG', { month: 'short', year: '2-digit' }).format(new Date(d + 'T00:00:00'));
    const cell = (list) => months.map((m) => list.filter((r) => r.period === m).reduce((s, r) => s + Number(r.amount), 0));
    const tot = (arr) => arr.reduce((s, x) => s + x, 0);
    const net = tot(rows.map((r) => Number(r.amount)));
    const opening = Number(open);
    // أي فرق بين (أول المدة + الصافي) وآخر المدة = قيود افتتاحية جوه الفترة
    const openingEntries = Number(close) - opening - net;
    const trs = []; const aoa = [['البند', ...months.map(mlabel), 'الإجمالي']];
    for (const [k, name] of CLASSES) {
      const list = rows.filter((r) => r.cf_class === k); if (!list.length) continue;
      trs.push(h('tr', { class: 'fin-header' }, h('td', { colspan: months.length + 2 }, name))); aoa.push([name]);
      const cats = [...new Set(list.map((r) => r.category))].sort((a, b) => Math.abs(tot(cell(list.filter((r) => r.category === b)))) - Math.abs(tot(cell(list.filter((r) => r.category === a)))));
      for (const c of cats) {
        const v = cell(list.filter((r) => r.category === c));
        trs.push(h('tr', { class: 'fin-account' }, h('td', {}, c), ...v.map((x) => h('td', { class: neg(x) }, x ? N(x) : '')), h('td', { class: neg(tot(v)) }, N(tot(v)))));
        aoa.push([c, ...v, tot(v)]);
      }
      const v = cell(list);
      trs.push(h('tr', { class: 'fin-total' }, h('td', {}, 'صافي ' + name), ...v.map((x) => h('td', { class: neg(x) }, N(x))), h('td', { class: neg(tot(v)) }, N(tot(v)))));
      aoa.push(['صافي ' + name, ...v, tot(v)]);
    }
    const nv = cell(rows);
    trs.push(h('tr', { class: 'fin-grand' }, h('td', {}, 'صافي التغير في النقدية'), ...nv.map((x) => h('td', { class: neg(x) }, N(x))), h('td', { class: neg(net) }, N(net))));
    aoa.push(['صافي التغير في النقدية', ...nv, net]);
    out.replaceChildren(h('h2', { class: 'fin-title' }, `التدفقات النقدية — ${sel.value ? cname(sel.value) : 'كل الشركات'}`),
      h('div', { class: 'card fin' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report fin-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'البند'), ...months.map((m) => h('th', {}, mlabel(m))), h('th', {}, 'الإجمالي'))),
        h('tbody', {}, ...trs,
          h('tr', { class: 'fin-subtotal' }, h('td', {}, 'النقدية أول المدة'), h('td', { colspan: months.length }), h('td', { class: 'num' }, N(opening))),
          Math.abs(openingEntries) > 0.005 ? h('tr', { class: 'fin-account' }, h('td', {}, 'أرصدة افتتاحية مسجلة جوه الفترة'), h('td', { colspan: months.length }), h('td', { class: 'num' }, N(openingEntries))) : null,
          h('tr', { class: 'fin-grand' }, h('td', {}, 'النقدية آخر المدة'), h('td', { colspan: months.length }), h('td', { class: 'num' }, N(close))))))),
      h('p', { class: 'help' }, 'البند بيتحدد من "بند التدفق" المكتوب على الحساب في الشجرة، وإلا من نوع الحساب. التحويل بين الصندوق والبنك مش بيظهر لأنه مش داخل ولا خارج.'));
    aoa.push([], ['النقدية أول المدة', opening], ['النقدية آخر المدة', Number(close)]);
    return { name: 'التدفقات النقدية', print: { company: sel.value ? cname(sel.value) : 'كل الشركات', period: `من ${from.value} إلى ${to.value}`, fit: true, sign: true }, aoa };
  });
  go();
}

// ---------------------------------------------------------------------
// أعمار الديون: العملاء أو الموردون، مقسومين حسب التأخير عن ميعاد الاستحقاق
// ---------------------------------------------------------------------
const BUCKETS = [['cur', 'غير مستحق'], ['b30', '1 – 30'], ['b60', '31 – 60'], ['b90', '61 – 90'], ['b90p', 'أكتر من 90'], ['un', 'غير موزع']];
export function renderAging(el) {
  const sel = companySelect(() => go());
  const asOf = dateInput(today());
  const side = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: 'customer' }, 'العملاء (لنا)'), h('option', { value: 'supplier' }, 'الموردون (علينا)'));
  const go = frame(el, [sel, side, h('span', {}, 'في'), asOf], async (out) => {
    const rows = (await rpc('open_invoices', { p_company: sel.value, p_as_of: asOf.value, p_party: null }, 'accounting'))
      .filter((r) => r.side === side.value && Math.abs(Number(r.remaining)) >= 0.005);
    const bucket = (r) => {
      if (!r.invoice_no) return 'un';
      const late = Math.round((new Date(asOf.value) - new Date(r.due_date || r.invoice_date)) / 864e5);
      return late <= 0 ? 'cur' : late <= 30 ? 'b30' : late <= 60 ? 'b60' : late <= 90 ? 'b90' : 'b90p';
    };
    const parties = new Map();
    for (const r of rows) {
      const p = parties.get(r.party_id) || { name: r.party_name, inv: [], cur: 0, b30: 0, b60: 0, b90: 0, b90p: 0, un: 0, total: 0 };
      const b = bucket(r); p[b] += Number(r.remaining); p.total += Number(r.remaining); p.inv.push({ ...r, b });
      parties.set(r.party_id, p);
    }
    const list = [...parties.values()].sort((a, b) => b.total - a.total);
    const col = (k) => list.reduce((s, p) => s + p[k], 0);
    out.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, h('strong', {}, `أعمار ${side.value === 'customer' ? 'ديون العملاء' : 'أرصدة الموردين'} — ${cname(sel.value)}`),
        h('span', { class: 'help' }, 'الاستحقاق = المكتوب على الفاتورة، وإلا تاريخها + مدة سداد الطرف (من شاشة العملاء والموردين). اضغط على الطرف لفواتيره.')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid report aging' },
        h('thead', {}, h('tr', {}, h('th', {}, 'الطرف'), ...BUCKETS.map(([, t]) => h('th', {}, t)), h('th', {}, 'الإجمالي'))),
        h('tbody', {}, list.length ? list.map((p) => h('tr', { onclick: () => partyDetails(p) }, h('td', {}, p.name),
          ...BUCKETS.map(([k]) => h('td', { class: (k === 'b90p' || k === 'b90') && p[k] ? 'num neg' : 'num' }, p[k] ? N(p[k]) : '')), h('td', { class: 'num' }, h('b', {}, N(p.total)))))
          : h('tr', {}, h('td', { colspan: 8, class: 'empty' }, 'مفيش أرصدة مفتوحة'))),
        h('tfoot', {}, h('tr', {}, h('td', {}, 'الإجمالي'), ...BUCKETS.map(([k]) => h('td', { class: 'num' }, N(col(k)))), h('td', { class: 'num' }, N(col('total')))))))));
    return { name: 'أعمار الديون', print: { company: cname(sel.value), period: 'في ' + asOf.value, fit: true },
      aoa: [['الطرف', ...BUCKETS.map(([, t]) => t), 'الإجمالي'], ...list.map((p) => [p.name, ...BUCKETS.map(([k]) => p[k]), p.total])] };
  });
  function partyDetails(p) {
    const m = modal({ title: p.name, size: 'wide' });
    m.body.append(h('table', { class: 'grid report' },
      h('thead', {}, h('tr', {}, ['الفاتورة', 'تاريخها', 'الاستحقاق', 'القيمة', 'المسدد', 'المتبقي', 'الشريحة'].map((t) => h('th', {}, t)))),
      h('tbody', {}, p.inv.map((r) => h('tr', { onclick: () => openEntry(r.entry_id) },
        h('td', { class: 'ltr' }, r.invoice_no || 'بدون رقم'), h('td', {}, fmt.date(r.invoice_date)), h('td', {}, fmt.date(r.due_date)),
        h('td', { class: 'num' }, N(r.amount)), h('td', { class: 'num' }, N(r.settled)), h('td', { class: 'num' }, N(r.remaining)),
        h('td', {}, BUCKETS.find((b) => b[0] === r.b)[1]))))));
    m.foot.append(h('button', { class: 'btn primary', onclick: m.close }, 'تم'));
  }
  go();
}

// ---------------------------------------------------------------------
// الالتزامات الثابتة
// ---------------------------------------------------------------------
const FREQ = [['monthly', 'شهري'], ['quarterly', 'ربع سنوي'], ['yearly', 'سنوي'], ['once', 'مرة واحدة']];
export function renderCommitments(el) {
  renderMaster(el, {
    title: 'الالتزام', schema: 'accounting', table: 'cash_commitments', module: 'accounting', companyField: 'company_id',
    levelAdd: 3, levelEdit: 3, order: [{ col: 'start_date' }],
    defaults: () => ({ direction: 'out', frequency: 'monthly', start_date: today() }),
    columns: [
      { key: 'company_id', label: 'الشركة', render: (r) => cname(r.company_id) },
      { key: 'name', label: 'البيان' },
      { key: 'direction', label: 'الاتجاه', render: (r) => (r.direction === 'in' ? 'داخل' : 'خارج') },
      { key: 'amount', label: 'المبلغ', num: true },
      { key: 'frequency', label: 'التكرار', render: (r) => (FREQ.find((f) => f[0] === r.frequency) || [])[1] },
      { key: 'start_date', label: 'أول مرة' }, { key: 'end_date', label: 'لحد' },
    ],
    fields: [
      { key: 'company_id', label: 'الشركة', type: 'select', required: true, options: opts.companies() },
      { key: 'name', label: 'البيان', required: true, help: 'مثلًا: إيجار المكتب، قسط السيارة، رواتب شهر' },
      { key: 'direction', label: 'الاتجاه', type: 'select', required: true, options: opts.list([['out', 'خارج (مدفوع)'], ['in', 'داخل (متحصّل)']]) },
      { key: 'amount', label: 'المبلغ', type: 'number', required: true },
      { key: 'frequency', label: 'التكرار', type: 'select', required: true, options: opts.list(FREQ) },
      { key: 'start_date', label: 'أول ميعاد', type: 'date', required: true, help: 'اليوم ده بيتكرر كل شهر/ربع/سنة' },
      { key: 'end_date', label: 'آخر ميعاد', type: 'date', help: 'فاضي = مستمر' },
      { key: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
  });
}

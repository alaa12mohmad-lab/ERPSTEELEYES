// قسم تنفيذ المشاريع — تقدّم الأعمال (المرحلة الأولى)
//   بنود القياس لكل مشروع (طن / كمية / نسبة / مرحلة) بأوزانها ← خطة أسبوعية (الأسبوع يبدأ السبت) ← تقرير يومي ← لوحة إنجاز.
//   الصلاحيات (exec): 1 مشاهدة، 2 التقرير اليومي، 3 البنود والخطة. المشاريع الظاهرة = مشاريع المستخدم.
//   كل الحسابات والتحقق في قاعدة البيانات (037): الواجهة تعرض وتجمع المدخلات فقط، إلا توزيع الخطة المقترح (قابل للتعديل).
import { core, rpc } from '../../shared/sb.js';
import { h, fmt, modal, toast, store, askReason, confirmDialog } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { combo } from '../../shared/combo.js';
import { multiLine, barChart, hbars, legend, PALETTE } from '../../shared/charts.js';

const METHODS = { ton: 'طن', qty: 'كمية', pct: 'نسبة', stage: 'مرحلة' };
const CURVES = { linear: 'منتظم', s: 'منحنى S', front: 'مبكر', back: 'متأخر' };
const lvl = (n) => state.can('exec', n);
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false && x !== ''));
const num = (v, d = 2) => fmt.num(v, d);
const pct = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(1) + '%');
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
// بداية الأسبوع (السبت)
const weekOf = (s) => { const d = new Date(s + 'T00:00:00'); const back = (d.getDay() + 1) % 7; d.setDate(d.getDate() - back); return iso(d); };
const weekLabel = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getDate()}/${d.getMonth() + 1}`; };
const F = (label, input, o = {}) => h('div', { class: 'field' + (o.wide ? ' wide' : '') }, h('label', {}, label, o.req ? h('span', { class: 'req' }, '*') : ''), input, o.help ? h('div', { class: 'help' }, o.help) : null);

// المشروع المختار يتفتكر بين الصفحات
const curProject = () => store.get('exec.project');
const setProject = (id) => store.set('exec.project', id);

async function overview() { return rpc('prg_overview', {}, 'core'); }

// اختيار المشروع أعلى الصفحة
async function projectBar(el, onPick, { onlySetUp = false } = {}) {
  const list = (await overview()).filter((p) => !onlySetUp || p.set_up);
  const sel = h('select', { class: 'input', style: { width: 'auto', minWidth: '260px' }, id: 'exec-project' },
    list.length ? list.map((p) => h('option', { value: p.id }, `${p.code} — ${p.name}${p.set_up ? '' : ' (بدون خطة)'}`)) : h('option', { value: '' }, 'لا توجد مشاريع'));
  if (list.some((p) => p.id === curProject())) sel.value = curProject();
  sel.onchange = () => { setProject(sel.value); onPick(sel.value, list.find((p) => p.id === sel.value)); };
  el.append(h('label', { for: 'exec-project', class: 'help' }, 'المشروع'), sel);
  if (sel.value) { setProject(sel.value); onPick(sel.value, list.find((p) => p.id === sel.value)); }
  return { list, sel };
}

// ---------------------------------------------------------------------
// المشاريع: كل المشاريع الظاهرة بإنجازها
// ---------------------------------------------------------------------
async function renderOverview(el) {
  put(el, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  let list;
  try { list = await overview(); } catch (e) { put(el, h('div', { class: 'notice bad' }, e.message)); return; }
  if (!list.length) { put(el, h('div', { class: 'notice' }, 'مفيش مشاريع ظاهرة لحسابك. المدير بيربطك بمشاريعك من شاشة المستخدمين.')); return; }
  const go = (p, tab) => { setProject(p.id); location.hash = `#/exec/${tab}`; };
  const card = (p) => {
    const diff = p.set_up ? Number(p.actual) - Number(p.planned) : 0;
    const stale = p.set_up && (!p.last_report || daysBetween(p.last_report, today()) > 2);
    return h('section', { class: 'card ex-card' },
      h('div', { class: 'ex-card-head' }, h('div', {}, h('small', { class: 'help ltr' }, p.code), h('h3', {}, p.name)),
        p.set_up ? h('span', { class: 'badge ' + (diff < -2 ? 'bad' : diff < 0 ? 'warn' : 'ok') }, diff < -0.05 ? `متأخر ${Math.abs(diff).toFixed(1)}%` : 'على الخطة')
          : h('span', { class: 'badge' }, 'بدون خطة')),
      p.set_up ? [
        h('div', { class: 'ex-prog' },
          h('div', { class: 'ex-prog-track' }, h('span', { class: 'ex-prog-act', style: { width: Math.min(100, p.actual) + '%' } }),
            h('span', { class: 'ex-prog-plan', style: { insetInlineStart: Math.min(100, p.planned) + '%' }, title: 'المخطط' })),
          h('div', { class: 'ex-prog-nums' }, h('b', {}, pct(p.actual)), h('span', { class: 'help' }, `المخطط ${pct(p.planned)}`))),
        h('div', { class: 'help' }, `${fmt.date(p.start)} ← ${fmt.date(p.end)} · ${p.items} بند · الخطة ن${p.plan_version}`),
        h('div', { class: 'help' + (stale ? ' bad' : '') }, p.last_report ? `آخر تقرير ${fmt.date(p.last_report)}` : 'لا توجد تقارير'),
      ] : h('div', { class: 'help' }, lvl(3) ? 'حدد بنود القياس والخطة عشان تبدأ المتابعة.' : 'مدير المشاريع لسه ما حددش البنود والخطة.'),
      h('div', { class: 'ex-card-foot' },
        p.set_up ? h('button', { class: 'btn sm primary', onclick: () => go(p, 'dashboard') }, 'لوحة الإنجاز') : null,
        p.set_up && lvl(2) ? h('button', { class: 'btn sm', onclick: () => go(p, 'daily') }, 'التقرير اليومي') : null,
        lvl(3) ? h('button', { class: 'btn sm ghost', onclick: () => go(p, 'plan') }, p.set_up ? 'البنود والخطة' : 'حدد البنود والخطة') : null));
  };
  const setUp = list.filter((p) => p.set_up), rest = list.filter((p) => !p.set_up);
  put(el, setUp.length ? h('div', { class: 'ex-grid' }, setUp.map(card)) : null,
    rest.length ? [h('div', { class: 'section-title' }, `مشاريع بدون خطة (${rest.length})`), h('div', { class: 'ex-grid' }, rest.map(card))] : null);
}

// ---------------------------------------------------------------------
// التقرير اليومي
// ---------------------------------------------------------------------
async function renderDaily(el) {
  const bar = h('div', { class: 'toolbar' });
  const body = h('div');
  const date = h('input', { class: 'input', type: 'date', id: 'exec-date', value: store.get('exec.date') || today(), max: today(), style: { width: 'auto' } });
  put(el, h('div', { class: 'card', style: { marginBottom: '12px' } }, bar), body);
  let pid = null;
  const load = async () => {
    store.set('exec.date', date.value);
    if (!pid || !date.value) return;
    put(body, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    let form, rep, st;
    try {
      const [f, r, s] = await Promise.all([
        rpc('prg_form', { p_project: pid }, 'core'),
        core.from('prg_reports').select('*').eq('project_id', pid).eq('report_date', date.value).eq('status', 'active').maybeSingle(),
        rpc('prg_status', { p_project: pid, p_to: date.value }, 'core')]);
      form = f; if (r.error) throw new Error(r.error.message); rep = r.data; st = s;
    } catch (e) { put(body, h('div', { class: 'notice bad' }, e.message)); return; }
    drawForm(body, { pid, day: date.value, form, rep, st, reload: load });
  };
  date.onchange = load;
  await projectBar(bar, (id) => { pid = id; load(); }, { onlySetUp: true });
  bar.append(h('label', { for: 'exec-date', class: 'help' }, 'اليوم'), date,
    h('button', { class: 'btn sm', onclick: () => { date.value = addDays(date.value, -1); load(); } }, '← اليوم السابق'),
    h('button', { class: 'btn sm', onclick: () => { if (date.value < today()) { date.value = addDays(date.value, 1); load(); } } }, 'اليوم التالي →'));
  if (!pid) put(body, h('div', { class: 'notice' }, 'مفيش مشروع ليه خطة معتمدة لسه.'));
}

function drawForm(box, { pid, day, form, rep, st, reload }) {
  const editable = lvl(3) || (lvl(2) && daysBetween(day, today()) <= 1);
  const qtyOf = (id) => (rep?.qty || []).find((q) => q.item_id === id);
  const stItem = (id) => (st.items || []).find((x) => x.id === id) || {};
  const ins = {};
  // 1) المنفّذ
  const itemRow = (it) => {
    const q = qtyOf(it.id); const s = stItem(it.id);
    let input;
    if (it.method === 'stage') {
      input = h('input', { type: 'checkbox', checked: Number(q?.value) === 100, disabled: !editable, id: 'q-' + it.id });
      ins[it.id] = () => (input.checked ? 100 : (q ? 0 : null));
    } else {
      input = h('input', { class: 'input ex-qty', inputmode: 'decimal', type: 'number', step: 'any', min: 0, max: it.method === 'pct' ? 100 : null,
        value: q ? q.value : '', disabled: !editable, id: 'q-' + it.id, placeholder: it.method === 'pct' ? '% الكلية' : '0' });
      ins[it.id] = () => (input.value === '' ? null : Number(input.value));
    }
    const doneTxt = it.method === 'ton' || it.method === 'qty'
      ? `${num(s.done_qty, 1)} / ${num(it.planned_qty, 0)} ${it.unit || ''} · ${pct(s.actual_pct)}`
      : it.method === 'pct' ? `الإنجاز ${pct(s.actual_pct)} — اكتب النسبة الكلية لحد النهارده` : (Number(s.actual_pct) >= 100 ? 'تم' : 'لم يتم بعد');
    return h('div', { class: 'ex-item' },
      h('div', { class: 'ex-item-row' }, h('label', { for: 'q-' + it.id }, it.name),
        h('div', { class: 'ex-item-in' }, input, h('span', { class: 'help' }, it.method === 'stage' ? 'تم' : it.method === 'pct' ? '%' : (it.unit || '')))),
      h('div', { class: 'ex-item-prog' }, h('span', { class: 'ex-mini' }, h('i', { style: { width: Math.min(100, s.actual_pct || 0) + '%' } })), h('small', { class: 'help' }, doneTxt)));
  };
  // 2) العمالة
  const crewIn = {};
  const crewOf = (id) => (rep?.crew || []).find((c) => c.trade_id === id)?.count || '';
  const crewBox = h('div', { class: 'ex-crew' }, form.trades.map((t) => {
    const i = h('input', { class: 'input ex-qty', type: 'number', min: 0, step: 1, inputmode: 'numeric', value: crewOf(t.id), disabled: !editable, id: 'c-' + t.id });
    crewIn[t.id] = i;
    return h('div', { class: 'ex-crew-cell' }, h('label', { for: 'c-' + t.id }, t.name), i);
  }));
  const crewTotal = h('b');
  const sumCrew = () => { crewTotal.textContent = Object.values(crewIn).reduce((s, i) => s + (Number(i.value) || 0), 0); };
  Object.values(crewIn).forEach((i) => i.addEventListener('input', sumCrew)); sumCrew();
  // 3) المعدات
  const eqOpts = form.equipment.map((e) => ({ id: e.id, code: e.code, name: e.name, label: `${e.code} — ${e.name}` }));
  const eqRows = [];
  const eqList = h('div', { class: 'ex-eq' });
  const addEq = (v = {}) => {
    const c = combo({ options: eqOpts, listKey: 'exec-eq', value: v.equipment_id || null, placeholder: 'اختر المعدة', disabled: !editable });
    const hrs = h('input', { class: 'input ex-qty', type: 'number', min: 0, max: 24, step: 0.5, value: v.hours ?? '', placeholder: 'ساعات', disabled: !editable });
    const row = h('div', { class: 'ex-eq-row' }, c.el, hrs,
      editable ? h('button', { class: 'btn sm ghost', 'aria-label': 'حذف', onclick: () => { row.remove(); eqRows.splice(eqRows.indexOf(rec), 1); } }, '×') : null);
    const rec = { c, hrs }; eqRows.push(rec); eqList.append(row);
  };
  (rep?.equipment || []).forEach(addEq);
  // 4) المعوقات
  const obs = new Set(rep?.obstacles || []);
  const chips = h('div', { class: 'ex-chips' }, form.obstacles.map((o) => {
    const b = h('button', { type: 'button', class: 'ex-chip' + (obs.has(o.id) ? ' on' : ''), disabled: !editable, 'aria-pressed': String(obs.has(o.id)),
      onclick: () => { obs.has(o.id) ? obs.delete(o.id) : obs.add(o.id); b.classList.toggle('on'); b.setAttribute('aria-pressed', String(obs.has(o.id))); } }, o.name);
    return b;
  }));
  const notes = h('textarea', { class: 'input', id: 'exec-notes', rows: 3, disabled: !editable, placeholder: 'اللي اتعمل، والمشاكل، والمطلوب بكرة…' }, rep?.notes || '');
  const save = h('button', { class: 'btn primary ex-save', disabled: !editable }, rep ? 'حفظ التعديل' : 'حفظ التقرير');
  save.onclick = async () => {
    const eqVal = (r) => { r.c.resolve?.(); return r.c.id; };
    const payload = {
      qty: form.items.map((it) => ({ item_id: it.id, value: ins[it.id]() })).filter((x) => x.value !== null && x.value !== undefined),
      crew: form.trades.map((t) => ({ trade_id: t.id, count: Number(crewIn[t.id].value) || 0 })).filter((x) => x.count > 0),
      equipment: eqRows.map((r) => ({ equipment_id: eqVal(r) || null, hours: Number(r.hrs.value) || 0 })).filter((x) => x.equipment_id),
      obstacles: [...obs], notes: notes.value,
    };
    save.disabled = true;
    try { await rpc('prg_save_report', { p_project: pid, p_date: day, p_data: payload }, 'core'); toast('اتحفظ التقرير', 'ok'); reload(); }
    catch (e) { toast(e.message, 'bad'); save.disabled = false; }
  };
  const sec = (title, who, ...kids) => h('section', { class: 'card ex-sec' }, h('div', { class: 'ex-sec-head' }, h('b', {}, title), who ? h('small', { class: 'help' }, who) : null), ...kids);
  put(box,
    !editable ? h('div', { class: 'notice warn' }, lvl(2) ? 'التقرير ده اتقفل (بيتعدل لحد آخر اليوم التالي لتاريخه). مدير المشاريع بس يقدر يعدّله.' : 'عرض فقط.') : null,
    h('div', { class: 'ex-daily' },
      sec('المنفّذ في اليوم', 'المهندس', form.items.map(itemRow)),
      h('div', { class: 'ex-col' },
        sec('العمالة في الموقع', 'المشرف', crewBox, h('div', { class: 'help' }, 'الإجمالي: ', crewTotal)),
        sec('المعدات في الموقع', 'المشرف', eqList, editable ? h('button', { class: 'btn sm ghost', onclick: () => addEq() }, '＋ معدة') : null,
          !form.equipment.length ? h('div', { class: 'help' }, 'مفيش معدات في سجل المعدات.') : null),
        sec('المعوقات والملاحظات', null, chips, h('label', { for: 'exec-notes', class: 'help' }, 'ملاحظات'), notes))),
    editable ? h('div', { class: 'ex-save-bar' }, save,
      h('span', { class: 'help' }, lvl(3) ? 'مدير المشاريع يقدر يعدّل أي يوم.' : `يتعدل لحد آخر يوم ${addDays(day, 1)}، وبعدها يتقفل.`)) : null);
}

// ---------------------------------------------------------------------
// لوحة الإنجاز
// ---------------------------------------------------------------------
async function renderDashboard(el) {
  const bar = h('div', { class: 'toolbar' });
  const body = h('div');
  put(el, h('div', { class: 'card', style: { marginBottom: '12px' } }, bar), body);
  const load = async (pid, p) => {
    put(body, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    const from = addDays(today(), -27);
    let st, series, daily, res, plans;
    try {
      [st, series, daily, res, plans] = await Promise.all([
        rpc('prg_status', { p_project: pid, p_to: today() }, 'core'), rpc('prg_series', { p_project: pid }, 'core'),
        rpc('prg_daily', { p_project: pid, p_from: from, p_to: today() }, 'core'), rpc('prg_resources', { p_project: pid, p_from: from, p_to: today() }, 'core'),
        core.from('prg_plans').select('version, reason, created_at').eq('project_id', pid).eq('status', 'active').order('version')]);
    } catch (e) { put(body, h('div', { class: 'notice bad' }, e.message)); return; }
    drawDash(body, p, st, series, daily, res, plans.data || []);
  };
  await projectBar(bar, (id, p) => load(id, p), { onlySetUp: true });
  if (!bar.querySelector('select').value) put(body, h('div', { class: 'notice' }, 'مفيش مشروع ليه خطة معتمدة لسه.'));
}

function drawDash(box, p, st, series, daily, res, plans) {
  const diff = Number(st.actual) - Number(st.planned);
  // الانتهاء المتوقع: بمعدل الإنجاز في آخر 4 أسابيع
  const past = series.filter((w) => w.actual !== null);
  let eta = null, rate = 0;
  if (past.length >= 2) {
    const last = past[past.length - 1]; const ref = past[Math.max(0, past.length - 5)];
    const weeks = (past.length - 1) - Math.max(0, past.length - 5);
    rate = weeks ? (Number(last.actual) - Number(ref.actual)) / weeks : 0;
    if (rate > 0.01) eta = addDays(today(), Math.ceil((100 - Number(st.actual)) / rate * 7));
  }
  const lateDays = rate > 0.01 && diff < 0 ? Math.round(Math.abs(diff) / rate * 7) : null;
  const tile = (label, v, sub, cls = '') => h('div', { class: 'dash-tile ' + cls, style: { cursor: 'default' } }, h('small', {}, label), h('b', { class: 'dash-big' }, v), sub ? h('span', {}, sub) : null);
  const weekNow = weekOf(today());
  const marker = series.findIndex((w) => w.week === weekNow);
  const tons = st.items.filter((i) => i.method === 'ton');
  const tonDone = tons.reduce((s, i) => s + Number(i.done_qty || 0), 0), tonPlan = tons.reduce((s, i) => s + Number(i.planned_qty || 0), 0);
  const late = st.items.filter((i) => i.planned_pct !== null && Number(i.actual_pct) < Number(i.planned_pct) - 0.5)
    .sort((a, b) => (a.actual_pct - a.planned_pct) * a.weight - (b.actual_pct - b.planned_pct) * b.weight);
  const status = (i) => Number(i.actual_pct) >= 100 ? ['مكتمل', 'ok'] : !Number(i.actual_pct) && !Number(i.planned_pct) ? ['لم يبدأ', ''] :
    Number(i.actual_pct) < Number(i.planned_pct) - 0.5 ? ['متأخر', 'bad'] : Number(i.actual_pct) > Number(i.planned_pct) + 0.5 ? ['متقدّم', 'ok'] : ['على الخطة', 'ok'];
  const base = plans.length > 1;
  put(box,
    h('div', { class: 'dash-tiles' },
      tile('الإنجاز الفعلي', pct(st.actual), `آخر تقرير ${fmt.date(st.last_report) || '—'}`),
      tile('المخطط حتى اليوم', pct(st.planned), `الخطة ن${st.plan_version}${base ? ` · الأساسية ${pct(st.baseline)}` : ''}`),
      tile('الفرق', (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%', lateDays ? `متأخر حوالي ${lateDays} يوم` : diff >= 0 ? 'على الخطة أو متقدّم' : '', diff < -2 ? 'bad' : diff < 0 ? 'warn' : 'ok'),
      tile('الانتهاء المتوقع', eta || '—', `المخطط ${fmt.date(st.end)} · بمعدل آخر 4 أسابيع`),
      tonPlan ? tile('الحديد', `${num(tonDone, 1)} / ${num(tonPlan, 0)} طن`, `${tonPlan ? (tonDone / tonPlan * 100).toFixed(1) : 0}%`) : null),
    h('div', { class: 'ex-two' },
      h('section', { class: 'card dash-card' }, h('header', {}, h('h3', {}, 'منحنى الإنجاز — المخطط قصاد الفعلي (تراكمي)'),
        legend([{ label: 'الفعلي', color: PALETTE[0] }, { label: 'المخطط الحالي', color: '#7d8590' }, ...(base ? [{ label: 'الخطة الأساسية', color: PALETTE[1] }] : [])])),
        multiLine(series.map((w) => w.week), [
          ...(base ? [{ label: 'الأساسية', color: PALETTE[1], values: series.map((w) => w.baseline), dash: '2 4', width: 2 }] : []),
          { label: 'المخطط', color: '#7d8590', values: series.map((w) => w.planned), dash: '6 4' },
          { label: 'الفعلي', color: PALETTE[0], values: series.map((w) => w.actual), width: 3 }], { marker: marker >= 0 ? marker : null, fmtLabel: weekLabel, label: 'منحنى الإنجاز' })),
      h('section', { class: 'card dash-card' }, h('header', {}, h('h3', {}, 'المتأخر عن الخطة')),
        late.length ? late.slice(0, 5).map((i) => h('div', { class: 'ex-late' }, h('div', {}, h('b', {}, i.name), h('span', { class: 'bad' }, (i.actual_pct - i.planned_pct).toFixed(1) + '%')),
          h('small', { class: 'help' }, `مخطط ${pct(i.planned_pct)} · فعلي ${pct(i.actual_pct)}`))) : h('div', { class: 'help' }, 'مفيش بند متأخر.'),
        res.obstacles?.length ? h('div', { class: 'ex-note' }, 'أكتر المعوقات آخر 4 أسابيع: ', res.obstacles.slice(0, 3).map((o, k) => [k ? '، ' : '', h('b', {}, o.name), ` (${o.days} يوم)`])) : null)),
    h('section', { class: 'card dash-card' }, h('header', {}, h('h3', {}, 'البنود'), h('small', {}, 'الشريط الأزرق = الفعلي، والخط = المخطط حتى اليوم')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['البند', 'الوزن', 'الإنجاز', 'الفعلي', 'المخطط', 'المنفّذ', 'الحالة'].map((x) => h('th', {}, x)))),
        h('tbody', {}, st.items.map((i) => {
          const [t, c] = status(i);
          return h('tr', { style: { cursor: 'default' } }, h('td', {}, i.name), h('td', { class: 'num' }, Number(i.weight) + '%'),
            h('td', { style: { minWidth: '180px' } }, h('span', { class: 'ex-bar' }, h('i', { style: { width: Math.min(100, i.actual_pct) + '%' } }),
              i.planned_pct !== null ? h('em', { style: { insetInlineStart: Math.min(100, i.planned_pct) + '%' } }) : null)),
            h('td', { class: 'num' }, pct(i.actual_pct)), h('td', { class: 'num' }, pct(i.planned_pct)),
            h('td', { class: 'num' }, i.method === 'ton' || i.method === 'qty' ? `${num(i.done_qty, 1)} / ${num(i.planned_qty, 0)} ${i.unit || ''}` : i.method === 'stage' ? (i.actual_pct >= 100 ? 'تم' : '—') : pct(i.actual_pct)),
            h('td', {}, h('span', { class: 'badge ' + c }, t)));
        }))))),
    h('div', { class: 'ex-two' },
      h('section', { class: 'card dash-card' }, h('header', {}, h('h3', {}, 'العمالة في الموقع — آخر 4 أسابيع'), h('small', {}, 'مجموع العمال في كل تقرير')),
        daily.length ? barChart(daily.map((d) => ({ label: d.date, values: [d.crew] })), [{ label: 'العمال', color: PALETTE[0] }], { fmtLabel: (s) => s.slice(8) + '/' + Number(s.slice(5, 7)), label: 'العمالة اليومية' })
          : h('div', { class: 'help' }, 'لا تقارير في الفترة.'),
        res.trades?.length ? h('div', { class: 'help' }, 'يوم-عامل: ', res.trades.map((t, k) => `${k ? '، ' : ''}${t.name} ${t.man_days}`).join('')) : null),
      h('section', { class: 'card dash-card' }, h('header', {}, h('h3', {}, 'المعدات في الموقع — ساعات آخر 4 أسابيع')),
        res.equipment?.length ? hbars(res.equipment.map((e) => ({ label: e.name, value: Number(e.hours), sub: `${e.days} يوم`, color: PALETTE[1] })), { max: 10 })
          : h('div', { class: 'help' }, 'لا معدات مسجلة في الفترة.'))),
    h('section', { class: 'card dash-card' }, h('header', {}, h('h3', {}, 'التقارير اليومية — آخر 4 أسابيع')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['اليوم', 'العمال', 'ساعات المعدات', 'المعوقات', 'الملاحظات', 'أدخل المنفّذ', 'أدخل العمالة'].map((x) => h('th', {}, x)))),
        h('tbody', {}, daily.length ? [...daily].reverse().map((d) => h('tr', { onclick: () => { store.set('exec.date', d.date); location.hash = '#/exec/daily'; } },
          h('td', {}, fmt.date(d.date)), h('td', { class: 'num' }, d.crew), h('td', { class: 'num' }, num(d.hours, 1)), h('td', {}, (d.obstacles || []).join('، ')),
          h('td', { style: { whiteSpace: 'normal', maxWidth: '360px' } }, d.notes || ''), h('td', {}, d.qty_by || ''), h('td', {}, d.crew_by || ''))) :
          h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'لا تقارير'))))),
      plans.length > 1 ? h('details', { style: { marginTop: '10px' } }, h('summary', {}, `نسخ الخطة (${plans.length})`),
        h('ul', {}, plans.map((x) => h('li', {}, `ن${x.version} — ${fmt.datetime(x.created_at)}${x.reason ? ' — ' + x.reason : ' — الخطة الأساسية'}`)))) : null));
}

// ---------------------------------------------------------------------
// البنود والخطة (مدير المشاريع)
// ---------------------------------------------------------------------
// توزيع البند على أسابيعه حسب الشكل: يُرجع {أسبوع: نسبة} مجموعها 100
export function distribute(start, end, curve) {
  const weeks = [];
  for (let w = weekOf(start); w <= end; w = addDays(w, 7)) weeks.push(w);
  const total = daysBetween(start, end) + 1;
  const raw = weeks.map((w, k) => {
    const a = w < start ? start : w; const b = addDays(w, 6) > end ? end : addDays(w, 6);
    const days = Math.max(0, daysBetween(a, b) + 1);
    const t = (daysBetween(start, a) + days / 2) / total;
    const f = curve === 's' ? Math.sin(Math.PI * t) + 0.15 : curve === 'front' ? (1 - t) + 0.2 : curve === 'back' ? t + 0.2 : 1;
    return days * f;
  });
  const s = raw.reduce((x, y) => x + y, 0) || 1;
  const out = {}; let acc = 0;
  weeks.forEach((w, k) => {
    const v = k === weeks.length - 1 ? Math.round((100 - acc) * 10) / 10 : Math.round(raw[k] / s * 1000) / 10;
    acc += v; out[w] = v;
  });
  return out;
}

async function renderPlan(el) {
  if (!lvl(3)) { put(el, h('div', { class: 'notice' }, 'البنود والخطة لمدير المشاريع.')); return; }
  const bar = h('div', { class: 'toolbar' });
  const body = h('div');
  put(el, h('div', { class: 'card', style: { marginBottom: '12px' } }, bar), body);
  await projectBar(bar, (pid, p) => loadPlan(body, pid, p));
}

async function loadPlan(body, pid, p) {
  put(body, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  let items, plans, tpls;
  try {
    const [a, b, c] = await Promise.all([
      core.from('prg_items').select('*').eq('project_id', pid).eq('status', 'active').order('sort_no'),
      core.from('prg_plans').select('version, rows, reason, created_at').eq('project_id', pid).eq('status', 'active').order('version', { ascending: false }).limit(1),
      core.from('prg_templates').select('id, name, items').eq('status', 'active').order('name')]);
    for (const r of [a, b, c]) if (r.error) throw new Error(r.error.message);
    items = a.data; plans = b.data; tpls = c.data;
  } catch (e) { put(body, h('div', { class: 'notice bad' }, e.message)); return; }
  const cur = plans[0];
  // الحالة في المحرر: البنود + أسابيعها من آخر نسخة
  let rows = items.map((i) => ({ ...i, weeks: (cur?.rows || []).find((r) => r.item_id === i.id)?.weeks || distribute(i.start_date, i.end_date, i.curve) }));
  const dirty = { v: false };
  const ed = h('div');
  const draw = () => drawPlanEditor(ed, { pid, p, rows, cur, tpls, dirty, setRows: (r) => { rows = r; dirty.v = true; draw(); }, redraw: draw, reload: () => loadPlan(body, pid, p) });
  put(body, ed); draw();
}

function drawPlanEditor(box, { pid, p, rows, cur, tpls, dirty, setRows, redraw, reload }) {
  const ver = cur?.version || 0;
  const start = p?.start || today();
  const tw = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const tplSel = h('select', { class: 'input', style: { width: 'auto' }, id: 'exec-tpl' }, h('option', { value: '' }, 'اختر قالب…'), tpls.map((t) => h('option', { value: t.id }, t.name)));
  const applyTpl = async () => {
    const t = tpls.find((x) => x.id === tplSel.value); if (!t) return;
    if (rows.length && !(await confirmDialog('القالب هيستبدل البنود اللي في الشاشة (قبل الاعتماد). تكمّل؟'))) return;
    const s0 = today(); const e0 = addDays(s0, 13);
    setRows(t.items.map((x) => ({ name: x.name, method: x.method, unit: x.unit || (x.method === 'ton' ? 'طن' : x.method === 'pct' ? '%' : ''), planned_qty: null, weight: x.weight,
      start_date: s0, end_date: e0, curve: x.curve || 'linear', weeks: distribute(s0, e0, x.curve || 'linear') })));
  };
  const upd = (k, field, v) => {
    const r = { ...rows[k], [field]: v };
    if (['start_date', 'end_date', 'curve'].includes(field) && r.start_date && r.end_date && r.end_date >= r.start_date) r.weeks = distribute(r.start_date, r.end_date, r.curve);
    if (field === 'method') r.unit = v === 'ton' ? 'طن' : v === 'pct' ? '%' : v === 'stage' ? '' : (r.unit === 'طن' || r.unit === '%' ? '' : r.unit);
    const next = [...rows]; next[k] = r; setRows(next);
  };
  const tr = (r, k) => h('tr', {},
    h('td', { class: 'num' }, k + 1),
    h('td', {}, h('input', { class: 'input', value: r.name || '', 'aria-label': 'البند', onchange: (e) => upd(k, 'name', e.target.value) })),
    h('td', {}, h('select', { class: 'input', 'aria-label': 'طريقة القياس', onchange: (e) => upd(k, 'method', e.target.value) },
      Object.entries(METHODS).map(([v, t]) => h('option', { value: v, selected: r.method === v }, t)))),
    h('td', {}, ['ton', 'qty'].includes(r.method) ? h('input', { class: 'input ex-num', type: 'number', min: 0, step: 'any', value: r.planned_qty ?? '', 'aria-label': 'الكمية', onchange: (e) => upd(k, 'planned_qty', e.target.value === '' ? null : Number(e.target.value)) }) : h('span', { class: 'help' }, '—')),
    h('td', {}, r.method === 'qty' ? h('input', { class: 'input', style: { width: '70px' }, value: r.unit || '', 'aria-label': 'الوحدة', onchange: (e) => upd(k, 'unit', e.target.value) }) : h('span', { class: 'help' }, r.unit || (r.method === 'stage' ? 'تم/لم يتم' : ''))),
    h('td', {}, h('input', { class: 'input ex-num', type: 'number', min: 0, max: 100, step: 'any', value: r.weight ?? '', 'aria-label': 'الوزن', onchange: (e) => upd(k, 'weight', Number(e.target.value)) })),
    h('td', {}, h('input', { class: 'input', type: 'date', value: r.start_date || '', 'aria-label': 'البداية', onchange: (e) => upd(k, 'start_date', e.target.value) })),
    h('td', {}, h('input', { class: 'input', type: 'date', value: r.end_date || '', 'aria-label': 'النهاية', onchange: (e) => upd(k, 'end_date', e.target.value) })),
    h('td', {}, h('select', { class: 'input', 'aria-label': 'شكل التوزيع', onchange: (e) => upd(k, 'curve', e.target.value) },
      Object.entries(CURVES).map(([v, t]) => h('option', { value: v, selected: r.curve === v }, t)))),
    h('td', {}, h('button', { class: 'btn sm ghost', title: 'لأعلى', disabled: !k, onclick: () => { const n = [...rows]; [n[k - 1], n[k]] = [n[k], n[k - 1]]; setRows(n); } }, '↑'),
      h('button', { class: 'btn sm ghost', title: 'حذف البند', onclick: () => setRows(rows.filter((_, j) => j !== k)) }, '×')));

  // جدول الأسابيع
  const allW = [...new Set(rows.flatMap((r) => Object.keys(r.weeks || {})))].sort();
  const weeks = [];
  if (allW.length) for (let w = allW[0]; w <= allW[allW.length - 1]; w = addDays(w, 7)) weeks.push(w);
  const rowSum = (r) => Object.values(r.weeks || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const cum = weeks.map((w) => rows.reduce((s, r) => s + (Number(r.weight) || 0) * Object.entries(r.weeks || {}).filter(([k]) => k <= w).reduce((a, [, v]) => a + (Number(v) || 0), 0) / 100, 0));
  const cell = (r, k, w) => {
    const v = r.weeks?.[w];
    const inRange = w >= weekOf(r.start_date || w) && w <= (r.end_date || w);
    return h('td', { class: 'ex-wk' + (v ? ' on' : ''), style: v ? { '--a': Math.min(1, v / 35).toFixed(2) } : {} },
      inRange || v ? h('input', { value: v ?? '', inputmode: 'decimal', 'aria-label': `${r.name} أسبوع ${w}`,
        onchange: (e) => { const n = [...rows]; const wk = { ...(n[k].weeks || {}) }; const x = e.target.value === '' ? 0 : Number(e.target.value); if (x) wk[w] = x; else delete wk[w]; n[k] = { ...n[k], weeks: wk }; setRows(n); } }) : null);
  };
  const okRows = rows.every((r) => Math.abs(rowSum(r) - 100) <= 0.05);
  const approve = h('button', { class: 'btn primary' }, ver ? 'اعتماد إعادة التخطيط' : 'اعتماد الخطة الأساسية');
  approve.disabled = !rows.length || Math.abs(tw - 100) > 0.01 || !okRows;
  approve.onclick = async () => {
    let reason = null;
    if (ver) { reason = await askReason('سبب إعادة التخطيط', { ok: 'اعتماد', note: `هتتعمل النسخة ${ver + 1} من الخطة، والنسخ القديمة تفضل محفوظة للمقارنة.` }); if (!reason) return; }
    approve.disabled = true;
    try {
      const r = await rpc('prg_save_plan', { p_project: pid, p_items: rows.map((x) => ({ id: x.id || null, name: x.name, method: x.method, unit: x.unit, planned_qty: x.planned_qty,
        weight: x.weight, start_date: x.start_date, end_date: x.end_date, curve: x.curve, weeks: x.weeks })), p_reason: reason }, 'core');
      toast(`اتعتمدت الخطة — النسخة ${r.version}`, 'ok'); dirty.v = false; reload();
    } catch (e) { toast(e.message, 'bad'); approve.disabled = false; }
  };
  const saveTpl = async () => {
    const name = await askReason('اسم القالب', { ok: 'حفظ القالب', note: 'هيتحفظ البنود وطريقة قياسها وأوزانها وشكل توزيعها، من غير تواريخ ولا كميات. لو الاسم موجود هيتحدّث.' });
    if (!name) return;
    try { await rpc('prg_save_template', { p_name: name, p_items: rows }, 'core'); toast('اتحفظ القالب', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  };
  put(box,
    h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, h('strong', {}, 'بنود القياس'),
        h('span', { class: 'badge ' + (ver ? 'ok' : 'warn') }, ver ? `الخطة المعتمدة: النسخة ${ver}` : 'لم تُعتمد بعد'),
        dirty.v ? h('span', { class: 'badge warn' }, 'تعديلات لم تُعتمد') : null,
        h('div', { class: 'grow' }), tplSel, h('button', { class: 'btn sm', onclick: applyTpl }, 'تطبيق القالب'),
        rows.length ? h('button', { class: 'btn sm ghost', onclick: saveTpl }, 'حفظ كقالب') : null),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid ex-items' },
        h('thead', {}, h('tr', {}, ['#', 'البند', 'القياس', 'الكمية المخططة', 'الوحدة', 'الوزن %', 'البداية', 'النهاية', 'التوزيع', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.map(tr)),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 5 }, h('button', { class: 'btn sm ghost', onclick: () => setRows([...rows, { name: '', method: 'ton', unit: 'طن', planned_qty: null, weight: 0,
          start_date: start, end_date: addDays(start, 13), curve: 'linear', weeks: distribute(start, addDays(start, 13), 'linear') }]) }, '＋ بند')),
          h('td', { class: 'num ' + (Math.abs(tw - 100) > 0.01 ? 'bad' : 'ok') }, h('b', {}, `${Math.round(tw * 1000) / 1000}%`)), h('td', { colspan: 4, class: 'help' }, Math.abs(tw - 100) > 0.01 ? 'مجموع الأوزان لازم يبقى 100%' : 'مجموع الأوزان 100% ✓'))))),
      h('p', { class: 'help' }, 'طن وكمية: المهندس يكتب منفّذ اليوم. نسبة: يكتب النسبة الكلية لحد النهارده. مرحلة: تم أو لم يتم. تغيير البداية أو النهاية أو التوزيع بيعيد توزيع أسابيع البند.')),
    weeks.length ? h('div', { class: 'card', style: { marginTop: '12px' } },
      h('div', { class: 'toolbar' }, h('strong', {}, 'الخطة الأسبوعية — النسبة المخططة من كل بند'), h('span', { class: 'help' }, 'الأسبوع يبدأ السبت. أي خانة تتعدل، ومجموع كل صف لازم 100.')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid ex-weeks' },
        h('thead', {}, h('tr', {}, h('th', { class: 'ex-stick' }, 'البند'), h('th', {}, 'المجموع'), weeks.map((w) => h('th', { title: w }, weekLabel(w))))),
        h('tbody', {}, rows.map((r, k) => { const s = rowSum(r); return h('tr', {}, h('td', { class: 'ex-stick' }, r.name || '—'),
          h('td', { class: 'num ' + (Math.abs(s - 100) > 0.05 ? 'bad' : '') }, Math.round(s * 10) / 10), weeks.map((w) => cell(r, k, w))); })),
        h('tfoot', {}, h('tr', {}, h('td', { class: 'ex-stick' }, 'المشروع — تراكمي'), h('td', {}), cum.map((c) => h('td', { class: 'num help' }, Math.round(c) + '%'))))))) : null,
    h('div', { class: 'ex-save-bar' }, approve,
      h('span', { class: 'help' }, !okRows ? 'في بند مجموع أسابيعه مش 100.' : ver ? 'الاعتماد بيعمل نسخة جديدة بسبب، والقديمة تفضل للمقارنة.' : 'بعد الاعتماد تقدر تبدأ التقارير اليومية.')));
}

export default {
  code: 'exec',
  title: 'تنفيذ المشاريع',
  tabs: [
    { path: 'projects', title: 'المشاريع', wide: true, subtitle: 'إنجاز كل مشروع قصاد خطته، وآخر تقرير يومي', render: renderOverview },
    { path: 'daily', title: 'التقرير اليومي', visible: () => lvl(2), wide: true, subtitle: 'المهندس: المنفّذ لكل بند · المشرف: العمالة والمعدات · والمعوقات والملاحظات', render: renderDaily },
    { path: 'dashboard', title: 'لوحة الإنجاز', wide: true, subtitle: 'الفعلي قصاد المخطط، والمتأخر، والعمالة والمعدات', render: renderDashboard },
    { path: 'plan', title: 'البنود والخطة', visible: () => lvl(3), wide: true, subtitle: 'بنود القياس بأوزانها والخطة الأسبوعية — كل اعتماد نسخة جديدة', render: renderPlan },
  ],
};

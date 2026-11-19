// قسم تنفيذ المشاريع — تقدّم الأعمال (المرحلة الأولى)
//   بنود القياس لكل مشروع (طن / كمية / نسبة / مرحلة) بأوزانها ← خطة أسبوعية (الأسبوع يبدأ السبت) ← تقرير يومي ← لوحة إنجاز.
//   الصلاحيات (exec): 1 مشاهدة، 2 التقرير اليومي، 3 البنود والخطة. المشاريع الظاهرة = مشاريع المستخدم.
//   كل الحسابات والتحقق في قاعدة البيانات (037): الواجهة تعرض وتجمع المدخلات فقط، إلا توزيع الخطة المقترح (قابل للتعديل).
import { core, rpc } from '../../shared/sb.js';
import { h, fmt, modal, toast, store, askReason, confirmDialog } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { combo } from '../../shared/combo.js';
import { multiLine, barChart, hbars, legend, PALETTE } from '../../shared/charts.js';

const METHODS = { qty: 'كمية تراكمية', pct: 'نسبة', stage: 'مرحلة' };
const isQty = (m) => m === 'qty' || m === 'ton';
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
  const units = [...form.units];
  const ins = {};
  // 1) المنفّذ: البنود الشغالة حوالين اليوم (أسبوع قبل وبعد) + اللي عليها قيمة، والباقي «＋ بند من الخطة»
  const near = (it) => it.start_date <= addDays(day, 7) && it.end_date >= addDays(day, -7) && Number(stItem(it.id).actual_pct || 0) < 100;
  const shown = new Set(form.items.filter((it) => near(it) || qtyOf(it.id)).map((it) => it.id));
  const itemsBox = h('div');
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
    const doneTxt = it.method === 'pct' ? `الإنجاز ${pct(s.actual_pct)} — اكتب النسبة الكلية لحد النهارده`
      : it.method === 'stage' ? (Number(s.actual_pct) >= 100 ? 'تم' : 'لم يتم بعد')
      : `${num(s.done_qty, 1)} / ${num(it.planned_qty, 0)} ${it.unit || ''} · ${pct(s.actual_pct)}`;
    return h('div', { class: 'ex-item' },
      h('div', { class: 'ex-item-row' }, h('label', { for: 'q-' + it.id }, it.name),
        h('div', { class: 'ex-item-in' }, input, h('span', { class: 'help' }, it.method === 'stage' ? 'تم' : it.method === 'pct' ? '%' : (it.unit || '')))),
      h('div', { class: 'ex-item-prog' }, h('span', { class: 'ex-mini' }, h('i', { style: { width: Math.min(100, s.actual_pct || 0) + '%' } })), h('small', { class: 'help' }, doneTxt)));
  };
  const drawItems = () => {
    const hidden = form.items.filter((it) => !shown.has(it.id));
    const pick = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'بند من الخطة' }, h('option', { value: '' }, '＋ بند من الخطة…'), hidden.map((it) => h('option', { value: it.id }, it.name)));
    pick.onchange = () => { if (pick.value) { shown.add(pick.value); drawItems(); } };
    put(itemsBox, form.items.filter((it) => shown.has(it.id)).map(itemRow),
      !shown.size ? h('div', { class: 'help' }, 'مفيش بنود شغالة الأيام دي — اختار من الخطة.') : null,
      editable && hidden.length ? pick : null);
  };
  drawItems();
  // أعمال إضافية خارج الخطة
  const extraRows = []; const extraBox = h('div', { class: 'ex-rows' });
  const unitSel = (val, onAdd) => {
    const s = h('select', { class: 'input', 'aria-label': 'الوحدة', disabled: !editable }, h('option', { value: '' }, '—'),
      [...new Set([...units, ...(val ? [val] : [])])].map((u) => h('option', { value: u, selected: u === val }, u)), h('option', { value: '__new' }, '＋ وحدة جديدة…'));
    s.onchange = async () => {
      if (s.value !== '__new') return;
      const name = await askReason('وحدة جديدة', { ok: 'إضافة', note: 'هتتضاف لقايمة الوحدات للكل.' });
      if (!name) { s.value = ''; return; }
      try { const r = await rpc('prg_add_list_item', { p_kind: 'unit', p_name: name }, 'core'); if (!units.includes(r.name)) units.push(r.name);
        s.insertBefore(h('option', { value: r.name }, r.name), s.lastChild); s.value = r.name; onAdd?.(r.name); } catch (e) { toast(e.message, 'bad'); s.value = ''; }
    };
    return s;
  };
  const addExtra = (v = {}) => {
    const d = h('input', { class: 'input', value: v.desc || '', placeholder: 'وصف الشغل', disabled: !editable, 'aria-label': 'وصف العمل الإضافي' });
    const q = h('input', { class: 'input ex-qty', type: 'number', min: 0, step: 'any', value: v.qty ?? '', placeholder: 'الكمية', disabled: !editable, 'aria-label': 'الكمية' });
    const u = unitSel(v.unit);
    const rec = { d, q, u };
    const row = h('div', { class: 'ex-extra-row' }, d, q, u, editable ? h('button', { class: 'btn sm ghost', 'aria-label': 'حذف', onclick: () => { row.remove(); extraRows.splice(extraRows.indexOf(rec), 1); } }, '×') : null);
    extraRows.push(rec); extraBox.append(row);
  };
  (rep?.extra || []).forEach(addExtra);
  // 2) العمالة: صفوف (المهنة + العدد)
  const trades = [...form.trades];
  const crewRows = []; const crewBox = h('div', { class: 'ex-rows' });
  const crewTotal = h('b');
  const sumCrew = () => { crewTotal.textContent = crewRows.reduce((s, r) => s + (Number(r.n.value) || 0), 0); };
  const tradeSel = (val) => {
    const s = h('select', { class: 'input', 'aria-label': 'المهنة', disabled: !editable }, h('option', { value: '' }, 'اختر المهنة'),
      trades.map((t) => h('option', { value: t.id, selected: t.id === val }, t.name)), h('option', { value: '__new' }, '＋ مهنة جديدة…'));
    s.onchange = async () => {
      if (s.value !== '__new') return;
      const name = await askReason('مهنة جديدة', { ok: 'إضافة', note: 'هتتضاف لقايمة المهن للكل.' });
      if (!name) { s.value = ''; return; }
      try { const r = await rpc('prg_add_list_item', { p_kind: 'trade', p_name: name }, 'core'); if (!trades.some((t) => t.id === r.id)) trades.push(r);
        crewRows.forEach((x) => { if (x.t !== s && ![...x.t.options].some((o) => o.value === r.id)) x.t.insertBefore(h('option', { value: r.id }, r.name), x.t.lastChild); });
        if (![...s.options].some((o) => o.value === r.id)) s.insertBefore(h('option', { value: r.id }, r.name), s.lastChild);
        s.value = r.id; } catch (e) { toast(e.message, 'bad'); s.value = ''; }
    };
    return s;
  };
  const addCrew = (v = {}) => {
    const t = tradeSel(v.trade_id);
    const n = h('input', { class: 'input ex-qty', type: 'number', min: 0, step: 1, inputmode: 'numeric', value: v.count ?? '', placeholder: 'العدد', disabled: !editable, 'aria-label': 'العدد' });
    n.addEventListener('input', sumCrew);
    const rec = { t, n };
    const row = h('div', { class: 'ex-crew-row' }, t, n, editable ? h('button', { class: 'btn sm ghost', 'aria-label': 'حذف', onclick: () => { row.remove(); crewRows.splice(crewRows.indexOf(rec), 1); sumCrew(); } }, '×') : null);
    crewRows.push(rec); crewBox.append(row);
  };
  (rep?.crew?.length ? rep.crew : (editable ? [{}] : [])).forEach(addCrew); sumCrew();
  // 3) المعدات: من السجل أو باسم حر (مؤجرة يومي مثلًا)
  const eqOpts = form.equipment.map((e) => ({ id: e.id, code: e.code, name: e.name, label: `${e.code} — ${e.name}` }));
  const eqRows = []; const eqList = h('div', { class: 'ex-rows' });
  const addEq = (v = {}, free = false) => {
    const isFree = free || (!v.equipment_id && v.name);
    const c = isFree ? null : combo({ options: eqOpts, listKey: 'exec-eq', value: v.equipment_id || null, placeholder: 'اختر المعدة', disabled: !editable });
    const nm = isFree ? h('input', { class: 'input', value: v.name || '', placeholder: 'اسم المعدة (مش في السجل)', disabled: !editable, 'aria-label': 'اسم المعدة' }) : null;
    const hrs = h('input', { class: 'input ex-qty', type: 'number', min: 0, max: 24, step: 0.5, value: v.hours ?? '', placeholder: 'ساعات', disabled: !editable, 'aria-label': 'الساعات' });
    const rec = { c, nm, hrs };
    const row = h('div', { class: 'ex-eq-row' }, c ? c.el : nm, hrs,
      editable ? h('button', { class: 'btn sm ghost', 'aria-label': 'حذف', onclick: () => { row.remove(); eqRows.splice(eqRows.indexOf(rec), 1); } }, '×') : null);
    eqRows.push(rec); eqList.append(row);
  };
  (rep?.equipment || []).forEach((v) => addEq(v));
  // 4) المعوقات
  const obs = new Set(rep?.obstacles || []);
  const chip = (o) => {
    const b = h('button', { type: 'button', class: 'ex-chip' + (obs.has(o.id) ? ' on' : ''), disabled: !editable, 'aria-pressed': String(obs.has(o.id)),
      onclick: () => { obs.has(o.id) ? obs.delete(o.id) : obs.add(o.id); b.classList.toggle('on'); b.setAttribute('aria-pressed', String(obs.has(o.id))); } }, o.name);
    return b;
  };
  const chips = h('div', { class: 'ex-chips' }, form.obstacles.map(chip));
  if (editable) chips.append(h('button', { type: 'button', class: 'ex-chip add', onclick: async () => {
    const name = await askReason('معوّق جديد', { ok: 'إضافة', note: 'هيتضاف لقايمة المعوقات للكل.' });
    if (!name) return;
    try { const r = await rpc('prg_add_list_item', { p_kind: 'site_obstacle', p_name: name }, 'core'); obs.add(r.id); const b = chip(r); b.classList.add('on'); chips.insertBefore(b, chips.lastChild); }
    catch (e) { toast(e.message, 'bad'); }
  } }, '＋ معوّق'));
  const notes = h('textarea', { class: 'input', id: 'exec-notes', rows: 3, disabled: !editable, placeholder: 'اللي اتعمل، والمشاكل، والمطلوب بكرة…' }, rep?.notes || '');
  const save = h('button', { class: 'btn primary ex-save', disabled: !editable }, rep ? 'حفظ التعديل' : 'حفظ التقرير');
  save.onclick = async () => {
    const payload = {
      qty: form.items.filter((it) => shown.has(it.id) && ins[it.id]).map((it) => ({ item_id: it.id, value: ins[it.id]() })).filter((x) => x.value !== null && x.value !== undefined),
      extra: extraRows.map((r) => ({ desc: r.d.value, qty: r.q.value === '' ? null : Number(r.q.value), unit: r.u.value === '__new' ? '' : r.u.value })).filter((x) => x.desc.trim()),
      crew: crewRows.map((r) => ({ trade_id: r.t.value, count: Number(r.n.value) || 0 })).filter((x) => x.trade_id && x.trade_id !== '__new' && x.count > 0),
      equipment: eqRows.map((r) => (r.c ? (r.c.resolve?.(), { equipment_id: r.c.id, hours: Number(r.hrs.value) || 0 }) : { name: r.nm.value, hours: Number(r.hrs.value) || 0 }))
        .filter((x) => x.equipment_id || (x.name || '').trim()),
      obstacles: [...obs], notes: notes.value,
    };
    save.disabled = true;
    try { const id = await rpc('prg_save_report', { p_project: pid, p_date: day, p_data: payload }, 'core'); toast('اتحفظ التقرير', 'ok'); await reload(); reportDialog(id); }
    catch (e) { toast(e.message, 'bad'); save.disabled = false; }
  };
  const sec = (title, who, ...kids) => h('section', { class: 'card ex-sec' }, h('div', { class: 'ex-sec-head' }, h('b', {}, title), who ? h('small', { class: 'help' }, who) : null), ...kids);
  const addBtn = (t, fn) => (editable ? h('button', { class: 'btn sm ghost', onclick: fn }, t) : null);
  put(box,
    !editable ? h('div', { class: 'notice warn' }, lvl(2) ? 'التقرير ده اتقفل (بيتعدل لحد آخر اليوم التالي لتاريخه). مدير المشاريع بس يقدر يعدّله.' : 'عرض فقط.') : null,
    rep ? h('div', { class: 'toolbar', style: { marginBottom: '8px' } }, h('span', { class: 'help' }, `اتعمل ${fmt.datetime(rep.created_at)} · آخر تعديل ${fmt.datetime(rep.updated_at)}`),
      h('button', { class: 'btn sm', onclick: () => reportDialog(rep.id) }, 'عرض / PDF / سجل التعديلات')) : null,
    h('div', { class: 'ex-daily' },
      h('div', { class: 'ex-col' },
        sec('المنفّذ في اليوم', 'المهندس', itemsBox),
        sec('أعمال إضافية خارج الخطة', 'بتتسجل وتتطبع، وما بتدخلش نسبة الإنجاز', extraBox, addBtn('＋ عمل إضافي', () => addExtra()))),
      h('div', { class: 'ex-col' },
        sec('العمالة في الموقع', 'المشرف', crewBox, addBtn('＋ مهنة', () => addCrew()), h('div', { class: 'help' }, 'الإجمالي: ', crewTotal)),
        sec('المعدات في الموقع', 'المشرف', eqList, h('div', { class: 'toolbar' }, addBtn('＋ معدة من السجل', () => addEq()), addBtn('＋ معدة باسم حر', () => addEq({}, true)))),
        sec('المعوقات والملاحظات', null, chips, h('label', { for: 'exec-notes', class: 'help' }, 'ملاحظات'), notes))),
    editable ? h('div', { class: 'ex-save-bar' }, save,
      h('span', { class: 'help' }, lvl(3) ? 'مدير المشاريع يقدر يعدّل أي يوم.' : `يتعدل لحد آخر يوم ${addDays(day, 1)}، وبعدها يتقفل.`)) : null);
}

// ---------------------------------------------------------------------
// عرض تقرير يومي: للطباعة / PDF، وسجل التعديلات
// ---------------------------------------------------------------------
export async function reportDialog(id) {
  const m = modal({ title: 'التقرير اليومي', size: 'wide' });
  m.body.append(h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  let r;
  try { r = await rpc('prg_report_full', { p_id: id }, 'core'); } catch (e) { m.body.replaceChildren(h('div', { class: 'notice bad' }, e.message)); return; }
  const title = `التقرير اليومي — ${r.project.code} ${r.project.name} — ${fmt.date(r.date)}`;
  m.el.querySelector('.modal-head h2').textContent = title;
  const tbl = (head, rows, empty) => h('table', { class: 'grid report' }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: head.length, class: 'empty' }, empty || '—'))));
  const content = h('div', { class: 'ex-report' },
    h('div', { class: 'ex-rep-meta' },
      h('div', {}, h('small', { class: 'help' }, 'المشروع'), h('b', {}, `${r.project.code} — ${r.project.name}`)),
      h('div', {}, h('small', { class: 'help' }, 'اليوم'), h('b', {}, fmt.date(r.date))),
      h('div', {}, h('small', { class: 'help' }, 'إنجاز المشروع حتى اليوم'), h('b', {}, `${pct(r.actual)} (المخطط ${pct(r.planned)})`))),
    h('h4', {}, 'المنفّذ في اليوم'),
    tbl(['البند', 'المنفّذ اليوم', 'الإجمالي حتى اليوم', 'إنجاز البند', 'ملاحظة'], r.qty.map((q) => h('tr', { style: { cursor: 'default' } }, h('td', {}, q.name),
      h('td', { class: 'num' }, q.method === 'stage' ? (Number(q.value) === 100 ? 'تم' : 'لم يتم') : q.method === 'pct' ? pct(q.value) : `${num(q.value, 2)} ${q.unit || ''}`),
      h('td', { class: 'num' }, q.method === 'qty' || q.method === 'ton' ? `${num(q.done_qty, 1)} / ${num(q.planned_qty, 0)} ${q.unit || ''}` : '—'),
      h('td', { class: 'num' }, pct(q.actual_pct)), h('td', {}, q.note || ''))), 'لم يُسجَّل منفّذ'),
    r.extra.length ? [h('h4', {}, 'أعمال إضافية خارج الخطة'), tbl(['الوصف', 'الكمية', 'الوحدة'], r.extra.map((x) => h('tr', { style: { cursor: 'default' } }, h('td', {}, x.desc), h('td', { class: 'num' }, x.qty ?? ''), h('td', {}, x.unit || ''))))] : null,
    h('div', { class: 'ex-two-print' },
      h('div', {}, h('h4', {}, `العمالة (${r.crew.reduce((s, c) => s + c.count, 0)})`), tbl(['المهنة', 'العدد'], r.crew.map((c) => h('tr', { style: { cursor: 'default' } }, h('td', {}, c.name), h('td', { class: 'num' }, c.count))))),
      h('div', {}, h('h4', {}, 'المعدات'), tbl(['المعدة', 'الساعات'], r.equipment.map((e) => h('tr', { style: { cursor: 'default' } }, h('td', {}, e.name), h('td', { class: 'num' }, num(e.hours, 1))))))),
    h('h4', {}, 'المعوقات والملاحظات'),
    h('p', {}, r.obstacles.length ? r.obstacles.join('، ') : 'لا معوقات'),
    r.notes ? h('p', { style: { whiteSpace: 'pre-wrap' } }, r.notes) : null,
    h('div', { class: 'ex-rep-who' },
      h('span', {}, `أدخل المنفّذ: ${r.qty_by || '—'}`), h('span', {}, `أدخل العمالة والمعدات: ${r.crew_by || '—'}`),
      h('span', {}, `أنشأه: ${r.created_by || '—'} — ${fmt.datetime(r.created_at)}`), h('span', {}, `آخر تعديل: ${r.updated_by || '—'} — ${fmt.datetime(r.updated_at)}`)));
  const histBox = h('div');
  m.body.replaceChildren(content, h('details', { class: 'no-print', style: { marginTop: '14px' }, ontoggle: (e) => { if (e.target.open && !histBox.childNodes.length) loadHistory(id, histBox); } },
    h('summary', {}, 'سجل التعديلات'), histBox));
  const { printReport } = await import('../accounting/reports.js');
  m.foot.append(
    h('button', { class: 'btn primary', onclick: () => printReport(content, { title: 'التقرير اليومي للموقع', company: r.project.company_id, period: `${r.project.code} — ${r.project.name} — ${fmt.date(r.date)}`, sign: true }) }, 'طباعة / PDF'),
    r.editable && lvl(2) ? h('button', { class: 'btn', onclick: () => { setProject(r.project_id); store.set('exec.date', r.date); m.close(); location.hash = '#/exec/daily'; if (location.hash === '#/exec/daily') window.dispatchEvent(new HashChangeEvent('hashchange')); } }, 'تعديل') : null,
    h('button', { class: 'btn', onclick: m.close }, 'إغلاق'));
}

// مقارنة نسخ التقرير: إيه اتغير في كل تعديل
async function loadHistory(id, box) {
  put(box, h('div', { class: 'help' }, 'جارٍ التحميل…'));
  let hist, form;
  try {
    hist = await rpc('prg_report_history', { p_id: id }, 'core');
    const pid = (await rpc('prg_report_full', { p_id: id }, 'core')).project_id;
    form = await rpc('prg_form', { p_project: pid }, 'core');
  } catch (e) { put(box, h('div', { class: 'notice bad' }, e.message)); return; }
  const nameOf = (list, id2) => (list.find((x) => x.id === id2) || {}).name || '؟';
  const itemName = (id2) => nameOf(form.items, id2);
  const diff = (a, b) => {
    const out = [];
    const mapQ = (d) => Object.fromEntries((d?.qty || []).map((q) => [q.item_id, q.value]));
    const qa = mapQ(a), qb = mapQ(b);
    for (const k of new Set([...Object.keys(qa), ...Object.keys(qb)])) if (qa[k] !== qb[k]) out.push(`${itemName(k)}: ${qa[k] ?? '—'} ← ${qb[k] ?? '—'}`);
    const mapC = (d) => Object.fromEntries((d?.crew || []).map((c) => [c.trade_id, c.count]));
    const ca = mapC(a), cb = mapC(b);
    for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) if (ca[k] !== cb[k]) out.push(`عمالة ${nameOf(form.trades, k)}: ${ca[k] ?? 0} ← ${cb[k] ?? 0}`);
    const eqs = (d) => (d?.equipment || []).map((e) => `${e.equipment_id ? nameOf(form.equipment, e.equipment_id) : e.name} ${e.hours}س`).sort().join('، ');
    if (eqs(a) !== eqs(b)) out.push(`المعدات: ${eqs(a) || '—'} ← ${eqs(b) || '—'}`);
    const ob = (d) => (d?.obstacles || []).map((x) => nameOf(form.obstacles, x)).sort().join('، ');
    if (ob(a) !== ob(b)) out.push(`المعوقات: ${ob(a) || '—'} ← ${ob(b) || '—'}`);
    const ex = (d) => (d?.extra || []).map((x) => `${x.desc} ${x.qty ?? ''}${x.unit ? ' ' + x.unit : ''}`).join('، ');
    if (ex(a) !== ex(b)) out.push(`خارج الخطة: ${ex(a) || '—'} ← ${ex(b) || '—'}`);
    if ((a?.notes || '') !== (b?.notes || '')) out.push(`الملاحظات: «${a?.notes || ''}» ← «${b?.notes || ''}»`);
    return out;
  };
  put(box, h('ol', { class: 'ex-hist' }, hist.map((v, i) => {
    const ch = i ? diff(hist[i - 1].data, v.data) : [];
    return h('li', {}, h('b', {}, i ? 'تعديل' : 'إنشاء'), ` — ${v.by || '—'} — ${fmt.datetime(v.at)}`,
      i ? (ch.length ? h('ul', {}, ch.map((c) => h('li', {}, c))) : h('div', { class: 'help' }, 'بدون تغيير في المحتوى')) : null);
  })), h('p', { class: 'help' }, 'القيمة القديمة ← الجديدة.'));
}

// جدول التقارير (سجل التقارير ولوحة الإنجاز)
function reportsTable(rows, { project = true } = {}) {
  const head = [...(project ? ['المشروع'] : []), 'اليوم', 'المنفّذ', 'العمال', 'المعوقات', 'الملاحظات', 'أدخل المنفّذ', 'أدخل العمالة', 'آخر تعديل', 'التعديلات', ''];
  return h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
    h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.length ? rows.map((r) => h('tr', { onclick: () => reportDialog(r.id) },
      project ? h('td', {}, r.project) : null, h('td', {}, fmt.date(r.date)),
      h('td', { class: 'num' }, `${r.items} بند${r.extra ? ` + ${r.extra} إضافي` : ''}`), h('td', { class: 'num' }, r.crew),
      h('td', {}, (r.obstacles || []).join('، ')), h('td', { style: { whiteSpace: 'normal', maxWidth: '320px' } }, r.notes || ''),
      h('td', {}, r.qty_by || ''), h('td', {}, r.crew_by || ''),
      h('td', { class: 'help' }, `${r.updated_by || ''} ${fmt.datetime(r.updated_at)}`),
      h('td', { class: 'num' }, r.edits ? h('span', { class: 'badge warn' }, r.edits) : '0'),
      h('td', {}, h('span', { class: 'badge ' + (r.editable ? 'ok' : '') }, r.editable ? 'مفتوح' : 'مقفول')))) :
      h('tr', {}, h('td', { colspan: head.length, class: 'empty' }, 'لا تقارير في الفترة')))));
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
    let st, series, daily, res, plans, reps;
    try {
      [st, series, daily, res, plans, reps] = await Promise.all([
        rpc('prg_status', { p_project: pid, p_to: today() }, 'core'), rpc('prg_series', { p_project: pid }, 'core'),
        rpc('prg_daily', { p_project: pid, p_from: from, p_to: today() }, 'core'), rpc('prg_resources', { p_project: pid, p_from: from, p_to: today() }, 'core'),
        core.from('prg_plans').select('version, reason, created_at').eq('project_id', pid).eq('status', 'active').order('version'),
        rpc('prg_reports_list', { p_project: pid, p_from: from, p_to: today() }, 'core')]);
    } catch (e) { put(body, h('div', { class: 'notice bad' }, e.message)); return; }
    drawDash(body, p, st, series, daily, res, plans.data || [], reps);
  };
  await projectBar(bar, (id, p) => load(id, p), { onlySetUp: true });
  if (!bar.querySelector('select').value) put(body, h('div', { class: 'notice' }, 'مفيش مشروع ليه خطة معتمدة لسه.'));
}

function drawDash(box, p, st, series, daily, res, plans, reps) {
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
  const tons = st.items.filter((i) => isQty(i.method) && /^طن/.test(i.unit || ''));
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
            h('td', { class: 'num' }, isQty(i.method) ? `${num(i.done_qty, 1)} / ${num(i.planned_qty, 0)} ${i.unit || ''}` : i.method === 'stage' ? (i.actual_pct >= 100 ? 'تم' : '—') : pct(i.actual_pct)),
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
    h('section', { class: 'card dash-card' }, h('header', {}, h('h3', {}, 'التقارير اليومية — آخر 4 أسابيع'), h('small', {}, 'اضغط على التقرير لعرضه وطباعته وسجل تعديلاته')),
      reportsTable(reps, { project: false }),
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
  let items, plans, tpls, units;
  try {
    const [a, b, c] = await Promise.all([
      core.from('prg_items').select('*').eq('project_id', pid).eq('status', 'active').order('sort_no'),
      core.from('prg_plans').select('version, rows, reason, created_at').eq('project_id', pid).eq('status', 'active').order('version', { ascending: false }).limit(1),
      core.from('prg_templates').select('id, name, items').eq('status', 'active').order('name')]);
    for (const r of [a, b, c]) if (r.error) throw new Error(r.error.message);
    items = a.data; plans = b.data; tpls = c.data;
    units = (await rpc('prg_form', { p_project: pid }, 'core')).units;
  } catch (e) { put(body, h('div', { class: 'notice bad' }, e.message)); return; }
  const cur = plans[0];
  // الحالة في المحرر: البنود + أسابيعها من آخر نسخة
  let rows = items.map((i) => ({ ...i, method: isQty(i.method) ? 'qty' : i.method, weeks: (cur?.rows || []).find((r) => r.item_id === i.id)?.weeks || distribute(i.start_date, i.end_date, i.curve) }));
  const dirty = { v: false };
  const ed = h('div');
  const draw = () => drawPlanEditor(ed, { pid, p, rows, cur, tpls, units, dirty, setRows: (r) => { rows = r; dirty.v = true; draw(); }, redraw: draw, reload: () => loadPlan(body, pid, p) });
  put(body, ed); draw();
}

function drawPlanEditor(box, { pid, p, rows, cur, tpls, units, dirty, setRows, redraw, reload }) {
  const unitPick = (val, onSet) => {
    const s = h('select', { class: 'input', 'aria-label': 'الوحدة', style: { minWidth: '90px' } }, h('option', { value: '' }, '—'),
      [...new Set([...units, ...(val ? [val] : [])])].map((u) => h('option', { value: u, selected: u === val }, u)), h('option', { value: '__new' }, '＋ وحدة جديدة…'));
    s.onchange = async () => {
      if (s.value !== '__new') { onSet(s.value); return; }
      const name = await askReason('وحدة جديدة', { ok: 'إضافة', note: 'هتتضاف لقايمة الوحدات للكل (مثلًا: م.ط، نقطة، لوح).' });
      if (!name) { s.value = val || ''; return; }
      try { const r = await rpc('prg_add_list_item', { p_kind: 'unit', p_name: name }, 'core'); if (!units.includes(r.name)) units.push(r.name); onSet(r.name); }
      catch (e) { toast(e.message, 'bad'); s.value = val || ''; }
    };
    return s;
  };
  const ver = cur?.version || 0;
  const start = p?.start || today();
  const tw = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const tplSel = h('select', { class: 'input', style: { width: 'auto' }, id: 'exec-tpl' }, h('option', { value: '' }, 'اختر قالب…'), tpls.map((t) => h('option', { value: t.id }, t.name)));
  const applyTpl = async () => {
    const t = tpls.find((x) => x.id === tplSel.value); if (!t) return;
    if (rows.length && !(await confirmDialog('القالب هيستبدل البنود اللي في الشاشة (قبل الاعتماد). تكمّل؟'))) return;
    const s0 = today(); const e0 = addDays(s0, 13);
    setRows(t.items.map((x) => ({ name: x.name, method: isQty(x.method) ? 'qty' : x.method, unit: x.unit || (x.method === 'ton' ? 'طن' : x.method === 'pct' ? '%' : ''), planned_qty: null, weight: x.weight,
      start_date: s0, end_date: e0, curve: x.curve || 'linear', weeks: distribute(s0, e0, x.curve || 'linear') })));
  };
  const upd = (k, field, v) => {
    const r = { ...rows[k], [field]: v };
    if (['start_date', 'end_date', 'curve'].includes(field) && r.start_date && r.end_date && r.end_date >= r.start_date) r.weeks = distribute(r.start_date, r.end_date, r.curve);
    if (field === 'method') r.unit = v === 'pct' ? '%' : v === 'stage' ? '' : (r.unit === '%' ? '' : r.unit);
    const next = [...rows]; next[k] = r; setRows(next);
  };
  const tr = (r, k) => h('tr', {},
    h('td', { class: 'num' }, k + 1),
    h('td', {}, h('input', { class: 'input', value: r.name || '', 'aria-label': 'البند', onchange: (e) => upd(k, 'name', e.target.value) })),
    h('td', {}, h('select', { class: 'input', 'aria-label': 'طريقة الحساب', onchange: (e) => upd(k, 'method', e.target.value) },
      Object.entries(METHODS).map(([v, t]) => h('option', { value: v, selected: (isQty(r.method) ? 'qty' : r.method) === v }, t)))),
    h('td', {}, isQty(r.method) ? h('input', { class: 'input ex-num', type: 'number', min: 0, step: 'any', value: r.planned_qty ?? '', 'aria-label': 'الكمية', onchange: (e) => upd(k, 'planned_qty', e.target.value === '' ? null : Number(e.target.value)) }) : h('span', { class: 'help' }, '—')),
    h('td', {}, isQty(r.method) ? unitPick(r.unit, (v) => upd(k, 'unit', v)) : h('span', { class: 'help' }, r.method === 'stage' ? 'تم/لم يتم' : '%')),
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
        h('thead', {}, h('tr', {}, ['#', 'البند', 'طريقة الحساب', 'الكمية المخططة', 'الوحدة', 'الوزن %', 'البداية', 'النهاية', 'التوزيع', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows.map(tr)),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 5 }, h('button', { class: 'btn sm ghost', onclick: () => setRows([...rows, { name: '', method: 'qty', unit: 'طن', planned_qty: null, weight: 0,
          start_date: start, end_date: addDays(start, 13), curve: 'linear', weeks: distribute(start, addDays(start, 13), 'linear') }]) }, '＋ بند')),
          h('td', { class: 'num ' + (Math.abs(tw - 100) > 0.01 ? 'bad' : 'ok') }, h('b', {}, `${Math.round(tw * 1000) / 1000}%`)), h('td', { colspan: 4, class: 'help' }, Math.abs(tw - 100) > 0.01 ? 'مجموع الأوزان لازم يبقى 100%' : 'مجموع الأوزان 100% ✓'))))),
      h('p', { class: 'help' }, 'كمية تراكمية (بأي وحدة: طن، م²، م.ط، عدد…): المهندس يكتب منفّذ اليوم. نسبة: يكتب النسبة الكلية لحد النهارده. مرحلة: تم أو لم يتم. تغيير البداية أو النهاية أو التوزيع بيعيد توزيع أسابيع البند.')),
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

// ---------------------------------------------------------------------
// سجل التقارير: كل التقارير المحفوظة لكل المشاريع أو لمشروع
// ---------------------------------------------------------------------
async function renderReports(el) {
  const bar = h('div', { class: 'toolbar' });
  const out = h('div');
  const prj = h('select', { class: 'input', style: { width: 'auto', minWidth: '240px' }, id: 'rep-prj' }, h('option', { value: '' }, 'كل المشاريع'));
  const from = h('input', { class: 'input', type: 'date', value: addDays(today(), -30), style: { width: 'auto' }, id: 'rep-from' });
  const to = h('input', { class: 'input', type: 'date', value: today(), style: { width: 'auto' }, id: 'rep-to' });
  put(el, h('div', { class: 'card', style: { marginBottom: '12px' } }, bar), out);
  try { (await overview()).filter((p) => p.set_up).forEach((p) => prj.append(h('option', { value: p.id }, `${p.code} — ${p.name}`))); } catch (e) { put(out, h('div', { class: 'notice bad' }, e.message)); return; }
  const load = async () => {
    put(out, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    try {
      const rows = await rpc('prg_reports_list', { p_project: prj.value || null, p_from: from.value, p_to: to.value }, 'core');
      put(out, h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('strong', {}, `${rows.length} تقرير`),
        h('span', { class: 'help' }, 'اضغط على التقرير لعرضه وطباعته PDF وسجل تعديلاته. «مفتوح» = لسه بيتعدل.')), reportsTable(rows)));
    } catch (e) { put(out, h('div', { class: 'notice bad' }, e.message)); }
  };
  [prj, from, to].forEach((x) => { x.onchange = load; });
  put(bar, h('label', { for: 'rep-prj', class: 'help' }, 'المشروع'), prj, h('label', { for: 'rep-from', class: 'help' }, 'من'), from, h('label', { for: 'rep-to', class: 'help' }, 'إلى'), to);
  load();
}

// ---------------------------------------------------------------------
// التقرير الأسبوعي: يتعمل لوحده من التقارير اليومية
// ---------------------------------------------------------------------
async function renderWeekly(el) {
  const bar = h('div', { class: 'toolbar' });
  const out = h('div');
  const wk = h('input', { class: 'input', type: 'date', id: 'wk-date', value: store.get('exec.week') || today(), style: { width: 'auto' } });
  put(el, h('div', { class: 'card', style: { marginBottom: '12px' } }, bar), out);
  let pid = null;
  const load = async () => {
    store.set('exec.week', wk.value);
    if (!pid) return;
    put(out, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
    let w;
    try { w = await rpc('prg_weekly', { p_project: pid, p_week: wk.value }, 'core'); } catch (e) { put(out, h('div', { class: 'notice bad' }, e.message)); return; }
    drawWeekly(out, w);
  };
  wk.onchange = load;
  await projectBar(bar, (id) => { pid = id; load(); }, { onlySetUp: true });
  bar.append(h('label', { for: 'wk-date', class: 'help' }, 'أي يوم في الأسبوع'), wk,
    h('button', { class: 'btn sm', onclick: () => { wk.value = addDays(wk.value, -7); load(); } }, '← الأسبوع السابق'),
    h('button', { class: 'btn sm', onclick: () => { wk.value = addDays(wk.value, 7); load(); } }, 'الأسبوع التالي →'));
  if (!pid) put(out, h('div', { class: 'notice' }, 'مفيش مشروع ليه خطة معتمدة لسه.'));
}

function drawWeekly(out, w) {
  const gain = Number(w.actual_end) - Number(w.actual_start);
  const tbl = (head, rows, empty) => h('table', { class: 'grid report' }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: head.length, class: 'empty' }, empty || '—'))));
  const cell = (t, c = '') => h('td', { class: 'num ' + c }, t);
  const content = h('div', { class: 'ex-report' },
    h('div', { class: 'ex-rep-meta' },
      h('div', {}, h('small', { class: 'help' }, 'الأسبوع'), h('b', {}, `${fmt.date(w.week)} ← ${fmt.date(w.week_end)}`)),
      h('div', {}, h('small', { class: 'help' }, 'الإنجاز في الأسبوع'), h('b', {}, `+${gain.toFixed(1)}% (المخطط +${Number(w.planned_week).toFixed(1)}%)`)),
      h('div', {}, h('small', { class: 'help' }, 'الإنجاز التراكمي'), h('b', { class: Number(w.actual_end) < Number(w.planned_end) - 0.05 ? 'bad' : '' }, `${pct(w.actual_end)} (المخطط ${pct(w.planned_end)})`))),
    h('h4', {}, 'البنود'),
    tbl(['البند', 'الوزن', 'منفّذ الأسبوع', 'مخطط الأسبوع', 'التراكمي الفعلي', 'التراكمي المخطط'], w.items.map((i) => {
      const late = Number(i.cum_actual_pct) < Number(i.cum_planned_pct) - 0.5;
      return h('tr', { style: { cursor: 'default' } }, h('td', {}, i.name), cell(Number(i.weight) + '%'),
        cell(isQty(i.method) ? `${num(i.week_done_qty, 1)} ${i.unit || ''}` : `+${Number(i.week_actual_pct).toFixed(1)}%`),
        cell(isQty(i.method) ? `${num(i.week_planned_qty, 1)} ${i.unit || ''}` : `${Number(i.week_planned_pct).toFixed(1)}%`),
        cell(pct(i.cum_actual_pct), late ? 'bad' : ''), cell(pct(i.cum_planned_pct)));
    })),
    w.extra.length ? [h('h4', {}, 'أعمال إضافية خارج الخطة'), tbl(['اليوم', 'الوصف', 'الكمية'], w.extra.map((x) => h('tr', { style: { cursor: 'default' } }, h('td', {}, fmt.date(x.date)), h('td', {}, x.desc), cell(`${x.qty ?? ''} ${x.unit || ''}`))))] : null,
    h('h4', {}, 'الأيام'),
    tbl(['اليوم', 'العمال', 'ساعات المعدات', 'المعوقات', 'الملاحظات'], w.days.map((d) => h('tr', { onclick: () => reportDialog(d.id) },
      h('td', {}, fmt.date(d.date)), cell(d.crew), cell(num(d.hours, 1)), h('td', {}, (d.obstacles || []).join('، ')), h('td', { style: { whiteSpace: 'normal' } }, d.notes || ''))), 'لا تقارير في الأسبوع'),
    h('div', { class: 'ex-two-print' },
      h('div', {}, h('h4', {}, 'العمالة (يوم-عامل)'), tbl(['المهنة', 'يوم-عامل'], (w.resources.trades || []).map((t) => h('tr', { style: { cursor: 'default' } }, h('td', {}, t.name), cell(t.man_days))))),
      h('div', {}, h('h4', {}, 'المعدات'), tbl(['المعدة', 'الساعات', 'الأيام'], (w.resources.equipment || []).map((e) => h('tr', { style: { cursor: 'default' } }, h('td', {}, e.name), cell(num(e.hours, 1)), cell(e.days)))))),
    (w.resources.obstacles || []).length ? h('p', {}, 'المعوقات: ', w.resources.obstacles.map((o) => `${o.name} (${o.days} يوم)`).join('، ')) : null);
  put(out, h('div', { class: 'card' }, h('div', { class: 'toolbar no-print' }, h('div', { class: 'grow' }),
    h('button', { class: 'btn primary', onclick: async () => { const { printReport } = await import('../accounting/reports.js');
      printReport(content, { title: 'التقرير الأسبوعي للموقع', company: w.project.company_id, period: `${w.project.code} — ${w.project.name} — ${fmt.date(w.week)} ← ${fmt.date(w.week_end)}`, sign: true }); } }, 'طباعة / PDF')),
    content));
}

// ---------------------------------------------------------------------
// مقارنة المشاريع
// ---------------------------------------------------------------------
async function renderCompare(el) {
  put(el, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  let list;
  try { list = (await overview()).filter((p) => p.set_up); } catch (e) { put(el, h('div', { class: 'notice bad' }, e.message)); return; }
  if (!list.length) { put(el, h('div', { class: 'notice' }, 'مفيش مشاريع ليها خطة معتمدة.')); return; }
  list.forEach((p) => { p.diff = Number(p.actual) - Number(p.planned); });
  list.sort((a, b) => a.diff - b.diff);
  const go = (p, tab) => { setProject(p.id); location.hash = `#/exec/${tab}`; };
  put(el,
    h('div', { class: 'ex-two' },
      h('section', { class: 'card dash-card' }, h('header', {}, h('h3', {}, 'الفعلي قصاد المخطط'), legend([{ label: 'الفعلي', color: PALETTE[0] }, { label: 'المخطط', color: '#9aa1ab' }])),
        barChart(list.map((p) => ({ label: p.code, values: [Number(p.actual), Number(p.planned)] })), [{ label: 'الفعلي', color: PALETTE[0] }, { label: 'المخطط', color: '#9aa1ab' }], { label: 'مقارنة المشاريع' })),
      h('section', { class: 'card dash-card' }, h('header', {}, h('h3', {}, 'الفرق عن الخطة'), h('small', {}, 'الأحمر = متأخر')),
        hbars(list.map((p) => ({ label: `${p.code} — ${p.name}`, value: Number(p.diff.toFixed(1)), sub: `فعلي ${pct(p.actual)} · مخطط ${pct(p.planned)}`, color: '#1baf7a' })), { max: 15 }))),
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
      h('thead', {}, h('tr', {}, ['المشروع', 'البداية', 'النهاية', 'الفعلي', 'المخطط', 'الفرق', 'آخر تقرير', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map((p) => {
        const stale = !p.last_report || daysBetween(p.last_report, today()) > 2;
        return h('tr', { onclick: () => go(p, 'dashboard') }, h('td', {}, `${p.code} — ${p.name}`), h('td', {}, fmt.date(p.start)), h('td', {}, fmt.date(p.end)),
          h('td', { class: 'num' }, pct(p.actual)), h('td', { class: 'num' }, pct(p.planned)),
          h('td', { class: 'num ' + (p.diff < -0.05 ? 'bad' : 'ok') }, (p.diff >= 0 ? '+' : '') + p.diff.toFixed(1) + '%'),
          h('td', { class: stale ? 'bad' : '' }, p.last_report ? fmt.date(p.last_report) : 'لا يوجد'),
          h('td', {}, h('span', { class: 'help' }, 'اللوحة ←')));
      }))))));
}

// ---------------------------------------------------------------------
// الهندسة: المخططات والاعتمادات
// ---------------------------------------------------------------------
const DSTATES = { draft: ['مسودة', ''], submitted: ['عند الاستشاري', 'warn'], approved: ['معتمد', 'ok'], approved_comments: ['معتمد بملاحظات', 'ok'], rejected: ['مرفوض — يُعاد', 'bad'], for_info: ['للعلم', ''] };
const RSTATES = { open: ['مفتوح', 'warn'], answered: ['تم الرد', 'ok'], closed: ['مغلق', ''] };
const badgeOf = (map, k) => h('span', { class: 'badge ' + (map[k]?.[1] || '') }, map[k]?.[0] || k);
const linkCell = (u) => (u ? h('a', { href: /^https?:\/\//.test(u) ? u : 'https://' + u, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, 'الملف ↗') : '');

async function renderDrawings(el) {
  const bar = h('div', { class: 'toolbar' });
  const out = h('div');
  const fst = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'الحالة' }, h('option', { value: '' }, 'كل الحالات'), Object.entries(DSTATES).map(([k, v]) => h('option', { value: k }, v[0])));
  const q = h('input', { class: 'input', placeholder: 'بحث بالرقم أو العنوان', style: { width: '200px' } });
  put(el, h('div', { class: 'card', style: { marginBottom: '12px' } }, bar), out);
  let pid = null; let rows = [];
  const draw = () => {
    const f = rows.filter((r) => (!fst.value || r.state === fst.value) && (!q.value || `${r.drawing_no} ${r.title}`.includes(q.value)));
    const cnt = (k) => rows.filter((r) => r.state === k).length;
    put(out, h('div', { class: 'dash-tiles' }, ['submitted', 'approved', 'approved_comments', 'rejected'].map((k) => h('div', { class: 'dash-tile', style: { cursor: 'default' } }, h('small', {}, DSTATES[k][0]), h('b', { class: 'dash-big' }, cnt(k))))),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['رقم المخطط', 'العنوان', 'التخصص', 'المراجعة', 'الحالة', 'الإرسال', 'الرد', 'أيام عند الاستشاري', 'تعليق الاستشاري', 'الملف'].map((x) => h('th', {}, x)))),
        h('tbody', {}, f.length ? f.map((r) => h('tr', { onclick: () => drawingDialog(pid, r, refresh) },
          h('td', { class: 'ltr' }, r.drawing_no), h('td', {}, r.title), h('td', {}, r.discipline || ''), h('td', { class: 'ltr' }, 'Rev ' + r.rev), h('td', {}, badgeOf(DSTATES, r.state)),
          h('td', {}, fmt.date(r.submitted_date)), h('td', {}, fmt.date(r.reply_date)),
          h('td', { class: 'num ' + (r.state === 'submitted' && daysBetween(r.submitted_date, today()) > 14 ? 'bad' : '') }, r.state === 'submitted' && r.submitted_date ? daysBetween(r.submitted_date, today()) : ''),
          h('td', { style: { whiteSpace: 'normal', maxWidth: '280px' } }, r.comment || ''), h('td', {}, linkCell(r.link)))) :
          h('tr', {}, h('td', { colspan: 10, class: 'empty' }, 'لا مخططات')))))));
  };
  const refresh = async () => {
    if (!pid) return;
    const { data, error } = await core.from('eng_drawings').select('*').eq('project_id', pid).eq('status', 'active').order('drawing_no');
    if (error) { put(out, h('div', { class: 'notice bad' }, error.message)); return; }
    rows = data; draw();
  };
  [fst].forEach((x) => { x.onchange = draw; }); q.oninput = draw;
  await projectBar(bar, (id) => { pid = id; refresh(); });
  bar.append(fst, q, h('div', { class: 'grow' }), lvl(2) ? h('button', { class: 'btn primary', onclick: () => pid && drawingDialog(pid, null, refresh) }, '＋ مخطط') : null);
}

function drawingDialog(pid, d, done) {
  const can = lvl(2);
  const m = modal({ title: d ? `المخطط ${d.drawing_no}` : 'مخطط جديد', size: 'wide' });
  const v = { drawing_no: d?.drawing_no || '', title: d?.title || '', discipline: d?.discipline || '', rev: d?.rev || '0', state: d?.state || 'draft',
    submitted_date: d?.submitted_date || '', reply_date: d?.reply_date || '', comment: d?.comment || '', link: d?.link || '' };
  const inp = (k, o = {}) => { const i = h(o.tag || 'input', { class: 'input' + (o.ltr ? ' ltr' : ''), type: o.type || 'text', value: v[k], disabled: !can, id: 'dw-' + k, rows: o.rows }); if (o.tag === 'textarea') i.value = v[k]; i.oninput = () => { v[k] = i.value; }; return i; };
  const st = h('select', { class: 'input', disabled: !can, id: 'dw-state' }, Object.entries(DSTATES).map(([k, x]) => h('option', { value: k, selected: k === v.state }, x[0])));
  st.onchange = () => { v.state = st.value; };
  m.body.append(h('div', { class: 'form-grid' },
    F('رقم المخطط', inp('drawing_no', { ltr: true }), { req: true }), F('العنوان', inp('title'), { req: true }),
    F('التخصص', inp('discipline'), { help: 'إنشائي، معماري، تفاصيل، مسقط…' }), F('رقم المراجعة (Rev)', inp('rev', { ltr: true })),
    F('الحالة', st), F('تاريخ الإرسال', inp('submitted_date', { type: 'date' })), F('تاريخ الرد', inp('reply_date', { type: 'date' })),
    F('رابط الملف', inp('link', { ltr: true }), { help: 'رابط درايف أو أي مكان محفوظ فيه الملف' }),
    F('تعليق الاستشاري', inp('comment', { tag: 'textarea', rows: 3 }), { wide: true })),
    d?.history?.length ? h('details', { style: { marginTop: '10px' } }, h('summary', {}, `تاريخ المراجعات (${d.history.length})`),
      h('table', { class: 'grid report' }, h('thead', {}, h('tr', {}, ['Rev', 'الحالة', 'الإرسال', 'الرد', 'التعليق', 'بواسطة', 'الوقت'].map((x) => h('th', {}, x)))),
        h('tbody', {}, d.history.map((x) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'ltr' }, x.rev), h('td', {}, badgeOf(DSTATES, x.state)), h('td', {}, fmt.date(x.submitted_date)),
          h('td', {}, fmt.date(x.reply_date)), h('td', {}, x.comment || ''), h('td', {}, x.by || ''), h('td', {}, fmt.datetime(x.at))))))) : null);
  if (can) m.foot.append(h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try { await rpc('eng_save_drawing', { p_project: pid, p_data: { ...v, id: d?.id || null } }, 'core'); toast('اتحفظ المخطط', 'ok'); m.close(); done(); }
    catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
  } }, 'حفظ'));
  if (d && lvl(3)) m.foot.append(h('button', { class: 'btn ghost', onclick: async () => {
    const reason = await askReason('إلغاء المخطط', { ok: 'إلغاء المخطط' }); if (!reason) return;
    try { await rpc('eng_cancel', { p_kind: 'drawing', p_id: d.id, p_reason: reason }, 'core'); toast('اتلغى', 'ok'); m.close(); done(); } catch (err) { toast(err.message, 'bad'); }
  } }, 'إلغاء المخطط'));
  m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

// ---------------------------------------------------------------------
// الهندسة: الاستفسارات الفنية (RFI)
// ---------------------------------------------------------------------
async function renderRfi(el) {
  const bar = h('div', { class: 'toolbar' });
  const out = h('div');
  const fst = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'الحالة' }, h('option', { value: 'open' }, 'المفتوحة'), h('option', { value: '' }, 'الكل'),
    Object.entries(RSTATES).filter(([k]) => k !== 'open').map(([k, v]) => h('option', { value: k }, v[0])));
  put(el, h('div', { class: 'card', style: { marginBottom: '12px' } }, bar), out);
  let pid = null; let rows = []; let dws = [];
  const draw = () => {
    const f = rows.filter((r) => !fst.value || r.state === fst.value);
    const late = (r) => r.state === 'open' && r.due_date && r.due_date < today();
    put(out, h('div', { class: 'dash-tiles' },
      h('div', { class: 'dash-tile', style: { cursor: 'default' } }, h('small', {}, 'مفتوحة'), h('b', { class: 'dash-big' }, rows.filter((r) => r.state === 'open').length)),
      h('div', { class: 'dash-tile bad', style: { cursor: 'default' } }, h('small', {}, 'متأخر ردها'), h('b', { class: 'dash-big' }, rows.filter(late).length)),
      h('div', { class: 'dash-tile', style: { cursor: 'default' } }, h('small', {}, 'تم الرد / مغلقة'), h('b', { class: 'dash-big' }, rows.filter((r) => r.state !== 'open').length))),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'grid report' },
        h('thead', {}, h('tr', {}, ['الرقم', 'الموضوع', 'المخطط', 'الإرسال', 'مطلوب الرد', 'الحالة', 'الرد', 'الملف'].map((x) => h('th', {}, x)))),
        h('tbody', {}, f.length ? f.map((r) => h('tr', { onclick: () => rfiDialog(pid, r, dws, refresh) },
          h('td', { class: 'ltr' }, r.rfi_no), h('td', {}, r.subject), h('td', { class: 'ltr' }, dws.find((d) => d.id === r.drawing_id)?.drawing_no || ''),
          h('td', {}, fmt.date(r.sent_date)), h('td', { class: late(r) ? 'bad' : '' }, fmt.date(r.due_date), late(r) ? ` (متأخر ${daysBetween(r.due_date, today())} يوم)` : ''),
          h('td', {}, badgeOf(RSTATES, r.state)), h('td', { style: { whiteSpace: 'normal', maxWidth: '300px' } }, r.reply || ''), h('td', {}, linkCell(r.link)))) :
          h('tr', {}, h('td', { colspan: 8, class: 'empty' }, 'لا استفسارات')))))));
  };
  const refresh = async () => {
    if (!pid) return;
    const [a, b] = await Promise.all([core.from('eng_rfis').select('*').eq('project_id', pid).eq('status', 'active').order('rfi_no', { ascending: false }),
      core.from('eng_drawings').select('id, drawing_no, title').eq('project_id', pid).eq('status', 'active').order('drawing_no')]);
    if (a.error || b.error) { put(out, h('div', { class: 'notice bad' }, (a.error || b.error).message)); return; }
    rows = a.data; dws = b.data; draw();
  };
  fst.onchange = draw;
  await projectBar(bar, (id) => { pid = id; refresh(); });
  bar.append(fst, h('div', { class: 'grow' }), lvl(2) ? h('button', { class: 'btn primary', onclick: () => pid && rfiDialog(pid, null, dws, refresh) }, '＋ استفسار') : null);
}

function rfiDialog(pid, r, dws, done) {
  const can = lvl(2);
  const m = modal({ title: r ? `الاستفسار ${r.rfi_no}` : 'استفسار فني جديد', size: 'wide' });
  const v = { subject: r?.subject || '', question: r?.question || '', discipline: r?.discipline || '', drawing_id: r?.drawing_id || '', sent_date: r?.sent_date || today(),
    due_date: r?.due_date || addDays(today(), 7), reply: r?.reply || '', reply_date: r?.reply_date || '', state: r?.state || 'open', link: r?.link || '' };
  const inp = (k, o = {}) => { const i = h(o.tag || 'input', { class: 'input' + (o.ltr ? ' ltr' : ''), type: o.type || 'text', value: v[k], disabled: !can, rows: o.rows }); if (o.tag === 'textarea') i.value = v[k]; i.oninput = () => { v[k] = i.value; }; return i; };
  const dw = h('select', { class: 'input', disabled: !can }, h('option', { value: '' }, '—'), dws.map((d) => h('option', { value: d.id, selected: d.id === v.drawing_id }, `${d.drawing_no} — ${d.title}`)));
  dw.onchange = () => { v.drawing_id = dw.value; };
  const st = h('select', { class: 'input', disabled: !can }, Object.entries(RSTATES).map(([k, x]) => h('option', { value: k, selected: k === v.state }, x[0])));
  st.onchange = () => { v.state = st.value; };
  m.body.append(h('div', { class: 'form-grid' },
    F('الموضوع', inp('subject'), { req: true, wide: true }), F('الاستفسار', inp('question', { tag: 'textarea', rows: 3 }), { wide: true }),
    F('التخصص', inp('discipline')), F('المخطط المرتبط', dw), F('تاريخ الإرسال', inp('sent_date', { type: 'date' })), F('مطلوب الرد قبل', inp('due_date', { type: 'date' })),
    F('الرد', inp('reply', { tag: 'textarea', rows: 3 }), { wide: true }), F('تاريخ الرد', inp('reply_date', { type: 'date' })), F('الحالة', st),
    F('رابط الملف', inp('link', { ltr: true }))),
    r ? h('p', { class: 'help' }, `الرقم ${r.rfi_no} — اتعمل ${fmt.datetime(r.created_at)}`) : h('p', { class: 'help' }, 'الرقم بيتعمل تلقائي (RFI-001، RFI-002…).'));
  if (can) m.foot.append(h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try { await rpc('eng_save_rfi', { p_project: pid, p_data: { ...v, id: r?.id || null } }, 'core'); toast('اتحفظ الاستفسار', 'ok'); m.close(); done(); }
    catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
  } }, 'حفظ'));
  if (r && lvl(3)) m.foot.append(h('button', { class: 'btn ghost', onclick: async () => {
    const reason = await askReason('إلغاء الاستفسار', { ok: 'إلغاء الاستفسار' }); if (!reason) return;
    try { await rpc('eng_cancel', { p_kind: 'rfi', p_id: r.id, p_reason: reason }, 'core'); toast('اتلغى', 'ok'); m.close(); done(); } catch (err) { toast(err.message, 'bad'); }
  } }, 'إلغاء'));
  m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
}

export default {
  code: 'exec',
  title: 'تنفيذ المشاريع',
  tabs: [
    { path: 'projects', title: 'المشاريع', wide: true, subtitle: 'إنجاز كل مشروع قصاد خطته، وآخر تقرير يومي', render: renderOverview },
    { path: 'daily', title: 'التقرير اليومي', group: 'الموقع', visible: () => lvl(2), wide: true, subtitle: 'المهندس: المنفّذ · المشرف: العمالة والمعدات · والمعوقات والملاحظات', render: renderDaily },
    { path: 'reports', title: 'سجل التقارير', group: 'الموقع', wide: true, subtitle: 'كل التقارير المحفوظة: عرض وطباعة PDF وسجل التعديلات', render: renderReports },
    { path: 'weekly', title: 'التقرير الأسبوعي', group: 'الموقع', wide: true, subtitle: 'ملخص الأسبوع قصاد الخطة — جاهز للطباعة', render: renderWeekly },
    { path: 'dashboard', title: 'لوحة الإنجاز', group: 'المتابعة', wide: true, subtitle: 'الفعلي قصاد المخطط، والمتأخر، والعمالة والمعدات', render: renderDashboard },
    { path: 'compare', title: 'مقارنة المشاريع', group: 'المتابعة', wide: true, subtitle: 'كل المشاريع جنب بعض — المتأخر فوق', render: renderCompare },
    { path: 'drawings', title: 'المخططات والاعتمادات', group: 'الهندسة', wide: true, subtitle: 'كل مخطط بمراجعاته وحالته عند الاستشاري', render: renderDrawings },
    { path: 'rfi', title: 'الاستفسارات الفنية', group: 'الهندسة', wide: true, subtitle: 'RFI: المرسل والمطلوب رده والمتأخر', render: renderRfi },
    { path: 'plan', title: 'البنود والخطة', group: 'الإعداد', visible: () => lvl(3), wide: true, subtitle: 'بنود القياس بأوزانها والخطة الأسبوعية — كل اعتماد نسخة جديدة', render: renderPlan },
  ],
};

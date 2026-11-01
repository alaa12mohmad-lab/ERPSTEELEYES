// نقطة البداية: الدخول، الهيكل العام (قائمة جانبية + شريط علوي)، لوحة التحكم، البحث السريع، التنقل
//
// عقد القسم (كل قسم في modules/<code>/index.js يصدّر كائنًا بهذا الشكل):
//   code      كود القسم (نفس core.modules.code)
//   title     الاسم
//   tabs      [{ path, title, subtitle?, group?, wide?, visible?(), render(el) }]
//             group: عنوان المجموعة في القائمة الجانبية، wide: الصفحة بعرض الشاشة كله
//   widgets?  [{ id, title, size: 'sm'|'md'|'lg', visible?(), render(el) }]  بطاقات لوحة التحكم
//   search?   async (text) => [{ label, hint?, icon?, run() }]                نتائج البحث السريع Ctrl+K
//
// إضافة قسم جديد = إنشاء مجلده وإضافته لقائمة MODULES فقط.
import { CONFIG } from './config.js';
import { VERSION } from './shared/version.js';
import { sb } from './shared/sb.js';
import { h, toast, modal, icon, store } from './shared/ui.js';
import { state } from './shared/state.js';
import { MODES, ACCENTS, getTheme, setTheme } from './shared/theme.js';
import { renderLogin, renderMessage, renderChangePassword, renderMfa, changePasswordForm, mfaForm } from './shared/auth.js';
import { mountAssistant } from './shared/assistant.js';
import coreModule from './modules/core/index.js';
import adminModule from './modules/admin/index.js';
import accountingModule from './modules/accounting/index.js';

// كل قسم جديد يُضاف هنا فقط
const MODULES = [accountingModule, coreModule, adminModule];

const root = document.getElementById('app');

async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return renderLogin(root, afterLogin);
  afterLogin();
}

async function afterLogin() {
  root.replaceChildren(h('div', { class: 'boot' }, 'جارٍ التحميل…'));
  let p;
  try { p = await state.loadProfile(); } catch (e) {
    return renderMessage(root, 'تعذر التحميل', e.message);
  }
  if (!p.registered) return renderMessage(root, 'حساب غير مسجّل', 'حسابك غير مسجّل في النظام. تواصل مع المحاسب لإضافتك.');
  if (!p.is_active) return renderMessage(root, 'حساب موقوف', 'حسابك موقوف. تواصل مع المحاسب.');
  if (p.must_change_password) return renderChangePassword(root, afterLogin);
  if (p.mfa_required && !p.mfa_ok) return renderMfa(root, afterLogin);
  renderShell();
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') { shell = null; renderLogin(root, afterLogin); }
});

// الأقسام المتاحة للمستخدم (مبنية + مفعّلة + صلاحية)
const available = () => MODULES.filter((m) => state.can(m.code, 1));
const tabsOf = (m) => m.tabs.filter((t) => !t.visible || t.visible());
const moduleMeta = (code) => (state.profile.modules || []).find((x) => x.code === code) || {};

// ---------------------------------------------------------------------
// الهيكل العام
// ---------------------------------------------------------------------
let shell = null; let main = null; let sideNav = null; let topTitle = null;
function renderShell() {
  const p = state.profile;
  main = h('main', { class: 'page' });
  sideNav = h('nav', { class: 'side-nav', 'aria-label': 'القائمة' });
  shell = h('div', { class: 'shell' + (store.get('erp-side-collapsed', false) ? ' collapsed' : '') });

  const picker = h('div', { class: 'company-picker', role: 'group', 'aria-label': 'الشركات' });
  const drawPicker = () => {
    const all = state.companies();
    picker.replaceChildren(...[
      all.length > 1 ? h('button', { class: state.allCompaniesSelected() ? 'on' : '', onclick: () => state.setCompanies(all.map((c) => c.id)) }, 'الكل') : null,
      ...all.map((c) => h('button', {
        class: !state.allCompaniesSelected() && state.selectedCompanies.includes(c.id) ? 'on' : '',
        title: 'اضغط مع Ctrl لاختيار أكثر من شركة',
        onclick: (e) => {
          if (e.ctrlKey || e.metaKey) {
            const cur = state.allCompaniesSelected() ? [] : [...state.selectedCompanies];
            state.setCompanies(cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]);
          } else state.setCompanies([c.id]);
        },
      }, c.name))].filter(Boolean));
  };
  state.onCompaniesChange(drawPicker);
  drawPicker();

  const themeBtn = h('button', { class: 'icon-btn', title: 'تبديل الوضع الفاتح / الداكن', onclick: () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    setTheme({ mode: dark ? 'light' : 'dark' }); themeBtn.innerHTML = icon(dark ? 'moon' : 'sun').innerHTML;
  } }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));

  const initials = p.full_name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  const userBtn = h('button', { class: 'user-btn', onclick: (e) => { e.stopPropagation(); toggleMenu(); } },
    h('span', { class: 'avatar' }, initials), h('span', { class: 'txt' }, p.full_name.split(' ')[0]), '▾');

  shell.append(
    h('aside', { class: 'side' },
      h('a', { class: 'side-brand', href: '#/' }, h('span', { class: 'logo' }, 'م'),
        h('span', { class: 't' }, CONFIG.APP_NAME, h('small', {}, 'عيون الحديد • ريان • القيادة الذكية'))),
      sideNav,
      h('div', { class: 'side-foot' },
        h('button', { class: 'side-link', title: 'إخفاء القائمة (تظهر من زر القائمة فوق)', onclick: () => {
          shell.classList.add('collapsed'); store.set('erp-side-collapsed', true);
        } }, icon('collapse'), h('span', { class: 'txt' }, 'إخفاء القائمة')))),
    h('div', { class: 'side-scrim', onclick: () => shell.classList.remove('side-open') }),
    h('div', { class: 'main' },
      h('header', { class: 'topbar' },
        h('button', { class: 'icon-btn menu-btn', title: 'القائمة', onclick: () => {
          if (window.innerWidth <= 900) shell.classList.toggle('side-open');
          else { shell.classList.toggle('collapsed'); store.set('erp-side-collapsed', shell.classList.contains('collapsed')); }
        } }, icon('menu')),
        h('a', { class: 'top-brand', href: '#/' }, h('span', { class: 'logo' }, 'م'), h('span', { class: 'txt' }, CONFIG.APP_NAME)),
        h('button', { class: 'search-btn', onclick: openPalette }, icon('search'), h('span', { class: 'txt' }, 'بحث أو انتقال سريع…'), h('kbd', {}, 'Ctrl K')),
        topTitle = h('span', { class: 'spacer' }),
        picker, themeBtn, userBtn),
      main,
      h('div', { class: 'version' }, 'v' + VERSION)));
  root.replaceChildren(shell);
  mountAssistant(document.body);
  route();
}

let menuEl = null;
function toggleMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; return; }
  const p = state.profile; const t = getTheme();
  const redraw = () => { menuEl?.remove(); menuEl = null; toggleMenu(); };
  menuEl = h('div', { class: 'menu', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'who' }, h('div', { style: { fontWeight: 600, color: 'var(--ink)' } }, p.full_name), p.email, p.role ? ' — ' + p.role.name : ''),
    h('div', { class: 'sec', style: { borderTop: 0, marginTop: 0 } }, 'المظهر'),
    h('div', { class: 'seg' }, MODES.map(([k, v]) => h('button', { class: t.mode === k ? 'on' : '', onclick: () => { setTheme({ mode: k }); redraw(); } }, v))),
    h('div', { class: 'swatches' }, ACCENTS.map(([k, v, c]) => h('button', { class: 'swatch' + (t.accent === k ? ' on' : ''), title: v, style: { background: c },
      onclick: () => { setTheme({ accent: k }); redraw(); } }))),
    h('div', { class: 'sec' }, 'الحساب'),
    h('button', { onclick: () => { toggleMenu(); openChangePassword(); } }, 'تغيير كلمة السر'),
    h('button', { onclick: () => { toggleMenu(); openMfa(); } }, 'التحقق بخطوتين'),
    h('button', { onclick: () => sb.auth.signOut() }, 'تسجيل خروج'));
  document.body.append(menuEl);
}
document.addEventListener('click', () => { if (menuEl) { menuEl.remove(); menuEl = null; } });

function openChangePassword() {
  const m = modal({ title: 'تغيير كلمة السر', size: 'narrow' });
  m.body.append(changePasswordForm({ forced: false, onDone: m.close, onCancel: m.close }));
}

async function openMfa() {
  const m = modal({ title: 'التحقق بخطوتين', size: 'narrow' });
  m.body.append(await mfaForm({ onDone: () => { m.close(); afterLogin(); }, onCancel: m.close }));
}

// ---------------------------------------------------------------------
// القائمة الجانبية
// ---------------------------------------------------------------------
function drawSide(modCode, tabPath) {
  // الرئيسية بدون قائمة جانبية؛ داخل القسم: صفحات القسم فقط + مبدّل الأقسام
  shell.classList.toggle('no-side', !modCode);
  if (!modCode) { sideNav.replaceChildren(); return; }
  const mod = MODULES.find((m) => m.code === modCode);
  const meta = moduleMeta(mod.code);
  const groups = [];
  for (const t of tabsOf(mod)) {
    const g = t.group || '';
    let grp = groups.find((x) => x.name === g);
    if (!grp) groups.push(grp = { name: g, tabs: [] });
    grp.tabs.push(t);
  }
  let menu = null;
  const switcher = h('button', { class: 'mod-switch', title: 'التنقل لقسم آخر', onclick: (e) => {
    e.stopPropagation();
    if (menu) { menu.remove(); menu = null; return; }
    const built = new Set(MODULES.map((m) => m.code));
    menu = h('div', { class: 'mod-menu', onclick: (ev) => ev.stopPropagation() },
      h('a', { href: '#/' }, icon('home'), 'الرئيسية'),
      ...available().map((m) => h('a', { href: `#/${m.code}`, class: m.code === modCode ? 'on' : '' }, icon(moduleMeta(m.code).icon || 'database'), m.title)),
      ...(state.profile.modules || []).filter((m) => !built.has(m.code) && !['dashboard', 'assistant'].includes(m.code) && (m.level > 0 || state.profile.is_admin))
        .map((m) => h('span', { class: 'soon' }, icon(m.icon), m.name, h('small', {}, 'قريبًا'))));
    switcher.after(menu);
    const close = () => { menu?.remove(); menu = null; document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  } }, h('span', { class: 'mod-ico' }, icon(meta.icon || 'database')), h('span', { class: 'txt' }, mod.title), h('span', { class: 'chev' }, '▾'));
  sideNav.replaceChildren(switcher, ...groups.flatMap((g) => [
    g.name ? h('div', { class: 'side-lbl' }, g.name) : null,
    ...g.tabs.map((t) => h('a', { class: 'side-item' + (t.path === tabPath ? ' on' : ''), href: `#/${mod.code}/${t.path}` }, t.title)),
  ]).filter(Boolean));
}

// ---------------------------------------------------------------------
// التنقل
// ---------------------------------------------------------------------
window.addEventListener('hashchange', () => { if (main) route(); });

function route() {
  document.querySelectorAll('.overlay, .palette').forEach((o) => o.remove());   // النوافذ المفتوحة لا تنتقل مع الصفحة
  shell?.classList.remove('side-open');
  const [modCode, tabPath] = location.hash.replace(/^#\/?/, '').split('/');
  if (!modCode) { drawSide(null, null); main.className = 'page'; return renderHome(); }
  const mod = MODULES.find((m) => m.code === modCode);
  if (!mod || !state.can(mod.code, 1)) { location.hash = '#/'; return; }
  const tabs = tabsOf(mod);
  const tab = tabs.find((t) => t.path === tabPath) || tabs[0];
  drawSide(mod.code, tab.path);
  main.className = 'page' + (tab.wide ? ' wide' : '');
  const content = h('div');
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('div', {},
      h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'الرئيسية'), ' / ', h('a', { href: `#/${mod.code}` }, mod.title), tab.group ? ' / ' + tab.group : ''),
      h('h1', {}, tab.title), tab.subtitle ? h('p', { class: 'sub' }, tab.subtitle) : null)),
    content);
  document.title = `${tab.title} — ${CONFIG.APP_NAME}`;
  window.scrollTo(0, 0);
  Promise.resolve(tab.render(content)).catch((e) => toast(e.message, 'bad'));
}

// ---------------------------------------------------------------------
// الرئيسية: لوحة التحكم (بطاقات من كل الأقسام) + الأقسام
// ---------------------------------------------------------------------
function renderHome() {
  const p = state.profile;
  document.title = CONFIG.APP_NAME;
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh', hour: 'numeric', hour12: false }));
  const mods = (p.modules || []).filter((m) => !['dashboard', 'assistant'].includes(m.code) && (m.level > 0 || (p.is_admin && !m.enabled)));
  const widgets = state.can('dashboard', 1)
    ? available().flatMap((m) => (m.widgets || []).filter((w) => !w.visible || w.visible())) : [];
  const wbox = h('div', { class: 'widgets' }, widgets.map((w) => {
    const body = h('div', { style: { display: 'contents' } }, h('div', { class: 'help', style: { color: 'var(--ink-3)' } }, 'جارٍ التحميل…'));
    Promise.resolve().then(() => w.render(body)).catch((e) => body.replaceChildren(h('div', { class: 'help', style: { color: 'var(--bad)' } }, e.message)));
    return h('section', { class: 'widget ' + (w.size || 'sm') }, h('h3', {}, w.title), body);
  }));
  const off = state.onCompaniesChange(() => { if (document.body.contains(wbox)) renderHome(); else off(); });
  main.replaceChildren(...[
    h('div', { class: 'page-head' }, h('div', {},
      h('h1', { class: 'hello' }, (hour < 12 ? 'صباح الخير' : 'مساء الخير') + '، ' + p.full_name.split(' ')[0]),
      h('p', { class: 'sub' }, widgets.length ? 'نظرة سريعة على الشركات المختارة من الشريط العلوي' : 'اختر القسم'))),
    widgets.length ? wbox : null,
    widgets.length ? h('p', { class: 'help', style: { color: 'var(--ink-3)', fontSize: '12px', marginTop: '8px' } }, 'محتوى لوحة التحكم الكامل هيتحدد لاحقًا — كل قسم بيضيف بطاقاته هنا.') : null,
    mods.length === 0 ? h('div', { class: 'notice warn' }, 'لا توجد أقسام متاحة لحسابك حتى الآن. تواصل مع المحاسب لتحديد صلاحياتك.') : null,
    mods.length ? h('div', { class: 'section-title' }, 'الأقسام') : null,
    h('div', { class: 'tiles' }, mods.map((m) => {
      const ready = m.enabled && MODULES.some((x) => x.code === m.code);
      return h('a', { class: 'tile' + (ready ? '' : ' soon'), href: ready ? `#/${m.code}` : null },
        icon(m.icon), h('div', { class: 'name' }, m.name),
        h('div', { class: 'meta' }, ready ? ['', 'عرض', 'عرض وإضافة', 'عرض وتعديل', 'كامل'][m.level] : 'قريبًا'));
    }))].filter(Boolean));
}

// ---------------------------------------------------------------------
// البحث السريع (Ctrl+K): الصفحات + نتائج يوفّرها كل قسم (مثل رقم قيد)
// ---------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && shell) { e.preventDefault(); openPalette(); }
});

function openPalette() {
  if (document.querySelector('.palette')) return;
  const pages = [{ label: 'الرئيسية', hint: '', icon: 'home', run: () => { location.hash = '#/'; } }];
  for (const m of available()) for (const t of tabsOf(m)) {
    pages.push({ label: t.title, hint: m.title + (t.group ? ' • ' + t.group : ''), icon: moduleMeta(m.code).icon || 'page', run: () => { location.hash = `#/${m.code}/${t.path}`; } });
  }
  const actions = [
    { label: 'الوضع الداكن', hint: 'المظهر', icon: 'moon', run: () => setTheme({ mode: 'dark' }) },
    { label: 'الوضع الفاتح', hint: 'المظهر', icon: 'sun', run: () => setTheme({ mode: 'light' }) },
  ];
  const input = h('input', { placeholder: 'اكتب اسم صفحة، أو رقم قيد (15 أو 2026-15)…', autocomplete: 'off' });
  const list = h('div', { class: 'palette-list' });
  let items = []; let sel = 0; let seq = 0;
  const close = () => { pal.remove(); document.removeEventListener('keydown', onKey, true); };
  const norm = (s) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  const draw = (sections) => {
    items = sections.flatMap((s) => s.items);
    sel = Math.min(sel, Math.max(items.length - 1, 0));
    let i = 0;
    list.replaceChildren(...(items.length ? sections.filter((s) => s.items.length).flatMap((s) => [
      h('div', { class: 'palette-sec' }, s.title),
      ...s.items.map((it) => { const k = i++; return h('div', { class: 'palette-item' + (k === sel ? ' on' : ''), onmouseenter: () => { sel = k; highlight(); }, onclick: () => { close(); it.run(); } },
        icon(it.icon || 'page'), it.label, it.hint ? h('span', { class: 'hint' }, it.hint) : null); })]) : [h('div', { class: 'empty' }, 'لا نتائج')]));
  };
  const highlight = () => list.querySelectorAll('.palette-item').forEach((el, k) => { el.classList.toggle('on', k === sel); if (k === sel) el.scrollIntoView({ block: 'nearest' }); });
  const update = async () => {
    const q = input.value.trim(); const my = ++seq;
    const match = (it) => !q || norm(it.label + ' ' + (it.hint || '')).includes(norm(q));
    const base = [{ title: 'الصفحات', items: pages.filter(match).slice(0, q ? 12 : 30) }, { title: 'إجراءات', items: actions.filter(match) }];
    draw(base);
    if (!q) return;
    const extra = await Promise.all(available().filter((m) => m.search).map((m) => m.search(q).then((r) => ({ title: m.title, items: r || [] })).catch(() => ({ title: m.title, items: [] }))));
    if (my === seq) draw([...extra, ...base]);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); highlight(); }
    else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); const it = items[sel]; close(); it.run(); }
  };
  input.addEventListener('input', () => { sel = 0; update(); });
  document.addEventListener('keydown', onKey, true);
  const pal = h('div', { class: 'palette', onmousedown: (e) => { if (e.target === pal) close(); } },
    h('div', { class: 'palette-box' }, input, list,
      h('div', { class: 'palette-foot' }, h('span', {}, h('span', { class: 'kbd' }, '↑↓'), ' تنقل'), h('span', {}, h('span', { class: 'kbd' }, 'Enter'), ' فتح'), h('span', {}, h('span', { class: 'kbd' }, 'Esc'), ' إغلاق'))));
  document.body.append(pal);
  update();
  setTimeout(() => input.focus(), 0);
}

boot();

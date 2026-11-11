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
import { sb, core, logout } from './shared/sb.js';
import { h, toast, modal, icon, store } from './shared/ui.js';
import { state } from './shared/state.js';
import { MODES, ACCENTS, FONT_SIZES, getTheme, setTheme } from './shared/theme.js';
import { SCENES, POWERS, getBackdrop, setBackdrop, mountBackdrop } from './shared/backdrop.js';
import { renderLogin, renderMessage, renderChangePassword, renderMfa, changePasswordForm, mfaForm } from './shared/auth.js';
import { mountAssistant } from './shared/assistant.js';
import { runBackup, askBackupBeforeLogout, lastBackup } from './shared/backup.js';
import { startIdle, stopIdle, idleLogoutNotice } from './shared/idle.js';
import { dailyIntegrity } from './modules/accounting/integrity.js';
import { brand, loadBranding, logoEl, activeAnnouncement } from './shared/branding.js';
import coreModule from './modules/core/index.js';
import adminModule from './modules/admin/index.js';
import accountingModule from './modules/accounting/index.js';
import paymentsModule from './modules/payments/index.js';

// كل قسم جديد يُضاف هنا فقط
const MODULES = [paymentsModule, accountingModule, coreModule, adminModule];

const root = document.getElementById('app');

async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) { renderLogin(root, afterLogin); idleLogoutNotice(); return; }
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
  // من فعّل التحقق بخطوتين (ولو لم يكن مُلزمًا): يتحقق أولًا، لأن Supabase لا يقبل تغيير كلمة المرور قبل التحقق (aal2)
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return renderMfa(root, afterLogin);
  if (p.must_change_password) return renderChangePassword(root, afterLogin);
  if (p.mfa_required && !p.mfa_ok) return renderMfa(root, afterLogin);
  await loadBranding();
  renderShell();
}

sb.auth.onAuthStateChange((event) => {
  // الخروج: إعادة تحميل الصفحة بالكامل حتى تُمسح كل البيانات المخزنة في الذاكرة (قوائم الحسابات والمشاريع والموظفين…)
  //   فلا يرى المستخدم التالي على الجهاز نفسه شيئًا من بيانات السابق
  if (event === 'SIGNED_OUT') { stopIdle(); shell = null; root.replaceChildren(); location.replace(location.pathname + location.search); }
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
      h('a', { class: 'side-brand', href: '#/' }, logoEl(),
        h('span', { class: 't' }, CONFIG.APP_NAME, h('small', {}, brand.subtitle))),
      sideNav,
      h('div', { class: 'side-foot' },
        h('button', { class: 'side-link', title: 'إخفاء القائمة (تظهر من زر القائمة في الأعلى)', onclick: () => {
          shell.classList.add('collapsed'); store.set('erp-side-collapsed', true);
        } }, icon('collapse'), h('span', { class: 'txt' }, 'إخفاء القائمة')))),
    h('div', { class: 'side-scrim', onclick: () => shell.classList.remove('side-open') }),
    h('div', { class: 'main' },
      h('header', { class: 'topbar' },
        h('button', { class: 'icon-btn menu-btn', title: 'القائمة', onclick: () => {
          if (window.innerWidth <= 900) shell.classList.toggle('side-open');
          else { shell.classList.toggle('collapsed'); store.set('erp-side-collapsed', shell.classList.contains('collapsed')); }
        } }, icon('menu')),
        h('a', { class: 'top-brand', href: '#/' }, logoEl(), h('span', { class: 'txt' }, CONFIG.APP_NAME)),
        h('button', { class: 'search-btn', onclick: openPalette }, icon('search'), h('span', { class: 'txt' }, 'بحث أو انتقال سريع…'), h('kbd', {}, 'Ctrl K')),
        topTitle = h('span', { class: 'spacer' }),
        picker, themeBtn, userBtn),
      main,
      h('div', { class: 'version' }, 'v' + VERSION)));
  root.replaceChildren(shell);
  mountAssistant(document.body);
  route();
  startIdle();
  if (p.is_admin) { securityAlert(p); setTimeout(dailyIntegrity, 4000); }
}

// تنبيه المدير: أي تغيير في المستخدمين أو الأدوار أو الصلاحيات أو الإعدادات أجراه شخص غيره (أو جرى بلا مستخدم) منذ آخر مرة اطّلع فيها
const SEC_TABLES = ['app_users', 'user_companies', 'user_projects', 'user_permission_overrides', 'user_sensitive_overrides', 'roles', 'role_permissions', 'role_sensitive', 'settings'].map((t) => 'core.' + t);
const SELF_ONLY = ['last_login_at', 'must_change_password'];  // دخول المستخدم وتغييره كلمة مروره بنفسه ليسا تغييرًا في الصلاحيات
const SEC_NAMES = { 'core.app_users': 'المستخدمين', 'core.user_companies': 'شركات المستخدمين', 'core.user_projects': 'مشاريع المستخدمين', 'core.user_permission_overrides': 'استثناءات الصلاحيات',
  'core.user_sensitive_overrides': 'استثناءات البيانات الحساسة', 'core.roles': 'الأدوار', 'core.role_permissions': 'صلاحيات الأدوار', 'core.role_sensitive': 'البيانات الحساسة للأدوار', 'core.settings': 'الإعدادات' };
async function securityAlert(p) {
  try {
    const key = 'erp-sec-seen-' + p.id;
    const since = store.get(key, null);
    if (!since) { store.set(key, new Date().toISOString()); return; }  // أول مرة على هذا الجهاز: تبدأ المتابعة من الآن
    const { data } = await core.from('audit_log').select('id, at, table_name, action, user_id, record_id, new_data')
      .in('table_name', SEC_TABLES).gt('at', since).or(`user_id.is.null,user_id.neq.${p.id}`).order('at', { ascending: false }).limit(50);
    const rows = (data || []).filter((r) => !(r.table_name === 'core.app_users' && r.action === 'update' && r.record_id === r.user_id
      && Object.keys(r.new_data || {}).every((k) => SELF_ONLY.includes(k))));
    if (!rows.length) { store.set(key, new Date().toISOString()); return; }
    const by = {}; rows.forEach((r) => { by[r.table_name] = (by[r.table_name] || 0) + 1; });
    const m = modal({ title: '⚠ تغييرات في الصلاحيات', size: 'narrow' });
    m.body.append(
      h('p', { style: { marginTop: 0 } }, 'توجد تغييرات في الصلاحيات أو المستخدمين لم تُجرَ من حسابك:'),
      h('ul', {}, Object.entries(by).map(([t, n]) => h('li', {}, `${SEC_NAMES[t] || t}: ${n} تغيير`))),
      h('p', { class: 'help' }, 'إن لم تكن أنت من أجراها من أداة أخرى، فراجعها فورًا وغيّر كلمة المرور.'));
    const seen = () => store.set(key, new Date().toISOString());
    m.foot.append(
      h('button', { class: 'btn primary', onclick: () => { seen(); m.close(); location.hash = '#/admin/audit'; } }, 'افتح سجل المراجعة'),
      h('button', { class: 'btn', onclick: () => { seen(); m.close(); } }, 'اطّلعت عليها'));
  } catch { /* التنبيه ليس أساسيًا */ }
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
    h('div', { class: 'sec' }, 'حجم الخط'),
    h('div', { class: 'seg' }, FONT_SIZES.map(([k, v]) => h('button', { class: t.fs === k ? 'on' : '', onclick: () => { setTheme({ fs: k }); redraw(); } }, v))),
    h('button', { onclick: () => { toggleMenu(); openBackdropSettings(); } }, 'خلفية الرئيسية: ' + (SCENES[getBackdrop().scene]?.name || 'بدون حركة')),
    h('div', { class: 'sec' }, 'الحساب'),
    h('button', { onclick: () => { toggleMenu(); openChangePassword(); } }, 'تغيير كلمة المرور'),
    h('button', { onclick: () => { toggleMenu(); openMfa(); } }, 'التحقق بخطوتين'),
    p.is_admin ? h('button', { onclick: () => { toggleMenu(); runBackup(); }, title: lastBackup() ? 'آخر نسخة: ' + lastBackup().toLocaleString('ar-EG') : 'لم تُنشأ نسخة من هذا الجهاز' }, 'نسخة احتياطية الآن') : null,
    h('button', { onclick: async () => { toggleMenu(); if (await askBackupBeforeLogout()) logout(); } }, 'تسجيل الخروج'));
  document.body.append(menuEl);
}
document.addEventListener('click', () => { if (menuEl) { menuEl.remove(); menuEl = null; } });

// اختيار خلفية الرئيسية: يظهر التغيير فورًا (إذا كانت الرئيسية مفتوحة خلف النافذة)
function openBackdropSettings() {
  const m = modal({ title: 'خلفية الصفحة الرئيسية' });
  const draw = () => {
    const b = getBackdrop();
    m.body.replaceChildren(
      h('p', { class: 'help', style: { marginTop: 0 } }, 'الحركة في الصفحة الرئيسية فقط، وتتوقف تلقائيًا عند إخفاء التبويب. الاختيار محفوظ على هذا الجهاز.'),
      h('div', { class: 'bd-list' }, [['none', { name: 'بدون حركة', desc: 'خلفية ثابتة' }], ...Object.entries(SCENES)].map(([k, sc]) =>
        h('button', { class: 'bd-opt' + (b.scene === k ? ' on' : ''), onclick: () => { setBackdrop({ scene: k }); draw(); } },
          h('b', {}, sc.name), h('small', {}, sc.desc)))),
      h('div', { class: 'field', style: { marginTop: '14px' } }, h('label', {}, 'شدة الحركة'),
        h('div', { class: 'seg', style: { padding: 0 } }, POWERS.map(([v, t]) => h('button', { class: 'btn' + (b.power === v ? ' on' : ''), onclick: () => { setBackdrop({ power: v }); draw(); } }, t)))));
  };
  draw();
  m.foot.append(h('button', { class: 'btn primary', onclick: () => { m.close(); if (location.hash.replace(/^#\/?/, '')) location.hash = '#/'; } }, 'تم'));
}

function openChangePassword() {
  const m = modal({ title: 'تغيير كلمة المرور', size: 'narrow' });
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

let stopBackdrop = null;
function route() {
  stopBackdrop?.(); stopBackdrop = null;
  document.querySelectorAll('.overlay, .palette').forEach((o) => o.remove());   // النوافذ المفتوحة لا تنتقل مع الصفحة
  shell?.classList.remove('side-open');
  const [modCode, tabPath] = location.hash.replace(/^#\/?/, '').split('/');
  if (!modCode) { drawSide(null, null); main.className = 'page home'; return renderHome(); }
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
const MOD_DESC = {
  accounting: 'القيود، شجرة الحسابات، الفواتير والإقرار الضريبي، والتقارير المالية',
  core: 'المشاريع، العملاء والموردون، المعدات، الموظفون، ومراكز التكلفة',
  admin: 'المستخدمون، الأدوار، الاستثناءات، وسجل المراجعة',
  hr: 'الحضور والمسيّر، ويرحّل قيد الرواتب للمحاسبة',
  equipment: 'التشغيل والصيانة وتكلفة كل معدة',
  tools: 'العِدد في المخزن والمواقع',
  purchasing: 'الطلبات والعُهد والتسويات',
  housing: 'السكن والعقود والدفعات',
};

function renderHome() {
  const p = state.profile;
  document.title = CONFIG.APP_NAME;
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh', hour: 'numeric', hour12: false }));
  const mods = (p.modules || []).filter((m) => !['dashboard', 'assistant'].includes(m.code) && (m.level > 0 || (p.is_admin && !m.enabled)));
  const ready = (m) => m.enabled && MODULES.some((x) => x.code === m.code);
  const live = mods.filter(ready), soon = mods.filter((m) => !ready(m));
  const widgets = state.can('dashboard', 1)
    ? available().flatMap((m) => (m.widgets || []).filter((w) => !w.visible || w.visible())) : [];
  const wbox = h('div', { class: 'widgets' }, widgets.map((w) => {
    const body = h('div', { style: { display: 'contents' } }, h('div', { class: 'help', style: { color: 'var(--ink-3)' } }, 'جارٍ التحميل…'));
    Promise.resolve().then(() => w.render(body)).catch((e) => body.replaceChildren(h('div', { class: 'help', style: { color: 'var(--bad)' } }, e.message)));
    return h('section', { class: 'widget ' + (w.size || 'sm') }, h('h3', {}, w.title), body);
  }));
  const now = new Date();
  let hijri = '';
  try { hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(now); } catch { /* المتصفح لا يدعم الهجري */ }
  const greg = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  // أزرار سريعة حسب الصلاحية
  const quick = [];
  if (state.can('accounting', 2)) quick.push({ t: 'قيد جديد', href: '#/accounting/journal', main: true, ic: 'ledger' });
  if (state.can('accounting', 1)) quick.push({ t: 'كشف حساب', href: '#/accounting/statement' }, { t: 'ميزان المراجعة', href: '#/accounting/trial-balance' }, { t: 'الإقرار الضريبي', href: '#/accounting/vat' });

  const ann = activeAnnouncement();
  main.replaceChildren(...[
    ann ? h('div', { class: 'notice announce ' + (ann.level || 'info') }, '📢 ', ann.text) : null,
    h('section', { class: 'home-hero' },
      h('div', {},
        h('h1', { class: 'hello' }, (hour < 12 ? 'صباح الخير' : 'مساء الخير') + '، ', h('b', {}, p.full_name.split(' ')[0])),
        h('div', { class: 'home-date' }, greg + (hijri ? '   |   ' + hijri : ''))),
      quick.length ? h('div', { class: 'home-quick' }, quick.map((q) => h('a', { class: 'qa' + (q.main ? ' main' : ''), href: q.href }, q.main ? '＋ ' : '', q.t))) : null),
    widgets.length ? wbox : null,
    mods.length === 0 ? h('div', { class: 'notice warn' }, 'لا توجد أقسام متاحة لحسابك حتى الآن. تواصل مع المحاسب لتحديد صلاحياتك.') : null,
    live.length ? h('div', { class: 'section-title' }, 'الأقسام') : null,
    h('div', { class: 'tiles' }, live.map((m) => {
      const tile = h('a', { class: 'tile', href: `#/${m.code}` },
        h('span', { class: 'ico' }, icon(m.icon)), h('div', { class: 'name' }, m.name),
        MOD_DESC[m.code] ? h('div', { class: 'desc' }, MOD_DESC[m.code]) : null,
        h('div', { class: 'meta' }, ['', 'عرض', 'عرض وإضافة', 'عرض وتعديل', 'كامل'][m.level]));
      tile.addEventListener('pointermove', (e) => { const r = tile.getBoundingClientRect(); tile.style.setProperty('--mx', (e.clientX - r.left) + 'px'); tile.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
      return tile;
    })),
    soon.length ? h('div', { class: 'section-title' }, 'قريبًا') : null,
    soon.length ? h('div', { class: 'tiles-soon' }, soon.map((m) => h('div', { class: 'soon-item' },
      h('span', { class: 'ico' }, icon(m.icon)), h('div', {}, h('b', {}, m.name), MOD_DESC[m.code] ? h('small', {}, MOD_DESC[m.code]) : null)))) : null,
  ].filter(Boolean));
  stopBackdrop?.();
  stopBackdrop = mountBackdrop(main, { companies: state.companies().map((c) => c.name.replace(/^(شركة|مؤسسة)\s+/, '')) });
  const off = state.onCompaniesChange(() => { if (document.body.contains(wbox) && widgets.length) renderHome(); else off(); });
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

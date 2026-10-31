// نقطة البداية: الدخول، الهيكل العام، الشاشة الرئيسية، التنقل بين الأقسام
import { CONFIG } from './config.js';
import { sb } from './shared/sb.js';
import { h, toast, modal, icon } from './shared/ui.js';
import { state } from './shared/state.js';
import { renderLogin, renderMessage, renderChangePassword, renderMfa, changePasswordForm, mfaForm } from './shared/auth.js';
import coreModule from './modules/core/index.js';
import adminModule from './modules/admin/index.js';

// كل قسم جديد يُضاف هنا فقط
const MODULES = [coreModule, adminModule];

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
  if (event === 'SIGNED_OUT') renderLogin(root, afterLogin);
});

// ---------------------------------------------------------------------
// الهيكل العام
// ---------------------------------------------------------------------
let main;
function renderShell() {
  const p = state.profile;
  main = h('main', { class: 'page' });
  const picker = h('div', { class: 'company-picker', role: 'group', 'aria-label': 'الشركات' });
  const drawPicker = () => {
    const all = state.companies();
    picker.replaceChildren(...[
      all.length > 1 && h('button', { class: state.allCompaniesSelected() ? 'on' : '', onclick: () => state.setCompanies(all.map((c) => c.id)) }, 'الكل'),
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

  let menuEl = null;
  const userBtn = h('button', { class: 'user-btn', onclick: (e) => { e.stopPropagation(); toggleMenu(); } }, p.full_name + ' ▾');
  function toggleMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; return; }
    menuEl = h('div', { class: 'menu' },
      h('div', { class: 'who' }, h('div', { style: { fontWeight: 600, color: 'var(--ink)' } }, p.full_name), p.email, p.role ? ' — ' + p.role.name : ''),
      h('button', { onclick: () => { toggleMenu(); openChangePassword(); } }, 'تغيير كلمة السر'),
      h('button', { onclick: () => { toggleMenu(); openMfa(); } }, 'التحقق بخطوتين'),
      h('button', { onclick: () => sb.auth.signOut() }, 'تسجيل خروج'));
    document.body.append(menuEl);
  }
  document.addEventListener('click', () => { if (menuEl) { menuEl.remove(); menuEl = null; } });

  root.replaceChildren(
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/' }, CONFIG.APP_NAME),
      picker, h('div', { class: 'spacer' }), userBtn),
    main,
    h('div', { class: 'version' }, 'v' + CONFIG.VERSION));
  route();
}

function openChangePassword() {
  const m = modal({ title: 'تغيير كلمة السر', size: 'narrow' });
  m.body.append(changePasswordForm({ forced: false, onDone: m.close, onCancel: m.close }));
}

async function openMfa() {
  const m = modal({ title: 'التحقق بخطوتين', size: 'narrow' });
  m.body.append(await mfaForm({ onDone: () => { m.close(); afterLogin(); }, onCancel: m.close }));
}

// ---------------------------------------------------------------------
// التنقل
// ---------------------------------------------------------------------
window.addEventListener('hashchange', () => { if (main) route(); });

function route() {
  const [modCode, tabPath] = location.hash.replace(/^#\/?/, '').split('/');
  if (!modCode) return renderHome();
  const mod = MODULES.find((m) => m.code === modCode);
  if (!mod || !state.can(mod.code, 1)) { location.hash = '#/'; return; }
  const tabs = mod.tabs.filter((t) => !t.visible || t.visible());
  const tab = tabs.find((t) => t.path === tabPath) || tabs[0];
  const content = h('div');
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('div', {},
      h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'الرئيسية'), ' / ', mod.title),
      h('h1', {}, tab.title), tab.subtitle && h('p', { class: 'sub' }, tab.subtitle))),
    h('nav', { class: 'subnav' }, tabs.map((t) => h('a', { href: `#/${mod.code}/${t.path}`, class: t === tab ? 'on' : '' }, t.title))),
    content);
  window.scrollTo(0, 0);
  Promise.resolve(tab.render(content)).catch((e) => toast(e.message, 'bad'));
}

function renderHome() {
  const p = state.profile;
  const mods = (p.modules || []).filter((m) => m.level > 0 || (p.is_admin && !m.enabled));
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh', hour: 'numeric', hour12: false }));
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('div', {},
      h('h1', {}, (hour < 12 ? 'صباح الخير' : 'مساء الخير') + '، ' + p.full_name.split(' ')[0]),
      h('p', { class: 'sub' }, 'اختر القسم'))),
    h('div', { class: 'tiles' }, mods.map((m) => {
      const ready = m.enabled && MODULES.some((x) => x.code === m.code);
      return h('a', { class: 'tile' + (ready ? '' : ' soon'), href: ready ? `#/${m.code}` : null },
        icon(m.icon), h('div', { class: 'name' }, m.name),
        h('div', { class: 'meta' }, ready ? ['', 'عرض', 'عرض وإضافة', 'عرض وتعديل', 'كامل'][m.level] : 'قريبًا'));
    })));
}

boot();

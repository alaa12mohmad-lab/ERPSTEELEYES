// الخروج التلقائي بعد عدم النشاط (المدة من إعداد security.idle_minutes، الافتراضي 30 دقيقة)
//   آخر نشاط محفوظ في المتصفح فيُشارَك بين كل التبويبات المفتوحة: النشاط في تبويب واحد يكفي للجميع
//   قبل الخروج بدقيقة يظهر تنبيه «أنا هنا». مسودة صفحة القيود محفوظة تلقائيًا فلن تضيع.
import { sb, core } from './sb.js';
import { h, modal, toast } from './ui.js';

const KEY = 'erp-last-active';
const EVENTS = ['mousedown', 'keydown', 'wheel', 'touchstart', 'mousemove'];
let timer = null; let warn = null; let minutes = 30; let lastWrite = 0;

const now = () => Date.now();
const last = () => { try { return Number(localStorage.getItem(KEY)) || now(); } catch { return now(); } };
function touch() {
  const t = now();
  if (t - lastWrite < 5000) return; // الكتابة مرة كل 5 ثوانٍ على الأكثر
  lastWrite = t;
  try { localStorage.setItem(KEY, String(t)); } catch { /* ignore */ }
  if (warn) { warn.close(); warn = null; }
}

async function logout() {
  stopIdle();
  try { sessionStorage.setItem('erp-idle-logout', '1'); } catch { /* ignore */ }
  await sb.auth.signOut();
}

function check() {
  if (!minutes) return;
  const idle = now() - last();
  const limit = minutes * 60000;
  if (idle >= limit) { logout(); return; }
  if (idle >= limit - 60000 && !warn) {
    const m = modal({ title: 'سيتم تسجيل خروجك تلقائيًا', size: 'narrow', onClose: () => { warn = null; lastWrite = 0; touch(); } });
    const left = h('b', {}, '60');
    m.body.append(h('p', { style: { margin: 0 } }, 'لا يوجد نشاط منذ ', String(minutes), ' دقيقة. سيتم تسجيل الخروج خلال ', left, ' ثانية.'));
    m.foot.append(h('button', { class: 'btn primary', onclick: () => m.close() }, 'أنا هنا'));
    warn = m;
    const tick = setInterval(() => {
      if (warn !== m) { clearInterval(tick); return; }
      left.textContent = String(Math.max(0, Math.ceil((limit - (now() - last())) / 1000)));
    }, 1000);
  }
}

export async function startIdle() {
  stopIdle();
  try {
    const { data } = await core.rpc('setting', { p_key: 'security.idle_minutes', p_company: null });
    const v = Number(data);
    if (Number.isFinite(v) && v >= 0) minutes = v;
  } catch { /* الافتراضي 30 */ }
  lastWrite = 0; touch();
  EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));
  timer = setInterval(check, 10000);
}

export function stopIdle() {
  clearInterval(timer); timer = null;
  EVENTS.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
  if (warn) { warn.close(); warn = null; }
}

// بعد ظهور صفحة الدخول: رسالة بأن الخروج كان تلقائيًا
export function idleLogoutNotice() {
  try {
    if (sessionStorage.getItem('erp-idle-logout')) {
      sessionStorage.removeItem('erp-idle-logout');
      toast('تم تسجيل الخروج تلقائيًا بعد عدم النشاط', 'warn');
    }
  } catch { /* ignore */ }
}

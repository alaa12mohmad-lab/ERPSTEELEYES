// شاشات الدخول: تسجيل الدخول، وتغيير كلمة المرور، والتحقق بخطوتين
import { sb, rpc } from './sb.js';
import { h, toast } from './ui.js';
import { CONFIG } from '../config.js';
import { VERSION } from './version.js';
import { brand, logoEl } from './branding.js';

function authShell(title, sub, ...content) {
  return h('div', { class: 'auth-wrap' },
    h('div', { class: 'auth-card' }, h('div', { class: 'auth-logo' }, logoEl()), h('h1', {}, title), sub && h('p', { class: 'sub' }, sub), ...content,
      h('div', { class: 'foot' }, `${CONFIG.APP_NAME} — الإصدار ${VERSION}`)));
}

export function renderLogin(root, onDone) {
  const email = h('input', { class: 'input ltr', type: 'email', autocomplete: 'username', required: true, id: 'email' });
  const pass = h('input', { class: 'input ltr', type: 'password', autocomplete: 'current-password', required: true, id: 'password' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'دخول');
  const err = h('div');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.replaceChildren();
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      btn.disabled = false;
      if (error) {
        const msg = /invalid login/i.test(error.message) ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
          : /banned/i.test(error.message) ? 'الحساب موقوف — تواصل مع المحاسب' : error.message;
        err.replaceChildren(h('div', { class: 'notice bad' }, msg));
        return;
      }
      try { await rpc('touch_login'); } catch { /* ignore */ }
      onDone();
    },
  },
  h('div', { class: 'field' }, h('label', { for: 'email' }, 'البريد الإلكتروني'), email),
  h('div', { class: 'field' }, h('label', { for: 'password' }, 'كلمة المرور'), pass),
  err, btn);
  root.replaceChildren(authShell(CONFIG.APP_NAME, brand.subtitle, form));
  email.focus();
}

export function renderMessage(root, title, message) {
  root.replaceChildren(authShell(title, null,
    h('div', { class: 'notice warn' }, message),
    h('button', { class: 'btn', style: { marginTop: '16px' }, onclick: () => sb.auth.signOut() }, 'تسجيل الخروج')));
}

export function changePasswordForm({ forced, onDone, onCancel }) {
  const p1 = h('input', { class: 'input ltr', type: 'password', autocomplete: 'new-password', id: 'np1' });
  const p2 = h('input', { class: 'input ltr', type: 'password', autocomplete: 'new-password', id: 'np2' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'حفظ كلمة المرور');
  const err = h('div');
  return h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); err.replaceChildren();
      if (p1.value.length < 8) { err.append(h('div', { class: 'notice bad' }, 'كلمة المرور 8 أحرف على الأقل')); return; }
      if (p1.value !== p2.value) { err.append(h('div', { class: 'notice bad' }, 'كلمتا المرور غير متطابقتين')); return; }
      btn.disabled = true;
      const { error } = await sb.auth.updateUser({ password: p1.value });
      if (error) { btn.disabled = false; err.append(h('div', { class: 'notice bad' }, error.message)); return; }
      await rpc('mark_password_changed');
      toast('تم تغيير كلمة المرور', 'ok');
      onDone();
    },
  },
  forced && h('div', { class: 'notice' }, 'أول دخول: اختر كلمة مرور جديدة خاصة بك.'),
  h('div', { class: 'field' }, h('label', { for: 'np1' }, 'كلمة المرور الجديدة'), p1),
  h('div', { class: 'field' }, h('label', { for: 'np2' }, 'تأكيد كلمة المرور'), p2),
  err, btn,
  !forced && onCancel && h('button', { class: 'btn', type: 'button', onclick: onCancel }, 'رجوع'));
}

export function renderChangePassword(root, onDone) {
  root.replaceChildren(authShell('تغيير كلمة المرور', null, changePasswordForm({ forced: true, onDone })));
}

// التحقق بخطوتين: تسجيل تطبيق Authenticator أو إدخال الكود
export async function mfaForm({ onDone, onCancel }) {
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  const code = h('input', { class: 'input ltr', inputmode: 'numeric', maxlength: 6, placeholder: '123456', id: 'mfa' });
  const err = h('div');
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) { box.append(h('div', { class: 'notice bad' }, error.message)); return box; }
  let factor = (data?.totp || []).find((f) => f.status === 'verified');

  if (!factor) {
    const { data: en, error: enErr } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator ' + Date.now() });
    if (enErr) { box.append(h('div', { class: 'notice bad' }, enErr.message)); return box; }
    factor = { id: en.id };
    box.append(
      h('div', { class: 'notice' }, 'افتح تطبيق Google Authenticator أو Microsoft Authenticator وامسح الرمز، ثم اكتب الرقم الظاهر.'),
      h('img', { src: en.totp.qr_code, alt: 'QR', style: { width: '180px', alignSelf: 'center', background: '#fff' } }),
      h('div', { class: 'help ltr', style: { textAlign: 'center', fontSize: 'calc(12px * var(--fs, 1))', wordBreak: 'break-all' } }, en.totp.secret));
  } else {
    box.append(h('div', { class: 'notice' }, 'اكتب الرقم الظاهر في تطبيق Authenticator.'));
  }
  const btn = h('button', { class: 'btn primary' }, 'تحقق');
  btn.addEventListener('click', async () => {
    btn.disabled = true; err.replaceChildren();
    const { error: vErr } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.value.trim() });
    btn.disabled = false;
    if (vErr) { err.append(h('div', { class: 'notice bad' }, 'الرمز غير صحيح')); return; }
    await sb.auth.refreshSession();
    toast('تم التحقق', 'ok');
    onDone();
  });
  box.append(h('div', { class: 'field' }, h('label', { for: 'mfa' }, 'الرمز'), code), err, btn,
    onCancel && h('button', { class: 'btn', onclick: onCancel }, 'رجوع'));
  return box;
}

export async function renderMfa(root, onDone) {
  root.replaceChildren(authShell('التحقق بخطوتين', 'حسابك يتطلب تحققًا إضافيًا', h('div', { class: 'empty' }, '…')));
  const form = await mfaForm({ onDone });
  root.replaceChildren(authShell('التحقق بخطوتين', 'حسابك يتطلب تحققًا إضافيًا', form,
    h('button', { class: 'btn ghost', style: { marginTop: '10px' }, onclick: () => sb.auth.signOut() }, 'تسجيل الخروج')));
}

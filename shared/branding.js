// هوية النظام: الاسم والسطر الفرعي وحرف الشعار وصورة الشعار، ورسالة الإعلان، وإعدادات الطباعة
//   المصدر: جدول الإعدادات (core.settings) — يعدّلها المدير من «الإدارة ← هوية النظام وإعداداته».
//   تُحفظ نسخة منها في المتصفح لتظهر في شاشة الدخول (قبل الدخول لا يُسمح بالقراءة من قاعدة البيانات).
import { core } from './sb.js';
import { h } from './ui.js';
import { CONFIG } from '../config.js';

const CACHE = 'erp-branding';
const DEFAULTS = {
  name: CONFIG.APP_NAME || 'النظام الموحد',
  subtitle: 'عيون الحديد • ريان • القيادة الذكية',
  letter: 'م',
  logo: null,
  announcement: null,     // { text, level: info|warn|bad, until: 'YYYY-MM-DD' }
  hijri: false,           // التاريخ الهجري بجانب الميلادي في الطباعة
};
export const BRAND_KEYS = {
  name: 'app.name', subtitle: 'app.subtitle', letter: 'app.logo_letter', logo: 'app.logo_image',
  announcement: 'app.announcement', hijri: 'print.hijri',
};

function cached() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(CACHE) || 'null') || {}) }; } catch { return { ...DEFAULTS }; }
}

export const brand = cached();
let companiesInfo = [];

function apply() {
  CONFIG.APP_NAME = brand.name;   // كل الشاشات التي تقرأ CONFIG.APP_NAME تأخذ الاسم الجديد
  document.title = brand.name;
}
apply();

// بعد الدخول: قراءة الهوية من الإعدادات وبيانات الشركات (للترويسة)
export async function loadBranding() {
  try {
    const [{ data: rows }, { data: cos }] = await Promise.all([
      core.from('settings').select('key, value').is('company_id', null).eq('status', 'active').in('key', Object.values(BRAND_KEYS)),
      core.from('companies').select('*').eq('status', 'active').order('code'),
    ]);
    const v = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
    for (const [k, key] of Object.entries(BRAND_KEYS)) {
      if (key in v && v[key] !== null && v[key] !== '') brand[k] = v[key];
      else brand[k] = DEFAULTS[k];
    }
    brand.hijri = brand.hijri === true || brand.hijri === 'true';
    companiesInfo = cos || [];
    try { localStorage.setItem(CACHE, JSON.stringify({ name: brand.name, subtitle: brand.subtitle, letter: brand.letter, logo: brand.logo })); } catch { /* ignore */ }
  } catch { /* تبقى القيم المحفوظة */ }
  apply();
  return brand;
}

// الشعار: صورة إن وُجدت، وإلا الحرف
export function logoEl(cls = 'logo') {
  return brand.logo
    ? h('span', { class: cls + ' has-img' }, h('img', { src: brand.logo, alt: '' }))
    : h('span', { class: cls }, brand.letter || 'م');
}

// الإعلان الساري (لم ينتهِ تاريخه)
export function activeAnnouncement() {
  const a = brand.announcement;
  if (!a || !a.text) return null;
  if (a.until && a.until < new Date().toISOString().slice(0, 10)) return null;
  return a;
}

// التاريخ الهجري (تقويم أم القرى)
export function hijri(d = new Date()) {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));
  } catch { return ''; }
}

export function companyInfo(idOrName) {
  return companiesInfo.find((c) => c.id === idOrName || c.name === idOrName) || null;
}

// تحديث بيانات الشركات قبل الطباعة (حتى يظهر العنوان أو الهاتف المضاف للتو دون إعادة تحميل الصفحة)
export async function refreshCompanies() {
  try {
    const { data } = await core.from('companies').select('*').eq('status', 'active').order('code');
    if (data) companiesInfo = data;
  } catch { /* تبقى البيانات السابقة */ }
}

// ترويسة الطباعة: الشعار + اسم الشركة + السجل التجاري والرقم الضريبي والعنوان
//   companies: معرّف شركة أو اسمها، أو مصفوفة معرّفات (تقرير مجمّع) فتظهر الأسماء فقط
export function printHeader(companies, title, period) {
  const list = Array.isArray(companies) ? companies : null;
  const c = list ? (list.length === 1 ? companyInfo(list[0]) : null) : companyInfo(companies);
  const details = c ? [c.cr_number && 'س.ت: ' + c.cr_number, c.vat_number && 'الرقم الضريبي: ' + c.vat_number, c.address, c.phone && 'هاتف: ' + c.phone].filter(Boolean) : [];
  const name = c ? c.name : list ? 'تقرير مجمّع' : (companies || '');
  const sub = !c && list ? list.map((id) => companyInfo(id)?.name || '').filter(Boolean).join(' + ') : '';
  return h('div', { class: 'rp-head' },
    h('div', { class: 'rp-brand' },
      brand.logo ? h('img', { class: 'rp-logo', src: brand.logo, alt: '' }) : null,
      h('div', {},
        h('div', { class: 'rp-co' }, name),
        details.length ? h('div', { class: 'rp-meta' }, details.join(' — ')) : sub ? h('div', { class: 'rp-meta' }, sub) : null,
        h('div', { class: 'rp-title' }, title || ''))),
    h('div', { class: 'rp-period' }, period || ''));
}

// تذييل الطباعة: من طبع ومتى (بالهجري أيضًا عند تفعيله)
export function printFooter(name, fmtDatetime) {
  const now = new Date();
  return `طُبع في ${fmtDatetime(now)}${brand.hijri ? ' (' + hijri(now) + ')' : ''} — بواسطة ${name || ''}`;
}

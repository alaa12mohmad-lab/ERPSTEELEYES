// الثيمات: وضع (فاتح / داكن / حسب الجهاز) + لون مميز. الاختيار محفوظ لكل مستخدم في متصفحه.
//   الألوان كلها معرّفة في styles.css كمتغيرات؛ هنا فقط نضبط سمات <html>.
import { store } from './ui.js';

export const MODES = [['light', 'فاتح'], ['dark', 'داكن'], ['auto', 'حسب الجهاز']];
export const ACCENTS = [
  ['iron', 'حديدي', '#b4561f'],
  ['navy', 'كحلي', '#2b5cab'],
  ['emerald', 'زمردي', '#13795b'],
  ['sand', 'رملي', '#a07116'],
  ['plum', 'بنفسجي', '#7a4fb0'],
];

const KEY = 'erp-theme';
const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

// حجم خط الشاشة لكل جهاز: s صغير، m عادي، l كبير، xl كبير جدًا
export const FONT_SIZES = [['s', 'صغير'], ['m', 'عادي'], ['l', 'كبير'], ['xl', 'كبير جدًا']];

export function getTheme() {
  const t = store.get(KEY, null) || {};
  return { mode: MODES.some((m) => m[0] === t.mode) ? t.mode : 'light', accent: ACCENTS.some((a) => a[0] === t.accent) ? t.accent : 'iron', fs: FONT_SIZES.some((f) => f[0] === t.fs) ? t.fs : 'm' };
}

export function applyTheme(t = getTheme()) {
  const dark = t.mode === 'dark' || (t.mode === 'auto' && media?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.accent = t.accent;
  document.documentElement.dataset.fs = t.fs || 'm';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#0f141b' : '#1b2430';
}

export function setTheme(patch) {
  const t = { ...getTheme(), ...patch };
  store.set(KEY, t);
  applyTheme(t);
}

media?.addEventListener?.('change', () => { if (getTheme().mode === 'auto') applyTheme(); });
applyTheme();

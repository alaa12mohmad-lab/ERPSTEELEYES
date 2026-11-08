// هوية النظام وإعداداته: الاسم والشعار والإعلان والطباعة والأمان والضريبة — في شاشة واحدة للمدير
import { core, insertRows, updateRow } from '../../shared/sb.js';
import { h, toast } from '../../shared/ui.js';
import { brand, BRAND_KEYS, loadBranding, logoEl, hijri } from '../../shared/branding.js';

const KEYS = {
  ...BRAND_KEYS,
  idle: 'security.idle_minutes', mfa: 'security.require_mfa_for_admins', vat: 'vat.rate',
};
const DESC = {
  'app.name': 'اسم النظام الظاهر في الشاشات والطباعة', 'app.subtitle': 'السطر الفرعي تحت اسم النظام',
  'app.logo_letter': 'حرف الشعار (يظهر عند عدم وجود صورة شعار)', 'app.logo_image': 'صورة الشعار',
  'app.announcement': 'رسالة إعلان تظهر لكل المستخدمين في الصفحة الرئيسية', 'print.hijri': 'إظهار التاريخ الهجري بجانب الميلادي في الطباعة',
  'security.idle_minutes': 'الخروج التلقائي بعد عدم النشاط (بالدقائق) — 0 = بدون', 'security.require_mfa_for_admins': 'إلزام التحقق بخطوتين لحسابات المدير',
  'vat.rate': 'نسبة ضريبة القيمة المضافة',
};

// تصغير صورة الشعار إلى 256 بكسل كحد أقصى وحفظها داخل الإعدادات (بدون رفع ملفات)
function resizeImage(file, max = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('تعذّرت قراءة الصورة'));
    img.src = URL.createObjectURL(file);
  });
}

export async function renderSystem(el) {
  const { data: rows, error } = await core.from('settings').select('*').is('company_id', null).eq('status', 'active').in('key', Object.values(KEYS));
  if (error) { el.replaceChildren(h('div', { class: 'notice bad' }, error.message)); return; }
  const cur = Object.fromEntries(rows.map((r) => [r.key, r]));
  const val = (k, d) => (cur[k] ? cur[k].value : d);

  const name = h('input', { class: 'input', value: val(KEYS.name, brand.name), maxlength: 60 });
  const sub = h('input', { class: 'input', value: val(KEYS.subtitle, brand.subtitle), maxlength: 120 });
  const letter = h('input', { class: 'input', value: val(KEYS.letter, 'م'), maxlength: 2, style: { width: '80px', textAlign: 'center' } });
  let logo = val(KEYS.logo, null);
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', style: { display: 'none' } });
  const ann = val(KEYS.announcement, null) || {};
  const annText = h('textarea', { class: 'input', rows: 2, placeholder: 'مثال: سيُحدَّث النظام مساء اليوم بعد الساعة العاشرة', maxlength: 300 }, ann.text || '');
  const annLevel = h('select', { class: 'input', style: { width: 'auto' } },
    [['info', 'معلومة (أزرق)'], ['warn', 'تنبيه (أصفر)'], ['bad', 'مهم (أحمر)']].map(([v, t]) => h('option', { value: v, selected: (ann.level || 'info') === v }, t)));
  const annUntil = h('input', { class: 'input', type: 'date', value: ann.until || '', style: { width: 'auto' } });
  const hij = h('input', { type: 'checkbox', checked: val(KEYS.hijri, false) === true });
  const idle = h('input', { class: 'input', type: 'number', min: 0, max: 480, value: val(KEYS.idle, 30), style: { width: '100px' } });
  const mfa = h('input', { type: 'checkbox', checked: val(KEYS.mfa, false) === true });
  const vat = h('input', { class: 'input', type: 'number', step: '0.01', min: 0, max: 100, value: Math.round(Number(val(KEYS.vat, 0.15)) * 10000) / 100, style: { width: '100px' } });
  const err = h('p', { class: 'notice bad', style: { display: 'none' } });

  const preview = h('div');
  const drawPreview = () => {
    const b = { ...brand, name: name.value || 'النظام', subtitle: sub.value, letter: letter.value || 'م', logo };
    preview.replaceChildren(h('div', { class: 'side-brand', style: { pointerEvents: 'none' } },
      b.logo ? h('span', { class: 'logo has-img' }, h('img', { src: b.logo, alt: '' })) : h('span', { class: 'logo' }, b.letter),
      h('span', { class: 't' }, b.name, h('small', {}, b.subtitle))));
  };
  [name, sub, letter].forEach((x) => x.addEventListener('input', drawPreview));
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    if (f.size > 3 * 1024 * 1024) { toast('الصورة أكبر من 3 ميجابايت', 'bad'); return; }
    try { logo = await resizeImage(f); drawPreview(); logoBtns(); } catch (e) { toast(e.message, 'bad'); }
  });
  const logoBox = h('div', { class: 'toolbar' });
  const logoBtns = () => logoBox.replaceChildren(
    h('button', { class: 'btn', onclick: () => file.click() }, logo ? 'تغيير الصورة' : 'رفع صورة شعار'),
    logo ? h('button', { class: 'btn ghost', onclick: () => { logo = null; drawPreview(); logoBtns(); } }, 'إزالة الصورة') : null,
    h('span', { class: 'help' }, 'PNG أو JPG، وتُصغَّر تلقائيًا. يُفضَّل شعار مربع بخلفية شفافة.'), file);
  logoBtns(); drawPreview();

  const F = (label, input, help) => h('div', { class: 'field' }, h('label', {}, label), input, help ? h('div', { class: 'help' }, help) : null);
  const card = (title, ...kids) => h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'section-title', style: { marginTop: 0 } }, title), ...kids);

  async function save() {
    err.style.display = 'none';
    const vr = Number(vat.value);
    if (!name.value.trim()) { err.textContent = 'اسم النظام مطلوب'; err.style.display = ''; return; }
    if (!(vr >= 0 && vr <= 100)) { err.textContent = 'نسبة الضريبة غير صحيحة'; err.style.display = ''; return; }
    const want = {
      [KEYS.name]: name.value.trim(), [KEYS.subtitle]: sub.value.trim(), [KEYS.letter]: letter.value.trim() || 'م', [KEYS.logo]: logo,
      [KEYS.announcement]: annText.value.trim() ? { text: annText.value.trim(), level: annLevel.value, until: annUntil.value || null } : null,
      [KEYS.hijri]: hij.checked, [KEYS.idle]: Math.max(0, Math.round(Number(idle.value) || 0)), [KEYS.mfa]: mfa.checked,
      [KEYS.vat]: Math.round(vr * 100) / 10000,
    };
    try {
      for (const [k, v] of Object.entries(want)) {
        const value = v === null ? '' : v;   // الحقل لا يقبل قيمة فارغة: النص الفارغ يعني «غير محدد»
        const old = cur[k] && cur[k].value !== '' ? cur[k].value : null;
        if (cur[k]) {
          if (JSON.stringify(old) !== JSON.stringify(v)) await updateRow('settings', cur[k].id, { value }, 'core');
        } else if (v !== null) {
          const [r] = await insertRows('settings', [{ key: k, value, description: DESC[k] }], 'core');
          cur[k] = { id: r.id, value };
        }
      }
      await loadBranding();
      toast('حُفظت الإعدادات — يظهر الاسم والشعار الجديدان بعد تحديث الصفحة', 'ok');
    } catch (e) { err.textContent = e.message; err.style.display = ''; }
  }

  el.replaceChildren(
    card('هوية النظام',
      h('div', { class: 'form-grid' },
        F('اسم النظام', name, 'يظهر في الشريط الجانبي والعلوي وعنوان المتصفح وشاشة الدخول والطباعة'),
        F('السطر الفرعي', sub),
        F('حرف الشعار', letter, 'يظهر عند عدم وجود صورة شعار')),
      h('div', { class: 'field' }, h('label', {}, 'صورة الشعار'), logoBox),
      h('div', { class: 'field' }, h('label', {}, 'معاينة'), preview)),
    card('رسالة إعلان للمستخدمين',
      h('p', { class: 'help', style: { marginTop: 0 } }, 'تظهر أعلى الصفحة الرئيسية لكل المستخدمين حتى تاريخ الانتهاء. اترك النص فارغًا لإخفائها.'),
      F('النص', annText),
      h('div', { class: 'form-grid' }, F('النوع', annLevel), F('تظهر حتى تاريخ', annUntil, 'فارغ = حتى حذفها'))),
    card('الطباعة',
      h('label', { class: 'check' }, hij, ' إظهار التاريخ الهجري بجانب الميلادي في التقارير والقيود المطبوعة'),
      h('p', { class: 'help' }, 'اليوم: ', hijri(), '. بيانات الشركة في ترويسة الطباعة (السجل التجاري والرقم الضريبي والعنوان والهاتف) تُعدَّل من «البيانات الأساسية ← الشركات».')),
    card('الأمان',
      h('div', { class: 'form-grid' }, F('الخروج التلقائي بعد عدم النشاط (دقيقة)', idle, '0 = بدون خروج تلقائي')),
      h('label', { class: 'check' }, mfa, ' إلزام حسابات المدير بالتحقق بخطوتين'),
      h('p', { class: 'help' }, '⚠️ فعّل التحقق بخطوتين لحسابك أولًا (من قائمة المستخدم) قبل إلزامه، وإلا ستُطلب منك إعداده عند الدخول التالي.')),
    card('الضريبة',
      h('div', { class: 'form-grid' }, F('نسبة ضريبة القيمة المضافة (%)', vat, 'تُستخدم في حساب الفواتير والمستخلصات الجديدة فقط'))),
    err,
    h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: save }, 'حفظ الإعدادات')));
}

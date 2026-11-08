// طباعة القيود: سند قيد لكل قيد (اسم الشركة، الرقم، التاريخ، الأسطر، الإجمالي بالحروف، التوقيعات)
import { h, fmt } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { brand, companyInfo, printFooter, hijri } from '../../shared/branding.js';
import { ENTRY_TYPES, TAX_CATEGORIES } from './lookups.js';

// ---------------------------------------------------------------------
// المبلغ بالحروف (ريال وهللة)
// ---------------------------------------------------------------------
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function below1000(n) {
  const parts = [];
  const hnd = Math.floor(n / 100), rest = n % 100;
  if (hnd) parts.push(HUNDREDS[hnd]);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else { const o = rest % 10, t = Math.floor(rest / 10); parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]); }
  }
  return parts.join(' و');
}

// العدد مع المعدود: 1 مفرد، 2 مثنى، 3-10 جمع، 11-99 مفرد منصوب، والمئات الكاملة مفرد مجرور
//   forms: [مفرد, مثنى, جمع, منصوب, مجرور]
function counted(n, forms, withOne = false) {
  const [one, two, plural, acc, gen] = forms;
  if (n === 1) return withOne ? `${one} واحد` : one;
  if (n === 2) return two;
  const r = n % 100;
  const noun = r === 0 ? gen : r >= 3 && r <= 10 ? plural : r >= 11 ? acc : gen;
  return `${below1000(n)} ${noun}`;
}
const SCALES = [null, ['ألف', 'ألفان', 'آلاف', 'ألفًا', 'ألف'], ['مليون', 'مليونان', 'ملايين', 'مليونًا', 'مليون'], ['مليار', 'ملياران', 'مليارات', 'مليارًا', 'مليار']];

// construct: العدد متبوع بمعدود (ريال/هللة) — "ألفا ريال" و"أحد عشر ألف ريال" و"مائتا ريال"
export function numberToWords(n, construct = false) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'صفر';
  const groups = [];
  let i = 0; let lowest = true;
  while (n > 0 && i < SCALES.length) {
    const g = n % 1000;
    if (g) {
      let w;
      if (i === 0) w = construct && g === 200 ? 'مائتا' : below1000(g);
      else {
        const f = SCALES[i];
        w = construct && lowest ? counted(g, [f[0], f[1].replace(/ن$/, ''), f[2], f[4], f[4]]) : counted(g, f);
      }
      groups.unshift(w);
      lowest = false;
    }
    n = Math.floor(n / 1000); i++;
  }
  return groups.join(' و');
}

// العدد كاملًا بالحروف ثم المعدود حسب آخر رقمين
function withNoun(n, [, , plural, acc, gen]) {
  const r = n % 100;
  return `${numberToWords(n, true)} ${r >= 3 && r <= 10 ? plural : r >= 11 ? acc : gen}`;
}

export function amountInWords(v) {
  const total = Math.round(Math.abs(Number(v) || 0) * 100);
  const riyals = Math.floor(total / 100), halalas = total % 100;
  const r = riyals === 0 ? '' : riyals === 1 ? 'ريال واحد' : riyals === 2 ? 'ريالان' : withNoun(riyals, ['ريال', 'ريالان', 'ريالات', 'ريالًا', 'ريال']);
  const hl = halalas === 0 ? '' : halalas === 1 ? 'هللة واحدة' : halalas === 2 ? 'هللتان' : withNoun(halalas, ['هللة', 'هللتان', 'هللات', 'هللة', 'هللة']);
  const words = [r, hl].filter(Boolean).join(' و');
  return words ? `فقط ${words} لا غير` : 'صفر';
}

// ---------------------------------------------------------------------
// السند
// ---------------------------------------------------------------------
function voucher(entry, lines, users) {
  const name = (id) => users.find((u) => u.id === id)?.full_name || '';
  const cancelled = entry.status === 'cancelled';
  const totD = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totC = lines.reduce((s, l) => s + Number(l.credit), 0);
  const hasInv = lines.some((l) => l.invoice_no);
  const extra = (l) => [l.project_name && 'مشروع: ' + l.project_name, l.cost_center_name && 'مركز: ' + l.cost_center_name,
    l.equipment_name && 'معدة: ' + l.equipment_name].filter(Boolean).join(' • ');
  return h('section', { class: 'pv' + (cancelled ? ' pv-cancelled' : '') },
    cancelled ? h('div', { class: 'pv-stamp' }, 'ملغي') : '',
    h('header', { class: 'pv-head' },
      h('div', { class: 'rp-brand' }, brand.logo ? h('img', { class: 'rp-logo', src: brand.logo, alt: '' }) : null,
        h('div', {}, h('div', { class: 'pv-co' }, state.companyName(entry.company_id)), coMeta(entry.company_id), h('div', { class: 'pv-title' }, 'قيد يومية'))),
      h('table', { class: 'pv-meta' }, h('tbody', {},
        h('tr', {}, h('th', {}, 'رقم القيد'), h('td', { class: 'ltr' }, `${entry.fiscal_year}-${entry.entry_no}`)),
        h('tr', {}, h('th', {}, 'التاريخ'), h('td', {}, fmt.date(entry.entry_date), brand.hijri ? h('div', { class: 'pv-hijri' }, hijri(entry.entry_date)) : null)),
        h('tr', {}, h('th', {}, 'النوع'), h('td', {}, ENTRY_TYPES[entry.entry_type] + (entry.batch_no ? ` — صفحة ${entry.batch_no}` : ''))),
        entry.version > 1 ? h('tr', {}, h('th', {}, 'النسخة'), h('td', {}, `${entry.version} (معدّل)`)) : '',
        ''))),
    h('div', { class: 'pv-desc' }, h('strong', {}, 'البيان: '), entry.description),
    cancelled ? h('div', { class: 'pv-desc' }, h('strong', {}, 'سبب الإلغاء: '), entry.cancel_reason || '') : '',
    h('table', { class: 'pv-lines' },
      h('thead', {}, h('tr', {}, h('th', {}, 'م'), h('th', {}, 'الحساب'), h('th', {}, 'الطرف'), hasInv ? h('th', {}, 'الفاتورة') : '',
        h('th', {}, 'البيان / التحليل'), h('th', {}, 'مدين'), h('th', {}, 'دائن'))),
      h('tbody', {}, lines.map((l, i) => h('tr', {},
        h('td', {}, i + 1), h('td', {}, `${l.account_code} — ${l.account_name}`), h('td', {}, l.party_name || ''),
        hasInv ? h('td', {}, l.invoice_no ? [h('span', { class: 'ltr' }, l.invoice_no), l.invoice_date ? ' — ' + fmt.date(l.invoice_date) : '',
          l.tax_base ? ` (خاضع ${fmt.num(l.tax_base)})` : l.tax_category && l.tax_category !== 'standard' ? ` (${TAX_CATEGORIES[l.tax_category]})` : ''] : '') : '',
        h('td', {}, [l.line_description, extra(l)].filter(Boolean).join(' — ')),
        h('td', { class: 'num' }, Number(l.debit) ? fmt.num(l.debit) : ''), h('td', { class: 'num' }, Number(l.credit) ? fmt.num(l.credit) : '')))),
      h('tfoot', {}, h('tr', {}, h('td', { colspan: hasInv ? 5 : 4 }, amountInWords(totD)),
        h('td', { class: 'num' }, fmt.num(totD)), h('td', { class: 'num' }, fmt.num(totC))))),
    h('footer', { class: 'pv-sign' },
      h('div', {}, h('div', { class: 'pv-sl' }, 'أعدّه'), h('div', {}, name(entry.created_by)), h('div', { class: 'pv-line' })),
      h('div', {}, h('div', { class: 'pv-sl' }, 'راجعه'), h('div', {}, entry.version > 1 ? name(entry.updated_by) : ''), h('div', { class: 'pv-line' })),
      h('div', {}, h('div', { class: 'pv-sl' }, 'اعتمده'), h('div', {}, ' '), h('div', { class: 'pv-line' }))));
}

// بيانات الشركة تحت اسمها في الترويسة
function coMeta(id) {
  const c = companyInfo(id);
  const t = c ? [c.cr_number && 'س.ت: ' + c.cr_number, c.vat_number && 'الرقم الضريبي: ' + c.vat_number, c.address].filter(Boolean).join(' — ') : '';
  return t ? h('div', { class: 'rp-meta' }, t) : null;
}

// list: [{ entry (صف من v_entries), lines (صفوف v_lines) }]
export function printEntries(list, users = []) {
  document.getElementById('print-area')?.remove();
  const area = h('div', { id: 'print-area' },
    list.map(({ entry, lines }) => voucher(entry, lines, users)),
    h('div', { class: 'pv-foot' }, printFooter(state.profile?.full_name, fmt.datetime)));
  document.body.append(area);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); area.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

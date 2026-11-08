// فحص سلامة البيانات: قواعد لازم تكون صح دايمًا. أي رقم غير صفر = حاجة محتاجة مراجعة
import { rpc } from '../../shared/sb.js';
import { h, fmt, toast } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { openEntry } from './register.js';

const ids = () => (state.selectedCompanies.length ? state.selectedCompanies : state.companies().map((c) => c.id));

export async function runIntegrity(companies = ids()) {
  const out = [];
  for (const co of companies) {
    const rows = await rpc('integrity_check', { p_company: co }, 'accounting');
    rows.forEach((r) => out.push({ ...r, company_id: co }));
  }
  return out;
}

export function renderIntegrity(el) {
  const out = h('div');
  const btn = h('button', { class: 'btn primary', onclick: () => run() }, 'افحص الآن');
  el.replaceChildren(
    h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { class: 'toolbar' }, btn, h('span', { class: 'help' }, 'بيفحص الشركات المختارة فوق. الفحص بيقرأ بس، وما بيغيّرش أي حاجة.')),
      h('p', { class: 'help', style: { margin: '8px 0 0' } },
        'الأحمر = خطأ في البيانات المفروض ما يحصلش أبدًا (ابعته فورًا). الأصفر = محتاج مراجعة: غالبًا إدخال أو إعداد حساب اتغير بعد الحفظ. ',
        'الفحص ده بيتشغل كمان مع النسخة الاحتياطية كل ليلة.')),
    out);

  async function run() {
    btn.disabled = true;
    out.replaceChildren(h('div', { class: 'empty' }, 'جارٍ الفحص…'));
    const t0 = performance.now();
    let rows;
    try { rows = await runIntegrity(); } catch (e) { out.replaceChildren(h('div', { class: 'notice bad' }, e.message)); btn.disabled = false; return; }
    btn.disabled = false;
    try { localStorage.setItem('erp-integrity-last', JSON.stringify({ at: Date.now(), errors: rows.filter((r) => r.severity === 'error' && r.problems > 0).length })); } catch { /* ignore */ }
    const errs = rows.filter((r) => r.problems > 0 && r.severity === 'error').length;
    const warns = rows.filter((r) => r.problems > 0 && r.severity === 'warn').length;
    const checks = new Set(rows.map((r) => r.code)).size;
    out.replaceChildren(
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi main' }, h('small', {}, 'النتيجة'), h('b', {}, errs ? `${errs} خطأ` : warns ? 'سليمة مع ملاحظات' : 'سليمة ✓'),
          h('span', {}, `${checks} فحص × ${ids().length} شركة — ${Math.round(performance.now() - t0) / 1000} ث`)),
        h('div', { class: 'kpi' }, h('small', {}, 'أخطاء'), h('b', { class: errs ? 'bad' : '' }, String(errs))),
        h('div', { class: 'kpi' }, h('small', {}, 'ملاحظات'), h('b', {}, String(warns)))),
      ...ids().map((co) => {
        const list = rows.filter((r) => r.company_id === co).sort((a, b) => (b.problems > 0) - (a.problems > 0) || (a.severity === 'error' ? -1 : 1));
        return h('div', { class: 'card', style: { marginBottom: '12px' } },
          h('div', { class: 'section-title', style: { marginTop: 0 } }, state.companyName(co)),
          h('table', { class: 'grid report' }, h('tbody', {}, list.map((r) => {
            const bad = r.problems > 0;
            const det = h('div', { style: { display: 'none', marginTop: '6px' } },
              h('div', { class: 'help' }, r.hint),
              h('ul', { style: { margin: '6px 0', paddingInlineStart: '18px' } }, (r.samples || []).map((s) => h('li', {},
                s.entry_id ? h('a', { href: 'javascript:void 0', onclick: () => openEntry(s.entry_id, { onChange: run }) }, s.ref || 'فتح القيد') : s.ref ? h('b', {}, s.ref) : null,
                s.info ? ' — ' + s.info : ''))),
              r.problems > (r.samples || []).length ? h('div', { class: 'help' }, `وأكتر (الإجمالي ${fmt.num(r.problems).replace('.00', '')})`) : null);
            return h('tr', { style: { cursor: bad ? 'pointer' : 'default' }, onclick: () => { if (bad) det.style.display = det.style.display ? '' : 'none'; } },
              h('td', { style: { width: '32px', textAlign: 'center' } }, bad ? (r.severity === 'error' ? '❌' : '⚠️') : '✓'),
              h('td', {}, h('b', {}, r.title), bad ? det : null),
              h('td', { class: 'num', style: { width: '90px' } }, bad ? h('span', { class: 'badge ' + (r.severity === 'error' ? 'bad' : 'warn') }, String(r.problems)) : ''));
          }))));
      }));
    if (errs) toast(`الفحص لقى ${errs} خطأ — راجعهم`, 'bad');
  }
  run();
}

// للمدير: فحص تلقائي مرة كل يوم عند الدخول (في الخلفية)، ولو فيه أخطاء يظهر تنبيه
export async function dailyIntegrity() {
  try {
    const last = JSON.parse(localStorage.getItem('erp-integrity-last') || 'null');
    if (last && Date.now() - last.at < 86400000) return;
    const rows = await runIntegrity(state.companies().map((c) => c.id));
    const errs = rows.filter((r) => r.severity === 'error' && r.problems > 0);
    localStorage.setItem('erp-integrity-last', JSON.stringify({ at: Date.now(), errors: errs.length }));
    if (errs.length) toast(`⚠ فحص سلامة البيانات لقى ${errs.length} خطأ — افتح المحاسبة ← فحص سلامة البيانات`, 'bad');
  } catch { /* الفحص مش أساسي للدخول */ }
}

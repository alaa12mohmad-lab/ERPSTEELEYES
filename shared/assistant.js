// المساعد الذكي — الأساس فقط (غير مفعّل)
//   يظهر الزر عندما يكون قسم «assistant» مفعّلًا من شاشة الأقسام، ولدى المستخدم صلاحية عليه.
//   التصميم الكامل في docs/AI.md، وملخصه:
//     - المفتاح في أسرار Supabase، والطلب يمر بدالة Edge اسمها assistant (لا مفاتيح في المتصفح أبدًا)
//     - المساعد يقرأ بصلاحيات المستخدم نفسه (RLS) عبر نفس دوال التقارير
//     - لا يكتب في الدفاتر: أقصى ما يفعله اقتراح قيد يذهب لـ "القيود المقترحة"
import { h, icon } from './ui.js';
import { state } from './state.js';
import { callFn } from './sb.js';

export function mountAssistant(container) {
  document.querySelectorAll('.ai-fab, .ai-panel').forEach((x) => x.remove());
  const meta = (state.profile?.modules || []).find((m) => m.code === 'assistant');
  if (!meta || !meta.enabled || meta.level < 1) return;

  let panel = null;
  const fab = h('button', { class: 'ai-fab', title: 'المساعد الذكي', onclick: toggle }, icon('spark'));
  container.append(fab);

  function toggle() {
    if (panel) { panel.remove(); panel = null; return; }
    const body = h('div', { class: 'ai-body' }, h('p', {}, 'اسأل عن أرصدة، قيود، فواتير، أو اطلب تجهيز قيد مقترح.'));
    const input = h('input', { class: 'input', placeholder: 'اكتب سؤالك…' });
    const send = async () => {
      const q = input.value.trim(); if (!q) return;
      input.value = '';
      body.append(h('p', { style: { color: 'var(--ink)', fontWeight: 600 } }, q));
      const ans = h('p', {}, '…'); body.append(ans);
      try {
        const r = await callFn('assistant', { message: q, companies: state.selectedCompanies });
        ans.textContent = r?.reply || '';
      } catch (e) { ans.textContent = 'المساعد غير متاح الآن: ' + e.message; }
      body.scrollTop = body.scrollHeight;
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    panel = h('div', { class: 'ai-panel' },
      h('header', {}, icon('spark'), 'المساعد الذكي'), body,
      h('footer', {}, input, h('button', { class: 'btn primary', onclick: send }, 'إرسال')));
    container.append(panel);
    input.focus();
  }
}

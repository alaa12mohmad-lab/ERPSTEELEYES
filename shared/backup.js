// النسخة الاحتياطية من الشاشة (للمدير): كل جداول النظام في ملف JSON (للاسترجاع) + ملف Excel (للقراءة).
//   تُنزَّل الملفات في مجلد التنزيلات، ويُسجَّل تاريخ آخر نسخة على الجهاز ليذكّرك النظام عند الخروج.
//   هذه النسخة مكمّلة للنسخة التلقائية اليومية من الخادم (ops/backup) وليست بديلًا عنها.
import { db } from './sb.js';
import { h, modal, toast, store, fmt } from './ui.js';
import { state } from './state.js';
import { VERSION } from './version.js';
import { CONFIG } from '../config.js';

// [schema, table] — بالترتيب الذي يحتاجه الاسترجاع (الجداول الأساسية قبل الجداول المعتمدة عليها)
export const BACKUP_TABLES = [
  ['core', 'companies'], ['core', 'schema_migrations'], ['core', 'settings'], ['core', 'doc_sequences'], ['core', 'modules'], ['core', 'roles'], ['core', 'role_permissions'],
  ['core', 'sensitive_items'], ['core', 'role_sensitive'], ['core', 'app_users'], ['core', 'user_companies'], ['core', 'user_projects'],
  ['core', 'user_permission_overrides'], ['core', 'user_sensitive_overrides'],
  ['core', 'units'], ['core', 'categories'], ['core', 'cost_centers'], ['core', 'parties'], ['core', 'projects'], ['core', 'project_companies'],
  ['core', 'locations'], ['core', 'employees'], ['core', 'equipment'], ['core', 'price_kinds'], ['core', 'prices'], ['core', 'attachments'],
  ['accounting', 'accounts'], ['accounting', 'batches'], ['accounting', 'journal_entries'], ['accounting', 'journal_lines'],
  ['accounting', 'entry_versions'], ['accounting', 'proposed_entries'], ['accounting', 'deleted_entries'], ['accounting', 'period_locks'],
  ['accounting', 'bank_statements'], ['accounting', 'bank_statement_lines'], ['accounting', 'cash_commitments'],
  ['accounting', 'contracts'], ['accounting', 'contract_amendments'], ['accounting', 'contract_bills'], ['accounting', 'sales_invoices'],
  ['accounting', 'quotations'], ['core', 'company_letterheads'],
  ['core', 'audit_log'],
];
// ملاحظة: ملفات المرفقات (Storage) ليست في هذه النسخة ولا في النسخة الليلية — النسخة لبيانات قاعدة البيانات فقط

const LAST_KEY = 'erp-last-backup';
export const lastBackup = () => { const v = store.get(LAST_KEY, null); return v ? new Date(v) : null; };
export const backupDue = (hours = 24) => { const l = lastBackup(); return !l || Date.now() - l.getTime() > hours * 3600e3; };

async function fetchAll(schema, table, onPage) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await db(schema).from(table).select('*').range(from, from + size - 1);
    if (error) {
      // جدول غير موجود في إصدار قاعدة البيانات الحالي يُتخطّى ويُذكر؛ أما خطأ الصلاحية أو غيره فيُوقف النسخة (لا نجاح ناقص)
      if (/does not exist|schema cache|Could not find the table/i.test(error.message)) return null;
      throw new Error(`${schema}.${table}: ${error.message}`);
    }
    out.push(...data); onPage?.(out.length);
    if (data.length < size) return out;
  }
}

function download(name, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// يفتح نافذة التقدم وينشئ النسخة. يُرجع true عند اكتمالها
export function runBackup({ excel = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title: 'نسخة احتياطية', size: 'narrow', onClose: () => resolve(done) });
    const bar = h('div', { class: 'bk-bar' }, h('i'));
    const line = h('div', { class: 'help' }, 'جارٍ التجهيز…');
    m.body.append(h('p', { style: { marginTop: 0 } }, 'يجري تحميل جميع جداول قاعدة البيانات (دون ملفات المرفقات) في ملفين: JSON للاسترجاع وExcel للقراءة. لا تغلق الصفحة حتى يكتملا.'), bar, line);
    (async () => {
      const stamp = new Date();
      const tag = stamp.toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const data = {}; const counts = []; let total = 0; const skipped = [];
      try {
        for (let i = 0; i < BACKUP_TABLES.length; i++) {
          const [s, t] = BACKUP_TABLES[i];
          line.textContent = `${s}.${t}…`;
          bar.firstChild.style.width = Math.round((i / BACKUP_TABLES.length) * 100) + '%';
          const rows = await fetchAll(s, t, (n) => { line.textContent = `${s}.${t} — ${n} سجل`; });
          if (rows === null) { skipped.push(`${s}.${t}`); continue; }
          data[`${s}.${t}`] = rows; counts.push([`${s}.${t}`, rows.length]); total += rows.length;
        }
        bar.firstChild.style.width = '100%';
        const meta = { app: CONFIG.APP_NAME, version: VERSION, created_at: stamp.toISOString(), created_by: state.profile?.email || '', tables: Object.fromEntries(counts), skipped, note: 'نسخة إدارية لبيانات قاعدة البيانات (لا تشمل ملفات المرفقات). الاسترجاع الكامل من النسخة الليلية.' };
        download(`erp-backup-${tag}.json`, new Blob([JSON.stringify({ meta, data })], { type: 'application/json' }));
        // ملف Excel للقراءة فقط: إذا تعذّر لا تفشل النسخة (ملف JSON هو الأساس ونزل بالفعل)
        let excelErr = null;
        if (excel && window.XLSX) {
          try {
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet([['الجدول', 'عدد السجلات'], ...counts, [], ['التاريخ', fmt.datetime(stamp)], ['بواسطة', meta.created_by], ['الإصدار', VERSION]]), 'الفهرس');
            // خلية Excel لا تتسع لأكثر من 32,767 حرفًا (صور الشعار والترويسة وبعض سجلات المراجعة) — تُقتطع في Excel فقط وتبقى كاملة في JSON
            const cell = (v) => {
              const t = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
              return typeof t === 'string' && t.length > 30000 ? t.slice(0, 200) + ` …[مقتطع: ${t.length} حرف — كامل في ملف JSON]` : t;
            };
            for (const [name, rows] of Object.entries(data)) {
              if (!rows.length) continue;
              const flat = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])));
              window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(flat), name.replace(/^core\./, '').replace(/^accounting\./, 'acc_').slice(0, 31));
            }
            window.XLSX.writeFile(wb, `erp-backup-${tag}.xlsx`);
          } catch (e) { excelErr = e.message; }
        }
        store.set(LAST_KEY, stamp.toISOString());
        done = true;
        line.textContent = `اكتملت النسخة: ${counts.length} جدولًا، ${total.toLocaleString('en')} سجلًا — الملفات في مجلد التنزيلات.`
          + (skipped.length ? ` (جداول غير موجودة في قاعدة البيانات بعد: ${skipped.join('، ')} — شغّل ملفات التحديث)` : '')
          + ' ملفات المرفقات غير مشمولة.';
        if (excelErr) line.textContent += ` — تعذّر ملف Excel (${excelErr})، وملف JSON الأساسي سليم.`;
        if (skipped.length || excelErr) line.style.color = 'var(--warn, #b26b00)';
        m.foot.append(h('button', { class: 'btn primary', onclick: m.close }, 'تم'));
        toast('تمت النسخة الاحتياطية', 'ok');
      } catch (e) {
        line.textContent = 'تعذر إكمال النسخة: ' + e.message;
        line.style.color = 'var(--bad)';
        m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'إغلاق'));
      }
    })();
  });
}

// عند الخروج: إذا كانت آخر نسخة أقدم من يوم يسأل المستخدم (للمدير فقط). تُرجع true لمتابعة الخروج
export function askBackupBeforeLogout() {
  if (!state.profile?.is_admin || !backupDue(24)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let answered = false;
    const l = lastBackup();
    const m = modal({ title: 'نسخة احتياطية قبل الخروج؟', size: 'narrow', onClose: () => { if (!answered) resolve(false); } });
    m.body.append(h('p', { style: { margin: 0 } }, l ? `آخر نسخة احتياطية من هذا الجهاز: ${fmt.datetime(l)}.` : 'لم تُنشأ أي نسخة احتياطية من هذا الجهاز من قبل.'),
      h('p', { class: 'help' }, 'تُنزّل النسخة ملف JSON (للاسترجاع) وملف Excel (للقراءة) في مجلد التنزيلات.'));
    m.foot.append(
      h('button', { class: 'btn primary', onclick: async () => { answered = true; m.close(); await runBackup(); resolve(true); } }, 'نسخ ثم خروج'),
      h('button', { class: 'btn', onclick: () => { answered = true; m.close(); resolve(true); } }, 'خروج بدون نسخة'),
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'رجوع'));
  });
}

// النسخة الاحتياطية من الشاشة (للمدير): كل جداول النظام في ملف JSON (للاسترجاع) + ملف Excel (للقراءة).
//   الملفات بتنزل في فولدر التنزيلات. آخر نسخة بتتسجل على الجهاز عشان النظام يفكّرك عند الخروج.
//   ده مكمّل للنسخة التلقائية اليومية من السيرفر (ops/backup) — مش بديل عنها.
import { db } from './sb.js';
import { h, modal, toast, store, fmt } from './ui.js';
import { state } from './state.js';
import { VERSION } from './version.js';

// [schema, table] — بالترتيب اللي الاسترجاع محتاجه (الأساسي قبل اللي معتمد عليه)
export const BACKUP_TABLES = [
  ['core', 'companies'], ['core', 'settings'], ['core', 'doc_sequences'], ['core', 'modules'], ['core', 'roles'], ['core', 'role_permissions'],
  ['core', 'sensitive_items'], ['core', 'role_sensitive'], ['core', 'app_users'], ['core', 'user_companies'], ['core', 'user_projects'],
  ['core', 'user_permission_overrides'], ['core', 'user_sensitive_overrides'],
  ['core', 'units'], ['core', 'categories'], ['core', 'cost_centers'], ['core', 'parties'], ['core', 'projects'], ['core', 'project_companies'],
  ['core', 'locations'], ['core', 'employees'], ['core', 'equipment'], ['core', 'price_kinds'], ['core', 'prices'], ['core', 'attachments'],
  ['accounting', 'accounts'], ['accounting', 'batches'], ['accounting', 'journal_entries'], ['accounting', 'journal_lines'],
  ['accounting', 'entry_versions'], ['accounting', 'proposed_entries'], ['accounting', 'deleted_entries'],
  ['core', 'audit_log'],
];

const LAST_KEY = 'erp-last-backup';
export const lastBackup = () => { const v = store.get(LAST_KEY, null); return v ? new Date(v) : null; };
export const backupDue = (hours = 24) => { const l = lastBackup(); return !l || Date.now() - l.getTime() > hours * 3600e3; };

async function fetchAll(schema, table, onPage) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await db(schema).from(table).select('*').range(from, from + size - 1);
    if (error) {
      if (/does not exist|schema cache|permission/i.test(error.message)) return null;   // جدول مش موجود في النسخة دي
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

// يفتح نافذة التقدم ويعمل النسخة. يرجّع true لو خلصت
export function runBackup({ excel = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title: 'نسخة احتياطية', size: 'narrow', onClose: () => resolve(done) });
    const bar = h('div', { class: 'bk-bar' }, h('i'));
    const line = h('div', { class: 'help' }, 'جارٍ التجهيز…');
    m.body.append(h('p', { style: { marginTop: 0 } }, 'بيتم تحميل كل بيانات النظام. ما تقفلش الصفحة لحد ما الملفات تنزل.'), bar, line);
    (async () => {
      const stamp = new Date();
      const tag = stamp.toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const data = {}; const counts = []; let total = 0;
      try {
        for (let i = 0; i < BACKUP_TABLES.length; i++) {
          const [s, t] = BACKUP_TABLES[i];
          line.textContent = `${s}.${t}…`;
          bar.firstChild.style.width = Math.round((i / BACKUP_TABLES.length) * 100) + '%';
          const rows = await fetchAll(s, t, (n) => { line.textContent = `${s}.${t} — ${n} سجل`; });
          if (rows === null) continue;
          data[`${s}.${t}`] = rows; counts.push([`${s}.${t}`, rows.length]); total += rows.length;
        }
        bar.firstChild.style.width = '100%';
        const meta = { app: 'النظام الموحد', version: VERSION, created_at: stamp.toISOString(), created_by: state.profile?.email || '', tables: Object.fromEntries(counts) };
        download(`erp-backup-${tag}.json`, new Blob([JSON.stringify({ meta, data })], { type: 'application/json' }));
        if (excel && window.XLSX) {
          const wb = window.XLSX.utils.book_new();
          window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet([['الجدول', 'عدد السجلات'], ...counts, [], ['التاريخ', fmt.datetime(stamp)], ['بواسطة', meta.created_by], ['الإصدار', VERSION]]), 'الفهرس');
          for (const [name, rows] of Object.entries(data)) {
            if (!rows.length) continue;
            const flat = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])));
            window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(flat), name.replace(/^core\./, '').replace(/^accounting\./, 'acc_').slice(0, 31));
          }
          window.XLSX.writeFile(wb, `erp-backup-${tag}.xlsx`);
        }
        store.set(LAST_KEY, stamp.toISOString());
        done = true;
        line.textContent = `تمت النسخة: ${counts.length} جدول، ${total.toLocaleString('en')} سجل — الملفات في فولدر التنزيلات.`;
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

// عند الخروج: لو آخر نسخة أقدم من يوم يسأل (للمدير بس). يرجّع true لو يكمّل الخروج
export function askBackupBeforeLogout() {
  if (!state.profile?.is_admin || !backupDue(24)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let answered = false;
    const l = lastBackup();
    const m = modal({ title: 'نسخة احتياطية قبل الخروج؟', size: 'narrow', onClose: () => { if (!answered) resolve(false); } });
    m.body.append(h('p', { style: { margin: 0 } }, l ? `آخر نسخة احتياطية من الجهاز ده: ${fmt.datetime(l)}.` : 'مفيش نسخة احتياطية اتعملت من الجهاز ده قبل كده.'),
      h('p', { class: 'help' }, 'النسخة بتنزل ملف JSON (للاسترجاع) وملف Excel (للقراءة) في فولدر التنزيلات.'));
    m.foot.append(
      h('button', { class: 'btn primary', onclick: async () => { answered = true; m.close(); await runBackup(); resolve(true); } }, 'نسخة ثم خروج'),
      h('button', { class: 'btn', onclick: () => { answered = true; m.close(); resolve(true); } }, 'خروج بدون نسخة'),
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'رجوع'));
  });
}

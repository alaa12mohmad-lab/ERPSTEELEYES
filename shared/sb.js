// الاتصال بقاعدة البيانات — كل الأقسام تستخدم هذا الملف فقط
import { CONFIG } from '../config.js';

export const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'erp-auth' },
});

// الخروج: يُنهي الجلسة على الخادم، وإن تعذّر (انتهت الجلسة أو انقطع الاتصال) يمسحها من الجهاز على أي حال،
//   ثم يعيد تحميل الصفحة حتى لا يبقى في الذاكرة شيء من بيانات المستخدم
export async function logout() {
  try { const { error } = await sb.auth.signOut(); if (error) throw error; }
  catch { try { await sb.auth.signOut({ scope: 'local' }); } catch { /* ignore */ } }
  try { Object.keys(localStorage).filter((k) => k === 'erp-auth' || k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  location.replace(location.pathname + location.search);
}

// قاعدة بيانات الأساس (schema core) وقسم المحاسبة
export const core = sb.schema('core');
export const acc = sb.schema('accounting');
export const db = (schema) => (schema === 'accounting' ? acc : schema && schema !== 'core' ? sb.schema(schema) : core);

// ترجمة أخطاء قاعدة البيانات لرسالة مفهومة
export function errMsg(error) {
  if (!error) return '';
  const m = error.message || String(error);
  if (error.code === '23505' || /duplicate key/i.test(m)) return 'القيمة مكررة — يوجد سجل بنفس الكود أو الرقم';
  if (error.code === '23503' || /foreign key/i.test(m)) return 'السجل مرتبط ببيانات أخرى';
  if (error.code === '42501' || /row-level security|permission denied/i.test(m)) return 'ليس لديك صلاحية لهذه العملية';
  if (error.code === '23514' || /check constraint/i.test(m)) {
    if (/cancel_reason/.test(m)) return 'سبب الإلغاء مطلوب';
    if (/iban/.test(m)) return 'الآيبان غير صحيح (يبدأ بحرفين ثم أرقام، مثل SA0380000000608010167519)';
    if (/tax/.test(m)) return 'الرقم الضريبي يجب أن يكون 15 رقمًا';
    if (/dates/.test(m)) return 'تاريخ النهاية قبل تاريخ البداية';
    if (/supplier/.test(m)) return 'المعدة المستأجرة تحتاج إلى مورد';
    if (/role_chk/.test(m)) return 'يجب أن يكون الطرف عميلًا أو موردًا أو كليهما';
    return 'بيانات غير صحيحة: ' + m;
  }
  if (/Failed to fetch|NetworkError/i.test(m)) return 'تعذر الاتصال بالخادم — تأكد من الإنترنت';
  return m;
}

// استدعاء Edge Function
export async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// تحديث مع التأكد أن الصف تغيّر فعلًا (RLS يرفض التعديل بصمت)
export async function updateRow(table, id, values, schema) {
  const { data, error } = await db(schema).from(table).update(values).eq('id', id).select('id');
  if (error) throw new Error(errMsg(error));
  if (!data || data.length === 0) throw new Error('ليس لديك صلاحية لتعديل هذا السجل');
  return data[0];
}

export async function insertRows(table, rows, schema) {
  const { data, error } = await db(schema).from(table).insert(rows).select('id');
  if (error) throw new Error(errMsg(error));
  return data;
}

// يمكن لأي قسم الاستماع لنداءات rpc الناجحة (مثلًا: تحديث الأرصدة المعروضة بعد حفظ قيد)
export const rpcListeners = new Set();
// الخادم يرجّع 1000 صف كحد أقصى في الطلب الواحد (max-rows) — فالتقارير والقوائم الطويلة تُجلب صفحة صفحة
export const PAGE = 1000;
const MAX_ROWS = 200000;

// دوال قراءة فقط تُرجع قوائم — آمن طلبها أكثر من مرة لجلب باقي الصفحات
const READ_SETS = new Set([
  'account_statement', 'party_statement', 'analysis_lines', 'cost_center_detail', 'cost_center_summary',
  'trial_balance', 'party_balances', 'open_invoices', 'vat_accounts_movement', 'intercompany_mixed_entries',
  'intercompany_reconciliation', 'equipment_summary', 'project_summary', 'check_invoices', 'pr_open_invoices',
  'integrity_check', 'income_statement', 'balance_sheet', 'cash_flow_direct',
]);

// يجلب كل صفوف استعلام select على صفحات. make() يُرجع استعلامًا جديدًا في كل مرة (بترتيب ثابت).
export async function selectAll(make) {
  let all = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) return { data: from ? all : null, error };
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
  }
  return { data: all, error: null };
}

export async function rpc(fn, args = {}, schema) {
  let { data, error } = await db(schema).rpc(fn, args);
  if (error) throw new Error(errMsg(error));
  if (READ_SETS.has(fn) && Array.isArray(data) && data.length === PAGE) {
    for (let from = PAGE; from < MAX_ROWS; from += PAGE) {
      const r = await db(schema).rpc(fn, args).range(from, from + PAGE - 1);
      if (r.error) throw new Error(errMsg(r.error));
      data = data.concat(r.data || []);
      if (!r.data || r.data.length < PAGE) break;
    }
  }
  rpcListeners.forEach((f) => { try { f(fn, schema); } catch { /* ignore */ } });
  return data;
}

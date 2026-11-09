// قراءة ملفات Excel المستوردة بحدود أمان (1.8.1):
//   حجم أقصى، وامتدادات معروفة فقط، وبلا صيغ أو HTML — تقليلًا لأثر ثغرات قراءة الملفات المصمَّمة خصيصًا في مكتبة SheetJS
export const MAX_IMPORT_MB = 5;

export async function readWorkbook(file, opts = {}) {
  if (!file) throw new Error('اختر ملفًا');
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('الملف يجب أن يكون Excel (xlsx أو xls) أو CSV');
  if (file.size > MAX_IMPORT_MB * 1024 * 1024) throw new Error(`حجم الملف أكبر من ${MAX_IMPORT_MB} ميجابايت — قسّمه إلى ملفات أصغر`);
  const buf = await file.arrayBuffer();
  return window.XLSX.read(buf, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, sheetStubs: false, bookVBA: false, ...opts });
}

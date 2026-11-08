// قسم المحاسبة
import { state } from '../../shared/state.js';
import { renderAccounts } from './accounts.js';
import { renderJournal } from './journal.js';
import { renderRegister, renderProposed, renderDeleted } from './register.js';
import { renderTrialBalance, renderStatement, renderIncome, renderBalanceSheet, renderPartyBalances, renderProjects, renderEquipment, renderVatReturn, renderInvoices, renderIntercompany } from './reports.js';
import { search } from './search.js';
import { renderImport } from './import.js';
import { renderLiquidity, renderCashFlow, renderAging, renderCommitments } from './liquidity.js';
import { renderBank } from './bank.js';
import { renderContracts } from './contracts.js';
import { renderClosing } from './closing.js';
import { renderSales } from './sales.js';
import { renderQuotes } from './quotes.js';
import { renderIntegrity } from './integrity.js';

const IN = 'الإدخال', SETUP = 'الإعداد', REP = 'التقارير', TAX = 'الفواتير والضريبة', CASH = 'السيولة';

export default {
  code: 'accounting',
  title: 'المحاسبة',
  tabs: [
    { path: 'journal', title: 'القيود', group: IN, wide: true, subtitle: 'صفحة قيود شبيهة بـ Excel تُحفظ كلها مرة واحدة. يُعدَّل القيد المحفوظ أو يُلغى أو يُحذف من نافذته، وكل تعديل مسجّل.', render: (el) => renderJournal(el) },
    { path: 'register', title: 'سجل القيود', group: IN, render: renderRegister },
    { path: 'proposed', title: 'القيود المقترحة', group: IN, render: renderProposed },
    { path: 'deleted', title: 'القيود المحذوفة', group: IN, render: renderDeleted, visible: () => state.can('accounting', 3) },
    { path: 'import', title: 'استيراد قيود من Excel', group: IN, subtitle: 'القيود والأرصدة الافتتاحية من المنارة أو أي ملف بنفس الأعمدة — مراجعة كاملة قبل الحفظ', render: renderImport, visible: () => state.can('accounting', 3) },
    { path: 'contracts', title: 'العقود وأوامر الشراء', group: 'المشاريع', wide: true, subtitle: 'عقود العملاء وأوامر الشراء منهم ومقاولي الباطن: القيمة وتعديلاتها، والمستخلصات والفواتير، والدفعات المقدمة والمحتجزات', render: renderContracts },
    { path: 'liquidity', title: 'السيولة', group: CASH, subtitle: 'رصيد النقدية الآن، والمتوقع للأسابيع والأشهر القادمة', render: renderLiquidity },
    { path: 'cash-flow', title: 'التدفقات النقدية', group: CASH, subtitle: 'مصادر النقد واستخداماته — بالطريقة المباشرة، شهرًا بشهر', render: renderCashFlow },
    { path: 'bank', title: 'مطابقة البنك', group: CASH, wide: true, subtitle: 'ارفع كشف الحساب من البنك، ويطابقه النظام مع القيود ويُظهر الفروق', render: renderBank },
    { path: 'aging', title: 'أعمار الديون', group: CASH, subtitle: 'العملاء والموردون حسب التأخر عن تاريخ الاستحقاق', render: renderAging },
    { path: 'commitments', title: 'الالتزامات الثابتة', group: CASH, subtitle: 'إيجارات وأقساط ورواتب متكررة — تدخل في السيولة المتوقعة', render: renderCommitments },
    { path: 'accounts', title: 'شجرة الحسابات', group: SETUP, render: renderAccounts },
    { path: 'integrity', title: 'فحص سلامة البيانات', group: SETUP, subtitle: 'قواعد يجب أن تكون صحيحة دائمًا: توازن القيود والميزانية، والضريبة، والفواتير، والعقود — أي خطأ يظهر بالأحمر', render: renderIntegrity },
    { path: 'closing', title: 'إقفال السنة', group: SETUP, subtitle: 'نقل صافي ربح السنة إلى الأرباح المحتجزة بقيد إقفال في 31/12', render: renderClosing, visible: () => state.can('accounting', 3) },
    { path: 'trial-balance', title: 'ميزان المراجعة', group: REP, render: renderTrialBalance },
    { path: 'statement', title: 'كشف حساب', group: REP, render: renderStatement },
    { path: 'income', title: 'قائمة الدخل', group: REP, render: renderIncome },
    { path: 'balance-sheet', title: 'المركز المالي', group: REP, render: renderBalanceSheet },
    { path: 'parties', title: 'أرصدة الأطراف', group: REP, render: renderPartyBalances },
    { path: 'intercompany', title: 'مطابقة بين الشركات', group: REP, subtitle: 'ما تسجّله كل شركة على شقيقتها يجب أن يتقابل — والفرق يدل على فاتورة أو سداد ناقص', render: renderIntercompany },
    { path: 'projects', title: 'ربحية المشاريع', group: REP, render: renderProjects },
    { path: 'equipment', title: 'المعدات', group: REP, render: renderEquipment },
    { path: 'quotes', title: 'عروض الأسعار', group: TAX, wide: true, subtitle: 'عروض على ترويسة الشركة تُحفظ PDF: مسودة ← مُرسَل ← مقبول ← تحويل إلى فاتورة أو أمر شراء', render: renderQuotes },
    { path: 'sales', title: 'فواتير المبيعات', group: TAX, wide: true, subtitle: 'فواتير المنارة برقمها: تُربط بالعقد أو أمر الشراء والمشروع، وتمر بالاعتماد قبل أن تصبح قيدًا', render: renderSales },
    { path: 'invoices', title: 'الفواتير', group: TAX, render: renderInvoices },
    { path: 'vat', title: 'الإقرار الضريبي', group: TAX, render: renderVatReturn },
  ],
  search,
};

// قسم المحاسبة
import { state } from '../../shared/state.js';
import { renderAccounts } from './accounts.js';
import { renderJournal } from './journal.js';
import { renderRegister, renderProposed, renderDeleted } from './register.js';
import { renderTrialBalance, renderStatement, renderIncome, renderBalanceSheet, renderPartyBalances, renderProjects, renderEquipment, renderVatReturn, renderInvoices } from './reports.js';
import { search } from './search.js';
import { renderImport } from './import.js';
import { renderLiquidity, renderCashFlow, renderAging, renderCommitments } from './liquidity.js';
import { renderBank } from './bank.js';

const IN = 'الإدخال', SETUP = 'الإعداد', REP = 'التقارير', TAX = 'الفواتير والضريبة', CASH = 'السيولة';

export default {
  code: 'accounting',
  title: 'المحاسبة',
  tabs: [
    { path: 'journal', title: 'القيود', group: IN, wide: true, subtitle: 'صفحة قيود شبه Excel: كل الصفحة تُحفظ مرة واحدة. تعديل أو إلغاء أو حذف القيد المحفوظ من نافذته، وكل تعديل مسجّل.', render: (el) => renderJournal(el) },
    { path: 'register', title: 'سجل القيود', group: IN, render: renderRegister },
    { path: 'proposed', title: 'القيود المقترحة', group: IN, render: renderProposed },
    { path: 'deleted', title: 'القيود المحذوفة', group: IN, render: renderDeleted, visible: () => state.can('accounting', 3) },
    { path: 'import', title: 'استيراد قيود من Excel', group: IN, subtitle: 'القيود والأرصدة الافتتاحية من المنارة أو أي ملف بنفس الأعمدة — مراجعة كاملة قبل الحفظ', render: renderImport, visible: () => state.can('accounting', 3) },
    { path: 'liquidity', title: 'السيولة', group: CASH, subtitle: 'رصيد النقدية دلوقتي، والمتوقع للأسابيع والشهور الجاية', render: renderLiquidity },
    { path: 'cash-flow', title: 'التدفقات النقدية', group: CASH, subtitle: 'الفلوس جت منين وراحت فين — بالطريقة المباشرة، شهر بشهر', render: renderCashFlow },
    { path: 'bank', title: 'مطابقة البنك', group: CASH, wide: true, subtitle: 'ارفع كشف الحساب من البنك، والنظام يطابقه مع القيود ويطلعلك الفروق', render: renderBank },
    { path: 'aging', title: 'أعمار الديون', group: CASH, subtitle: 'العملاء والموردون حسب التأخير عن ميعاد الاستحقاق', render: renderAging },
    { path: 'commitments', title: 'الالتزامات الثابتة', group: CASH, subtitle: 'إيجارات وأقساط ورواتب بتتكرر — بتدخل في السيولة المتوقعة', render: renderCommitments },
    { path: 'accounts', title: 'شجرة الحسابات', group: SETUP, render: renderAccounts },
    { path: 'trial-balance', title: 'ميزان المراجعة', group: REP, render: renderTrialBalance },
    { path: 'statement', title: 'كشف حساب', group: REP, render: renderStatement },
    { path: 'income', title: 'قائمة الدخل', group: REP, render: renderIncome },
    { path: 'balance-sheet', title: 'المركز المالي', group: REP, render: renderBalanceSheet },
    { path: 'parties', title: 'أرصدة الأطراف', group: REP, render: renderPartyBalances },
    { path: 'projects', title: 'ربحية المشاريع', group: REP, render: renderProjects },
    { path: 'equipment', title: 'المعدات', group: REP, render: renderEquipment },
    { path: 'invoices', title: 'الفواتير', group: TAX, render: renderInvoices },
    { path: 'vat', title: 'الإقرار الضريبي', group: TAX, render: renderVatReturn },
  ],
  search,
};

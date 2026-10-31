// قسم المحاسبة
import { state } from '../../shared/state.js';
import { renderAccounts } from './accounts.js';
import { renderJournal } from './journal.js';
import { renderRegister, renderProposed } from './register.js';
import { renderTrialBalance, renderStatement, renderIncome, renderBalanceSheet, renderPartyBalances, renderProjects, renderEquipment } from './reports.js';

export default {
  code: 'accounting',
  title: 'المحاسبة',
  tabs: [
    { path: 'journal', title: 'القيود', subtitle: 'صفحة قيود شبه Excel: كل الصفحة تُحفظ مرة واحدة، والمحفوظ لا يُعدَّل', render: (el) => renderJournal(el) },
    { path: 'register', title: 'سجل القيود', render: renderRegister },
    { path: 'proposed', title: 'القيود المقترحة', render: renderProposed },
    { path: 'accounts', title: 'شجرة الحسابات', render: renderAccounts },
    { path: 'trial-balance', title: 'ميزان المراجعة', render: renderTrialBalance },
    { path: 'statement', title: 'كشف حساب', render: renderStatement },
    { path: 'income', title: 'قائمة الدخل', render: renderIncome },
    { path: 'balance-sheet', title: 'المركز المالي', render: renderBalanceSheet },
    { path: 'parties', title: 'أرصدة الأطراف', render: renderPartyBalances },
    { path: 'projects', title: 'ربحية المشاريع', render: renderProjects },
    { path: 'equipment', title: 'المعدات', render: renderEquipment, visible: () => state.can('accounting', 1) },
  ],
};

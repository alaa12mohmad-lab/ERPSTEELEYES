// قسم المستخدمين والصلاحيات: المستخدمون، الأدوار، الأقسام، الإعدادات، سجل المراجعة
import { core, errMsg, insertRows, updateRow, rpc, callFn } from '../../shared/sb.js';
import { h, modal, toast, fmt, LEVELS, confirmDialog } from '../../shared/ui.js';
import { state } from '../../shared/state.js';
import { renderMaster, opts } from '../../shared/master.js';
import { renderSystem } from './system.js';

async function fetchAll() {
  const [roles, modules, sensitive, projects, employees] = await Promise.all([
    core.from('roles').select('*').eq('status', 'active').order('created_at'),
    core.from('modules').select('*').eq('status', 'active').order('sort_order'),
    core.from('sensitive_items').select('*').eq('status', 'active').order('created_at'),
    core.from('v_projects').select('id, code, name, lead_company_id, companies').eq('status', 'active').order('code'),
    core.from('employees').select('id, employee_no, full_name, company_id').eq('status', 'active').order('full_name'),
  ]);
  return { roles: roles.data || [], modules: modules.data || [], sensitive: sensitive.data || [], projects: projects.data || [], employees: employees.data || [] };
}

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(10); crypto.getRandomValues(a);
  return Array.from(a, (n) => chars[n % chars.length]).join('') + '!7';
}

// إعادة استخدام صف موجود (لأن لا حذف): تفعيل/تعديل أو إلغاء
async function setOverride(table, existing, match, values) {
  if (values === null) {
    if (existing && existing.status === 'active') await updateRow(table, existing.id, { status: 'cancelled', cancel_reason: 'إرجاع للافتراضي' });
    return;
  }
  if (existing) await updateRow(table, existing.id, { ...values, status: 'active', cancel_reason: null });
  else await insertRows(table, [{ ...match, ...values }]);
}

// ---------------------------------------------------------------------
// المستخدمون
// ---------------------------------------------------------------------
async function renderUsers(el) {
  const meta = await fetchAll();
  const tbody = h('tbody');
  const card = h('div', { class: 'card' },
    h('div', { class: 'toolbar' }, h('div', { class: 'grow' }), h('button', { class: 'btn primary', onclick: () => openUser(null) }, '+ مستخدم جديد')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['الاسم', 'البريد الإلكتروني', 'الدور', 'الشركات', 'المشاريع', 'آخر دخول', 'الحالة'].map((t) => h('th', {}, t)))), tbody)));
  el.replaceChildren(h('p', { class: 'notice', style: { marginBottom: '14px' } },
    'الحساب يُنشأ مفعّلًا فورًا بالبريد الإلكتروني وكلمة المرور التي تحددها، ولا تُرسل أي رسالة بريد. يغيّر المستخدم كلمة المرور عند أول دخول.'), card);

  async function load() {
    const { data, error } = await core.from('v_users').select('*').order('created_at');
    if (error) { tbody.replaceChildren(h('tr', {}, h('td', { colspan: 7, class: 'empty' }, errMsg(error)))); return; }
    tbody.replaceChildren(...data.map((u) => h('tr', { class: u.is_active ? '' : 'dim', onclick: () => openUser(u) },
      h('td', {}, u.full_name, u.is_admin && h('span', { class: 'badge accent', style: { marginInlineStart: '6px' } }, 'مدير النظام')),
      h('td', { class: 'ltr' }, u.email),
      h('td', {}, u.role_name || '—'),
      h('td', {}, u.all_companies || u.is_admin ? 'الكل' : u.company_ids.map((id) => state.companyName(id)).join('، ') || '—'),
      h('td', {}, u.all_projects || u.is_admin ? 'كل مشاريع شركاته' : `${u.project_ids.length} مشروع`),
      h('td', {}, fmt.datetime(u.last_login_at) || '—'),
      h('td', {}, u.is_active ? h('span', { class: 'badge ok' }, 'نشط') : h('span', { class: 'badge bad' }, 'موقوف'),
        u.must_change_password && h('span', { class: 'badge warn', style: { marginInlineStart: '6px' } }, 'لم يغيّر كلمة المرور')))));
  }

  function scopeFields(u) {
    const allC = h('input', { type: 'checkbox', checked: !!u?.all_companies });
    const compChecks = state.companies().map((c) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: c.id, checked: (u?.company_ids || []).includes(c.id) }), c.name));
    const allP = h('input', { type: 'checkbox', checked: !!u?.all_projects });
    const projBox = h('div', { class: 'checks', style: { maxHeight: '180px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '8px', padding: '8px' } });
    const drawProjects = () => {
      const chosen = allC.checked ? state.companies().map((c) => c.id) : compChecks.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
      const prev = new Set([...projBox.querySelectorAll('input:checked')].map((i) => i.value).concat(projBox.dataset.init ? [] : (u?.project_ids || [])));
      projBox.dataset.init = '1';
      const list = meta.projects.filter((p) => p.companies.some((c) => chosen.includes(c.id)));
      projBox.replaceChildren(...(list.length ? list.map((p) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: p.id, checked: prev.has(p.id) }), p.code + ' — ' + p.name))
        : [h('span', { class: 'help' }, 'لا توجد مشاريع في الشركات المختارة')]));
      projBox.style.opacity = allP.checked ? '.45' : '1';
    };
    [allC, allP, ...compChecks.map((l) => l.querySelector('input'))].forEach((i) => i.addEventListener('change', drawProjects));
    drawProjects();
    const ui = h('div', { class: 'field wide' },
      h('label', {}, 'النطاق: الشركات'),
      h('label', { class: 'check' }, allC, 'كل الشركات'), h('div', { class: 'checks' }, compChecks),
      h('label', { style: { marginTop: '10px' } }, 'النطاق: المشاريع'),
      h('label', { class: 'check' }, allP, 'كل مشاريع الشركات المختارة'), projBox);
    const read = () => ({
      all_companies: allC.checked, all_projects: allP.checked,
      company_ids: allC.checked ? [] : compChecks.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value),
      project_ids: allP.checked ? [] : [...projBox.querySelectorAll('input:checked')].map((i) => i.value),
    });
    return { ui, read };
  }

  function openUser(u) {
    const isNew = !u;
    const m = modal({ title: isNew ? 'مستخدم جديد' : u.full_name, size: 'wide' });
    const name = h('input', { class: 'input', id: 'u_name', value: u?.full_name || '' });
    const email = h('input', { class: 'input ltr', id: 'u_email', type: 'email', value: u?.email || '', readonly: !isNew });
    const pass = h('input', { class: 'input ltr', id: 'u_pass', value: isNew ? genPassword() : '' });
    const role = h('select', { class: 'input', id: 'u_role' }, h('option', { value: '' }, '—'),
      meta.roles.map((r) => h('option', { value: r.id, selected: r.id === u?.role_id }, r.name)));
    const emp = h('select', { class: 'input', id: 'u_emp' }, h('option', { value: '' }, 'غير مرتبط بموظف'),
      meta.employees.map((e) => h('option', { value: e.id, selected: e.id === u?.employee_id }, `${e.full_name} (${e.employee_no} — ${state.companyName(e.company_id)})`)));
    const mfa = h('input', { type: 'checkbox', checked: !!u?.mfa_required });
    const scope = scopeFields(u);
    m.body.append(h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', { for: 'u_name' }, 'الاسم', h('span', { class: 'req' }, '*')), name),
      h('div', { class: 'field' }, h('label', { for: 'u_email' }, 'البريد الإلكتروني (اسم الدخول)', h('span', { class: 'req' }, '*')), email,
        isNew && h('div', { class: 'help' }, 'لا يلزم أن يكون بريدًا إلكترونيًا حقيقيًا — النظام لا يرسل له شيئًا')),
      isNew && h('div', { class: 'field' }, h('label', { for: 'u_pass' }, 'كلمة المرور المبدئية'), pass,
        h('div', { class: 'help' }, 'أعطها للموظف؛ سيطلب منه تغييرها أول دخول')),
      h('div', { class: 'field' }, h('label', { for: 'u_role' }, 'الدور'), role),
      h('div', { class: 'field' }, h('label', { for: 'u_emp' }, 'الموظف المرتبط'), emp),
      h('div', { class: 'field' }, h('label', { class: 'check', style: { marginTop: '24px' } }, mfa, 'إلزام التحقق بخطوتين')),
      u?.is_admin ? h('div', { class: 'field wide' }, h('div', { class: 'notice' }, 'مدير النظام يرى ويدير كل شيء.')) : scope.ui));

    const save = async () => {
      if (!name.value.trim() || !email.value.trim()) { toast('الاسم والبريد الإلكتروني مطلوبان', 'bad'); return; }
      const sc = scope.read();
      btn.disabled = true;
      try {
        if (isNew) {
          const res = await callFn('admin-users', {
            action: 'create', email: email.value.trim(), password: pass.value, full_name: name.value.trim(),
            role_id: role.value || null, employee_id: emp.value || null, mfa_required: mfa.checked, ...sc,
          });
          if (res.warning) toast(res.warning, 'bad');
        } else {
          await updateRow('app_users', u.id, {
            full_name: name.value.trim(), role_id: role.value || null, employee_id: emp.value || null, mfa_required: mfa.checked,
            ...(u.is_admin ? {} : { all_companies: sc.all_companies, all_projects: sc.all_projects }),
          });
          if (!u.is_admin) await rpc('set_user_scope', { p_user: u.id, p_company_ids: sc.company_ids, p_project_ids: sc.project_ids });
        }
        toast('تم الحفظ', 'ok'); m.close(); load();
      } catch (e) { toast(e.message, 'bad'); } finally { btn.disabled = false; }
    };
    const btn = h('button', { class: 'btn primary', onclick: save }, isNew ? 'إنشاء الحساب' : 'حفظ');
    m.foot.append(btn);
    if (!isNew) {
      m.foot.append(h('button', { class: 'btn', onclick: () => openOverrides(u) }, 'استثناءات الصلاحيات'));
      m.foot.append(h('button', { class: 'btn', onclick: () => resetPassword(u) }, 'تعيين كلمة مرور'));
      m.foot.append(h('span', { class: 'spacer' }));
      if (u.id !== state.profile.id) {
        m.foot.append(h('button', { class: 'btn ' + (u.is_active ? 'danger' : ''), onclick: async () => {
          if (u.is_active && !(await confirmDialog(`إيقاف حساب ${u.full_name}؟ لن يستطيع الدخول، وكل ما سجّله يبقى.`, { ok: 'إيقاف', danger: true }))) return;
          try { await callFn('admin-users', { action: 'set_active', user_id: u.id, active: !u.is_active }); toast('تم', 'ok'); m.close(); load(); } catch (e) { toast(e.message, 'bad'); }
        } }, u.is_active ? 'إيقاف الحساب' : 'تفعيل الحساب'));
      }
    }
  }

  function resetPassword(u) {
    const m = modal({ title: `كلمة مرور جديدة — ${u.full_name}`, size: 'narrow' });
    const p = h('input', { class: 'input ltr', value: genPassword(), id: 'rp' });
    m.body.append(h('div', { class: 'field' }, h('label', { for: 'rp' }, 'كلمة المرور الجديدة'), p,
      h('div', { class: 'help' }, 'أعطها للموظف؛ سيطلب منه تغييرها عند الدخول')));
    m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
      try { await callFn('admin-users', { action: 'set_password', user_id: u.id, password: p.value }); toast('تم تعيين كلمة المرور', 'ok'); m.close(); load(); } catch (e) { toast(e.message, 'bad'); }
    } }, 'حفظ'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
  }

  async function openOverrides(u) {
    const m = modal({ title: `استثناءات الصلاحيات — ${u.full_name}` });
    const [{ data: po }, { data: so }] = await Promise.all([
      core.from('user_permission_overrides').select('*').eq('user_id', u.id),
      core.from('user_sensitive_overrides').select('*').eq('user_id', u.id),
    ]);
    const modSel = meta.modules.map((mod) => {
      const ex = (po || []).find((x) => x.module_code === mod.code && x.status === 'active');
      const s = h('select', { class: 'input' }, h('option', { value: '' }, 'حسب الدور'), LEVELS.map((l, i) => h('option', { value: i, selected: ex && ex.level === i }, l)));
      return { mod, s };
    });
    const senSel = meta.sensitive.map((it) => {
      const ex = (so || []).find((x) => x.item_code === it.code && x.status === 'active');
      const s = h('select', { class: 'input' }, h('option', { value: '' }, 'حسب الدور'),
        h('option', { value: 'true', selected: ex?.allowed === true }, 'مسموح'), h('option', { value: 'false', selected: ex?.allowed === false }, 'ممنوع'));
      return { it, s };
    });
    m.body.append(
      h('p', { class: 'notice' }, 'الاستثناء يتقدم على صلاحيات الدور لهذا المستخدم فقط، ويُسجَّل باسمك.'),
      h('table', { class: 'grid matrix', style: { marginTop: '12px' } }, h('tbody', {},
        modSel.map(({ mod, s }) => h('tr', { style: { cursor: 'default' } }, h('td', {}, mod.name), h('td', {}, s))),
        h('tr', {}, h('th', { colspan: 2 }, 'البيانات الحساسة')),
        senSel.map(({ it, s }) => h('tr', { style: { cursor: 'default' } }, h('td', {}, it.name), h('td', {}, s))))));
    m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
      try {
        for (const { mod, s } of modSel) {
          const ex = (po || []).find((x) => x.module_code === mod.code);
          const want = s.value === '' ? null : { level: Number(s.value) };
          if (!want && !(ex && ex.status === 'active')) continue;
          if (want && ex && ex.status === 'active' && ex.level === want.level) continue;
          await setOverride('user_permission_overrides', ex, { user_id: u.id, module_code: mod.code }, want);
        }
        for (const { it, s } of senSel) {
          const ex = (so || []).find((x) => x.item_code === it.code);
          const want = s.value === '' ? null : { allowed: s.value === 'true' };
          if (!want && !(ex && ex.status === 'active')) continue;
          if (want && ex && ex.status === 'active' && ex.allowed === want.allowed) continue;
          await setOverride('user_sensitive_overrides', ex, { user_id: u.id, item_code: it.code }, want);
        }
        toast('تم حفظ الاستثناءات', 'ok'); m.close();
      } catch (e) { toast(e.message, 'bad'); }
    } }, 'حفظ'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
  }

  load();
}

// ---------------------------------------------------------------------
// الأدوار: مصفوفة الصلاحيات
// ---------------------------------------------------------------------
async function renderRoles(el) {
  const meta = await fetchAll();
  const [{ data: rp }, { data: rs }] = await Promise.all([
    core.from('role_permissions').select('*'), core.from('role_sensitive').select('*'),
  ]);
  const perms = rp || [], sens = rs || [];
  const save = async (fn) => { try { await fn(); toast('تم الحفظ', 'ok'); renderRoles(el); } catch (e) { toast(e.message, 'bad'); } };

  const table = h('table', { class: 'grid matrix' },
    h('thead', {}, h('tr', {}, h('th', {}, 'الدور'), meta.modules.map((m) => h('th', {}, m.name)), meta.sensitive.map((s) => h('th', {}, s.name)))),
    h('tbody', {}, meta.roles.map((r) => h('tr', { style: { cursor: 'default' } },
      h('td', { style: { fontWeight: 600 } }, r.name),
      meta.modules.map((mod) => {
        const ex = perms.find((p) => p.role_id === r.id && p.module_code === mod.code);
        const cur = ex && ex.status === 'active' ? ex.level : 0;
        return h('td', {}, h('select', { class: 'input', onchange: (e) => save(() =>
          setOverride('role_permissions', ex, { role_id: r.id, module_code: mod.code }, { level: Number(e.target.value) })) },
        LEVELS.map((l, i) => h('option', { value: i, selected: i === cur }, l))));
      }),
      meta.sensitive.map((it) => {
        const ex = sens.find((p) => p.role_id === r.id && p.item_code === it.code);
        const cur = ex && ex.status === 'active' && ex.allowed;
        return h('td', { style: { textAlign: 'center' } }, h('input', { type: 'checkbox', checked: cur, style: { width: '18px', height: '18px' }, onchange: (e) => save(() =>
          setOverride('role_sensitive', ex, { role_id: r.id, item_code: it.code }, { allowed: e.target.checked })) }));
      })))));

  const addRole = () => {
    const m = modal({ title: 'دور جديد', size: 'narrow' });
    const code = h('input', { class: 'input ltr', id: 'rc', placeholder: 'project_manager' });
    const name = h('input', { class: 'input', id: 'rn', placeholder: 'مدير مشروع' });
    m.body.append(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('div', { class: 'field' }, h('label', { for: 'rn' }, 'الاسم'), name), h('div', { class: 'field' }, h('label', { for: 'rc' }, 'الكود (إنجليزي)'), code)));
    m.foot.append(h('button', { class: 'btn primary', onclick: async () => {
      if (!code.value.trim() || !name.value.trim()) { toast('الكود والاسم مطلوبان', 'bad'); return; }
      try { await insertRows('roles', [{ code: code.value.trim(), name: name.value.trim() }]); m.close(); renderRoles(el); } catch (e) { toast(e.message, 'bad'); }
    } }, 'إضافة'), h('button', { class: 'btn', onclick: m.close }, 'رجوع'));
  };

  el.replaceChildren(
    h('p', { class: 'notice', style: { marginBottom: '14px' } }, 'المستويات: لا يرى ← يرى ← يضيف ← يعدّل ← يعتمد. التغيير يُحفظ فورًا ويسري على كل مستخدمي الدور (إلا من له استثناء). مدير النظام له كل الصلاحيات دائمًا.'),
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: addRole }, '+ دور جديد')),
      h('div', { class: 'table-wrap' }, table)));
}

// ---------------------------------------------------------------------
// الأقسام
// ---------------------------------------------------------------------
async function renderModules(el) {
  const { data, error } = await core.from('modules').select('*').order('sort_order');
  if (error) { el.replaceChildren(h('div', { class: 'notice bad' }, errMsg(error))); return; }
  el.replaceChildren(
    h('p', { class: 'notice', style: { marginBottom: '14px' } }, 'القسم غير المفعّل لا يظهر لأي مستخدم غير المدير. فعّل القسم بعد تجهيزه.'),
    h('div', { class: 'card' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, h('th', {}, 'القسم'), h('th', {}, 'الكود'), h('th', {}, 'مفعّل'))),
      h('tbody', {}, data.map((m) => h('tr', { style: { cursor: 'default' } },
        h('td', {}, m.name), h('td', { class: 'ltr' }, m.code),
        h('td', {}, h('input', { type: 'checkbox', checked: m.is_enabled, disabled: ['core', 'admin'].includes(m.code), style: { width: '18px', height: '18px' },
          onchange: async (e) => { try { await updateRow('modules', m.id, { is_enabled: e.target.checked }); toast('تم', 'ok'); } catch (err) { toast(err.message, 'bad'); e.target.checked = !e.target.checked; } } }))))))));
}

// ---------------------------------------------------------------------
// سجل المراجعة
// ---------------------------------------------------------------------
const TABLE_NAMES = {
  'core.companies': 'الشركات', 'core.projects': 'المشاريع', 'core.project_companies': 'شركات المشروع', 'core.parties': 'الأطراف',
  'core.equipment': 'المعدات', 'core.employees': 'الموظفون', 'core.prices': 'الأسعار', 'core.locations': 'الأماكن',
  'core.cost_centers': 'مراكز التكلفة', 'core.categories': 'التصنيفات', 'core.units': 'الوحدات', 'core.settings': 'الإعدادات',
  'core.app_users': 'المستخدمون', 'core.user_companies': 'نطاق الشركات', 'core.user_projects': 'نطاق المشاريع',
  'core.roles': 'الأدوار', 'core.role_permissions': 'صلاحيات الأدوار', 'core.role_sensitive': 'البيانات الحساسة للأدوار',
  'core.user_permission_overrides': 'استثناءات الصلاحيات', 'core.user_sensitive_overrides': 'استثناءات البيانات الحساسة',
  'core.modules': 'الأقسام', 'core.attachments': 'المرفقات', 'core.price_kinds': 'أنواع الأسعار', 'core.sensitive_items': 'البيانات الحساسة',
};

async function renderAudit(el) {
  const tableSel = h('select', { class: 'input', style: { width: 'auto' } }, h('option', { value: '' }, 'كل الجداول'),
    Object.entries(TABLE_NAMES).map(([k, v]) => h('option', { value: k }, v)));
  const tbody = h('tbody');
  const { data: users } = await core.from('v_user_names').select('id, full_name');
  const name = (id) => (users || []).find((u) => u.id === id)?.full_name || (id ? '—' : 'النظام');
  const load = async () => {
    let q = core.from('audit_log').select('*').order('id', { ascending: false }).limit(300);
    if (tableSel.value) q = q.eq('table_name', tableSel.value);
    const { data, error } = await q;
    if (error) { tbody.replaceChildren(h('tr', {}, h('td', { colspan: 5, class: 'empty' }, errMsg(error)))); return; }
    tbody.replaceChildren(...data.map((a) => h('tr', { onclick: () => {
      const m = modal({ title: `${TABLE_NAMES[a.table_name] || a.table_name} — ${{ insert: 'إضافة', update: 'تعديل', delete: 'حذف' }[a.action]}`, size: 'wide' });
      m.body.append(h('dl', { class: 'kv' }, h('dt', {}, 'الوقت'), h('dd', {}, fmt.datetime(a.at)), h('dt', {}, 'المستخدم'), h('dd', {}, name(a.user_id)),
        h('dt', {}, 'السجل'), h('dd', { class: 'ltr' }, a.record_id || ''),
        a.old_data && [h('dt', {}, 'قبل'), h('dd', {}, h('pre', { class: 'json' }, JSON.stringify(a.old_data, null, 2)))],
        h('dt', {}, a.action === 'insert' ? 'البيانات' : 'بعد'), h('dd', {}, h('pre', { class: 'json' }, JSON.stringify(a.new_data, null, 2)))));
      m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'إغلاق'));
    } },
      h('td', {}, fmt.datetime(a.at)), h('td', {}, name(a.user_id)), h('td', {}, TABLE_NAMES[a.table_name] || a.table_name),
      h('td', {}, a.action === 'insert' ? h('span', { class: 'badge ok' }, 'إضافة') : a.action === 'delete' ? h('span', { class: 'badge bad' }, 'حذف') : h('span', { class: 'badge' }, 'تعديل')),
      h('td', { style: { whiteSpace: 'normal', maxWidth: '420px', color: 'var(--ink-2)', fontSize: '13px' } },
        a.action === 'update' ? Object.keys(a.new_data || {}).join('، ') : (a.new_data?.name || a.new_data?.code || a.new_data?.full_name || '')))));
  };
  tableSel.addEventListener('change', load);
  el.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'toolbar' }, tableSel, h('span', { class: 'help' }, 'آخر 300 عملية')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['الوقت', 'المستخدم', 'الجدول', 'العملية', 'التفاصيل'].map((t) => h('th', {}, t)))), tbody))));
  load();
}

export default {
  code: 'admin',
  title: 'المستخدمون والصلاحيات',
  tabs: [
    { path: 'system', title: 'هوية النظام وإعداداته', render: renderSystem },
    { path: 'users', title: 'المستخدمون', render: renderUsers },
    { path: 'roles', title: 'الأدوار والصلاحيات', render: renderRoles },
    { path: 'modules', title: 'الأقسام', render: renderModules },
    {
      path: 'settings', title: 'الإعدادات المتقدمة',
      render: (el) => renderMaster(el, {
        title: 'الإعداد', titleKey: 'key', table: 'settings', module: 'admin', companyField: 'company_id', companyNullable: true,
        order: [{ col: 'key' }],
        columns: [
          { key: 'key', label: 'المفتاح' }, { key: 'description', label: 'الوصف' },
          { key: 'value', label: 'القيمة', render: (r) => JSON.stringify(r.value) },
          { key: 'company_id', label: 'الشركة', render: (r) => (r.company_id ? state.companyName(r.company_id) : 'عام') },
        ],
        fields: [
          { key: 'key', label: 'المفتاح', required: true, readonlyOnEdit: true, ltr: true },
          { key: 'company_id', label: 'الشركة', type: 'select', options: opts.companies(), placeholder: 'عام لكل الشركات', readonlyOnEdit: true },
          { key: 'value', label: 'القيمة', required: true, ltr: true, help: 'رقم، أو true / false، أو نص بين علامتي تنصيص' },
          { key: 'description', label: 'الوصف' },
        ],
        defaults: () => ({}),
        beforeSave: (v) => {
          if (v.value === undefined) return {};
          const raw = typeof v.value === 'string' ? v.value : JSON.stringify(v.value);
          try { return { value: JSON.parse(raw) }; } catch { return { value: raw }; }
        },
      }),
    },
    { path: 'audit', title: 'سجل المراجعة', render: renderAudit },
  ],
};

// شاشة بيانات أساسية عامة: قائمة + بحث + فلترة + إضافة/تعديل + أرشفة/إلغاء + استيراد/تصدير Excel
// كل قسم يعرّف شاشته بإعدادات فقط، بدون تكرار كود
import { core, db, errMsg, updateRow, insertRows } from './sb.js';
import { h, modal, toast, askReason, fmt, statusBadge } from './ui.js';
import { state } from './state.js';

export async function loadOptions(field) {
  if (!field.options) return [];
  return await field.options();
}

// ---------------------------------------------------------------------
// عناصر الحقول
// ---------------------------------------------------------------------
function fieldInput(f, value, opts, readonly) {
  const id = 'f_' + f.key;
  let input;
  if (f.type === 'select') {
    input = h('select', { class: 'input', id, disabled: readonly });
    if (!f.required || value === null || value === undefined) input.append(h('option', { value: '' }, f.placeholder || '—'));
    for (const o of opts) input.append(h('option', { value: o.value, selected: String(o.value) === String(value ?? '') }, o.label));
  } else if (f.type === 'bool') {
    input = h('input', { type: 'checkbox', id, checked: !!value, disabled: readonly });
    return h('div', { class: 'field' + (f.wide ? ' wide' : '') },
      h('label', { class: 'check', style: { marginTop: '24px' } }, input, f.label),
      f.help && h('div', { class: 'help' }, f.help));
  } else if (f.type === 'textarea') {
    input = h('textarea', { class: 'input', id, readonly }, value ?? '');
  } else {
    input = h('input', {
      class: 'input' + (f.ltr ? ' ltr' : ''), id, readonly,
      type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text',
      step: f.type === 'number' ? (f.step || 'any') : null,
      value: value ?? '', placeholder: f.placeholder || '', inputmode: f.inputmode || null,
    });
  }
  return h('div', { class: 'field' + (f.wide || f.type === 'textarea' ? ' wide' : '') },
    h('label', { for: id }, f.label, f.required && h('span', { class: 'req' }, '*')),
    input, f.help && h('div', { class: 'help' }, f.help));
}

function readField(root, f) {
  const el = root.querySelector('#f_' + f.key);
  if (!el) return undefined;
  if (f.type === 'bool') return el.checked;
  const v = el.value.trim();
  if (v === '') return null;
  if (f.type === 'number') return Number(v);
  return v;
}

// ---------------------------------------------------------------------
// الشاشة
// ---------------------------------------------------------------------
export function renderMaster(container, cfg) {
  const lvlAdd = cfg.levelAdd ?? 2, lvlEdit = cfg.levelEdit ?? 3;
  const canAdd = () => state.can(cfg.module, lvlAdd) && cfg.allowAdd !== false;
  const canEdit = () => state.can(cfg.module, lvlEdit);
  let rows = [];
  let statusFilter = 'active';
  let search = '';

  const searchInput = h('input', { class: 'input grow', placeholder: 'بحث…', oninput: (e) => { search = e.target.value.trim(); draw(); } });
  const statusSel = h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => { statusFilter = e.target.value; load(); } },
    h('option', { value: 'active' }, 'النشط'), h('option', { value: 'archived' }, 'المؤرشف'),
    h('option', { value: 'cancelled' }, 'الملغي'), h('option', { value: 'all' }, 'الكل'));
  const tbody = h('tbody');
  const countEl = h('div', { class: 'count' });
  const table = h('table', { class: 'grid' },
    h('thead', {}, h('tr', {}, cfg.columns.map((c) => h('th', {}, c.label)), h('th', {}, 'الحالة'))), tbody);

  const toolbar = h('div', { class: 'toolbar' }, searchInput, statusSel,
    canAdd() && h('button', { class: 'btn primary', onclick: () => openForm(null) }, '+ إضافة'),
    cfg.importable && canAdd() && h('button', { class: 'btn', onclick: openImport }, 'استيراد Excel'),
    h('button', { class: 'btn', onclick: exportXlsx }, 'تصدير'),
    ...(cfg.toolbarExtras ? cfg.toolbarExtras({ reload: load, redraw: () => draw() }) : []));

  container.replaceChildren(h('div', { class: 'card' }, toolbar, h('div', { class: 'table-wrap' }, table), countEl));

  const off = cfg.companyField ? state.onCompaniesChange(() => { if (document.body.contains(container)) load(); else off(); }) : null;

  async function load() {
    tbody.replaceChildren(h('tr', {}, h('td', { colspan: cfg.columns.length + 1, class: 'empty' }, 'جارٍ التحميل…')));
    let q = db(cfg.schema).from(cfg.view || cfg.table).select(cfg.select || '*');
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    if (cfg.companyField && !state.allCompaniesSelected()) {
      const ids = state.selectedCompanies.join(',');
      q = cfg.companyNullable ? q.or(`${cfg.companyField}.is.null,${cfg.companyField}.in.(${ids})`) : q.in(cfg.companyField, state.selectedCompanies);
    }
    if (cfg.filter) q = cfg.filter(q);
    for (const o of cfg.order || [{ col: 'code', asc: true }]) q = q.order(o.col, { ascending: o.asc !== false });
    const { data, error } = await q.limit(5000);
    if (error) { tbody.replaceChildren(h('tr', {}, h('td', { colspan: cfg.columns.length + 1, class: 'empty' }, errMsg(error)))); return; }
    rows = data || [];
    draw();
  }

  function cellText(c, r) {
    const v = c.render ? c.render(r) : r[c.key];
    return v instanceof Node ? v.textContent : (v ?? '');
  }

  // cfg.rowVisible(r, rows): إخفاء صفوف عند عدم البحث (مثل طي الشجرة). البحث يعرض كل النتائج
  function visibleRows() {
    if (!search) return cfg.rowVisible ? rows.filter((r) => cfg.rowVisible(r, rows)) : rows;
    const s = search.toLowerCase();
    const keys = cfg.searchKeys || cfg.columns.map((c) => c.key);
    return rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(s))
      || cfg.columns.some((c) => String(cellText(c, r)).toLowerCase().includes(s)));
  }

  function draw() {
    const list = visibleRows();
    if (list.length === 0) {
      tbody.replaceChildren(h('tr', {}, h('td', { colspan: cfg.columns.length + 1, class: 'empty' }, rows.length ? 'لا نتائج للبحث' : 'لا توجد بيانات بعد')));
    } else {
      tbody.replaceChildren(...list.map((r) => h('tr', { class: r.status !== 'active' ? 'dim' : '', onclick: () => openForm(r) },
        cfg.columns.map((c) => {
          const v = c.render ? c.render(r) : r[c.key];
          return h('td', { class: c.num ? 'num' : '' }, v instanceof Node ? v : (c.num ? fmt.num(v, c.digits ?? 2) : (v ?? '')));
        }),
        h('td', {}, statusBadge(r.status)))));
    }
    countEl.textContent = `${list.length} سجل`;
  }

  // -------------------------------------------------------------------
  // نموذج الإضافة / التعديل
  // -------------------------------------------------------------------
  async function openForm(row) {
    const isNew = !row;
    const editable = isNew ? canAdd() : (canEdit() && row.status !== 'cancelled');
    const m = modal({ title: isNew ? `إضافة — ${cfg.title}` : `${cfg.title}: ${row[cfg.titleKey || 'name'] ?? row.code ?? ''}`, size: cfg.wideForm ? 'wide' : '' });
    m.body.append(h('div', { class: 'empty' }, 'جارٍ التحميل…'));

    const rec = isNew ? { ...(cfg.defaults ? cfg.defaults() : {}) } : { ...row };
    if (isNew && cfg.companyField && rec[cfg.companyField] === undefined && state.selectedCompanies.length === 1) {
      rec[cfg.companyField] = state.selectedCompanies[0];
    }
    const fields = cfg.fields.filter((f) => !f.showIf || f.showIf(rec));
    const optsList = await Promise.all(fields.map((f) => loadOptions(f)));
    const grid = h('div', { class: 'form-grid' });
    fields.forEach((f, i) => {
      const ro = !editable || (!isNew && f.readonlyOnEdit) || f.readonly;
      grid.append(fieldInput(f, rec[f.key] ?? (isNew ? f.default : null), optsList[i], ro));
    });
    m.body.replaceChildren(grid);
    if (!isNew && row.status === 'cancelled') m.body.prepend(h('div', { class: 'notice bad', style: { marginBottom: '14px' } }, 'سجل ملغي: ' + (row.cancel_reason || '')));
    if (!isNew && cfg.formExtras) {
      const extra = h('div', { style: { marginTop: '18px' } });
      m.body.append(extra);
      cfg.formExtras(row, extra, { editable, reload: load });
    }
    if (!isNew) {
      m.body.append(h('div', { class: 'help', style: { marginTop: '16px', color: 'var(--ink-3)', fontSize: 'calc(12px * var(--fs, 1))' } },
        `أُنشئ ${fmt.datetime(row.created_at)} — آخر تعديل ${fmt.datetime(row.updated_at)}`));
    }

    const save = async () => {
      const values = {};
      for (const f of fields) {
        if (f.readonly || (!isNew && f.readonlyOnEdit)) continue;
        values[f.key] = readField(m.body, f);
        if (f.required && (values[f.key] === null || values[f.key] === undefined || values[f.key] === '')) {
          toast(`الحقل "${f.label}" مطلوب`, 'bad'); m.body.querySelector('#f_' + f.key)?.focus(); return;
        }
      }
      const problem = cfg.validate?.(values, rec);
      if (problem) { toast(problem, 'bad'); return; }
      if (cfg.beforeSave) {
        try { Object.assign(values, cfg.beforeSave(values, rec)); } catch (e) { toast(e.message, 'bad'); return; }
      }
      if (!isNew && Object.keys(values).length === 0) { m.close(); return; }
      saveBtn.disabled = true;
      try {
        let id;
        if (isNew) id = (await insertRows(cfg.table, [values], cfg.schema))[0].id;
        else { await updateRow(cfg.table, row.id, values, cfg.schema); id = row.id; }
        await cfg.onSaved?.(id, values, isNew);
        toast('تم الحفظ', 'ok');
        m.close();
        load();
      } catch (e) {
        toast(e.message, 'bad');
      } finally { saveBtn.disabled = false; }
    };

    const saveBtn = h('button', { class: 'btn primary', onclick: save }, 'حفظ');
    if (editable) m.foot.append(saveBtn);
    if (!isNew && cfg.rowActions) {
      for (const a of cfg.rowActions) {
        if (a.show && !a.show(row)) continue;
        m.foot.append(h('button', { class: 'btn', onclick: () => a.run(row, { close: m.close, reload: load }) }, a.label));
      }
    }
    m.foot.append(h('span', { class: 'spacer' }));
    if (!isNew && canEdit() && cfg.allowStatus !== false) {
      const setStatus = async (status, reason = null) => {
        try {
          await updateRow(cfg.table, row.id, { status, cancel_reason: reason }, cfg.schema);
          toast(status === 'active' ? 'تمت الاستعادة' : status === 'archived' ? 'تمت الأرشفة' : 'تم الإلغاء', 'ok');
          m.close(); load();
        } catch (e) { toast(e.message, 'bad'); }
      };
      if (row.status === 'active') {
        m.foot.append(h('button', { class: 'btn', onclick: () => setStatus('archived') }, 'أرشفة'));
        m.foot.append(h('button', { class: 'btn danger', onclick: async () => { const r = await askReason(); if (r) setStatus('cancelled', r); } }, 'إلغاء السجل'));
      } else {
        m.foot.append(h('button', { class: 'btn', onclick: () => setStatus('active') }, 'استعادة'));
      }
    }
    if (!isNew && state.profile?.is_admin) {
      m.foot.append(h('button', { class: 'btn ghost', onclick: () => showHistory(row.id, cfg.title) }, 'السجل'));
    }
  }

  // -------------------------------------------------------------------
  // الاستيراد من Excel
  // -------------------------------------------------------------------
  function importFields() { return cfg.fields.filter((f) => f.importable !== false && !f.readonly); }

  function downloadTemplate() {
    const fs = importFields();
    const ws = window.XLSX.utils.aoa_to_sheet([fs.map((f) => f.label + (f.required ? ' *' : ''))]);
    ws['!cols'] = fs.map(() => ({ wch: 20 }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'بيانات');
    window.XLSX.writeFile(wb, `قالب ${cfg.title}.xlsx`);
  }

  function parseCell(f, raw, opts) {
    const s = raw === null || raw === undefined ? '' : String(raw).trim();
    if (s === '' && f.default !== undefined) return { v: f.default };
    if (f.type === 'bool') return { v: ['نعم', 'yes', '1', 'true', 'y', '✓'].includes(s.toLowerCase()) };
    if (s === '') return { v: null };
    if (f.type === 'number') { const n = Number(s.replace(/,/g, '')); return isNaN(n) ? { err: `${f.label}: رقم غير صحيح` } : { v: n }; }
    if (f.type === 'date') {
      if (typeof raw === 'number') { const d = new Date(Math.round((raw - 25569) * 86400000)); return { v: d.toISOString().slice(0, 10) }; }
      const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); const m2 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (m1) return { v: `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}` };
      if (m2) return { v: `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}` };
      return { err: `${f.label}: تاريخ غير صحيح (استخدم 2026-01-31)` };
    }
    if (f.type === 'select') {
      const low = s.toLowerCase();
      const o = opts.find((x) => String(x.code ?? '').toLowerCase() === low || String(x.label).toLowerCase() === low || String(x.value) === s);
      return o ? { v: o.value } : { err: `${f.label}: "${s}" غير موجود` };
    }
    return { v: s };
  }

  async function openImport() {
    const m = modal({ title: `استيراد ${cfg.title} من Excel`, size: 'wide' });
    const fs = importFields();
    const optsList = await Promise.all(fs.map((f) => loadOptions(f)));
    const preview = h('div');
    let parsed = [];
    const importBtn = h('button', { class: 'btn primary', disabled: true }, 'استيراد');
    const fileInput = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'input' });
    m.body.append(
      h('p', { class: 'notice' }, 'نزّل القالب، املأه بنفس العناوين، ثم ارفعه هنا. القوائم (الشركة، المورد، التصنيف…) تُكتب بالكود أو بالاسم. لن يُحفظ شيء قبل المراجعة.'),
      h('div', { style: { display: 'flex', gap: '8px', margin: '14px 0', flexWrap: 'wrap' } },
        h('button', { class: 'btn', onclick: downloadTemplate }, 'تنزيل القالب'), fileInput),
      preview);
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0]; if (!file) return;
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = window.XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
      parsed = raw.map((r, i) => {
        const rec = {}; const errs = [];
        const norm = Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).replace('*', '').trim(), v]));
        fs.forEach((f, j) => {
          const res = parseCell(f, norm[f.label], optsList[j]);
          if (res.err) errs.push(res.err); else rec[f.key] = res.v;
          if (f.required && (rec[f.key] === null || rec[f.key] === undefined) && !res.err) errs.push(`${f.label} مطلوب`);
        });
        const problem = cfg.validate?.(rec, {});
        if (problem) errs.push(problem);
        return { line: i + 2, rec, errs };
      }).filter((p) => Object.values(p.rec).some((v) => v !== null && v !== false) || p.errs.length);
      const bad = parsed.filter((p) => p.errs.length);
      preview.replaceChildren(
        h('div', { class: 'notice ' + (bad.length ? 'warn' : '') }, `${parsed.length} صف — ${parsed.length - bad.length} سليم، ${bad.length} به أخطاء${bad.length ? ' (الصفوف التي بها أخطاء لن تُستورد)' : ''}`),
        h('div', { class: 'table-wrap', style: { maxHeight: '50vh', marginTop: '10px' } },
          h('table', { class: 'grid' },
            h('thead', {}, h('tr', {}, h('th', {}, 'السطر'), fs.map((f) => h('th', {}, f.label)), h('th', {}, 'الملاحظات'))),
            h('tbody', {}, parsed.map((p) => h('tr', { class: p.errs.length ? 'dim' : '' },
              h('td', {}, p.line),
              fs.map((f, j) => {
                const v = p.rec[f.key];
                const o = f.type === 'select' ? optsList[j].find((x) => x.value === v) : null;
                return h('td', {}, o ? o.label : f.type === 'bool' ? (v ? 'نعم' : '') : (v ?? ''));
              }),
              h('td', { style: { color: 'var(--bad)' } }, p.errs.join('، '))))))));
      importBtn.disabled = parsed.length - bad.length === 0;
      importBtn.textContent = `استيراد ${parsed.length - bad.length} صف`;
    });
    importBtn.addEventListener('click', async () => {
      const base = cfg.defaults ? cfg.defaults() : {};
      const good = parsed.filter((p) => !p.errs.length)
        .map((p) => ({ ...base, ...Object.fromEntries(Object.entries(p.rec).filter(([, v]) => v !== null && v !== undefined)) }));
      importBtn.disabled = true;
      try {
        for (let i = 0; i < good.length; i += 500) await insertRows(cfg.table, good.slice(i, i + 500), cfg.schema);
        toast(`تم استيراد ${good.length} صف`, 'ok'); m.close(); load();
      } catch (e) { toast('لم يُستورد شيء: ' + e.message, 'bad'); importBtn.disabled = false; }
    });
    m.foot.append(importBtn, h('button', { class: 'btn', onclick: m.close }, 'إغلاق'));
  }

  function exportXlsx() {
    const list = visibleRows();
    const aoa = [[...cfg.columns.map((c) => c.label), 'الحالة'],
      ...list.map((r) => [...cfg.columns.map((c) => cellText(c, r)), statusBadge(r.status).textContent])];
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = aoa[0].map(() => ({ wch: 18 }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'بيانات');
    window.XLSX.writeFile(wb, `${cfg.title}.xlsx`);
  }

  load();
  return { reload: load };
}

// سجل تغييرات سجل (للمدير)
export async function showHistory(recordId, title) {
  const m = modal({ title: `سجل التغييرات — ${title}`, size: 'wide' });
  const [{ data, error }, { data: users }] = await Promise.all([
    core.from('audit_log').select('*').eq('record_id', recordId).order('id', { ascending: false }).limit(200),
    core.from('v_user_names').select('id, full_name'),
  ]);
  if (error) { m.body.append(h('div', { class: 'notice bad' }, errMsg(error))); return; }
  const name = (id) => (users || []).find((u) => u.id === id)?.full_name || '—';
  m.body.append(!data?.length ? h('div', { class: 'empty' }, 'لا يوجد سجل') :
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, h('th', {}, 'الوقت'), h('th', {}, 'المستخدم'), h('th', {}, 'العملية'), h('th', {}, 'قبل'), h('th', {}, 'بعد'))),
      h('tbody', {}, data.map((a) => h('tr', { style: { cursor: 'default' } },
        h('td', {}, fmt.datetime(a.at)), h('td', {}, name(a.user_id)),
        h('td', {}, a.action === 'insert' ? 'إضافة' : 'تعديل'),
        h('td', {}, a.action === 'update' ? h('pre', { class: 'json' }, JSON.stringify(a.old_data, null, 1)) : ''),
        h('td', {}, h('pre', { class: 'json' }, JSON.stringify(a.action === 'update' ? a.new_data : stripMeta(a.new_data), null, 1)))))))));
  m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'إغلاق'));
}

function stripMeta(o) {
  if (!o) return o;
  const { id, created_at, created_by, updated_at, updated_by, ...rest } = o;
  return rest;
}

// خيارات جاهزة من جداول الأساس
export const opts = {
  companies: () => async () => state.companies().map((c) => ({ value: c.id, label: c.name, code: c.code })),
  table: (table, { where, label = (r) => r.name, filter } = {}) => async () => {
    let q = core.from(table).select('*').eq('status', 'active').order('code');
    if (where) q = where(q);
    const { data } = await q;
    return (data || []).filter(filter || (() => true)).map((r) => ({ value: r.id, label: (r.code ? r.code + ' — ' : '') + label(r), code: r.code }));
  },
  list: (pairs) => async () => pairs.map(([value, label]) => ({ value, label, code: value })),
};

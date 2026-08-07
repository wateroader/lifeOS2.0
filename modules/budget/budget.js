// modules/budget/budget.js — sub-view inside Finance

let _container, _data, _onSave;
let _year, _month;
let _editingCat  = null;
let _addingIncome = false;
let _editingIncome = null;   // income entry being edited, or null

function spendCats() { return _data.settings?.spendCategories ?? []; }
function budgets()   { return _data.settings?.monthlyBudgets  ?? {}; }

function uid() { return Math.random().toString(36).slice(2, 9); }

function catSpent(catId) {
  const prefix  = `${_year}-${String(_month + 1).padStart(2, '0')}`;
  const entries = _data.calendar?.spendEntries ?? {};
  let total = 0;
  for (const [date, list] of Object.entries(entries)) {
    if (!date.startsWith(prefix)) continue;
    for (const e of (list ?? [])) {
      if (e.categoryId === catId) total += e.amount ?? 0;
    }
  }
  return Math.round(total);
}

// Find the project category by id='project' or name='Project'
function projectCatIds() {
  // Spend categories are the primary source, but users may have created a
  // "Project" category under the calendar `settings.categories` list.
  // Check both lists so we don't miss user-created project categories.
  const spend = spendCats() || [];
  const calendarCats = _data.settings?.categories ?? [];
  const cats = [...spend, ...calendarCats];
  return new Set(
    cats
      .filter(c => {
        if (!c) return false;
        if (c.id === 'project') return true;
        const name = (c.name || '').toLowerCase();
        return name.startsWith('project'); // matches 'project' and 'projects'
      })
      .map(c => c.id)
  );
}

// All spend entries tagged with any project category for _year
function projectSpendEntries() {
  return projectSpendEntriesByYear(_year);
}

function projectSpendEntriesByYear(year) {
  const ids     = projectCatIds();
  const prefix  = `${year}-`;
  const entries = _data.calendar?.spendEntries ?? {};
  const hits = [];
  for (const [date, list] of Object.entries(entries)) {
    if (!date.startsWith(prefix)) continue;
    for (const e of (list ?? [])) {
      if (ids.has(e.categoryId)) hits.push({ date, ...e });
    }
  }
  return hits.sort((a, b) => a.date.localeCompare(b.date));
}

// Income entries stored separately: _data.projects.income[year]
function projectIncome() {
  return projectIncomeByYear(_year);
}

function projectIncomeByYear(year) {
  return _data.projects?.income?.[String(year)] ?? [];
}

function saveProjectIncome(entries) {
  const income = { ...(_data.projects?.income ?? {}), [String(_year)]: entries };
  _data = { ..._data, projects: { ...(_data.projects ?? {}), income } };
  _onSave({ projects: { ...(_data.projects ?? {}), income } });
}

function fmt(n) { return '¥' + Math.round(Math.abs(n)).toLocaleString(); }

function saveBudget(catId, amount) {
  const next = { ...budgets() };
  if (amount == null) delete next[catId];
  else next[catId] = amount;
  _onSave({ settings: { ..._data.settings, monthlyBudgets: next } });
}

// ── Sub-view contract ──────────────────────────────────────────────

export function mount(container, data, onSave, year, month) {
  _container    = container;
  _data         = data;
  _onSave       = onSave;
  _year         = year;
  _month        = month;
  _editingCat   = null;
  _addingIncome = false;
  _loadCss();
  render();
}

export function unmount() {
  if (_container) _container.innerHTML = '';
  _container = null;
}

export function update(data) {
  _data = data;
  if (_container) render();
}

function _loadCss() {
  const href = new URL('./budget.css', import.meta.url).href;
  if (!document.querySelector(`link[href="${href}"]`)) {
    document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
  }
}

// ── Render ─────────────────────────────────────────────────────────

function render() {
  _container.innerHTML = '';

  const layout = document.createElement('div');
  layout.className = 'bud-layout';

  const left = document.createElement('div');
  left.className = 'bud-left';
  left.appendChild(renderBudget());

  const right = document.createElement('div');
  right.className = 'bud-right';
  right.appendChild(renderProjects());

  layout.append(left, right);
  _container.appendChild(layout);
}

// ── Budget (left) ──────────────────────────────────────────────────

function renderBudget() {
  const wrap = document.createElement('div');
  wrap.className = 'bud-wrap';

  const cats       = spendCats();
  const bud        = budgets();
  const budgeted   = cats.filter(c => bud[c.id] != null);
  const unbudgeted = cats.filter(c => bud[c.id] == null);

  if (budgeted.length === 0 && unbudgeted.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'bud-empty';
    empty.textContent = 'No spend categories set up yet. Add them in Settings.';
    wrap.appendChild(empty);
  } else {
    if (budgeted.length > 0) wrap.appendChild(renderBudgetedSection(budgeted, bud));
    if (unbudgeted.length > 0) wrap.appendChild(renderUnbudgetedSection(unbudgeted));
  }

  return wrap;
}

function renderBudgetedSection(cats, bud) {
  const section = document.createElement('div');
  section.className = 'bud-section';

  let totalBudget = 0, totalSpent = 0;
  cats.forEach(cat => {
    const target = bud[cat.id];
    const spent  = catSpent(cat.id);
    totalBudget += target;
    totalSpent  += spent;
    section.appendChild(makeCatRow(cat, target, spent));
  });

  const totalRow = document.createElement('div');
  totalRow.className = 'bud-total-row';
  const lbl = document.createElement('span'); lbl.className = 'bud-total-label'; lbl.textContent = 'Total';
  const amt = document.createElement('span'); amt.className = 'bud-total-amt'; amt.textContent = `${fmt(totalSpent)} / ${fmt(totalBudget)}`;
  const rem = totalBudget - totalSpent;
  const remEl = document.createElement('span');
  remEl.className   = 'bud-total-rem' + (rem < 0 ? ' over' : '');
  remEl.textContent = rem < 0 ? `${fmt(rem)} over` : `${fmt(rem)} left`;
  totalRow.append(lbl, amt, remEl);
  section.appendChild(totalRow);
  return section;
}

function renderUnbudgetedSection(cats) {
  const wrap = document.createElement('div');
  wrap.className = 'bud-unbud-wrap';
  const label = document.createElement('div');
  label.className = 'bud-unbud-label'; label.textContent = 'No budget set';
  wrap.appendChild(label);

  cats.forEach(cat => {
    if (_editingCat === cat.id) { wrap.appendChild(makeEditRow(cat, null)); return; }
    const row = document.createElement('div'); row.className = 'bud-unbud-row';
    const dot = document.createElement('span'); dot.className = 'bud-dot'; dot.style.background = cat.color ?? `var(--cat-${cat.id})`;
    const name = document.createElement('span'); name.className = 'bud-unbud-name'; name.textContent = cat.name;
    const spent = catSpent(cat.id);
    const spentEl = document.createElement('span'); spentEl.className = 'bud-unbud-spent'; spentEl.textContent = spent > 0 ? fmt(spent) : '';
    const setBtn = document.createElement('button'); setBtn.className = 'bud-set-btn'; setBtn.textContent = '+ set budget';
    setBtn.addEventListener('click', () => { _editingCat = cat.id; render(); });
    row.append(dot, name, spentEl, setBtn);
    wrap.appendChild(row);
  });
  return wrap;
}

function makeCatRow(cat, target, spent) {
  if (_editingCat === cat.id) return makeEditRow(cat, target);
  const row = document.createElement('div'); row.className = 'bud-cat-row';
  const pct      = target > 0 ? Math.min(spent / target, 1) : 0;
  const rem      = target - spent;
  const over     = rem < 0;
  const barColor = pct >= 1 ? 'var(--red)' : pct >= 0.8 ? 'var(--amber)' : (cat.color ?? `var(--cat-${cat.id})`);
  const top = document.createElement('div'); top.className = 'bud-cat-top';
  const dot = document.createElement('span'); dot.className = 'bud-dot'; dot.style.background = cat.color ?? `var(--cat-${cat.id})`;
  const name = document.createElement('span'); name.className = 'bud-cat-name'; name.textContent = cat.name;
  const amts = document.createElement('span'); amts.className = 'bud-cat-amts'; amts.textContent = `${fmt(spent)} / ${fmt(target)}`;
  const remEl = document.createElement('span'); remEl.className = 'bud-cat-rem' + (over ? ' over' : ''); remEl.textContent = over ? `${fmt(rem)} over` : `${fmt(rem)} left`;
  const editBtn = document.createElement('button'); editBtn.className = 'bud-edit-btn'; editBtn.textContent = 'edit';
  editBtn.addEventListener('click', () => { _editingCat = cat.id; render(); });
  top.append(dot, name, amts, remEl, editBtn);
  const barWrap = document.createElement('div'); barWrap.className = 'bud-bar-wrap';
  const fill = document.createElement('div'); fill.className = 'bud-bar-fill'; fill.style.width = `${pct * 100}%`; fill.style.background = barColor;
  barWrap.appendChild(fill);
  row.append(top, barWrap);
  return row;
}

function makeEditRow(cat, currentTarget) {
  const row = document.createElement('div'); row.className = 'bud-cat-row editing';
  const top = document.createElement('div'); top.className = 'bud-edit-top';
  const dot = document.createElement('span'); dot.className = 'bud-dot'; dot.style.background = cat.color ?? `var(--cat-${cat.id})`;
  const name = document.createElement('span'); name.className = 'bud-cat-name'; name.textContent = cat.name;
  top.append(dot, name);
  const controls = document.createElement('div'); controls.className = 'bud-edit-controls';
  const input = document.createElement('input'); input.className = 'bud-input'; input.type = 'number'; input.min = '0'; input.placeholder = '0';
  if (currentTarget != null) input.value = currentTarget;
  const freq = document.createElement('select'); freq.className = 'bud-freq-sel';
  [['monthly', 'Monthly (¥)'], ['daily', 'Daily (¥)'], ['yearly', 'Yearly (¥)']].forEach(([val, lbl]) => {
    const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl; freq.appendChild(opt);
  });
  const toMonthly = () => {
    const val = parseFloat(input.value);
    if (isNaN(val) || val < 0) return null;
    if (freq.value === 'daily')  return Math.round(val * 30);
    if (freq.value === 'yearly') return Math.round(val / 12);
    return Math.round(val);
  };
  const saveBtn = document.createElement('button'); saveBtn.className = 'bud-save-btn'; saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => { const val = toMonthly(); if (val != null) saveBudget(cat.id, val); _editingCat = null; render(); });
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'bud-cancel-btn'; cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => { _editingCat = null; render(); });
  const actions = document.createElement('div'); actions.className = 'bud-edit-actions';
  actions.append(saveBtn, cancelBtn);
  if (currentTarget != null) {
    const removeBtn = document.createElement('button'); removeBtn.className = 'bud-remove-btn'; removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => { saveBudget(cat.id, null); _editingCat = null; render(); });
    actions.appendChild(removeBtn);
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); if (e.key === 'Escape') cancelBtn.click(); });
  controls.append(input, freq, actions);
  row.append(top, controls);
  requestAnimationFrame(() => input.focus());
  return row;
}

// ── Projects (right) — reads from calendar spend, categoryId='project' ──

function renderProjects() {
  const wrap = document.createElement('div');
  wrap.className = 'proj-wrap';

  const hdr = document.createElement('div'); hdr.className = 'proj-hdr';
  const title = document.createElement('span'); title.className = 'proj-title'; title.textContent = `Project · ${_year}`;
  hdr.appendChild(title);
  wrap.appendChild(hdr);

  const spendEntries = projectSpendEntries();
  const incomeEntries = projectIncome();
  const totalSpend  = spendEntries.reduce((s, e) => s + (e.amount ?? 0), 0);
  const totalIncome = incomeEntries.reduce((s, e) => s + (e.amount ?? 0), 0);
  const net = totalIncome - totalSpend;

  // Summary bar
  const summary = document.createElement('div'); summary.className = 'proj-summary';
  summary.innerHTML = `
    <div class="proj-sum-item"><span class="proj-sum-lbl">Spent</span><span class="proj-sum-amt expense">−${fmt(totalSpend)}</span></div>
    <div class="proj-sum-item"><span class="proj-sum-lbl">Income</span><span class="proj-sum-amt income">+${fmt(totalIncome)}</span></div>
    <div class="proj-sum-item"><span class="proj-sum-lbl">Net</span><span class="proj-sum-amt ${net >= 0 ? 'income' : 'expense'}">${net >= 0 ? '+' : '−'}${fmt(net)}</span></div>
  `;
  wrap.appendChild(summary);

  // Spend entries from calendar
  if (spendEntries.length) {
    const sec = document.createElement('div'); sec.className = 'proj-section-lbl'; sec.textContent = 'Expenses from calendar';
    wrap.appendChild(sec);
    const list = document.createElement('div'); list.className = 'proj-entry-list';
    spendEntries.forEach(e => {
      const row = document.createElement('div'); row.className = 'proj-entry-row';
      const dateEl = document.createElement('span'); dateEl.className = 'proj-entry-date'; dateEl.textContent = fmtDate(e.date);
      const lbl = document.createElement('span'); lbl.className = 'proj-entry-label'; lbl.textContent = e.note || e.subcategory || 'Project';
      const amt = document.createElement('span'); amt.className = 'proj-entry-amt expense'; amt.textContent = `−${fmt(e.amount ?? 0)}`;
      row.append(dateEl, lbl, amt);
      list.appendChild(row);
    });
    wrap.appendChild(list);
  } else {
    const empty = document.createElement('div'); empty.className = 'proj-empty';
    empty.textContent = `No project expenses logged in ${_year}. Log them in the calendar using the Project spend category.`;
    wrap.appendChild(empty);
  }

  // Income entries
  if (incomeEntries.length) {
    const sec = document.createElement('div'); sec.className = 'proj-section-lbl'; sec.textContent = 'Income';
    wrap.appendChild(sec);
    const list = document.createElement('div'); list.className = 'proj-entry-list';
    incomeEntries.forEach(e => {
      const row = document.createElement('div'); row.className = 'proj-entry-row';
      const dateEl = document.createElement('span'); dateEl.className = 'proj-entry-date'; dateEl.textContent = e.date ? fmtDate(e.date) : '—';
      const lbl = document.createElement('span'); lbl.className = 'proj-entry-label'; lbl.textContent = e.label || '—';
      const amt = document.createElement('span'); amt.className = 'proj-entry-amt income'; amt.textContent = `+${fmt(e.amount ?? 0)}`;
      const del = document.createElement('button'); del.className = 'proj-entry-del'; del.textContent = '×';
      del.addEventListener('click', ev => { ev.stopPropagation(); saveProjectIncome(incomeEntries.filter(x => x.id !== e.id)); render(); });
      row.style.cursor = 'pointer';
      row.title = 'Click to edit';
      row.addEventListener('click', () => { _editingIncome = e; _addingIncome = true; render(); });
      row.append(dateEl, lbl, amt, del);
      list.appendChild(row);
    });
    wrap.appendChild(list);
  }

  // Add income form or button
  if (_addingIncome) {
    wrap.appendChild(renderIncomeForm());
  } else {
    const addBtn = document.createElement('button'); addBtn.className = 'proj-add-inc-btn';
    addBtn.textContent = '+ Log income';
    addBtn.addEventListener('click', () => { _addingIncome = true; render(); });
    wrap.appendChild(addBtn);
  }

  // Last year review
  const lastYear = _year - 1;
  const lastYearSpend = projectSpendEntriesByYear(lastYear);
  const lastYearIncome = projectIncomeByYear(lastYear);
  const lastYearTotalSpend = lastYearSpend.reduce((s, e) => s + (e.amount ?? 0), 0);
  const lastYearTotalIncome = lastYearIncome.reduce((s, e) => s + (e.amount ?? 0), 0);
  const lastYearNet = lastYearTotalIncome - lastYearTotalSpend;

  if (lastYearTotalSpend > 0 || lastYearTotalIncome > 0) {
    const reviewSec = document.createElement('div'); reviewSec.className = 'proj-review-section';
    const reviewHdr = document.createElement('div'); reviewHdr.className = 'proj-review-hdr';
    reviewHdr.textContent = `← ${lastYear} Review`;
    reviewSec.appendChild(reviewHdr);

    const reviewSummary = document.createElement('div'); reviewSummary.className = 'proj-summary';
    reviewSummary.innerHTML = `
      <div class="proj-sum-item"><span class="proj-sum-lbl">Spent</span><span class="proj-sum-amt expense">−${fmt(lastYearTotalSpend)}</span></div>
      <div class="proj-sum-item"><span class="proj-sum-lbl">Income</span><span class="proj-sum-amt income">+${fmt(lastYearTotalIncome)}</span></div>
      <div class="proj-sum-item"><span class="proj-sum-lbl">Net</span><span class="proj-sum-amt ${lastYearNet >= 0 ? 'income' : 'expense'}">${lastYearNet >= 0 ? '+' : '−'}${fmt(lastYearNet)}</span></div>
    `;
    reviewSec.appendChild(reviewSummary);
    wrap.appendChild(reviewSec);
  }

  return wrap;
}

function renderIncomeForm() {
  const editing = _editingIncome;
  const form = document.createElement('div'); form.className = 'proj-income-form';

  const labelInp = document.createElement('input');
  labelInp.className = 'proj-entry-inp'; labelInp.type = 'text';
  labelInp.placeholder = 'e.g. Keychain sales, booth day 1…'; labelInp.autocomplete = 'off';
  labelInp.value = editing?.label ?? '';

  const amtInp = document.createElement('input');
  amtInp.className = 'proj-entry-inp'; amtInp.type = 'number'; amtInp.min = '0'; amtInp.placeholder = '¥0';
  amtInp.value = editing?.amount ?? '';

  const dateInp = document.createElement('input');
  dateInp.className = 'proj-entry-inp'; dateInp.type = 'date';
  dateInp.value = editing?.date ?? new Date().toISOString().slice(0, 10);

  const actions = document.createElement('div'); actions.className = 'proj-form-actions';

  const closeForm = () => { _addingIncome = false; _editingIncome = null; render(); };

  const saveBtn = document.createElement('button'); saveBtn.className = 'proj-save-btn'; saveBtn.textContent = editing ? 'Save' : 'Add income';
  saveBtn.addEventListener('click', () => {
    const amount = parseFloat(amtInp.value);
    if (isNaN(amount) || amount <= 0) { amtInp.focus(); return; }
    const label = labelInp.value.trim() || null;
    const date  = dateInp.value || null;
    if (editing) {
      saveProjectIncome(projectIncome().map(x => x.id === editing.id ? { ...x, label, amount, date } : x));
    } else {
      saveProjectIncome([...projectIncome(), { id: uid(), label, amount, date }]);
    }
    closeForm();
  });

  const cancelBtn = document.createElement('button'); cancelBtn.className = 'proj-cancel-btn'; cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeForm);

  amtInp.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); if (e.key === 'Escape') cancelBtn.click(); });

  actions.append(saveBtn, cancelBtn);
  form.append(labelInp, amtInp, dateInp, actions);
  requestAnimationFrame(() => labelInp.focus());
  return form;
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

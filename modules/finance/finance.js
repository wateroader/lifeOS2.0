// modules/finance/finance.js
import * as CurrencyView    from './currency-view.js';
import * as InvestmentView  from './investment-view.js';
import * as BudgetView      from '../budget/budget.js';

const MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_L = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const DEFAULT_INCOME = [
  { id: 'salary',     label: '給料',            amount: 0, isNeg: false },
  { id: 'transport',  label: '交通費補助',        amount: 0, isNeg: false },
  { id: 'other',      label: 'その他収入',        amount: 0, isNeg: false },
  { id: 'health',     label: '健康保険',          amount: 0, isNeg: true  },
  { id: 'care',       label: '介護保険',          amount: 0, isNeg: true  },
  { id: 'child',      label: '子ども・子育て支援', amount: 0, isNeg: true  },
  { id: 'pension',    label: '厚生年金保険',       amount: 0, isNeg: true  },
  { id: 'employment', label: '雇用保険',          amount: 0, isNeg: true  },
  { id: 'incometax',  label: '所得税',            amount: 0, isNeg: true  },
  { id: 'resident',   label: '住民税',            amount: 0, isNeg: true  },
];

const DEFAULT_BILLS = [
  { id: 'rent',        label: '家賃',           amount: 0 },
  { id: 'electricity', label: '電気',           amount: 0 },
  { id: 'gas',         label: 'ガス',           amount: 0 },
  { id: 'water',       label: '水道',           amount: 0 },
  { id: 'internet',    label: 'インターネット',  amount: 0 },
  { id: 'phone',       label: '携帯',           amount: 0 },
  { id: 'commute',     label: '定期券',         amount: 0 },
];

// ── State ──────────────────────────────────────────────────────────
let _container = null, _data = null, _onSave = null;
let _year = new Date().getFullYear(), _month = new Date().getMonth();
let _open = { income: true };
let _subView = 'finance';

const SUB_VIEWS = [
  { key: 'finance',    label: 'Finance'    },
  { key: 'currency',   label: 'Currency'   },
  { key: 'investment', label: 'Investment' },
  { key: 'budget',     label: 'Budget'     },
];

// ── Module contract ────────────────────────────────────────────────
export function init(container, data, onSave) {
  _container = container;
  _onSave    = onSave;
  _data      = data;
  _loadCss();
  const now = new Date();
  _year  = now.getFullYear();
  _month = now.getMonth();
  _render();
}

export function destroy() {
  CurrencyView.unmount();
  InvestmentView.unmount();
  BudgetView.unmount();
  _container = _data = _onSave = null;
  _subView = 'finance';
}

export function onDataChange(newData) {
  _data = newData;
  CurrencyView.update(newData);
  InvestmentView.update(newData);
  BudgetView.update(newData);
}

// ── Data helpers ───────────────────────────────────────────────────
function _uid()  { return Math.random().toString(36).slice(2, 9); }
function _mkey(y, m) { return `${y}-${String(m + 1).padStart(2, '0')}`; }
function _mdata(y, m) { return _data.finance?.months?.[_mkey(y, m)] ?? {}; }

function _incRows(y, m) {
  const saved = _mdata(y, m).income;
  if (!saved) return DEFAULT_INCOME;
  const ids = new Set(saved.map(r => r.id));
  const missing = DEFAULT_INCOME.filter(r => !ids.has(r.id));
  const all = missing.length ? [...saved, ...missing] : saved;
  return all.filter(r => !r.hidden);
}

function _billRows(y, m) {
  const saved = _mdata(y, m).bills;
  if (!saved) return DEFAULT_BILLS;
  const ids = new Set(saved.map(r => r.id));
  const missing = DEFAULT_BILLS.filter(r => !ids.has(r.id));
  return missing.length ? [...saved, ...missing] : saved;
}

function _spendCats() { return _data.settings?.spendCategories ?? []; }

function _setIncome(rows) {
  const key    = _mkey(_year, _month);
  const month  = { ..._mdata(_year, _month), income: rows };
  const months = { ...(_data.finance?.months ?? {}), [key]: month };
  _data = { ..._data, finance: { months } };
  _onSave({ finance: { months } });
}

function _setBills(rows) {
  const key    = _mkey(_year, _month);
  const month  = { ..._mdata(_year, _month), bills: rows };
  const months = { ...(_data.finance?.months ?? {}), [key]: month };
  _data = { ..._data, finance: { months } };
  _onSave({ finance: { months } });
}

function _catTotal(y, m, catId) {
  const prefix  = _mkey(y, m);
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

function _totals(y, m) {
  const rows  = _incRows(y, m);
  const inc   = rows.reduce((s, r) => s + (r.isNeg ? -(r.amount || 0) : (r.amount || 0)), 0);
  const bills = _billRows(y, m).reduce((s, r) => s + (r.amount || 0), 0);
  const cats  = _spendCats();
  const catTotals = {};
  let spent = 0;
  cats.forEach(c => {
    const t = _catTotal(y, m, c.id);
    catTotals[c.id] = t;
    spent += t;
  });
  const balance = inc - bills - spent;
  return { inc, bills, catTotals, spent, balance };
}

function _prevMo(y, m) { return m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }; }

// ── Render ─────────────────────────────────────────────────────────
function _render() {
  if (!_container) return;
  const prevScroll = _container.querySelector('.fin-body')?.scrollTop ?? 0;
  _container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'fin-root';
  root.appendChild(_buildHeader());
  const body = document.createElement('div'); body.className = 'fin-body';
  CurrencyView.unmount();
  InvestmentView.unmount();
  BudgetView.unmount();
  if (_subView === 'finance') {
    body.appendChild(_buildHero());
    body.appendChild(_buildMain());
  } else if (_subView === 'currency') {
    CurrencyView.mount(body, _data, partial => _onSave(partial));
  } else if (_subView === 'investment') {
    InvestmentView.mount(body, _data, partial => _onSave(partial));
  } else if (_subView === 'budget') {
    BudgetView.mount(body, _data, partial => _onSave(partial), _year, _month);
  }
  root.appendChild(body);
  _container.appendChild(root);
  body.scrollTop = prevScroll;
}

// ── Header ─────────────────────────────────────────────────────────
function _buildHeader() {
  const hdr = document.createElement('div'); hdr.className = 'fin-header';

  const prev = document.createElement('button'); prev.className = 'cal-year-btn';
  prev.textContent = '‹';
  prev.addEventListener('click', () => {
    const p = _prevMo(_year, _month); _year = p.y; _month = p.m; _render();
  });
  const lbl = document.createElement('span'); lbl.className = 'cal-year-label';
  lbl.textContent = `${MONTHS_L[_month]} ${_year}`;
  const next = document.createElement('button'); next.className = 'cal-year-btn';
  next.textContent = '›';
  next.addEventListener('click', () => {
    let y = _year, m = _month + 1; if (m > 11) { m = 0; y++; }
    _year = y; _month = m; _render();
  });
  const today = document.createElement('button'); today.className = 'cal-today-btn';
  today.textContent = 'today';
  today.addEventListener('click', () => {
    const now = new Date(); _year = now.getFullYear(); _month = now.getMonth(); _render();
  });

  const toggle = document.createElement('div'); toggle.className = 'cal-view-toggle';
  SUB_VIEWS.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.className = 'cal-view-btn' + (_subView === key ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => { if (_subView !== key) { _subView = key; _render(); } });
    toggle.appendChild(btn);
  });

  hdr.append(prev, lbl, next, today, toggle);
  return hdr;
}

// ── Hero ───────────────────────────────────────────────────────────
function _buildHero() {
  const t  = _totals(_year, _month);
  const p  = _prevMo(_year, _month);
  const tp = _totals(p.y, p.m);
  const del = t.balance - tp.balance;

  const hero = document.createElement('div'); hero.className = 'fin-hero';

  const bal = document.createElement('div'); bal.className = 'fin-hero-card';
  bal.innerHTML = `
    <div class="fin-hero-lbl">Balance · ${MONTHS_L[_month]} ${_year}</div>
    <div class="fin-hero-bal" style="color:${t.balance >= 0 ? 'var(--green)' : 'var(--red)'}">
      ${t.balance >= 0 ? '+' : ''}¥${t.balance.toLocaleString()}
    </div>
    <div class="fin-hero-delta ${del > 0 ? 'up' : del < 0 ? 'down' : ''}">
      ${del !== 0 ? `${del > 0 ? '+' : ''}¥${Math.abs(del).toLocaleString()} vs ${MONTHS_S[p.m]}` : 'no prior data'}
    </div>
  `;

  const spark = document.createElement('div'); spark.className = 'fin-hero-card';
  const spLbl = document.createElement('div'); spLbl.className = 'fin-hero-lbl';
  spLbl.textContent = '6-month trend';
  spark.append(spLbl, _buildSparkline());

  const dist  = document.createElement('div'); dist.className = 'fin-hero-card';
  const diLbl = document.createElement('div'); diLbl.className = 'fin-hero-lbl';
  diLbl.textContent = `Income ¥${t.inc.toLocaleString()} distribution`;
  dist.append(diLbl, _buildDistBar(t));

  hero.append(bal, spark, dist);
  return hero;
}

function _buildSparkline() {
  const pts = [], lbls = [];
  for (let i = 5; i >= 0; i--) {
    let y = _year, m = _month - i;
    while (m < 0) { m += 12; y--; }
    pts.push(_totals(y, m).balance);
    lbls.push(MONTHS_S[m]);
  }
  const W = 200, H = 52;
  const mn = Math.min(...pts), mx = Math.max(...pts), rng = mx - mn || 1;
  const xOf = i => (i / 5) * W;
  const yOf = v => H - 4 - Math.round(((v - mn) / rng) * (H - 10));
  const coords = pts.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v)}`);
  const path   = 'M' + coords.join(' L');
  const fill   = path + ` L${W},${H} L0,${H} Z`;
  const last   = pts[pts.length - 1];
  const c      = last >= 0 ? 'var(--green)' : 'var(--red)';
  const fc     = last >= 0 ? 'color-mix(in srgb,var(--green) 12%,transparent)' : 'color-mix(in srgb,var(--red) 12%,transparent)';
  const wrap   = document.createElement('div'); wrap.className = 'fin-spark-wrap';
  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="overflow:visible;display:block">
      <path d="${fill}" fill="${fc}"/>
      <path d="${path}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="fin-spark-lbls">${lbls.map(l => `<span>${l}</span>`).join('')}</div>
  `;
  return wrap;
}

function _buildDistBar(t) {
  const cats = _spendCats();
  const inc  = Math.max(t.inc, 1);
  const segs = [];
  if (t.bills > 0) segs.push([t.bills, 'var(--text-3)', 'Bills']);
  cats.forEach(c => {
    const v = t.catTotals[c.id] ?? 0;
    if (v > 0) segs.push([v, c.color, c.name]);
  });
  if (t.balance > 0) segs.push([t.balance, 'var(--fin-saved)', 'Saved']);
  let rem = 100;
  const ps = segs.map(([v, c, l]) => {
    const p = Math.min(rem, Math.round(v / inc * 100));
    rem = Math.max(0, rem - p);
    return { p, c, l };
  });
  const wrap = document.createElement('div'); wrap.className = 'fin-dist-wrap';
  const bar  = document.createElement('div'); bar.className  = 'fin-dist-bar';
  ps.forEach(({ p, c }) => {
    if (!p) return;
    const s = document.createElement('div'); s.className = 'fin-dist-seg';
    s.style.cssText = `width:${p}%;background:${c}`;
    bar.appendChild(s);
  });
  const leg = document.createElement('div'); leg.className = 'fin-dist-leg';
  ps.forEach(({ p, c, l }) => {
    const sp = document.createElement('span');
    sp.innerHTML = `<i style="background:${c}"></i>${l} <b>${p}%</b>`;
    leg.appendChild(sp);
  });
  wrap.append(bar, leg);
  return wrap;
}

// ── Main layout ────────────────────────────────────────────────────
function _buildMain() {
  const t         = _totals(_year, _month);
  const cats      = _spendCats();
  const incRows   = _incRows(_year, _month);
  const billRows  = _billRows(_year, _month);
  const filled    = incRows.filter(r => r.amount > 0).length;
  const filledB   = billRows.filter(r => r.amount > 0).length;

  if (!_open.hasOwnProperty('fixed-bills')) _open['fixed-bills'] = false;

  const main  = document.createElement('div'); main.className  = 'fin-main';
  const left  = document.createElement('div'); left.className  = 'fin-left';
  const right = document.createElement('div'); right.className = 'fin-right';

  left.appendChild(_acc('income', 'Income', '収入', false,
    `${filled} of ${incRows.length} filled`, t.inc, true, () => _buildIncRows(), null));

  if (_year < 2025) {
    left.appendChild(_acc('fixed-bills', 'Bills', '固定費', true,
      `${filledB} of ${billRows.length} filled`, t.bills, false, () => _buildBillRows(), null));
  }

  cats.forEach(cat => {
    if (!_open.hasOwnProperty(cat.id)) _open[cat.id] = false;
    const total = t.catTotals[cat.id] ?? 0;
    left.appendChild(_acc(cat.id, cat.name, '', true,
      'auto · from daily', total, false, () => _buildCatRows(cat), cat.color));
  });

  right.appendChild(_buildSummary(t));
  main.append(left, right);
  return main;
}

// ── Accordion ──────────────────────────────────────────────────────
function _acc(id, title, jp, isExpense, meta, total, isIncome, buildBody, color) {
  const sec  = document.createElement('div');
  sec.className = 'fin-acc' + (_open[id] ? ' open' : '');
  const head = document.createElement('div');
  head.className = 'fin-acc-head';

  const chev = document.createElement('span');
  chev.className = 'fin-acc-chev material-symbols-outlined';
  chev.textContent = 'chevron_right';
  head.appendChild(chev);

  if (color) {
    const dot = document.createElement('span');
    dot.className = 'fin-acc-dot';
    dot.style.background = color;
    head.appendChild(dot);
  }

  const titleEl = document.createElement('span');
  titleEl.className = 'fin-acc-title';
  titleEl.innerHTML = jp ? `${title} <span class="fin-jp">${jp}</span>` : title;
  head.appendChild(titleEl);

  const metaEl = document.createElement('span');
  metaEl.className = 'fin-acc-meta' + (meta === 'auto · from daily' ? ' auto' : '');
  metaEl.textContent = meta;
  head.appendChild(metaEl);

  const totalEl = document.createElement('span');
  totalEl.className = 'fin-acc-total' + (isIncome ? ' income' : '');
  totalEl.textContent = `${isExpense && total > 0 ? '−' : ''}¥${total.toLocaleString()}`;
  head.appendChild(totalEl);

  head.addEventListener('click', () => { _open[id] = !_open[id]; _render(); });
  sec.appendChild(head);

  if (_open[id]) {
    const body = document.createElement('div');
    body.className = 'fin-acc-body';
    buildBody().forEach(row => body.appendChild(row));
    sec.appendChild(body);
  }
  return sec;
}

// ── Income rows (editable, sortable) ──────────────────────────────
function _allIncSaved() {
  return _mdata(_year, _month).income ?? DEFAULT_INCOME.map(x => ({ ...x }));
}

function _patchInc(id, patch) {
  const all = _allIncSaved();
  const exists = all.find(x => x.id === id);
  if (exists) {
    _setIncome(all.map(x => x.id === id ? { ...x, ...patch } : x));
  } else {
    _setIncome([...all, { ...DEFAULT_INCOME.find(x => x.id === id), ...patch }]);
  }
}

function _buildIncRows() {
  const rows   = _incRows(_year, _month);
  const rowsEl = document.createElement('div');
  rowsEl.className = 'fin-inc-rows';

  rows.forEach(r => {
    const el = document.createElement('div');
    el.className = 'fin-inc-row';
    el.dataset.id = r.id;

    const handle = document.createElement('span');
    handle.className = 'fin-drag-handle material-symbols-outlined';
    handle.textContent = 'drag_indicator';

    const sign = document.createElement('button');
    sign.className = 'fin-sign-btn ' + (r.isNeg ? 'neg' : 'pos');
    sign.innerHTML = `<span class="material-symbols-outlined">${r.isNeg ? 'remove' : 'add'}</span>`;
    sign.title = r.isNeg ? 'Deduction — click to make positive' : 'Income — click to make deduction';
    sign.addEventListener('click', e => {
      e.stopPropagation();
      _patchInc(r.id, { isNeg: !r.isNeg });
      _render();
    });

    const lbl = document.createElement('input');
    lbl.type = 'text';
    lbl.className = 'fin-inc-lbl';
    lbl.value = r.label;
    lbl.addEventListener('click', e => e.stopPropagation());
    const saveIncLbl = e => {
      _patchInc(r.id, { label: e.target.value.trim() || r.label });
    };
    lbl.addEventListener('change', saveIncLbl);
    lbl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveIncLbl(e); lbl.blur(); } });

    const wrap = document.createElement('div');
    wrap.className = `fin-inp-wrap${r.amount > 0 ? ' filled' : ''}${r.isNeg ? ' neg' : ''}`;
    const yen = document.createElement('span'); yen.className = 'fin-yen'; yen.textContent = '¥';
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = '1000'; inp.min = '0';
    inp.value = r.amount || ''; inp.placeholder = '0';
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('change', e => {
      _patchInc(r.id, { amount: parseFloat(e.target.value) || 0 });
      _render();
    });
    wrap.append(yen, inp);

    const rm = document.createElement('button');
    rm.className = 'fin-rm-btn';
    rm.innerHTML = '<span class="material-symbols-outlined">close</span>';
    rm.title = 'Remove';
    rm.addEventListener('click', e => {
      e.stopPropagation();
      _patchInc(r.id, { hidden: true, amount: 0 });
      _render();
    });

    el.append(handle, sign, lbl, wrap, rm);
    rowsEl.appendChild(el);
  });

  Sortable.create(rowsEl, {
    handle:    '.fin-drag-handle',
    animation: 120,
    onEnd() {
      const visibleIds = [...rowsEl.querySelectorAll('.fin-inc-row')].map(el => el.dataset.id);
      const all        = _allIncSaved();
      const hidden     = all.filter(x => x.hidden);
      const rowMap     = Object.fromEntries(all.map(r => [r.id, r]));
      _setIncome([...visibleIds.map(id => rowMap[id]).filter(Boolean), ...hidden]);
      setTimeout(_render, 0);
    },
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'fin-add-row';
  addBtn.innerHTML = '<span class="material-symbols-outlined">add</span>Add row';
  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    _setIncome([..._allIncSaved(), { id: _uid(), label: '新しい項目', amount: 0, isNeg: false }]);
    _render();
  });

  return [rowsEl, addBtn];
}

// ── Bills rows (editable, sortable) ───────────────────────────────
function _buildBillRows() {
  const rows   = _billRows(_year, _month);
  const rowsEl = document.createElement('div');
  rowsEl.className = 'fin-inc-rows';

  rows.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'fin-inc-row';
    el.dataset.id = r.id;

    const handle = document.createElement('span');
    handle.className = 'fin-drag-handle material-symbols-outlined';
    handle.textContent = 'drag_indicator';

    const lbl = document.createElement('input');
    lbl.type = 'text';
    lbl.className = 'fin-inc-lbl';
    lbl.value = r.label;
    lbl.addEventListener('click', e => e.stopPropagation());
    const saveBillLbl = e => {
      _setBills(rows.map((x, j) => j === i ? { ...x, label: e.target.value.trim() || x.label } : x));
    };
    lbl.addEventListener('change', saveBillLbl);
    lbl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveBillLbl(e); lbl.blur(); } });

    const wrap = document.createElement('div');
    wrap.className = `fin-inp-wrap${r.amount > 0 ? ' filled' : ''} neg`;
    const yen = document.createElement('span'); yen.className = 'fin-yen'; yen.textContent = '¥';
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = '100'; inp.min = '0';
    inp.value = r.amount || ''; inp.placeholder = '0';
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('change', e => {
      _setBills(rows.map((x, j) => j === i ? { ...x, amount: parseFloat(e.target.value) || 0 } : x));
      _render();
    });
    wrap.append(yen, inp);

    const rm = document.createElement('button');
    rm.className = 'fin-rm-btn';
    rm.innerHTML = '<span class="material-symbols-outlined">close</span>';
    rm.addEventListener('click', e => {
      e.stopPropagation();
      _setBills(rows.filter((_, j) => j !== i));
      _render();
    });

    el.append(handle, lbl, wrap, rm);
    rowsEl.appendChild(el);
  });

  Sortable.create(rowsEl, {
    handle:    '.fin-drag-handle',
    animation: 120,
    onEnd() {
      const ids    = [...rowsEl.querySelectorAll('.fin-inc-row')].map(el => el.dataset.id);
      const rowMap = Object.fromEntries(_billRows(_year, _month).map(r => [r.id, r]));
      _setBills(ids.map(id => rowMap[id]).filter(Boolean));
      setTimeout(_render, 0);
    },
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'fin-add-row';
  addBtn.innerHTML = '<span class="material-symbols-outlined">add</span>Add row';
  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    _setBills([...rows, { id: _uid(), label: '新しい項目', amount: 0 }]);
    _render();
  });

  return [rowsEl, addBtn];
}

// ── Category rows (auto from calendar) ────────────────────────────
function _buildCatRows(cat) {
  const prefix  = _mkey(_year, _month);
  const entries = _data.calendar?.spendEntries ?? {};

  const items = [];
  for (const [date, list] of Object.entries(entries)) {
    if (!date.startsWith(prefix)) continue;
    for (const e of (list ?? [])) {
      if (e.categoryId === cat.id) items.push({ date, ...e });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date));

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'fin-cat-empty';
    empty.textContent = 'No entries this month';
    return [empty];
  }

  const wrap = document.createElement('div'); wrap.className = 'fin-cat-list';
  items.forEach(item => {
    const row = document.createElement('div'); row.className = 'fin-cat-row';
    const d   = new Date(item.date + 'T00:00:00');
    row.innerHTML = `
      <span class="fin-cat-date">${d.getDate()} ${MONTHS_S[d.getMonth()]}</span>
      <span class="fin-cat-lbl">${item.subcategory || cat.name}<em>${item.label || ''}</em></span>
      <span class="fin-cat-amt">¥${(item.amount ?? 0).toLocaleString()}</span>
    `;
    wrap.appendChild(row);
  });
  return [wrap];
}

// ── Summary panel ──────────────────────────────────────────────────
function _buildSummary(t) {
  let cum = 0;
  for (let cy = 2025; cy <= _year; cy++) {
    const end = cy < _year ? 11 : _month;
    for (let cm = 0; cm <= end; cm++) cum += _totals(cy, cm).balance;
  }

  const cats = _spendCats();
  const card = document.createElement('div'); card.className = 'fin-summary';

  const hdr = document.createElement('div'); hdr.className = 'fin-sum-month';
  hdr.textContent = `${MONTHS_L[_month]} ${_year}`;
  card.appendChild(hdr);

  const incRow = document.createElement('div'); incRow.className = 'fin-sum-row';
  incRow.innerHTML = `<span>Income</span><span style="color:var(--green)">+¥${t.inc.toLocaleString()}</span>`;
  card.appendChild(incRow);

  if (t.bills > 0) {
    const billRow = document.createElement('div'); billRow.className = 'fin-sum-row';
    billRow.innerHTML = `<span>Bills</span><span style="color:var(--text-2)">−¥${t.bills.toLocaleString()}</span>`;
    card.appendChild(billRow);
  }

  cats.forEach(cat => {
    const v = t.catTotals[cat.id] ?? 0;
    if (!v) return;
    const row = document.createElement('div'); row.className = 'fin-sum-row';
    row.innerHTML = `
      <span class="fin-sum-cat-lbl">
        <i style="width:6px;height:6px;border-radius:50%;background:${cat.color};display:inline-block;flex-shrink:0;vertical-align:middle;margin-right:5px"></i>${cat.name}
      </span>
      <span style="color:var(--text-2)">−¥${v.toLocaleString()}</span>
    `;
    card.appendChild(row);
  });

  const net = document.createElement('div'); net.className = 'fin-sum-row fin-sum-net';
  net.innerHTML = `<span>Net</span><span style="color:${t.balance >= 0 ? 'var(--green)' : 'var(--red)'}">${t.balance >= 0 ? '+' : ''}¥${t.balance.toLocaleString()}</span>`;
  card.appendChild(net);

  const cumRow = document.createElement('div'); cumRow.className = 'fin-sum-row fin-sum-cum';
  cumRow.innerHTML = `<span>Total since Jan 2025</span><span style="color:${cum >= 0 ? 'var(--green)' : 'var(--red)'}">${cum >= 0 ? '+' : ''}¥${cum.toLocaleString()}</span>`;
  card.appendChild(cumRow);

  return card;
}

// ── CSS loader ─────────────────────────────────────────────────────
function _loadCss() {
  const href = new URL('./finance.css', import.meta.url).href;
  if (!document.querySelector(`link[href="${href}"]`))
    document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
}

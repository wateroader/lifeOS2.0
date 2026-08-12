// mobile.js — LifeOS mobile companion
// Reads/writes via Supabase store (same data as desktop)

import { load, get, save, getSession, signIn } from '../core/store.js';
import {
  mergeEntry, removeDay, addSpotting, removeSpotting, setSymptom,
  getPeriodEntries, periodStats, currentWindow, getPhase,
} from '../modules/period/period-data.js';

let _mobileData = null;

const SYMPTOM_GROUPS = [
  { label: 'General', items: [
    { key: 'appetite_change', label: 'Appetite change' },
    { key: 'mood_change',     label: 'Mood change' },
    { key: 'sleep_change',    label: 'Sleep change' },
    { key: 'fatigue',         label: 'Fatigue' },
    { key: 'memory_lapse',    label: 'Memory lapse' },
    { key: 'hot_flashes',     label: 'Hot flashes' },
    { key: 'night_sweats',    label: 'Night sweats' },
    { key: 'chills',          label: 'Chills' },
  ]},
  { label: 'Skin & Hair', items: [
    { key: 'acne',      label: 'Acne' },
    { key: 'dry_skin',  label: 'Dry skin' },
    { key: 'hair_loss', label: 'Hair loss' },
    { key: 'itchy',     label: 'Itchy' },
  ]},
  { label: 'Pain', items: [
    { key: 'abdominal_cramp', label: 'Abdominal cramp' },
    { key: 'breast_pain',     label: 'Breast pain' },
    { key: 'headache',        label: 'Headache' },
    { key: 'lower_back_pain', label: 'Lower back pain' },
    { key: 'pelvic_pain',     label: 'Pelvic pain' },
  ]},
  { label: 'Digestive & Other', items: [
    { key: 'bloating',             label: 'Bloating' },
    { key: 'constipation',         label: 'Constipation' },
    { key: 'diarrhea',             label: 'Diarrhea' },
    { key: 'nausea',               label: 'Nausea' },
    { key: 'cravings',             label: 'Cravings' },
    { key: 'vaginal_dryness',      label: 'Vaginal dryness' },
    { key: 'bladder_incontinence', label: 'Bladder incontinence' },
  ]},
];

// ── Theme ────────────────────────────────────────────────────────────
const _THEME_KEY = 'lifeOS_landing_theme';
let _mobTheme = localStorage.getItem(_THEME_KEY) || 'dark';
function _applyTheme(t) {
  _mobTheme = t;
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : '');
  localStorage.setItem(_THEME_KEY, t);
}
_applyTheme(_mobTheme);

// ── State ───────────────────────────────────────────────────────────
let _tab      = 'day';
let _calView  = 'day'; // 'day' | 'week'
let _selDate  = _todayStr();
let _calMonth = { y: +_selDate.slice(0, 4), m: +_selDate.slice(5, 7) };
let _finMonth = { y: +_selDate.slice(0, 4), m: +_selDate.slice(5, 7) - 1 }; // m is 0-indexed
let _finEditLabelId = null; // income row whose name is being edited (null = none)
let _expandedNote = null;

// ── Finance (income only, mirrors desktop finance.js data model) ──────
const FIN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const FIN_DEFAULT_INCOME = [
  { id: 'salary',     label: '給料',              amount: 0, isNeg: false },
  { id: 'transport',  label: '交通費補助',         amount: 0, isNeg: false },
  { id: 'other',      label: 'その他収入',         amount: 0, isNeg: false },
  { id: 'health',     label: '健康保険',           amount: 0, isNeg: true  },
  { id: 'care',       label: '介護保険',           amount: 0, isNeg: true  },
  { id: 'child',      label: '子ども・子育て支援',  amount: 0, isNeg: true  },
  { id: 'pension',    label: '厚生年金保険',        amount: 0, isNeg: true  },
  { id: 'employment', label: '雇用保険',           amount: 0, isNeg: true  },
  { id: 'incometax',  label: '所得税',             amount: 0, isNeg: true  },
  { id: 'resident',   label: '住民税',             amount: 0, isNeg: true  },
];
function _finKey(y, m) { return `${y}-${String(m + 1).padStart(2, '0')}`; }
function _finIncome(y, m) {
  const saved = _D().finance?.months?.[_finKey(y, m)]?.income;
  if (!saved) return FIN_DEFAULT_INCOME.map(r => ({ ...r }));
  const ids = new Set(saved.map(r => r.id));
  const missing = FIN_DEFAULT_INCOME.filter(r => !ids.has(r.id));
  return (missing.length ? [...saved, ...missing] : saved).filter(r => !r.hidden).map(r => ({ ...r }));
}
function _setFinIncome(y, m, rows) {
  const d = _D();
  const key    = _finKey(y, m);
  const month  = { ...(d.finance?.months?.[key] ?? {}), income: rows };
  const months = { ...(d.finance?.months ?? {}), [key]: month };
  d.finance = { months };
  _mobileData = d;
  save({ finance: { months } });
}

// ── Data ────────────────────────────────────────────────────────────
function _D() {
  return _mobileData ?? get();
}

function _saveD(d) {
  _mobileData = d;
  save({ period: d.period });
  _render();
}

function _todayStr() {
  const tz = get().settings?.timezone ?? 'Asia/Tokyo';
  return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
}

function _ds(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function _uid() {
  return 'mob_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Period logic (shared engine: ../modules/period/period-data.js) ───
// Flow is stored per-day inside an entry: entry.flow[dateStr] = 'heavy'.
// All writes go through the same mergeEntry/removeDay helpers desktop uses,
// so the two clients can never drift apart.
function _getFlow(date) {
  const { entries = [], spotting = [] } = _D().period || {};
  if (spotting.includes(date)) return 'spotting';
  const e = entries.find(e => e.start <= date && date <= e.end);
  return e?.flow?.[date] ?? 'none';
}

function _logFlow(date, flow) {
  const d = _D();
  const p = d.period || { entries: [], spotting: [], symptoms: {} };
  let entries  = p.entries  || [];
  let spotting = p.spotting || [];

  if (flow === 'spotting') {
    entries  = removeDay(entries, date);
    spotting = addSpotting(spotting, date);
  } else if (flow === 'none') {
    entries  = removeDay(entries, date);
    spotting = removeSpotting(spotting, date);
  } else {
    spotting = removeSpotting(spotting, date);
    entries  = mergeEntry(entries, date, 'flow', flow);
  }

  p.entries  = entries;
  p.spotting = spotting;
  d.period   = p;
  _saveD(d);
}

function _toggleSymptom(date, key) {
  const d   = _D();
  const p   = d.period || {};
  const on  = !!(p.symptoms?.[date]?.[key]);
  p.symptoms = setSymptom(p.symptoms || {}, date, key, on ? null : true);
  d.period   = p;
  _saveD(d);
}

function _cycleStatus() {
  const data    = _D();
  const entries = getPeriodEntries(data);   // sorted by start
  const today   = _todayStr();
  const past    = entries.filter(e => e.start <= today);
  if (!past.length) return null;

  const stats = periodStats(entries);
  const last  = past[past.length - 1];
  const [ly, lm, ld] = last.start.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const cycleDay = Math.floor((new Date(ty, tm - 1, td) - new Date(ly, lm - 1, ld)) / 86400000) + 1;

  const ph    = getPhase(entries, stats, today);
  const phase = ph ? ph.charAt(0).toUpperCase() + ph.slice(1) : '—';

  const win     = currentWindow(entries, stats);
  const nextStr = win ? win.center.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;

  return { cycleDay, phase, nextStr };
}

// ── DOM helpers ──────────────────────────────────────────────────────
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)             e.className   = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(cls, text, onClick) {
  const b = el('button', cls, text);
  b.addEventListener('click', onClick);
  return b;
}

// ── Mini calendar ────────────────────────────────────────────────────
function _buildMiniCal(showPeriod) {
  const d = _D();
  const { entries = [], spotting = [] } = d.period || {};
  const events = d.calendar?.events        || [];
  const spend  = d.calendar?.spendEntries  || {};
  const today  = _todayStr();
  const { y, m } = _calMonth;

  const firstDowSun  = new Date(y, m - 1, 1).getDay(); // 0=Sun
  const firstDow     = (firstDowSun + 6) % 7;          // shift so Mon=0
  const daysInMonth  = new Date(y, m, 0).getDate();
  const wrap        = el('div', 'mc-wrap');

  // Header
  const hdr = el('div', 'mc-hdr');
  hdr.appendChild(btn('mc-nav', '‹', () => {
    let nm = m - 1, ny = y;
    if (nm < 1) { nm = 12; ny--; }
    _calMonth = { y: ny, m: nm }; _render();
  }));
  hdr.appendChild(el('span', 'mc-month-label',
    new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  ));
  hdr.appendChild(btn('mc-nav', '›', () => {
    let nm = m + 1, ny = y;
    if (nm > 12) { nm = 1; ny++; }
    _calMonth = { y: ny, m: nm }; _render();
  }));
  wrap.appendChild(hdr);

  // Day-of-week labels
  const dowRow = el('div', 'mc-dow-row');
  for (const d of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'])
    dowRow.appendChild(el('span', 'mc-dow', d));
  wrap.appendChild(dowRow);

  // Grid
  const grid = el('div', 'mc-grid');
  for (let i = 0; i < firstDow; i++)
    grid.appendChild(el('div', 'mc-cell mc-empty'));

  for (let day = 1; day <= daysInMonth; day++) {
    const ds   = _ds(y, m, day);
    const cell = el('div', 'mc-cell');

    if (showPeriod) {
      if (entries.some(e => e.start <= ds && ds <= e.end)) cell.classList.add('mc-period');
      if (spotting.includes(ds))                           cell.classList.add('mc-spotting');
    }
    if (ds === today)    cell.classList.add('mc-today');
    if (ds === _selDate) cell.classList.add('mc-sel');

    cell.appendChild(el('span', 'mc-num', String(day)));

    if (!showPeriod) {
      const hasEvent = events.some(e => e.date === ds);
      const hasSpend = !!(spend[ds]?.length);
      if (hasEvent || hasSpend) {
        const dots = el('div', 'mc-dots');
        if (hasEvent) dots.appendChild(el('span', 'mc-dot mc-dot-ev'));
        if (hasSpend) dots.appendChild(el('span', 'mc-dot mc-dot-sp'));
        cell.appendChild(dots);
      }
    }

    cell.addEventListener('click', () => { _selDate = ds; _render(); });
    grid.appendChild(cell);
  }

  wrap.appendChild(grid);
  return wrap;
}

// ── Add / edit event sheet ────────────────────────────────────────────
function _showAddEvent(dateStr, existing = null) {
  const d    = _D();
  const cats = [
    { id: 'personal',  label: 'Personal'  },
    { id: 'work',      label: 'Work'      },
    { id: 'health',    label: 'Health'    },
    { id: 'family',    label: 'Family'    },
    { id: 'friends',   label: 'Friends'   },
    { id: 'travel',    label: 'Travel'    },
    { id: 'education', label: 'Education' },
    { id: 'project',   label: 'Project'   },
    { id: 'partner',   label: 'Partner'   },
  ];

  const overlay = el('div', 'mob-sheet-overlay');
  const sheet   = el('div', 'mob-sheet');

  sheet.innerHTML = `
    <div class="mob-sheet-hdr">
      <span class="mob-sheet-title">${existing ? 'Edit event' : 'Add event'}</span>
      <button class="mob-sheet-close">✕</button>
    </div>
    <div class="mob-sheet-body">
      <input id="ms-ev-title" type="text" placeholder="Title" autocomplete="off">
      <div class="mob-field-row">
        <input id="ms-ev-time" type="time" placeholder="Start">
        <span class="mob-time-sep">–</span>
        <input id="ms-ev-time-end" type="time" placeholder="End">
      </div>
      <input id="ms-ev-link" type="url" placeholder="Meeting link (optional)" autocomplete="off">
      <input id="ms-ev-location" type="text" placeholder="Location (optional)" autocomplete="off">
      <div class="mob-cat-grid" id="ms-ev-cats"></div>
      <div class="mob-sheet-actions">
        <button class="mob-sheet-save" id="ms-ev-save">${existing ? 'Save' : 'Add'}</button>
        ${existing ? '<button class="mob-sheet-del" id="ms-ev-del">Delete</button>' : ''}
      </div>
    </div>
  `;
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  sheet.querySelector('#ms-ev-title').value    = existing?.title ?? '';
  sheet.querySelector('#ms-ev-time').value     = existing?.time ?? existing?.startTime ?? '';
  sheet.querySelector('#ms-ev-time-end').value = existing?.endTime ?? '';
  sheet.querySelector('#ms-ev-link').value     = existing?.link ?? '';
  sheet.querySelector('#ms-ev-location').value = existing?.location ?? '';

  let selCat = existing?.categoryId ?? existing?.category ?? 'personal';
  const catGrid = sheet.querySelector('#ms-ev-cats');
  cats.forEach(c => {
    const btn = el('button', 'mob-cat-btn' + (c.id === selCat ? ' active' : ''), c.label);
    btn.style.setProperty('--cat-color', `var(--cat-${c.id})`);
    btn.addEventListener('click', () => {
      selCat = c.id;
      catGrid.querySelectorAll('.mob-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    catGrid.appendChild(btn);
  });

  const close = () => overlay.remove();
  sheet.querySelector('.mob-sheet-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const saveCal = events => {
    const cal = { ...(d.calendar || {}), events };
    d.calendar = cal; _mobileData = d; save({ calendar: cal });
    close(); _render();
  };

  sheet.querySelector('#ms-ev-save').addEventListener('click', () => {
    const title = sheet.querySelector('#ms-ev-title').value.trim();
    if (!title) { sheet.querySelector('#ms-ev-title').focus(); return; }
    const time     = sheet.querySelector('#ms-ev-time').value;
    const endTime  = sheet.querySelector('#ms-ev-time-end').value;
    const link     = sheet.querySelector('#ms-ev-link').value.trim();
    const location = sheet.querySelector('#ms-ev-location').value.trim();
    const ev = { ...(existing || {}), id: existing?.id ?? _uid(), date: existing?.date ?? dateStr, title, category: selCat, categoryId: selCat };
    delete ev.startTime;                 // drop legacy field
    if (time) ev.time = time; else delete ev.time;
    if (endTime) ev.endTime = endTime; else delete ev.endTime;
    if (link) ev.link = link; else delete ev.link;
    if (location) ev.location = location; else delete ev.location;
    const events = existing
      ? (d.calendar?.events || []).map(e => e.id === existing.id ? ev : e)
      : [...(d.calendar?.events || []), ev];
    saveCal(events);
  });

  if (existing) {
    sheet.querySelector('#ms-ev-del').addEventListener('click', () => {
      saveCal((d.calendar?.events || []).filter(e => e.id !== existing.id));
    });
  } else {
    setTimeout(() => sheet.querySelector('#ms-ev-title').focus(), 100);
  }
}

// ── Add / edit spend sheet ────────────────────────────────────────────
function _showAddSpend(dateStr, existing = null) {
  const d    = _D();
  const cats = (d.settings?.spendCategories || []);

  const overlay = el('div', 'mob-sheet-overlay');
  const sheet   = el('div', 'mob-sheet');

  let selCat = existing?.categoryId || cats[0]?.id || 'food';
  let selSub = existing?.subcategory || '';

  sheet.innerHTML = `
    <div class="mob-sheet-hdr">
      <span class="mob-sheet-title">${existing ? 'Edit spend' : 'Add spend'}</span>
      <button class="mob-sheet-close">✕</button>
    </div>
    <div class="mob-sheet-body">
      <input id="ms-sp-amt" type="number" inputmode="numeric" placeholder="Amount (¥)">
      <div class="mob-cat-grid" id="ms-sp-cats"></div>
      <div class="mob-sub-wrap" id="ms-sp-subs"></div>
      <input id="ms-sp-note" type="text" placeholder="Note (optional)" autocomplete="off">
      <div class="mob-sheet-actions">
        <button class="mob-sheet-save" id="ms-sp-save">${existing ? 'Save' : 'Add'}</button>
        ${existing ? '<button class="mob-sheet-del" id="ms-sp-del">Delete</button>' : ''}
      </div>
    </div>
  `;
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  sheet.querySelector('#ms-sp-amt').value  = existing?.amount ?? '';
  sheet.querySelector('#ms-sp-note').value = existing?.note ?? '';

  function renderSubs() {
    const wrap = sheet.querySelector('#ms-sp-subs');
    const cat  = cats.find(c => c.id === selCat);
    const subs = cat?.sub || [];
    wrap.innerHTML = '';
    if (!subs.length) { selSub = ''; return; }
    if (selSub && !subs.includes(selSub)) selSub = '';   // clear if not valid for this category
    const pick = (val, elBtn) => {
      selSub = val;
      wrap.querySelectorAll('.mob-sub-btn').forEach(b => b.classList.remove('active'));
      elBtn.classList.add('active');
    };
    const noneBtn = el('button', 'mob-sub-btn' + (selSub === '' ? ' active' : ''), 'None');
    noneBtn.addEventListener('click', () => pick('', noneBtn));
    wrap.appendChild(noneBtn);
    subs.forEach(s => {
      const b = el('button', 'mob-sub-btn' + (s === selSub ? ' active' : ''), s);
      b.addEventListener('click', () => pick(s, b));
      wrap.appendChild(b);
    });
  }

  const catGrid = sheet.querySelector('#ms-sp-cats');
  cats.forEach(c => {
    const btn = el('button', 'mob-cat-btn' + (c.id === selCat ? ' active' : ''), c.name);
    btn.style.setProperty('--cat-color', c.color || `var(--cat-${c.id})`);
    btn.addEventListener('click', () => {
      selCat = c.id;
      catGrid.querySelectorAll('.mob-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSubs();
    });
    catGrid.appendChild(btn);
  });
  renderSubs();

  const close = () => overlay.remove();
  sheet.querySelector('.mob-sheet-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const saveSpend = entries => {
    const spendEntries = { ...(d.calendar?.spendEntries || {}) };
    if (entries.length) spendEntries[dateStr] = entries; else delete spendEntries[dateStr];
    const cal = { ...(d.calendar || {}), spendEntries };
    d.calendar = cal; _mobileData = d; save({ calendar: cal });
    close(); _render();
  };

  sheet.querySelector('#ms-sp-save').addEventListener('click', () => {
    const amt = parseFloat(sheet.querySelector('#ms-sp-amt').value);
    if (!amt || isNaN(amt)) { sheet.querySelector('#ms-sp-amt').focus(); return; }
    const note  = sheet.querySelector('#ms-sp-note').value.trim();
    const prev  = d.calendar?.spendEntries?.[dateStr] || [];
    const entry = { ...(existing || {}), id: existing?.id ?? _uid(), categoryId: selCat, subcategory: selSub || '', amount: amt, currency: existing?.currency ?? 'JPY', note };
    const entries = existing ? prev.map(e => e.id === existing.id ? entry : e) : [...prev, entry];
    saveSpend(entries);
  });

  if (existing) {
    sheet.querySelector('#ms-sp-del').addEventListener('click', () => {
      saveSpend((d.calendar?.spendEntries?.[dateStr] || []).filter(e => e.id !== existing.id));
    });
  } else {
    setTimeout(() => sheet.querySelector('#ms-sp-amt').focus(), 100);
  }
}

// Sort events chronologically (morning → night); untimed events first.
function _sortEventsByTime(events) {
  return [...events].sort((a, b) => {
    const ta = a.time ?? a.startTime;
    const tb = b.time ?? b.startTime;
    if (!ta && !tb) return 0;
    if (!ta) return -1;
    if (!tb) return 1;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

// ── Day detail (events + spend for one date) ─────────────────────────
function _buildDayDetail(dateStr) {
  const d    = _D();
  const frag = document.createDocumentFragment();

  const [sy, sm, sd] = dateStr.split('-').map(Number);
  const lbl = el('div', 'day-date-label',
    new Date(sy, sm - 1, sd).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  );
  frag.appendChild(lbl);

  // Events
  const events = _sortEventsByTime((d.calendar?.events || []).filter(e => e.date === dateStr));
  const evSec  = el('div', 'day-section');
  const evHdr  = el('div', 'day-sec-hdr');
  evHdr.appendChild(el('span', 'day-sec-title', 'Events'));
  const evAdd = el('button', 'day-sec-add', '+');
  evAdd.addEventListener('click', () => _showAddEvent(dateStr));
  evHdr.appendChild(evAdd);
  evSec.appendChild(evHdr);
  if (events.length) {
    const list = el('div', 'day-list');
    for (const ev of events) {
      const item = el('div', 'day-item');
      const dot  = el('span', 'day-dot');
      dot.style.background = `var(--cat-${ev.categoryId ?? ev.category ?? 'personal'})`;
      item.appendChild(dot);
      const info = el('div', 'day-item-info');
      info.appendChild(el('span', 'day-item-title', ev.title));
      const evTime = ev.time ?? ev.startTime;
      if (evTime) info.appendChild(el('span', 'day-item-meta', ev.endTime ? `${evTime}–${ev.endTime}` : evTime));
      if (ev.link) {
        const linkEl = document.createElement('a');
        linkEl.className = 'day-item-link';
        linkEl.href = ev.link;
        linkEl.target = '_blank';
        linkEl.rel = 'noopener noreferrer';
        let linkLabel = 'Open link';
        try { linkLabel = new URL(ev.link).hostname.replace(/^www\./, ''); } catch {}
        linkEl.innerHTML = `<span class="material-symbols-outlined">videocam</span>${linkLabel}`;
        linkEl.addEventListener('click', e => e.stopPropagation()); // tap link = open, not edit
        info.appendChild(linkEl);
      }
      if (ev.location) {
        const loc = document.createElement('a');
        loc.className = 'day-item-location';
        loc.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}`;
        loc.target = '_blank';
        loc.rel = 'noopener noreferrer';
        loc.innerHTML = `<span class="material-symbols-outlined">location_on</span>${ev.location}`;
        loc.addEventListener('click', e => e.stopPropagation()); // tap map link = maps, not edit
        info.appendChild(loc);
      }
      item.appendChild(info);
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => _showAddEvent(dateStr, ev));
      list.appendChild(item);
    }
    evSec.appendChild(list);
  } else {
    evSec.appendChild(el('div', 'day-empty', 'No events'));
  }
  frag.appendChild(evSec);

  // Spend
  const spendEntries = d.calendar?.spendEntries?.[dateStr] || [];
  const total  = spendEntries.reduce((s, e) => s + (e.amount || 0), 0);
  const spSec  = el('div', 'day-section');
  const spHdr  = el('div', 'day-sec-hdr');
  spHdr.appendChild(el('span', 'day-sec-title', 'Spend'));
  const spRight = el('div', 'day-sec-right');
  if (total) spRight.appendChild(el('span', 'day-sec-total', '¥' + total.toLocaleString()));
  const spAdd = el('button', 'day-sec-add', '+');
  spAdd.addEventListener('click', () => _showAddSpend(dateStr));
  spRight.appendChild(spAdd);
  spHdr.appendChild(spRight);
  spSec.appendChild(spHdr);
  if (spendEntries.length) {
    const list = el('div', 'day-list');
    const spendCats = d.settings?.spendCategories || [];
    for (const entry of spendEntries) {
      const cat  = spendCats.find(c => c.id === entry.categoryId);
      const item = el('div', 'day-item');
      const dot  = el('span', 'day-dot');
      dot.style.background = cat?.color || `var(--cat-${entry.categoryId})`;
      item.appendChild(dot);
      const info = el('div', 'day-item-info');
      const label = (cat?.name || entry.categoryId) + (entry.subcategory ? ' · ' + entry.subcategory : '');
      info.appendChild(el('span', 'day-item-title', label));
      if (entry.note) info.appendChild(el('span', 'day-item-meta', entry.note));
      item.appendChild(info);
      item.appendChild(el('span', 'day-item-amt', '¥' + (entry.amount || 0).toLocaleString()));
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => _showAddSpend(dateStr, entry));
      list.appendChild(item);
    }
    spSec.appendChild(list);
  } else {
    spSec.appendChild(el('div', 'day-empty', 'No spend'));
  }
  frag.appendChild(spSec);

  return frag;
}

// ── Week view ────────────────────────────────────────────────────────
function _buildWeekView() {
  const d     = _D();
  const today = _todayStr();
  const events = d.calendar?.events || [];
  const spend  = d.calendar?.spendEntries || {};

  const wrap = el('div', 'cal-week-wrap');

  // Find Monday of the selected week
  const [sy, sm, sd] = _selDate.split('-').map(Number);
  const sel = new Date(sy, sm - 1, sd);
  const dow = sel.getDay(); // 0=Sun
  const startOfWeek = new Date(sel);
  startOfWeek.setDate(sd - ((dow + 6) % 7)); // Monday

  for (let i = 0; i < 7; i++) {
    const day = new Date(startOfWeek);
    day.setDate(startOfWeek.getDate() + i);
    const ds = day.toLocaleDateString('sv-SE');
    const dayLabel = day.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });

    const row  = el('div', 'cal-week-row' + (ds === today ? ' today' : '') + (ds === _selDate ? ' selected' : ''));
    const hdr  = el('div', 'cal-week-day-hdr');
    hdr.appendChild(el('span', 'cal-week-day-label', dayLabel));

    const dayEvts   = _sortEventsByTime(events.filter(e => e.date === ds));
    const daySpend  = spend[ds] || [];
    const spTotal   = daySpend.reduce((s, e) => s + (e.amount || 0), 0);
    if (spTotal) hdr.appendChild(el('span', 'cal-week-spend', '¥' + spTotal.toLocaleString()));
    row.appendChild(hdr);

    if (dayEvts.length) {
      const chips = el('div', 'cal-week-chips');
      dayEvts.slice(0, 4).forEach(ev => {
        const chip = el('div', 'cal-week-chip');
        chip.style.background = `color-mix(in srgb, var(--cat-${ev.category ?? 'personal'}) 18%, transparent)`;
        chip.style.color = `var(--cat-${ev.category ?? 'personal'})`;
        chip.textContent = ev.title;
        chips.appendChild(chip);
      });
      if (dayEvts.length > 4) chips.appendChild(el('span', 'cal-week-more', `+${dayEvts.length - 4} more`));
      row.appendChild(chips);
    }

    row.addEventListener('click', () => { _selDate = ds; _calView = 'day'; _render(); });
    wrap.appendChild(row);
  }

  return wrap;
}

// ── Calendar tab ─────────────────────────────────────────────────────
function _buildDayTab() {
  const wrap = el('div', 'tab-content');

  // View toggle: Day | Week only
  const toggle = el('div', 'cal-view-toggle-mob');
  for (const v of ['Day', 'Week']) {
    const b = el('button', 'cal-vtog-btn' + (_calView === v.toLowerCase() ? ' active' : ''), v);
    b.addEventListener('click', () => { _calView = v.toLowerCase(); _render(); });
    toggle.appendChild(b);
  }
  wrap.appendChild(toggle);

  if (_calView === 'week') {
    wrap.appendChild(_buildWeekView());
  } else {
    wrap.appendChild(_buildMiniCal(false));
    wrap.appendChild(_buildDayDetail(_selDate));
  }

  return wrap;
}

// ── Period tab ───────────────────────────────────────────────────────
function _buildPeriodTab() {
  const d    = _D();
  const syms = d.period?.symptoms || {};
  const wrap = el('div', 'tab-content');

  // Cycle status
  const status = _cycleStatus();
  if (status) {
    const bar = el('div', 'cycle-bar');
    bar.appendChild(el('span', 'cycle-day', `Day ${status.cycleDay}`));
    bar.appendChild(el('span', 'cycle-phase', status.phase));
    if (status.nextStr) bar.appendChild(el('span', 'cycle-next', `Next ~${status.nextStr}`));
    wrap.appendChild(bar);
  }

  wrap.appendChild(_buildMiniCal(true));

  // Selected date label
  const [sy, sm, sd] = _selDate.split('-').map(Number);
  wrap.appendChild(el('div', 'day-date-label',
    new Date(sy, sm - 1, sd).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  ));

  // Flow
  const flowSec = el('div', 'period-section');
  flowSec.appendChild(el('div', 'period-sec-label', 'Flow'));
  const flowRow = el('div', 'flow-btns');
  const curFlow = _getFlow(_selDate);
  for (const f of ['none', 'light', 'medium', 'heavy', 'spotting']) {
    flowRow.appendChild(btn(
      'flow-btn' + (f === curFlow ? ' active' : '') + (f === 'spotting' ? ' spotting' : ''),
      f.charAt(0).toUpperCase() + f.slice(1),
      () => _logFlow(_selDate, f)
    ));
  }
  flowSec.appendChild(flowRow);
  wrap.appendChild(flowSec);

  // Symptoms
  const symSec = el('div', 'period-section');
  symSec.appendChild(el('div', 'period-sec-label', 'Symptoms'));
  const daySym = syms[_selDate] || {};
  for (const group of SYMPTOM_GROUPS) {
    symSec.appendChild(el('div', 'sym-group-label', group.label));
    const chips = el('div', 'sym-chips');
    for (const { key, label } of group.items) {
      chips.appendChild(btn(
        'sym-chip' + (daySym[key] ? ' active' : ''),
        label,
        () => _toggleSymptom(_selDate, key)
      ));
    }
    symSec.appendChild(chips);
  }
  wrap.appendChild(symSec);

  return wrap;
}

// ── Finance tab (income / salary) ────────────────────────────────────
function _buildFinanceTab() {
  const wrap = el('div', 'tab-content');
  const { y, m } = _finMonth;

  // Month nav
  const nav = el('div', 'fin-month-nav');
  nav.appendChild(btn('fin-month-btn', '‹', () => {
    let nm = m - 1, ny = y; if (nm < 0) { nm = 11; ny--; }
    _finMonth = { y: ny, m: nm }; _render();
  }));
  nav.appendChild(el('span', 'fin-month-label', `${FIN_MONTHS[m]} ${y}`));
  nav.appendChild(btn('fin-month-btn', '›', () => {
    let nm = m + 1, ny = y; if (nm > 11) { nm = 0; ny++; }
    _finMonth = { y: ny, m: nm }; _render();
  }));
  wrap.appendChild(nav);

  const rows = _finIncome(y, m);

  const netEl = el('div', 'fin-net');
  const calcNet = () => rows.reduce((s, r) => s + (r.isNeg ? -(r.amount || 0) : (r.amount || 0)), 0);
  const paintNet = () => {
    const n = calcNet();
    netEl.innerHTML = `<span>Net</span><span class="fin-net-val">¥${n.toLocaleString()}</span>`;
  };

  const sec = el('div', 'fin-income-sec');
  sec.appendChild(el('div', 'fin-sec-title', 'Income'));
  rows.forEach((r, i) => {
    const row = el('div', 'fin-row' + (r.isNeg ? ' neg' : ''));
    const left = el('div', 'fin-row-left');

    if (_finEditLabelId === r.id) {
      // Editing the name: input + a check to confirm (deliberate, no misclicks).
      const labelInp = el('input', 'fin-label-inp'); labelInp.value = r.label; labelInp.autocomplete = 'off';
      const check = el('button', 'fin-row-check'); check.innerHTML = '<span class="material-symbols-outlined">check</span>';
      const doSave = () => { rows[i].label = labelInp.value.trim() || r.label; _finEditLabelId = null; _setFinIncome(y, m, rows); _render(); };
      check.addEventListener('click', doSave);
      labelInp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  doSave();
        if (e.key === 'Escape') { _finEditLabelId = null; _render(); }
      });
      left.append(labelInp, check);
      requestAnimationFrame(() => labelInp.focus());
    } else {
      const labelSpan = el('span', 'fin-row-label', r.label);
      const editBtn = el('button', 'fin-row-edit'); editBtn.innerHTML = '<span class="material-symbols-outlined">edit</span>';
      editBtn.addEventListener('click', () => { _finEditLabelId = r.id; _render(); });
      left.append(labelSpan, editBtn);
    }

    const inp = el('input', 'fin-row-amt');
    inp.type = 'number'; inp.inputMode = 'numeric'; inp.placeholder = '0';
    inp.value = r.amount || '';
    inp.addEventListener('input', () => { rows[i].amount = parseFloat(inp.value) || 0; paintNet(); });
    inp.addEventListener('blur',  () => _setFinIncome(y, m, rows));

    row.append(left, inp);
    sec.appendChild(row);
  });
  wrap.appendChild(sec);

  paintNet();
  wrap.appendChild(netEl);
  return wrap;
}

// ── Notes tab ────────────────────────────────────────────────────────
function _buildNotesTab() {
  const d     = _D();
  const notes = (d.notes?.items || [])
    .filter(n => !n.archived)
    .slice()
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const wrap  = el('div', 'tab-content');

  if (!notes.length) {
    wrap.appendChild(el('div', 'day-empty', 'No notes yet'));
    return wrap;
  }

  const list = el('div', 'notes-list');
  for (const note of notes) {
    const isOpen = _expandedNote === note.id;
    const card   = el('div', 'note-card' + (isOpen ? ' expanded' : ''));

    if (isOpen) {
      // Editable: title + body, with delete. Edits save on blur (no re-render so focus is kept).
      const titleInp = el('input', 'note-edit-title'); titleInp.value = note.title || ''; titleInp.placeholder = 'Title';
      const bodyInp  = el('textarea', 'note-edit-body'); bodyInp.value = note.text || ''; bodyInp.placeholder = 'Write a note…';
      const persist  = () => _updateNote(note.id, { title: titleInp.value, text: bodyInp.value });
      [titleInp, bodyInp].forEach(inp => {
        inp.addEventListener('click', e => e.stopPropagation());
        inp.addEventListener('blur', persist);
      });
      const autoGrow = () => { bodyInp.style.height = 'auto'; bodyInp.style.height = bodyInp.scrollHeight + 'px'; };
      bodyInp.addEventListener('input', autoGrow);

      const actions = el('div', 'note-edit-actions');
      const collapseBtn = el('button', 'note-act-btn', 'Done');
      collapseBtn.addEventListener('click', e => { e.stopPropagation(); persist(); _expandedNote = null; _render(); });
      const delBtn = el('button', 'note-act-btn note-del-btn', 'Delete');
      delBtn.addEventListener('click', e => { e.stopPropagation(); if (confirm('Delete this note?')) _deleteNote(note.id); });
      actions.append(collapseBtn, delBtn);

      card.append(titleInp, bodyInp, actions);
      requestAnimationFrame(autoGrow);
    } else {
      card.appendChild(el('div', 'note-title', note.title || note.text?.split('\n')[0] || 'Untitled'));
      if (note.text) {
        card.appendChild(el('div', 'note-preview',
          note.text.slice(0, 140) + (note.text.length > 140 ? '…' : '')
        ));
      }
      card.addEventListener('click', () => { _expandedNote = note.id; _render(); });
    }
    list.appendChild(card);
  }
  wrap.appendChild(list);
  return wrap;
}

// Save a note edit in place (no re-render, so the open editor keeps focus).
function _updateNote(id, patch) {
  const d = _D();
  const items = (d.notes?.items || []).map(n => n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n);
  d.notes = { ...(d.notes || {}), items };
  _mobileData = d;
  save({ notes: d.notes });
}

function _deleteNote(id) {
  const d = _D();
  const items = (d.notes?.items || []).filter(n => n.id !== id);
  d.notes = { ...(d.notes || {}), items };
  _mobileData = d;
  save({ notes: d.notes });
  _expandedNote = null;
  _render();
}

// ── Bottom nav ───────────────────────────────────────────────────────
function _buildBottomNav() {
  const nav = el('div', 'bottom-nav');
  for (const { id, label, icon } of [
    { id: 'day',     label: 'Day',     icon: 'calendar_today' },
    { id: 'period',  label: 'Period',  icon: 'water_drop' },
    { id: 'finance', label: 'Finance', icon: 'payments' },
    { id: 'notes',   label: 'Notes',   icon: 'note' },
  ]) {
    const b = el('button', 'nav-btn' + (_tab === id ? ' active' : ''));
    b.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span class="nav-label">${label}</span>`;
    b.addEventListener('click', () => { _tab = id; _render(); });
    nav.appendChild(b);
  }
  return nav;
}

// ── Render (defined below with tap handler) ───────────────────────────────

function _showMobileLogin() {
  return new Promise(resolve => {
    const app = document.getElementById('mob-app');
    app.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:24px;">
        <form id="mob-login" style="display:flex;flex-direction:column;gap:16px;width:100%;max-width:320px;">
          <span style="font-size:20px;font-weight:600;margin-bottom:8px;">Seratus</span>
          <input id="mob-email" type="email" placeholder="Email" autocomplete="email"
            style="padding:12px 16px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:15px;">
          <input id="mob-pw" type="password" placeholder="Password" autocomplete="current-password"
            style="padding:12px 16px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:15px;">
          <button type="submit"
            style="padding:12px 16px;border-radius:10px;border:none;background:var(--accent);color:#fff;font-size:15px;font-weight:600;">
            Sign in
          </button>
          <p id="mob-err" style="color:var(--red);font-size:13px;margin:0;min-height:1em;"></p>
        </form>
      </div>
    `;
    app.querySelector('#mob-login').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = app.querySelector('button[type=submit]');
      const err = app.querySelector('#mob-err');
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      err.textContent = '';
      try {
        await signIn(app.querySelector('#mob-email').value, app.querySelector('#mob-pw').value);
        window.location.reload();
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    });
  });
}

let _mobTaps = 0, _mobTapTimer = null;

function _onTitleTap() {
  _mobTaps++;
  clearTimeout(_mobTapTimer);
  _mobTapTimer = setTimeout(() => { _mobTaps = 0; }, 2000);
  if (_mobTaps >= 10) {
    _mobTaps = 0;
    getSession().then(s => { if (!s) _showMobileLogin().then(() => load().then(d => { _mobileData = d; _render(); })); });
  }
}

let _lastRenderedTab = null;

function _render() {
  const app = document.getElementById('mob-app');
  // Preserve scroll position across a same-tab rebuild (e.g. toggling a symptom
  // shouldn't fling you back to the top). Switching tabs still starts at the top.
  const sameTab    = _tab === _lastRenderedTab;
  const prevScroll = sameTab ? (app.querySelector('.mob-main')?.scrollTop ?? 0) : 0;
  app.innerHTML = '';

  const hdr = el('div', 'mob-header');
  const title = el('span', 'brand-pill-name mob-title');
  title.textContent = 'Seratus';
  title.addEventListener('click', _onTitleTap);
  hdr.appendChild(title);
  const themeBtn = el('button', 'mob-theme-btn');
  themeBtn.innerHTML = `<span class="material-symbols-outlined">${_mobTheme === 'light' ? 'dark_mode' : 'light_mode'}</span>`;
  themeBtn.addEventListener('click', () => { _applyTheme(_mobTheme === 'dark' ? 'light' : 'dark'); _render(); });
  hdr.appendChild(themeBtn);
  app.appendChild(hdr);

  const main = el('div', 'mob-main');
  if (_tab === 'day')     main.appendChild(_buildDayTab());
  if (_tab === 'period')  main.appendChild(_buildPeriodTab());
  if (_tab === 'finance') main.appendChild(_buildFinanceTab());
  if (_tab === 'notes')   main.appendChild(_buildNotesTab());
  app.appendChild(main);

  app.appendChild(_buildBottomNav());

  // Restore scroll position after the rebuild.
  main.scrollTop = prevScroll;
  _lastRenderedTab = _tab;
}

load().then(data => { _mobileData = data; _render(); });

// calendar.js — Calendar module

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAYS     = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAYS_ALL = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; // indexed by getDay()
const DOW_SINGLE = ['S','M','T','W','T','F','S'];             // single-letter, indexed by getDay()

const DEFAULT_CATS = [
  { id: 'work',      name: 'Work',      isCustom: false },
  { id: 'personal',  name: 'Personal',  isCustom: false },
  { id: 'health',    name: 'Health',    isCustom: false },
  { id: 'family',    name: 'Family',    isCustom: false },
  { id: 'friends',   name: 'Friends',   isCustom: false },
  { id: 'travel',    name: 'Travel',    isCustom: false },
  { id: 'education', name: 'Education', isCustom: false },
  { id: 'project',   name: 'Project',   isCustom: false },
  { id: 'partner',   name: 'Partner',   isCustom: false },
];

function cats() { return _data.settings?.categories ?? DEFAULT_CATS; }

function catColor(id) {
  const cat = cats().find(c => c.id === id);
  return cat?.isCustom && cat.color ? cat.color : `var(--cat-${id})`;
}

function catBg(id) {
  const cat = cats().find(c => c.id === id);
  if (cat?.isCustom && cat.color)
    return `color-mix(in srgb, ${cat.color} 18%, transparent)`;
  return '';  // let CSS class handle it
}

function spendCats() { return _data.settings?.spendCategories ?? []; }
function spendCatById(id) { return spendCats().find(c => c.id === id); }

let _container, _data, _onSave;
let _year = new Date().getFullYear();
let _view = 'week'; // 'week' | 'month' | 'year'
let _weekStart = null; // Monday of displayed week; null until first week render
let _modal = null;
let _spendModal = null;
let _searchPanel = null;
let _tlModal = null;

// ── Helpers ────────────────────────────────────────────────────────

function uid() {
  return 'e_' + Math.random().toString(36).slice(2, 9);
}

function todayStr() {
  const tz = _data.settings?.timezone ?? 'Asia/Tokyo';
  return new Date().toLocaleDateString('sv', { timeZone: tz });
}

function events() {
  return _data.calendar?.events ?? [];
}

function sortByTime(evts) {
  return [...evts].sort((a, b) => {
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : 1;
  });
}

function evtChipLabel(evt) {
  return evt.time ? evt.time + ' ' + evt.title : evt.title;
}

function dateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dateStrFromDate(date) {
  return dateStr(date.getFullYear(), date.getMonth(), date.getDate());
}

function getWeekMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function currencies() { return _data.settings?.currencies?.length ? _data.settings.currencies : ['JPY']; }

function fmtSpend(amount, currency) {
  const cur = currency ?? currencies()[0];
  return `${cur} ${Number(amount).toLocaleString()}`;
}

function weekStartDay() {
  const ws = _data?.settings?.weekStart;
  return (typeof ws === 'number' && ws >= 0 && ws <= 6) ? ws : 1;
}

function getWeekStart(date) {
  const ws = weekStartDay();
  const d  = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() - ws + 7) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

function orderedDays() {
  const ws = weekStartDay();
  return Array.from({ length: 7 }, (_, i) => DAYS_ALL[(ws + i) % 7]);
}

// ── Module contract ────────────────────────────────────────────────

export function init(container, data, onSave) {
  _container = container;
  _data = data;
  _onSave = onSave;
  _view = data.calendar?.lastView ?? 'week';

  const cssHref = new URL('./calendar.css', import.meta.url).href;
  if (!document.querySelector(`link[href="${cssHref}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssHref;
    document.head.appendChild(link);
  }

  _container.style.cssText =
    'padding:0;overflow:hidden;position:relative;display:flex;flex-direction:column;';

  render();
}

export function destroy() {
  _container.style.cssText = '';
  _container.innerHTML = '';
  _modal = null;
  _spendModal = null;
  _tlModal = null;
}

export function onDataChange(newData) {
  const prevWS = _data?.settings?.weekStart;
  _data = newData;
  if (newData.settings?.weekStart !== prevWS) {
    _weekStart = null; // force recalculate for new week start
    render();
  } else {
    renderGrid();
  }
}

// ── Rendering ──────────────────────────────────────────────────────

let _calLast = { view: null, year: null };
function render() {
  _modal = null;
  // Preserve scroll on a same view+year rebuild (editing an event shouldn't jump
  // to the top). Auto-scroll-to-today only runs when the view/year actually changes.
  const sameViewYear = _calLast.view === _view && _calLast.year === _year;
  const prevScroll   = sameViewYear ? (_container.querySelector('#cal-scroll')?.scrollTop ?? 0) : 0;

  _container.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'cal-header';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'cal-year-btn';
  prevBtn.textContent = '‹';

  const yearLabel = document.createElement('span');

  const nextBtn = document.createElement('button');
  nextBtn.className = 'cal-year-btn';
  nextBtn.textContent = '›';

  const todayBtn = document.createElement('button');
  todayBtn.className = 'cal-today-btn';
  todayBtn.textContent = 'today';

  if (_view === 'timeline') {
    yearLabel.className = 'cal-year-label';
    yearLabel.textContent = 'Timeline';
    prevBtn.style.visibility = 'hidden';
    nextBtn.style.visibility = 'hidden';
    todayBtn.addEventListener('click', () => scrollToTimelineYear(new Date().getFullYear()));
  } else if (_view === 'week') {
    if (!_weekStart) _weekStart = getWeekStart(new Date());
    yearLabel.className = 'cal-week-label';
    const wEnd = addDays(_weekStart, 6);
    const sameMonth = _weekStart.getMonth() === wEnd.getMonth();
    yearLabel.textContent = sameMonth
      ? `${MONTHS[_weekStart.getMonth()].slice(0, 3)} ${_weekStart.getDate()}–${wEnd.getDate()}`
      : `${MONTHS[_weekStart.getMonth()].slice(0, 3)} ${_weekStart.getDate()} – ${MONTHS[wEnd.getMonth()].slice(0, 3)} ${wEnd.getDate()}`;
    prevBtn.addEventListener('click', () => { _weekStart = addDays(_weekStart, -7); render(); });
    nextBtn.addEventListener('click', () => { _weekStart = addDays(_weekStart, 7); render(); });
    todayBtn.addEventListener('click', () => { _weekStart = getWeekStart(new Date()); render(); });
  } else {
    yearLabel.className = 'cal-year-label';
    yearLabel.textContent = _year;
    prevBtn.addEventListener('click', () => { _year--; render(); });
    nextBtn.addEventListener('click', () => { _year++; render(); });
    todayBtn.addEventListener('click', () => {
      _year = new Date().getFullYear();
      render();
      if (_view === 'month') requestAnimationFrame(() => scrollToMonth(new Date().getMonth()));
    });
  }

  // View toggle
  const viewToggle = document.createElement('div');
  viewToggle.className = 'cal-view-toggle';
  ['week', 'month', 'year', 'timeline'].forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'cal-view-btn' + (_view === v ? ' active' : '');
    btn.textContent = v.charAt(0).toUpperCase() + v.slice(1);
    btn.addEventListener('click', () => { _view = v; _onSave({ calendar: { ...calData(), lastView: v } }); render(); });
    viewToggle.appendChild(btn);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'cal-add-btn';
  addBtn.textContent = '+ add event';
  addBtn.addEventListener('click', () => {
    if (_view === 'timeline') {
      openTimelineModal(new Date().getFullYear());
    } else if (_view === 'week' && _weekStart) {
      const tk = todayStr();
      const wEnd = addDays(_weekStart, 6);
      const inWeek = tk >= dateStrFromDate(_weekStart) && tk <= dateStrFromDate(wEnd);
      openModal(inWeek ? tk : dateStrFromDate(_weekStart));
    } else {
      openModal(todayStr());
    }
  });

  const searchBtn = document.createElement('button');
  searchBtn.className = 'cal-search-btn';
  searchBtn.title = 'Search events';
  searchBtn.innerHTML = '<span class="material-symbols-outlined">search</span>';
  searchBtn.addEventListener('click', () => {
    if (_searchPanel) { closeSearch(); } else { openSearch(); }
  });

  header.append(prevBtn, yearLabel, nextBtn, todayBtn, viewToggle, addBtn, searchBtn);
  _container.appendChild(header);

  // Scroll area
  const scroll = document.createElement('div');
  scroll.className = 'cal-scroll';
  scroll.id = 'cal-scroll';
  _container.appendChild(scroll);

  if (_view === 'month') {
    buildMonths(scroll);
    if (!sameViewYear && _year === new Date().getFullYear()) {
      requestAnimationFrame(() => scrollToMonth(new Date().getMonth()));
    }
  } else if (_view === 'week') {
    buildWeek(scroll);
  } else if (_view === 'timeline') {
    buildTimeline(scroll);
    if (!sameViewYear) requestAnimationFrame(() => scrollToTimelineYear(new Date().getFullYear()));
  } else {
    buildYear(scroll);
  }

  scroll.scrollTop = prevScroll;
  _calLast = { view: _view, year: _year };
}

function renderGrid() {
  const scroll = _container.querySelector('#cal-scroll');
  if (!scroll) return;
  if (_view === 'week') {
    buildWeek(scroll);
  } else if (_view === 'month') {
    const top = scroll.scrollTop;
    buildMonths(scroll);
    scroll.scrollTop = top;
  } else if (_view === 'timeline') {
    buildTimeline(scroll);
  } else {
    buildYear(scroll);
  }
}

function initSortable(scroll) {
  scroll.querySelectorAll('.cal-evt-list').forEach(list => {
    Sortable.create(list, {
      group:              'cal-events',
      animation:          120,
      delay:              150,
      delayOnTouchOnly:   true,
      touchStartThreshold: 4,
      onEnd(evt) {
        if (evt.from === evt.to) return;
        setTimeout(() => moveEvent(evt.item.dataset.id, evt.to.dataset.date), 0);
      },
      onAdd(evt) {
        if (evt.item.dataset.fromParking !== 'true') return;
        const id   = evt.item.dataset.id;
        const date = evt.to.dataset.date;
        evt.item.remove();
        setTimeout(() => moveEvent(id, date), 0);
      },
    });
  });
  scroll.querySelectorAll('.cal-spend-list').forEach(list => {
    Sortable.create(list, {
      group:              { name: 'cal-spend', put: 'cal-spend' },
      animation:          120,
      delay:              150,
      delayOnTouchOnly:   true,
      touchStartThreshold: 4,
      onEnd(evt) {
        if (evt.from === evt.to) return;
        setTimeout(() => moveSpendEntry(evt.item.dataset.id, evt.item.dataset.from, evt.to.dataset.date), 0);
      },
    });
  });
}

function buildMonths(scroll) {
  scroll.innerHTML = '';

  const todayKey = todayStr();
  const evtMap = {};
  events().forEach(e => {
    if (!evtMap[e.date]) evtMap[e.date] = [];
    evtMap[e.date].push(e);
  });
  Object.keys(evtMap).forEach(k => { evtMap[k] = sortByTime(evtMap[k]); });

  for (let m = 0; m < 12; m++) {
    const section = document.createElement('section');
    section.className = 'cal-month';
    section.dataset.month = m;

    // Month title
    const title = document.createElement('div');
    title.className = 'cal-month-title';
    title.textContent = MONTHS[m];
    section.appendChild(title);

    // Day-of-week header
    const dowRow = document.createElement('div');
    dowRow.className = 'cal-grid cal-dow-row';
    orderedDays().forEach(d => {
      const dow = DAYS_ALL.indexOf(d);
      const cell = document.createElement('div');
      cell.className = 'cal-dow' + (dow === 0 || dow === 6 ? ' weekend' : '');
      cell.textContent = d;
      dowRow.appendChild(cell);
    });
    section.appendChild(dowRow);

    // Day grid
    const grid = document.createElement('div');
    grid.className = 'cal-grid';

    const firstDay = new Date(_year, m, 1);
    const dim      = new Date(_year, m + 1, 0).getDate();
    const prevDim  = new Date(_year, m, 0).getDate();
    const startDow = (firstDay.getDay() - weekStartDay() + 7) % 7;

    // Leading blanks
    for (let i = 0; i < startDow; i++) {
      const cell = document.createElement('div');
      cell.className = 'cal-cell other-month';
      cell.innerHTML = `<div class="cal-day-num">${prevDim - startDow + 1 + i}</div>`;
      grid.appendChild(cell);
    }

    // Days
    for (let d = 1; d <= dim; d++) {
      const key     = dateStr(_year, m, d);
      const evts    = evtMap[key] ?? [];
      const dow     = new Date(_year, m, d).getDay();
      const cell    = document.createElement('div');
      cell.className = 'cal-cell'
        + (key === todayKey ? ' today' : '')
        + (dow === 0 || dow === 6 ? ' weekend' : '');

      const num = document.createElement('div');
      num.className = 'cal-day-num';
      num.textContent = d;
      cell.appendChild(num);

      // Sortable event list — drag events between days
      const evtList = document.createElement('div');
      evtList.className = 'cal-evt-list';
      evtList.dataset.date = key;

      const maxShow = 5;
      evts.slice(0, maxShow).forEach(evt => {
        const catId = evt.category ?? 'personal';
        const bg    = catBg(catId);
        const chip  = document.createElement('div');
        chip.className = `cal-evt${bg ? '' : ` evt-${catId}`}`;
        if (bg) { chip.style.background = bg; chip.style.color = catColor(catId); }
        chip.dataset.id = evt.id;
        chip.textContent = evtChipLabel(evt);
        chip.addEventListener('click', e => { e.stopPropagation(); openEventView(key, evt.id); });
        evtList.appendChild(chip);
      });
      if (evts.length > maxShow) {
        const more = document.createElement('div');
        more.className = 'cal-evt-more';
        more.textContent = `+${evts.length - maxShow} more`;
        evtList.appendChild(more);
      }

      cell.appendChild(evtList);
      cell.addEventListener('click', () => openModal(key));
      grid.appendChild(cell);
    }

    // Trailing blanks
    const filled = startDow + dim;
    const tail   = filled % 7 === 0 ? 0 : 7 - (filled % 7);
    for (let i = 1; i <= tail; i++) {
      const cell = document.createElement('div');
      cell.className = 'cal-cell other-month';
      cell.innerHTML = `<div class="cal-day-num">${i}</div>`;
      grid.appendChild(cell);
    }

    section.appendChild(grid);
    scroll.appendChild(section);
  }

  initSortable(scroll);
}

function scrollToMonth(month) {
  const scroll = _container.querySelector('#cal-scroll');
  const section = scroll?.querySelector(`[data-month="${month}"]`);
  if (section) section.scrollIntoView({ behavior: 'instant' });
}

function buildWeek(scroll) {
  scroll.innerHTML = '';
  if (!_weekStart) _weekStart = getWeekMonday(new Date());

  const todayKey = todayStr();
  const evtMap = {};
  events().forEach(e => {
    if (!e.date) return;
    if (!evtMap[e.date]) evtMap[e.date] = [];
    evtMap[e.date].push(e);
  });
  Object.keys(evtMap).forEach(k => { evtMap[k] = sortByTime(evtMap[k]); });

  const wrap = document.createElement('div');
  wrap.className = 'cal-week-wrap';

  const grid = document.createElement('div');
  grid.className = 'cal-week-grid';

  for (let i = 0; i < 7; i++) {
    const day   = addDays(_weekStart, i);
    const key   = dateStrFromDate(day);
    const dayEvts = evtMap[key] ?? [];
    const isToday = key === todayKey;

    const dow = day.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const col = document.createElement('div');
    col.className = 'cal-week-day' + (isToday ? ' today' : '') + (isWeekend ? ' weekend' : '');

    // Column header
    const hdr = document.createElement('div');
    hdr.className = 'cal-week-day-hdr';
    const dayName = document.createElement('div');
    dayName.className = 'cal-week-day-name';
    dayName.textContent = DAYS_ALL[day.getDay()];
    const dayNum = document.createElement('div');
    dayNum.className = 'cal-week-day-num';
    dayNum.textContent = day.getDate();
    hdr.append(dayName, dayNum);
    col.appendChild(hdr);

    // Column body
    const body = document.createElement('div');
    body.className = 'cal-week-day-body';

    // ── Events area (top) ──
    const evtArea = document.createElement('div');
    evtArea.className = 'cal-evt-area';
    evtArea.addEventListener('click', () => openModal(key));

    const evtList = document.createElement('div');
    evtList.className = 'cal-evt-list';
    evtList.dataset.date = key;

    dayEvts.forEach(evt => {
      const catId = evt.category ?? 'personal';
      const bg    = catBg(catId);
      const chip  = document.createElement('div');

      if (evt.time && evt.endTime) {
        chip.className = `cal-evt cal-week-evt cal-time-block${bg ? '' : ` evt-${catId}`}`;
        if (bg) { chip.style.background = bg; chip.style.color = catColor(catId); }
        chip.dataset.id = evt.id;

        const startEl = document.createElement('span');
        startEl.className = 'cal-tb-time cal-tb-start';
        startEl.textContent = evt.time;

        const body = document.createElement('span');
        body.className = 'cal-tb-body';
        const bar = document.createElement('span');
        bar.className = 'cal-tb-bar';
        const titleEl = document.createElement('span');
        titleEl.className = 'cal-tb-title';
        titleEl.textContent = evt.title;
        body.append(bar, titleEl);

        const endEl = document.createElement('span');
        endEl.className = 'cal-tb-time cal-tb-end';
        endEl.textContent = evt.endTime;

        chip.append(startEl, body, endEl);
      } else {
        chip.className = `cal-evt cal-week-evt${bg ? '' : ` evt-${catId}`}`;
        if (bg) { chip.style.background = bg; chip.style.color = catColor(catId); }
        chip.dataset.id = evt.id;
        chip.textContent = evtChipLabel(evt);
      }

      chip.addEventListener('click', e => { e.stopPropagation(); openEventView(key, evt.id); });
      evtList.appendChild(chip);
    });

    evtArea.appendChild(evtList);
    body.appendChild(evtArea);

    // ── Spend area (bottom) ──
    const daySpend = (calData().spendEntries ?? {})[key] ?? [];
    const spendSec = document.createElement('div');
    spendSec.className = 'cal-spend-section';
    spendSec.addEventListener('click', e => { e.stopPropagation(); openSpendModal(key); });

    // Divider header: ─── Spend ───
    const spendHdr = document.createElement('div');
    spendHdr.className = 'cal-spend-hdr';
    const spendLabel = document.createElement('span');
    spendLabel.className = 'cal-spend-label';
    spendLabel.textContent = 'Spend';
    spendHdr.appendChild(spendLabel);
    spendSec.appendChild(spendHdr);

    // Draggable spend chips
    const spendList = document.createElement('div');
    spendList.className = 'cal-spend-list';
    spendList.dataset.date = key;

    daySpend.forEach(entry => {
      const cat  = spendCatById(entry.categoryId);
      const chip = document.createElement('div');
      chip.className = 'cal-spend-chip';
      chip.dataset.id   = entry.id;
      chip.dataset.from = key;
      const dot = document.createElement('span');
      dot.className = 'cal-week-spend-dot';
      dot.style.background = cat?.color ?? 'var(--text-3)';
      const label = document.createElement('span');
      label.className = 'cal-spend-chip-label';
      label.textContent = entry.note || entry.subcategory || cat?.name || entry.categoryId;
      const amt = document.createElement('span');
      amt.className = 'cal-spend-chip-amt';
      amt.textContent = fmtSpend(entry.amount, entry.currency);
      chip.append(dot, label, amt);
      chip.addEventListener('click', e => { e.stopPropagation(); openSpendModal(key, entry.id); });
      spendList.appendChild(chip);
    });

    spendSec.appendChild(spendList);

    if (daySpend.length > 0) {
      const totalRow = document.createElement('div');
      totalRow.className = 'cal-week-spend-total';
      const total = daySpend.reduce((s, e) => s + Number(e.amount), 0);
      totalRow.innerHTML = `<span>Total</span><span>${fmtSpend(total)}</span>`;
      spendSec.appendChild(totalRow);
    }

    body.appendChild(spendSec);

    col.appendChild(body);
    grid.appendChild(col);
  }

  wrap.appendChild(grid);
  scroll.appendChild(wrap);
  initSortable(scroll);
}

function buildYear(scroll) {
  scroll.innerHTML = '';

  const todayKey = todayStr();
  const evtMap   = {};
  events().forEach(e => {
    if (!e.date) return;
    if (!evtMap[e.date]) evtMap[e.date] = [];
    evtMap[e.date].push(e);
  });
  Object.keys(evtMap).forEach(k => { evtMap[k] = sortByTime(evtMap[k]); });

  const grid = document.createElement('div');
  grid.className = 'cal-year-grid';

  for (let m = 0; m < 12; m++) {
    const card = document.createElement('div');
    card.className = 'cal-year-month';

    const title = document.createElement('div');
    title.className = 'cal-year-month-title';
    title.textContent = MONTHS[m];
    card.appendChild(title);

    const dowRow = document.createElement('div');
    dowRow.className = 'cal-year-dow-row';
    const ws = weekStartDay();
    for (let i = 0; i < 7; i++) {
      const dayIdx = (ws + i) % 7;
      const s = document.createElement('span');
      s.textContent = DOW_SINGLE[dayIdx];
      if (dayIdx === 0 || dayIdx === 6) s.classList.add('weekend');
      dowRow.appendChild(s);
    }
    card.appendChild(dowRow);

    const dayGrid = document.createElement('div');
    dayGrid.className = 'cal-year-day-grid';

    const dim      = new Date(_year, m + 1, 0).getDate();
    const startDow = (new Date(_year, m, 1).getDay() - ws + 7) % 7;

    for (let i = 0; i < startDow; i++) {
      const blank = document.createElement('div');
      blank.className = 'cal-year-cell blank';
      dayGrid.appendChild(blank);
    }

    for (let d = 1; d <= dim; d++) {

      const key       = dateStr(_year, m, d);
      const dayEvts   = evtMap[key] ?? [];
      const isToday   = key === todayKey;
      const dayOfWeek = new Date(_year, m, d).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      const cell = document.createElement('div');
      cell.className = 'cal-year-cell'
        + (isToday   ? ' today'   : '')
        + (isWeekend ? ' weekend' : '');

      const num = document.createElement('span');
      num.className = 'cal-year-cell-num';
      num.textContent = d;
      cell.appendChild(num);

      if (dayEvts.length > 0) {
        num.classList.add('has-evt');
        num.style.setProperty('--evt-color', catColor(dayEvts[0].category ?? 'personal'));
      }

      cell.addEventListener('click', e => {
        e.stopPropagation();
        _view = 'month';
        render();
        requestAnimationFrame(() => scrollToMonth(m));
      });
      dayGrid.appendChild(cell);
    }

    // Pad to always 42 cells (6 rows) so all cards are the same height
    const filled = startDow + dim;
    for (let i = filled; i < 42; i++) {
      const blank = document.createElement('div');
      blank.className = 'cal-year-cell blank';
      dayGrid.appendChild(blank);
    }

    card.appendChild(dayGrid);

    // Events preview
    const monthPrefix = `${_year}-${String(m + 1).padStart(2, '0')}`;
    const monthEvts   = events()
      .filter(e => e.date?.startsWith(monthPrefix))
      .sort((a, b) => (a.date > b.date ? 1 : -1));

    const evtSec  = document.createElement('div');
    evtSec.className = 'cal-year-events';

    monthEvts.slice(0, 3).forEach(evt => {
      const row = document.createElement('div');
      row.className = 'cal-year-evt-row';
      const dot = document.createElement('span');
      dot.className = 'cal-year-evt-row-dot';
      dot.style.background = catColor(evt.category ?? 'personal');
      const lbl = document.createElement('span');
      lbl.className = 'cal-year-evt-row-title';
      lbl.textContent = evt.title;
      row.append(dot, lbl);
      evtSec.appendChild(row);
    });

    const extra = monthEvts.length - 3;
    if (extra > 0) {
      const more = document.createElement('div');
      more.className = 'cal-year-evt-more';
      more.textContent = `+${extra} more`;
      evtSec.appendChild(more);
    }

    card.appendChild(evtSec);
    card.addEventListener('click', () => {
      _view = 'month';
      render();
      requestAnimationFrame(() => scrollToMonth(m));
    });
    grid.appendChild(card);
  }

  scroll.appendChild(grid);
}

// ── Modal ──────────────────────────────────────────────────────────

// ── Event view card (read mode) ────────────────────────────────────
function openEventView(date, evtId) {
  closeModal();
  const evt = sortByTime(events().filter(e => e.date === date)).find(e => e.id === evtId)
           ?? events().find(e => e.id === evtId); // parked events have no date
  if (!evt) { openModal(date); return; }

  const viewDate = evt.date ?? date;

  _modal = document.createElement('div');
  _modal.className = 'cal-modal';
  _modal.addEventListener('click', e => { if (e.target === _modal) closeModal(); });

  const card = document.createElement('div');
  card.className = 'cal-modal-card cal-ev-view-card';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'cal-modal-hdr';
  const backBtn = document.createElement('button');
  backBtn.className = 'cal-modal-back-btn';
  backBtn.innerHTML = '<span class="material-symbols-outlined">arrow_back</span>';
  backBtn.addEventListener('click', () => openModal(date));
  const closeBtn = document.createElement('button');
  closeBtn.className = 'cal-modal-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeModal);
  hdr.append(backBtn, closeBtn);
  card.appendChild(hdr);

  // Body
  const body = document.createElement('div');
  body.className = 'cal-ev-view-body';

  // Title
  const titleEl = document.createElement('div');
  titleEl.className = 'cal-ev-view-title';
  titleEl.textContent = evt.title;
  body.appendChild(titleEl);

  // Meta: time + category
  const metaEl = document.createElement('div');
  metaEl.className = 'cal-ev-view-meta';
  if (evt.time) {
    const timeEl = document.createElement('span');
    timeEl.className = 'cal-ev-view-time';
    timeEl.textContent = evt.endTime ? `${evt.time}–${evt.endTime}` : evt.time;
    metaEl.appendChild(timeEl);
  }
  const catEl = document.createElement('span');
  catEl.className = 'cal-ev-view-cat';
  catEl.textContent = evt.category ?? 'personal';
  catEl.style.color = catColor(evt.category ?? 'personal');
  metaEl.appendChild(catEl);
  body.appendChild(metaEl);

  // Location
  if (evt.location) {
    const locLink = document.createElement('a');
    locLink.className = 'cal-ev-view-location';
    locLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(evt.location)}`;
    locLink.target = '_blank';
    locLink.rel = 'noopener noreferrer';
    locLink.innerHTML = `<span class="material-symbols-outlined">location_on</span><span>${evt.location}</span>`;
    body.appendChild(locLink);
  }

  // Link button
  if (evt.link) {
    const linkBtn = document.createElement('a');
    linkBtn.className = 'cal-ev-view-link-btn';
    linkBtn.href = evt.link;
    linkBtn.target = '_blank';
    linkBtn.rel = 'noopener noreferrer';
    try {
      linkBtn.textContent = new URL(evt.link).hostname.replace(/^www\./, '');
    } catch {
      linkBtn.textContent = 'Open link';
    }
    linkBtn.innerHTML = `<span class="material-symbols-outlined">open_in_new</span>` + linkBtn.textContent;
    body.appendChild(linkBtn);
  }

  // Notes (editable inline)
  const notesWrap = document.createElement('div');
  notesWrap.className = 'cal-ev-view-notes-wrap';
  const notesLbl = document.createElement('div');
  notesLbl.className = 'cal-ev-view-notes-lbl';
  notesLbl.textContent = 'Notes';
  const notesTA = document.createElement('textarea');
  notesTA.className = 'cal-ev-view-notes';
  notesTA.placeholder = 'Add notes…';
  notesTA.value = evt.notes ?? '';
  notesTA.rows = 4;
  notesTA.addEventListener('click', e => e.stopPropagation());
  notesTA.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); notesTA.blur(); } });
  const saveNotesBtn = document.createElement('button');
  saveNotesBtn.className = 'cal-ev-view-notes-save';
  saveNotesBtn.textContent = 'Save notes';
  saveNotesBtn.style.display = 'none';
  notesTA.addEventListener('input', () => { saveNotesBtn.style.display = 'block'; });
  saveNotesBtn.addEventListener('click', () => {
    saveEvent({ ...evt, notes: notesTA.value.trim() || null });
    openEventView(viewDate, evtId);
  });
  notesWrap.append(notesLbl, notesTA, saveNotesBtn);
  body.appendChild(notesWrap);

  card.appendChild(body);

  // Footer actions
  const footer = document.createElement('div');
  footer.className = 'cal-ev-view-footer';
  const editBtn = document.createElement('button');
  editBtn.className = 'cal-ev-view-edit-btn';
  editBtn.innerHTML = '<span class="material-symbols-outlined">edit</span>Edit';
  editBtn.addEventListener('click', () => openEditForm(viewDate, evtId));
  const dupBtn = document.createElement('button');
  dupBtn.className = 'cal-ev-view-edit-btn';
  dupBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span>Duplicate';
  dupBtn.addEventListener('click', () => {
    const copy = { ...evt, id: uid(), createdAt: undefined };
    saveEvent(copy);
    openEventView(viewDate, copy.id);   // open the new copy so it's obvious it worked
  });
  const delBtn = document.createElement('button');
  delBtn.className = 'cal-ev-view-del-btn';
  delBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>Delete';
  delBtn.addEventListener('click', () => { removeEvent(evtId); openModal(date); });
  footer.append(editBtn, dupBtn, delBtn);
  card.appendChild(footer);

  _modal.appendChild(card);
  _container.appendChild(_modal);
}

// ── Day modal (add new event) ───────────────────────────────────────
function openModal(date, _editId = null) {
  // backward compat: if called with an event id, show view instead
  if (_editId) { openEventView(date, _editId); return; }
  closeModal();

  const dayEvts = sortByTime(events().filter(e => e.date === date));

  const [y, mo, d] = date.split('-').map(Number);
  const dayLabel = new Date(y, mo - 1, d).toLocaleDateString('en', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  _modal = document.createElement('div');
  _modal.className = 'cal-modal';

  const card = document.createElement('div');
  card.className = 'cal-modal-card';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'cal-modal-hdr';
  const dateSpan = document.createElement('span');
  dateSpan.className = 'cal-modal-date';
  dateSpan.textContent = dayLabel;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'cal-modal-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeModal);
  hdr.append(dateSpan, closeBtn);
  card.appendChild(hdr);

  // Event list (click row → view, ✕ → delete)
  if (dayEvts.length > 0) {
    const list = document.createElement('div');
    list.className = 'cal-modal-list';
    dayEvts.forEach(evt => {
      const row = document.createElement('div');
      row.className = 'cal-modal-row';
      row.style.cursor = 'pointer';
      const dot = document.createElement('span');
      dot.className = 'cal-modal-dot';
      dot.style.background = catColor(evt.category ?? 'personal');
      const titleWrap = document.createElement('span');
      titleWrap.className = 'cal-modal-evt-title';
      if (evt.time) {
        const timeSpan = document.createElement('span');
        timeSpan.className = 'cal-modal-evt-time';
        timeSpan.textContent = evt.endTime ? evt.time + '–' + evt.endTime : evt.time;
        titleWrap.appendChild(timeSpan);
      }
      titleWrap.appendChild(document.createTextNode(evt.title));
      const cat = document.createElement('span');
      cat.className = 'cal-modal-cat';
      cat.textContent = evt.category ?? '';
      const delBtn = document.createElement('button');
      delBtn.className = 'cal-modal-del-row';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', e => { e.stopPropagation(); removeEvent(evt.id); openModal(date); });
      row.append(dot, titleWrap, cat, delBtn);
      row.addEventListener('click', () => openEventView(date, evt.id));
      list.appendChild(row);
    });
    card.appendChild(list);
  }

  // Create form
  const formArea = document.createElement('div');
  card.appendChild(formArea);
  _modal.appendChild(card);
  _container.appendChild(_modal);
  _modal.addEventListener('click', e => { if (e.target === _modal) closeModal(); });

  _renderEventForm(formArea, date, null, () => openModal(date));
}

// ── Edit form modal ─────────────────────────────────────────────────
function openEditForm(date, evtId) {
  closeModal();
  const editing = events().find(e => e.id === evtId);
  if (!editing) { openModal(date); return; }

  _modal = document.createElement('div');
  _modal.className = 'cal-modal';
  _modal.addEventListener('click', e => { if (e.target === _modal) closeModal(); });

  const card = document.createElement('div');
  card.className = 'cal-modal-card';

  const hdr = document.createElement('div');
  hdr.className = 'cal-modal-hdr';
  const backBtn = document.createElement('button');
  backBtn.className = 'cal-modal-back-btn';
  backBtn.innerHTML = '<span class="material-symbols-outlined">arrow_back</span>';
  backBtn.addEventListener('click', () => openEventView(date, evtId));
  const closeBtn = document.createElement('button');
  closeBtn.className = 'cal-modal-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeModal);
  hdr.append(backBtn, closeBtn);
  card.appendChild(hdr);

  const formArea = document.createElement('div');
  card.appendChild(formArea);
  _modal.appendChild(card);
  _container.appendChild(_modal);

  _renderEventForm(formArea, date, editing, (savedId) => openEventView(date, savedId ?? evtId));
}

// ── Shared event form renderer ──────────────────────────────────────
function _renderEventForm(formArea, date, editing, onDone) {
  const form = document.createElement('div');
  form.className = 'cal-modal-form';

  const input = document.createElement('input');
  input.className = 'cal-modal-input';
  input.type = 'text';
  input.placeholder = editing ? 'Event title' : 'New event title';
  input.value = editing?.title ?? '';
  input.autocomplete = 'off';
  form.appendChild(input);

  let rescheduleDate = date;
  if (editing) {
    const dateRow = document.createElement('div');
    dateRow.className = 'cal-modal-date-row';
    const dateLbl = document.createElement('span');
    dateLbl.className = 'cal-form-label';
    dateLbl.textContent = 'Date';
    const dateInp = document.createElement('input');
    dateInp.type = 'date';
    dateInp.className = 'cal-modal-date-input';
    dateInp.value = editing.date ?? date;
    dateInp.addEventListener('change', () => { rescheduleDate = dateInp.value || date; });
    dateRow.append(dateLbl, dateInp);
    form.appendChild(dateRow);
  }

  const timeRow = document.createElement('div');
  timeRow.className = 'cal-modal-time-row';
  const timeStart = document.createElement('input');
  timeStart.type = 'time'; timeStart.className = 'cal-modal-time-input';
  timeStart.value = editing?.time ?? '';
  const timeSep = document.createElement('span');
  timeSep.className = 'cal-modal-time-sep'; timeSep.textContent = '–';
  const timeEnd = document.createElement('input');
  timeEnd.type = 'time'; timeEnd.className = 'cal-modal-time-input';
  timeEnd.value = editing?.endTime ?? '';
  timeRow.append(timeStart, timeSep, timeEnd);
  form.appendChild(timeRow);

  const linkInput = document.createElement('input');
  linkInput.className = 'cal-modal-input cal-modal-link-input';
  linkInput.type = 'url';
  linkInput.placeholder = 'Meeting link (optional)';
  linkInput.value = editing?.link ?? '';
  linkInput.autocomplete = 'off';
  form.appendChild(linkInput);

  const locationInput = document.createElement('input');
  locationInput.className = 'cal-modal-input cal-modal-link-input';
  locationInput.type = 'text';
  locationInput.placeholder = 'Location (optional)';
  locationInput.value = editing?.location ?? '';
  locationInput.autocomplete = 'off';
  form.appendChild(locationInput);

  const notesInput = document.createElement('textarea');
  notesInput.className = 'cal-modal-input cal-modal-notes-input';
  notesInput.placeholder = 'Notes (optional)';
  notesInput.value = editing?.notes ?? '';
  notesInput.rows = 3;
  notesInput.addEventListener('click', e => e.stopPropagation());
  notesInput.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  form.appendChild(notesInput);

  let selectedCat = editing?.category ?? 'personal';
  const catGrid = document.createElement('div');
  catGrid.className = 'cal-cat-grid';
  cats().forEach(c => {
    const bg   = catBg(c.id);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `cal-cat-chip${bg ? '' : ` evt-${c.id}`}${selectedCat === c.id ? ' selected' : ''}`;
    chip.dataset.cat = c.id;
    chip.textContent = c.name;
    if (bg) {
      chip.style.background = bg;
      chip.style.color = catColor(c.id);
      if (selectedCat === c.id) chip.style.borderColor = catColor(c.id);
    }
    chip.addEventListener('click', () => {
      selectedCat = c.id;
      catGrid.querySelectorAll('.cal-cat-chip').forEach(b => {
        const isSelected = b.dataset.cat === c.id;
        b.classList.toggle('selected', isSelected);
        const bcat = cats().find(x => x.id === b.dataset.cat);
        if (bcat?.isCustom && bcat.color) b.style.borderColor = isSelected ? bcat.color : '';
      });
    });
    catGrid.appendChild(chip);
  });
  form.appendChild(catGrid);

  const actions = document.createElement('div');
  actions.className = 'cal-modal-actions';

  if (editing) {
    const parkBtn = document.createElement('button');
    parkBtn.className = 'cal-park-btn';
    parkBtn.textContent = 'Park for later';
    parkBtn.addEventListener('click', () => {
      saveEvent({ ...editing, date: null, time: timeStart.value || null, endTime: timeEnd.value || null, link: linkInput.value.trim() || null, location: locationInput.value.trim() || null, notes: notesInput.value.trim() || null });
      closeModal();
    });
    const dupBtn = document.createElement('button');
    dupBtn.className = 'cal-park-btn';
    dupBtn.textContent = 'Duplicate';
    dupBtn.addEventListener('click', () => {
      saveEvent({ ...editing, id: uid(), createdAt: undefined });
      openModal(rescheduleDate);
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'cal-del-btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => { removeEvent(editing.id); openModal(date); });
    actions.append(parkBtn, dupBtn, delBtn);
  }

  const saveBtn = document.createElement('button');
  saveBtn.className = 'cal-save-btn';
  saveBtn.textContent = editing ? 'Save' : 'Add';
  saveBtn.addEventListener('click', () => {
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    const newId = editing?.id ?? uid();
    saveEvent({
      id: newId, date: rescheduleDate, title, category: selectedCat,
      time:     timeStart.value || null,
      endTime:  timeEnd.value   || null,
      link:     linkInput.value.trim()     || null,
      location: locationInput.value.trim() || null,
      notes:    notesInput.value.trim()    || null,
    });
    onDone(newId);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); saveBtn.click(); }
    if (e.key === 'Escape') closeModal();
  });
  actions.appendChild(saveBtn);
  form.appendChild(actions);
  formArea.appendChild(form);
  requestAnimationFrame(() => input.focus());
}

function closeModal() {
  _modal?.remove();
  _modal = null;
}

// ── Timeline ───────────────────────────────────────────────────────

function timelineEvents() {
  return _data.calendar?.timelineEvents ?? [];
}

function saveTimelineEvent(evt) {
  const evts = [...timelineEvents()];
  const idx  = evts.findIndex(e => e.id === evt.id);
  const now  = new Date().toISOString();
  if (idx >= 0) {
    evts[idx] = { ...evt, createdAt: evts[idx].createdAt ?? now, updatedAt: now };
  } else {
    evts.push({ ...evt, createdAt: now });
  }
  _onSave({ calendar: { ...calData(), timelineEvents: evts } });
}

function removeTimelineEvent(id) {
  _onSave({ calendar: { ...calData(), timelineEvents: timelineEvents().filter(e => e.id !== id) } });
}

function tlUid() { return 'tl_' + Math.random().toString(36).slice(2, 9); }

function buildTimeline(scroll) {
  scroll.innerHTML = '';
  scroll.className = 'cal-scroll tl-scroll';

  const birthYear = _data.settings?.birthYear ?? new Date().getFullYear() - 25;
  const lastYear  = birthYear + 100;
  const todayYear = new Date().getFullYear();
  const tlEvts    = timelineEvents();

  // Timeline lane order: life (personal) → health → finance → education → work → rest
  const TL_ORDER = ['personal', 'health', 'finance', 'education', 'work'];
  const fallbackOrder = cats().map(c => c.id);
  function catSortKey(id) {
    const cat = id ?? 'personal';
    const i = TL_ORDER.indexOf(cat);
    if (i !== -1) return i;
    const j = fallbackOrder.indexOf(cat);
    return TL_ORDER.length + (j === -1 ? fallbackOrder.length : j);
  }

  for (let rowStart = birthYear; rowStart <= lastYear; rowStart += 10) {
    const decade = rowStart; // kept as alias so rest of code is unchanged
    const decadeEl = document.createElement('div');
    decadeEl.className = 'tl-decade';
    decadeEl.dataset.decade = rowStart;

    const yearRow = document.createElement('div');
    yearRow.className = 'tl-year-row';

    for (let y = decade; y < decade + 10; y++) {
      const cell = document.createElement('div');
      cell.className = 'tl-year-cell';
      if (y === todayYear) cell.classList.add('tl-year-today');
      if (y > lastYear) cell.classList.add('tl-year-out');

      const yNum = document.createElement('span');
      yNum.className = 'tl-year-num';
      yNum.textContent = y;
      cell.appendChild(yNum);

      const age = y - birthYear;
      if (age >= 0) {
        const ageEl = document.createElement('span');
        ageEl.className = 'tl-year-age';
        ageEl.textContent = age;
        cell.appendChild(ageEl);
      }

      cell.addEventListener('click', () => openTimelineModal(y));
      yearRow.appendChild(cell);
    }
    decadeEl.appendChild(yearRow);

    const overlap = tlEvts.filter(e => e.yearStart <= decade + 9 && e.yearEnd >= decade);
    if (overlap.length > 0) {
      const evtArea = document.createElement('div');
      evtArea.className = 'tl-evt-area';

      // Lane per category; overlapping events within same category get sub-lanes
      const presentCats = [...new Set(overlap.map(e => e.categoryId ?? 'personal'))]
        .sort((a, b) => catSortKey(a) - catSortKey(b));

      const evtLaneMap = new Map();
      let totalLanes = 0;
      presentCats.forEach(cat => {
        const catEvts = overlap
          .filter(e => (e.categoryId ?? 'personal') === cat)
          .sort((a, b) => {
            if (a.yearStart !== b.yearStart) return a.yearStart - b.yearStart;
            return (a.yearEnd - a.yearStart) - (b.yearEnd - b.yearStart);
          });
        catEvts.forEach((evt, si) => {
          evtLaneMap.set(evt.id, totalLanes + si);
        });
        totalLanes += catEvts.length;
      });

      evtArea.style.height = `${totalLanes * 26}px`;

      overlap.forEach(evt => {
        const cat      = evt.categoryId ?? 'personal';
        const li       = evtLaneMap.get(evt.id);
        const segStart = Math.max(evt.yearStart, decade);
        const segEnd   = Math.min(evt.yearEnd,   decade + 9);
        const leftPct  = ((segStart - decade) / 10) * 100;
        const widthPct = ((segEnd - segStart + 1) / 10) * 100;

        const bar = document.createElement('div');
        bar.className = 'tl-evt-bar';
        const color = catColor(cat);
        bar.style.cssText = `left:${leftPct}%;width:${widthPct}%;top:${li * 26}px;background:${color};`;
        bar.title = `${evt.title} (${evt.yearStart}${evt.yearEnd !== evt.yearStart ? '–' + evt.yearEnd : ''})`;

        const label = document.createElement('span');
        label.textContent = evt.title;
        bar.appendChild(label);

        // Drag to shift years
        let didDrag = false;
        let startX = 0, startYearStart = 0, startYearEnd = 0;

        bar.addEventListener('pointerdown', e => {
          if (e.button !== 0) return;
          didDrag = false;
          startX = e.clientX;
          startYearStart = evt.yearStart;
          startYearEnd   = evt.yearEnd;
          bar.setPointerCapture(e.pointerId);
          bar.style.cursor = 'grabbing';
          bar.style.opacity = '0.75';
          e.stopPropagation();
        });

        bar.addEventListener('pointermove', e => {
          if (!bar.hasPointerCapture(e.pointerId)) return;
          const pxPerYear = evtArea.getBoundingClientRect().width / 10;
          const delta = Math.round((e.clientX - startX) / pxPerYear);
          if (delta !== 0) didDrag = true;
          const newStart = startYearStart + delta;
          const newEnd   = startYearEnd   + delta;
          const segS = Math.max(newStart, decade);
          const segE = Math.min(newEnd,   decade + 9);
          bar.style.left  = `${((segS - decade) / 10) * 100}%`;
          bar.style.width = `${((segE - segS + 1) / 10) * 100}%`;
        });

        bar.addEventListener('pointerup', e => {
          if (!bar.hasPointerCapture(e.pointerId)) return;
          bar.releasePointerCapture(e.pointerId);
          bar.style.cursor = '';
          bar.style.opacity = '';
          const pxPerYear = evtArea.getBoundingClientRect().width / 10;
          const delta = Math.round((e.clientX - startX) / pxPerYear);
          if (delta !== 0) {
            saveTimelineEvent({ ...evt, yearStart: startYearStart + delta, yearEnd: startYearEnd + delta });
          }
        });

        bar.addEventListener('click', e => {
          if (didDrag) { didDrag = false; return; }
          e.stopPropagation();
          openTimelineModal(evt.yearStart, evt.id);
        });

        evtArea.appendChild(bar);
      });

      decadeEl.appendChild(evtArea);
    }

    scroll.appendChild(decadeEl);
  }
}

function scrollToTimelineYear(year) {
  const scroll = _container.querySelector('#cal-scroll');
  if (!scroll) return;
  const birthYear = _data.settings?.birthYear ?? new Date().getFullYear() - 25;
  const rowStart = birthYear + Math.floor((year - birthYear) / 10) * 10;
  const el = scroll.querySelector(`[data-decade="${rowStart}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openTimelineModal(defaultYear, editId = null) {
  closeTimelineModal();

  const editing = editId ? timelineEvents().find(e => e.id === editId) : null;

  _tlModal = document.createElement('div');
  _tlModal.className = 'cal-modal';

  const card = document.createElement('div');
  card.className = 'cal-modal-card';

  const hdr = document.createElement('div');
  hdr.className = 'cal-modal-hdr';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'cal-modal-date';
  titleSpan.textContent = editing ? 'Edit life event' : 'New life event';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'cal-modal-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeTimelineModal);
  hdr.append(titleSpan, closeBtn);
  card.appendChild(hdr);

  const form = document.createElement('div');
  form.className = 'cal-modal-form';

  const titleInput = document.createElement('input');
  titleInput.className = 'cal-modal-input';
  titleInput.type = 'text';
  titleInput.placeholder = 'Event title';
  titleInput.value = editing?.title ?? '';
  titleInput.autocomplete = 'off';
  form.appendChild(titleInput);

  const yearRow = document.createElement('div');
  yearRow.className = 'tl-modal-year-row';

  const yearStartInput = document.createElement('input');
  yearStartInput.className = 'cal-modal-input tl-modal-year-input';
  yearStartInput.type = 'number';
  yearStartInput.placeholder = 'Start year';
  yearStartInput.value = editing?.yearStart ?? defaultYear;
  yearStartInput.min = 1900; yearStartInput.max = 2200;

  const yearSep = document.createElement('span');
  yearSep.className = 'cal-modal-time-sep';
  yearSep.textContent = 'to';

  const yearEndInput = document.createElement('input');
  yearEndInput.className = 'cal-modal-input tl-modal-year-input';
  yearEndInput.type = 'number';
  yearEndInput.placeholder = 'End year';
  yearEndInput.value = editing?.yearEnd ?? defaultYear;
  yearEndInput.min = 1900; yearEndInput.max = 2200;

  yearRow.append(yearStartInput, yearSep, yearEndInput);
  form.appendChild(yearRow);

  const noteInput = document.createElement('textarea');
  noteInput.className = 'cal-modal-input cal-modal-notes-input';
  noteInput.placeholder = 'Note (optional)';
  noteInput.value = editing?.note ?? '';
  noteInput.rows = 2;
  noteInput.addEventListener('click', e => e.stopPropagation());
  noteInput.addEventListener('keydown', e => { if (e.key === 'Escape') closeTimelineModal(); });
  form.appendChild(noteInput);

  let selectedCat = editing?.categoryId ?? 'personal';
  const catGrid = document.createElement('div');
  catGrid.className = 'cal-cat-grid';
  cats().forEach(c => {
    const bg   = catBg(c.id);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `cal-cat-chip${bg ? '' : ` evt-${c.id}`}${selectedCat === c.id ? ' selected' : ''}`;
    chip.dataset.cat = c.id;
    chip.textContent = c.name;
    if (bg) {
      chip.style.background = bg;
      chip.style.color = catColor(c.id);
      if (selectedCat === c.id) chip.style.borderColor = catColor(c.id);
    }
    chip.addEventListener('click', () => {
      selectedCat = c.id;
      catGrid.querySelectorAll('.cal-cat-chip').forEach(b => {
        const isSelected = b.dataset.cat === c.id;
        b.classList.toggle('selected', isSelected);
        const bcat = cats().find(x => x.id === b.dataset.cat);
        if (bcat?.isCustom && bcat.color) b.style.borderColor = isSelected ? bcat.color : '';
      });
    });
    catGrid.appendChild(chip);
  });
  form.appendChild(catGrid);

  const actions = document.createElement('div');
  actions.className = 'cal-modal-actions';

  if (editing) {
    const delBtn = document.createElement('button');
    delBtn.className = 'cal-del-btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      removeTimelineEvent(editing.id);
      closeTimelineModal();
      renderGrid();
    });
    actions.appendChild(delBtn);
  }

  const saveBtn = document.createElement('button');
  saveBtn.className = 'cal-save-btn';
  saveBtn.textContent = editing ? 'Save' : 'Add';
  saveBtn.addEventListener('click', () => {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    const yStart = parseInt(yearStartInput.value, 10);
    const yEnd   = parseInt(yearEndInput.value,   10);
    if (!yStart || !yEnd) return;
    saveTimelineEvent({
      id:         editing?.id ?? tlUid(),
      title,
      yearStart:  Math.min(yStart, yEnd),
      yearEnd:    Math.max(yStart, yEnd),
      categoryId: selectedCat,
      note:       noteInput.value.trim() || null,
    });
    closeTimelineModal();
    renderGrid();
  });

  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); saveBtn.click(); }
    if (e.key === 'Escape') closeTimelineModal();
  });

  actions.appendChild(saveBtn);
  form.appendChild(actions);
  card.appendChild(form);
  _tlModal.appendChild(card);
  _container.appendChild(_tlModal);
  _tlModal.addEventListener('click', e => { if (e.target === _tlModal) closeTimelineModal(); });
  requestAnimationFrame(() => titleInput.focus());
}

function closeTimelineModal() {
  _tlModal?.remove();
  _tlModal = null;
}

// ── Search ─────────────────────────────────────────────────────────

function openSearch() {
  _searchPanel = document.createElement('div');
  _searchPanel.className = 'cal-search-panel';

  const inp = document.createElement('input');
  inp.className = 'cal-search-input';
  inp.type = 'text';
  inp.placeholder = 'Search events and spending...';
  inp.autocomplete = 'off';
  _searchPanel.appendChild(inp);

  const results = document.createElement('div');
  results.className = 'cal-search-results';
  _searchPanel.appendChild(results);

  inp.addEventListener('input', () => _renderSearchResults(results, inp.value));
  inp.addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });
  document.addEventListener('keydown', _searchEscHandler);

  _container.appendChild(_searchPanel);
  requestAnimationFrame(() => inp.focus());
}

function _searchEscHandler(e) {
  if (e.key === 'Escape') closeSearch();
}

function closeSearch() {
  _searchPanel?.remove();
  _searchPanel = null;
  document.removeEventListener('keydown', _searchEscHandler);
}

function _renderSearchResults(container, query) {
  container.innerHTML = '';
  if (!query.trim()) return;

  const q = query.trim().toLowerCase();

  // ── Events ────────────────────────────────────────────────────
  const matchedEvts = events()
    .filter(e => e.date && e.title?.toLowerCase().includes(q))
    .sort((a, b) => a.date > b.date ? 1 : -1)
    .slice(0, 20);

  // ── Spend entries ─────────────────────────────────────────────
  const spendEntries = calData().spendEntries ?? {};
  const cats = spendCats();
  const catMap = Object.fromEntries(cats.map(c => [c.id, c]));
  const matchedSpend = [];
  for (const [date, list] of Object.entries(spendEntries)) {
    for (const e of (list ?? [])) {
      const cat    = catMap[e.categoryId];
      const amtStr = (e.amount ?? 0).toString();
      const text   = (e.note || e.subcategory || '').toLowerCase();
      const catName = (cat?.name ?? '').toLowerCase();
      if (amtStr.includes(q) || text.includes(q) || catName.includes(q)) {
        matchedSpend.push({ date, cat, ...e });
      }
    }
  }
  matchedSpend.sort((a, b) => b.date.localeCompare(a.date));

  if (!matchedEvts.length && !matchedSpend.length) {
    const empty = document.createElement('div');
    empty.className = 'cal-search-empty';
    empty.textContent = 'No results found';
    container.appendChild(empty);
    return;
  }

  function fmtDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (matchedEvts.length) {
    if (matchedSpend.length) {
      const lbl = document.createElement('div');
      lbl.className = 'cal-search-section-lbl';
      lbl.textContent = 'Events';
      container.appendChild(lbl);
    }
    matchedEvts.forEach(evt => {
      const row = document.createElement('div');
      row.className = 'cal-search-row';
      const dot = document.createElement('span');
      dot.className = 'cal-search-dot';
      dot.style.background = catColor(evt.category ?? 'personal');
      const title = document.createElement('span');
      title.className = 'cal-search-title';
      title.textContent = evt.title;
      const dateEl = document.createElement('span');
      dateEl.className = 'cal-search-date';
      dateEl.textContent = fmtDate(evt.date);
      row.append(dot, title, dateEl);
      row.addEventListener('click', () => { closeSearch(); _navigateToEvent(evt); });
      container.appendChild(row);
    });
  }

  if (matchedSpend.length) {
    if (matchedEvts.length) {
      const lbl = document.createElement('div');
      lbl.className = 'cal-search-section-lbl';
      lbl.textContent = 'Spending';
      container.appendChild(lbl);
    }
    matchedSpend.slice(0, 20).forEach(entry => {
      const row = document.createElement('div');
      row.className = 'cal-search-row';
      const dot = document.createElement('span');
      dot.className = 'cal-search-dot';
      dot.style.background = entry.cat?.color ?? 'var(--text-3)';
      const title = document.createElement('span');
      title.className = 'cal-search-title';
      title.textContent = entry.note || entry.subcategory || entry.cat?.name || entry.categoryId;
      const right = document.createElement('span');
      right.className = 'cal-search-spend-right';
      const amt = document.createElement('span');
      amt.className = 'cal-search-spend-amt';
      amt.textContent = `¥${(entry.amount ?? 0).toLocaleString()}`;
      const dateEl = document.createElement('span');
      dateEl.className = 'cal-search-date';
      dateEl.textContent = fmtDate(entry.date);
      right.append(amt, dateEl);
      row.append(dot, title, right);
      row.addEventListener('click', () => {
        closeSearch();
        _navigateToEvent({ date: entry.date });
      });
      container.appendChild(row);
    });
  }
}

function _navigateToEvent(evt) {
  const [y, m, d] = evt.date.split('-').map(Number);

  function highlight() {
    setTimeout(() => {
      const chip = _container.querySelector(`[data-id="${evt.id}"]`);
      if (chip) {
        chip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        chip.classList.add('cal-evt-highlight');
        setTimeout(() => chip.classList.remove('cal-evt-highlight'), 2000);
      }
    }, 320);
  }

  if (_view === 'week') {
    _weekStart = getWeekStart(new Date(y, m - 1, d));
    render();
    requestAnimationFrame(highlight);
  } else {
    _year = y;
    _view = 'month';
    render();
    requestAnimationFrame(() => { scrollToMonth(m - 1); highlight(); });
  }
}

// ── Spend entry modal ───────────────────────────────────────────────

function openSpendModal(dateStr, entryId, preselectCatId) {
  _spendModal?.remove();

  const daySpend = (calData().spendEntries ?? {})[dateStr] ?? [];
  const editing  = entryId ? daySpend.find(e => e.id === entryId) : null;

  _spendModal = document.createElement('div');
  _spendModal.className = 'cal-modal';

  const card = document.createElement('div');
  card.className = 'cal-modal-card';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'cal-modal-hdr';
  const title = document.createElement('div');
  title.className = 'cal-modal-title';
  title.textContent = editing ? 'Edit spend' : 'Add spend';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'cal-modal-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', closeSpendModal);
  hdr.append(title, closeBtn);
  card.appendChild(hdr);

  const form = document.createElement('div');
  form.className = 'cal-modal-form';

  // Category picker
  const catLbl = document.createElement('div');
  catLbl.className = 'cal-form-label';
  catLbl.textContent = 'Category';
  form.appendChild(catLbl);

  const catGrid = document.createElement('div');
  catGrid.className = 'cal-spend-cat-grid';

  let selectedCat  = editing?.categoryId ?? preselectCatId ?? null;
  let selectedSub  = editing?.subcategory ?? null;
  let selectedNote = editing?.note ?? '';

  const subRow = document.createElement('div');
  subRow.className = 'cal-spend-sub-row';

  function renderSubcategories() {
    subRow.innerHTML = '';
    const cat = spendCatById(selectedCat);
    if (!cat || !cat.sub?.length) return;
    const subLbl = document.createElement('div');
    subLbl.className = 'cal-form-label';
    subLbl.style.marginTop = 'var(--s3)';
    subLbl.textContent = 'Subcategory';
    subRow.appendChild(subLbl);
    const subGrid = document.createElement('div');
    subGrid.className = 'cal-spend-cat-grid';
    cat.sub.forEach(s => {
      const chip = document.createElement('button');
      chip.className = 'cal-spend-sub-chip' + (selectedSub === s ? ' active' : '');
      chip.textContent = s;
      chip.style.setProperty('--chip-color', cat.color);
      chip.addEventListener('click', () => {
        selectedSub = selectedSub === s ? null : s;
        subGrid.querySelectorAll('.cal-spend-sub-chip').forEach(b => b.classList.remove('active'));
        if (selectedSub === s) chip.classList.add('active');
      });
      subGrid.appendChild(chip);
    });
    subRow.appendChild(subGrid);
  }

  spendCats().forEach(cat => {
    const chip = document.createElement('button');
    chip.className = 'cal-spend-cat-chip' + (selectedCat === cat.id ? ' active' : '');
    chip.style.setProperty('--chip-color', cat.color);
    const dot = document.createElement('span');
    dot.className = 'cal-spend-chip-dot';
    dot.style.background = cat.color;
    chip.append(dot, cat.name);
    chip.addEventListener('click', () => {
      selectedCat = cat.id;
      selectedSub = null;
      catGrid.querySelectorAll('.cal-spend-cat-chip').forEach(b => b.classList.remove('active'));
      chip.classList.add('active');
      renderSubcategories();
    });
    catGrid.appendChild(chip);
  });

  form.appendChild(catGrid);
  form.appendChild(subRow);
  renderSubcategories();

  // Note (free-text description)
  const noteLbl = document.createElement('div');
  noteLbl.className = 'cal-form-label';
  noteLbl.style.marginTop = 'var(--s3)';
  noteLbl.textContent = 'Note';
  const noteInput = document.createElement('input');
  noteInput.className   = 'cal-modal-note-input';
  noteInput.type        = 'text';
  noteInput.placeholder = 'e.g. sushi, shinkansen ticket…';
  noteInput.value       = selectedNote;
  noteInput.addEventListener('input', () => { selectedNote = noteInput.value; });
  form.append(noteLbl, noteInput);

  // Currency toggle (only shown when user has multiple currencies)
  let selectedCurrency = editing?.currency ?? currencies()[0];
  const curList = currencies();
  if (curList.length > 1) {
    const curLbl = document.createElement('div');
    curLbl.className = 'cal-form-label';
    curLbl.style.marginTop = 'var(--s3)';
    curLbl.textContent = 'Currency';
    const curRow = document.createElement('div');
    curRow.className = 'cal-spend-cur-row';
    curList.forEach(cur => {
      const btn = document.createElement('button');
      btn.className = 'cal-spend-cur-btn' + (cur === selectedCurrency ? ' active' : '');
      btn.textContent = cur;
      btn.addEventListener('click', () => {
        selectedCurrency = cur;
        curRow.querySelectorAll('.cal-spend-cur-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        amtSym.textContent = cur;
      });
      curRow.appendChild(btn);
    });
    form.append(curLbl, curRow);
  }

  // Amount input
  const amtLbl = document.createElement('div');
  amtLbl.className = 'cal-form-label';
  amtLbl.style.marginTop = 'var(--s3)';
  amtLbl.textContent = 'Amount';
  const amtWrap = document.createElement('div');
  amtWrap.className = 'cal-modal-spend-wrap';
  const amtSym = document.createElement('span');
  amtSym.className = 'cal-modal-spend-sym';
  amtSym.textContent = selectedCurrency;
  const amtInput = document.createElement('input');
  amtInput.className = 'cal-modal-spend-input';
  amtInput.type = 'number';
  amtInput.step = '1';
  amtInput.placeholder = '0';
  amtInput.value = editing?.amount ?? '';
  amtWrap.append(amtSym, amtInput);
  form.append(amtLbl, amtWrap);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'cal-modal-actions';

  if (editing) {
    const delBtn = document.createElement('button');
    delBtn.className = 'cal-del-btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      removeSpendEntry(dateStr, editing.id);
      closeSpendModal();
      render();
    });
    actions.appendChild(delBtn);
  }

  const saveBtn = document.createElement('button');
  saveBtn.className = 'cal-save-btn';
  saveBtn.textContent = editing ? 'Save' : 'Add';
  saveBtn.addEventListener('click', () => {
    if (!selectedCat) { catGrid.querySelector('.cal-spend-cat-chip')?.focus(); return; }
    const amount = parseFloat(amtInput.value);
    if (isNaN(amount) || amount === 0) { amtInput.focus(); return; }
    saveSpendEntry(dateStr, {
      id:          editing?.id ?? spendUid(),
      categoryId:  selectedCat,
      subcategory: selectedSub ?? null,
      note:        selectedNote.trim() || null,
      amount,
      currency:    selectedCurrency,
    });
    if (editing) {
      closeSpendModal();
      render();
    } else {
      // Keep modal open for next entry — reset amount and note only
      amtInput.value = '';
      noteInput.value = '';
      selectedNote = '';
      render(); // update the calendar behind the modal
      const flash = document.createElement('span');
      flash.className = 'cal-spend-added-flash';
      flash.textContent = 'Added';
      actions.appendChild(flash);
      requestAnimationFrame(() => {
        amtInput.focus();
        setTimeout(() => flash.remove(), 1200);
      });
    }
  });
  amtInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); saveBtn.click(); }
    if (e.key === 'Escape') closeSpendModal();
  });
  actions.appendChild(saveBtn);
  form.appendChild(actions);
  card.appendChild(form);

  _spendModal.appendChild(card);
  _container.appendChild(_spendModal);

  _spendModal.addEventListener('click', e => { if (e.target === _spendModal) closeSpendModal(); });

  requestAnimationFrame(() => amtInput.focus());
}

function closeSpendModal() {
  _spendModal?.remove();
  _spendModal = null;
}

// ── Data ───────────────────────────────────────────────────────────

function calData() { return _data.calendar ?? {}; }

function saveEvent(evt) {
  const evts = [...events()];
  const idx  = evts.findIndex(e => e.id === evt.id);
  const now  = new Date().toISOString();
  if (idx >= 0) {
    evts[idx] = { ...evt, createdAt: evts[idx].createdAt ?? now, updatedAt: now };
  } else {
    evts.push({ ...evt, createdAt: now });
  }
  _onSave({ calendar: { ...calData(), events: evts } });
}

function removeEvent(id) {
  _onSave({ calendar: { ...calData(), events: events().filter(e => e.id !== id) } });
}

function moveEvent(id, newDate) {
  const moved  = events().find(e => e.id === id);
  const others = events().filter(e => e.id !== id);
  _onSave({ calendar: { ...calData(), events: [...others, { ...moved, date: newDate }] } });
}

function saveSpendEntry(dateStr, entry) {
  const all = { ...(calData().spendEntries ?? {}) };
  const day = [...(all[dateStr] ?? [])];
  const idx = day.findIndex(e => e.id === entry.id);
  if (idx >= 0) day[idx] = entry; else day.push(entry);
  _onSave({ calendar: { ...calData(), spendEntries: { ...all, [dateStr]: day } } });
}

function removeSpendEntry(dateStr, id) {
  const all = { ...(calData().spendEntries ?? {}) };
  const day = (all[dateStr] ?? []).filter(e => e.id !== id);
  _onSave({ calendar: { ...calData(), spendEntries: { ...all, [dateStr]: day } } });
}

function spendUid() { return 'sp_' + Math.random().toString(36).slice(2, 9); }

function moveSpendEntry(id, fromDate, toDate) {
  if (fromDate === toDate) return;
  const all  = { ...(calData().spendEntries ?? {}) };
  const from = all[fromDate] ?? [];
  const entry = from.find(e => e.id === id);
  if (!entry) return;
  all[fromDate] = from.filter(e => e.id !== id);
  all[toDate]   = [...(all[toDate] ?? []), entry];
  _onSave({ calendar: { ...calData(), spendEntries: all } });
}


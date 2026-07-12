// store.js — Supabase-backed load/save, pub/sub

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { migratePeriod } from '../modules/period/period-data.js';

const SUPABASE_URL = 'https://gexqhppvqkokaxmgyonb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdleHFocHB2cWtva2F4bWd5b25iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MjMyMjEsImV4cCI6MjA5Nzk5OTIyMX0.h4mBPSPEUlRGq6JBMPtZLtUr5dYSTxTMeUr33BhcOI4';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const MODULE_KEYS = ['settings', 'period', 'finance', 'currency', 'nisa', 'savings', 'notes', 'tasks', 'gacha'];

function defaultData() {
  return {
    version: 2,
    settings: {
      timezone:   'Asia/Tokyo',
      birthYear:  null,
      currencies: ['JPY', 'IDR'],
      weekStart:  1,
      setupDone:  true,
      spendCategories: [
        { id: 'food',          name: 'Food',              color: '#e8824a', sub: ['Breakfast', 'Lunch', 'Dinner', 'Others'],                                        isCustom: false },
        { id: 'bills',         name: 'Bills',             color: '#5b8fce', sub: ['Gas', 'Water', 'Electricity', 'Internet', 'Mobile'],                            isCustom: false },
        { id: 'commute',       name: 'Commute',           color: '#4aae8f', sub: ['Work', 'Bus', 'Train', 'Airplane', 'Taxi', 'Ship', 'Car'],                      isCustom: false },
        { id: 'entertainment', name: 'Entertainment',     color: '#a06fd8', sub: ['Game', 'Movie', 'Clothes', 'Gadget'],                                           isCustom: false },
        { id: 'beauty',        name: 'Beauty',            color: '#e06b9a', sub: ['Pedicure', 'Manicure', 'Hair cut', 'Hair color', 'Eyebrow', 'Eyelash'],         isCustom: false },
        { id: 'paperwork',     name: 'Paperwork',         color: '#c9a84c', sub: ['Visa', 'Government', 'Ward office'],                                            isCustom: false },
        { id: 'medical',       name: 'Medical',           color: '#e06060', sub: ['Hospital', 'Clinic', 'Pharmacy'],                                               isCustom: false },
        { id: 'necessities',   name: 'Daily necessities', color: '#7aab7a', sub: ['Shampoo', 'Body soap', 'Conditioner', 'Toothbrush', 'Detergent', 'Dish soap'], isCustom: false },
      ],
    },
    period:   { entries: [], spotting: [], symptoms: {}, discharge: {}, bbt: {}, settings: {} },
    calendar: { events: [], spendEntries: {} },
    finance:  { months: {} },
    currency: { holdings: [], reference: 'IDR', rates: null, ratesAt: null },
    nisa:     { contributions: [] },
    savings:  { accounts: [], bonds: [], deposits: [] },
    notes:    { items: [], countdowns: [] }, // drawings stored separately in lifeOS_drawings (localStorage-only)
    tasks:    {},
    gacha:    {},
  };
}

let _data = null;
const _subs = new Set();

// ── Paginate past server row limit ────────────────────────────────────────
async function fetchAll(table, columns) {
  const rows = [];
  const size = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + size - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < size) break;
    from += size;
  }
  return rows;
}

// ── Fetch all data from Supabase ───────────────────────────────────────────
async function fetchFromSupabase() {
  const data = defaultData();

  const [modRows, evtRows, spendRows] = await Promise.all([
    fetchAll('modules', '*'),
    fetchAll('calendar_events', 'data'),
    fetchAll('spend_entries', '*'),
  ]);

  // Modules
  for (const row of modRows) {
    if (row.module === 'settings') {
      data.settings = { ...data.settings, ...row.data };
    } else {
      data[row.module] = row.data;
    }
  }

  // Calendar events
  data.calendar.events = evtRows.map(r => r.data);

  // Spend entries — rebuild the date-keyed dict
  const spendDict = {};
  for (const row of spendRows) {
    if (!spendDict[row.date]) spendDict[row.date] = [];
    spendDict[row.date].push(row.data);
  }
  data.calendar.spendEntries = spendDict;

  // First-time migration: if Supabase is empty but localStorage has data, push it up
  const isEmpty = modRows.length === 0 && evtRows.length === 0 && spendRows.length === 0;

  if (isEmpty) {
    try {
      const raw = localStorage.getItem('lifeOS_data');
      if (raw) {
        const stored = JSON.parse(raw);
        Object.assign(data, stored, { settings: { ...data.settings, ...(stored.settings ?? {}) } });
        await pushToSupabase(data);
        console.log('[store] migrated localStorage to Supabase');
      }
    } catch (e) {
      console.warn('[store] migration failed', e);
    }
  }

  return data;
}

// ── Push full data set to Supabase (migration / import) ───────────────────
async function pushToSupabase(data) {
  const moduleWrites = MODULE_KEYS
    .filter(k => data[k] !== undefined)
    .map(k => sb.from('modules').upsert({ module: k, data: data[k], updated_at: new Date().toISOString() }));

  const eventRows = (data.calendar?.events ?? []).map(e => ({
    id: e.id, date: e.date ?? '1970-01-01', title: e.title ?? '', category: e.category ?? 'personal', data: e,
  }));

  const spendRows = [];
  for (const [date, entries] of Object.entries(data.calendar?.spendEntries ?? {})) {
    for (const e of entries ?? []) {
      if (!e?.id) continue;
      spendRows.push({ id: e.id, date, category_id: e.categoryId ?? null, subcategory: e.subcategory ?? null, amount: e.amount ?? 0, currency: e.currency ?? 'JPY', note: e.note ?? null, data: e });
    }
  }

  await Promise.all([
    ...moduleWrites,
    eventRows.length  ? sb.from('calendar_events').upsert(eventRows)  : Promise.resolve(),
    spendRows.length  ? sb.from('spend_entries').upsert(spendRows)    : Promise.resolve(),
  ]);
}

// ── Write partial update to Supabase ──────────────────────────────────────
async function writePartial(partial, prevCalendar) {
  const writes = [];

  for (const [key, value] of Object.entries(partial)) {
    if (key === 'calendar') {
      writes.push(writeCalendar(value, prevCalendar));
    } else if (MODULE_KEYS.includes(key)) {
      writes.push(
        sb.from('modules').upsert({ module: key, data: value, updated_at: new Date().toISOString() })
      );
    }
  }

  await Promise.all(writes);
}

async function writeCalendar(newCal, prevCal) {
  const writes = [];

  // Events: upsert additions/edits, delete removals
  if (newCal.events !== undefined) {
    if (newCal.events.length > 0) {
      const rows = newCal.events.map(e => ({
        id: e.id, date: e.date ?? '1970-01-01', title: e.title ?? '', category: e.category ?? 'personal', data: e,
      }));
      writes.push(sb.from('calendar_events').upsert(rows));
    }
    const newIds  = new Set(newCal.events.map(e => e.id));
    const removed = (prevCal?.events ?? []).map(e => e.id).filter(id => !newIds.has(id));
    if (removed.length) writes.push(sb.from('calendar_events').delete().in('id', removed));
  }

  // Spend entries: upsert additions/edits, delete removals
  if (newCal.spendEntries !== undefined) {
    const newRows = [];
    const newIds  = new Set();

    for (const [date, entries] of Object.entries(newCal.spendEntries)) {
      for (const e of entries ?? []) {
        if (!e?.id) continue;
        newIds.add(e.id);
        newRows.push({ id: e.id, date, category_id: e.categoryId ?? null, subcategory: e.subcategory ?? null, amount: e.amount ?? 0, currency: e.currency ?? 'JPY', note: e.note ?? null, data: e });
      }
    }

    if (newRows.length) writes.push(sb.from('spend_entries').upsert(newRows));

    const removed = Object.values(prevCal?.spendEntries ?? {})
      .flat()
      .map(e => e?.id)
      .filter(id => id && !newIds.has(id));
    if (removed.length) writes.push(sb.from('spend_entries').delete().in('id', removed));
  }

  await Promise.all(writes);
}

// ── Public API ─────────────────────────────────────────────────────────────

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem('lifeOS_data');
    const stored = raw ? JSON.parse(raw) : {};
    return { ...defaultData(), ...stored, settings: { ...defaultData().settings, ...(stored.settings ?? {}) } };
  } catch {
    return defaultData();
  }
}

// Normalize period to the canonical entry shape — IN MEMORY ONLY.
// We deliberately do NOT write the migrated shape back to Supabase here. Reads
// are correct on every device because each one migrates on load; the server copy
// stays in its original shape (a safety net) until a normal period edit naturally
// saves the new shape. Never let a load silently overwrite Supabase.
function _finishLoad(data) {
  data.period = migratePeriod(data.period).period;
  _data = data;
  return _data;
}

export function load() {
  if (_data) return _data;
  // Check if there's a Supabase session — if yes, use Supabase; otherwise localStorage
  return sb.auth.getSession().then(({ data: { session } }) => {
    if (!session) {
      return _finishLoad(loadFromLocalStorage());
    }
    return fetchFromSupabase()
      .then(_finishLoad)
      .catch(err => {
        console.error('[store] Supabase load failed, falling back to localStorage', err);
        return _finishLoad(loadFromLocalStorage());
      });
  });
}

export function get() { return _data ?? defaultData(); }

export function save(partial) {
  if (!_data) { load().then(() => save(partial)); return; }

  const prevCalendar = _data.calendar ? { events: [...(_data.calendar.events ?? [])], spendEntries: { ...(_data.calendar.spendEntries ?? {}) } } : null;

  Object.assign(_data, partial);
  _subs.forEach(fn => fn(_data));

  // Write to Supabase if authenticated, otherwise localStorage
  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      writePartial(partial, prevCalendar).catch(e => console.error('[store] write failed', e));
    } else {
      try { localStorage.setItem('lifeOS_data', JSON.stringify(_data)); } catch (e) { console.error('[store] localStorage write failed', e); }
    }
  });
}

export function subscribe(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

export async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  _data = null; // force fresh load from Supabase
  await load();
  _subs.forEach(fn => fn(_data));
  return data.session;
}

export async function signOut() {
  await sb.auth.signOut();
  _data = null;
}

export function exportBackup() {
  const blob = new Blob([JSON.stringify(_data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `lifeOS-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

export function importBackup(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = async e => {
      try {
        const imported = JSON.parse(e.target.result);
        _data = { ...defaultData(), ...imported, settings: { ...defaultData().settings, ...(imported.settings ?? {}) } };
        await pushToSupabase(_data);
        _subs.forEach(fn => fn(_data));
        resolve(_data);
      } catch (err) { reject(err); }
    };
    r.readAsText(file);
  });
}

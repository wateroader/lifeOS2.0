# Seratus 2.0

A personal life OS, yours for 100 years, starting from your birthday.

Set your name, birth date, timezone, and currencies once. Everything adapts from there. Your data lives in a private Supabase backend (personal use only) and syncs across your devices, with a local copy so it keeps working offline. Export to JSON anytime. No subscription.

---

## What works now

**Calendar**
Week, month, and year views. 9 built-in event categories, customizable in settings. Click any day to add or edit events. Drag events between days. Park an event for later — it moves to the Notes sidebar until you're ready.

**Notes sidebar**
Always one swipe away. Holds parked (unscheduled) events, countdowns, and free-form notes with markdown support. Collapsible.

**Period tracker**
Year calendar with color-coded flow, predictions, and fertile window. Day logger for flow, mood, and symptoms (full clinical list). Cycles tab with flow donut chart, stats grid (avg, median, longest, shortest), bar chart of recent cycles, and expandable cycle history.

**Finance**
Monthly income ledger with Japan-specific salary breakdown (salary, transport allowance, social insurance, taxes). Spend totals pulled from calendar by category. Sub-views for Savings, Currency, Investment (bonds, deposits, NISA), and Budget.

**Budget**
Per-category monthly budgets with progress bars. A take-home header shows your monthly income, what's left if you spend every budget (your free money), and what's left to spend against actual spending. Soft, non-nagging hints flag categories that eat too much of your take-home (e.g. housing over ~35%). A Project tracker sums project expenses from the calendar against manually logged, editable income.

**Drawings**
Daily scratch canvas in the Notes tab. Clears automatically each day. Export to PNG.

**Gacha tracker**
Personal Arknights pull tracker: resource counts, per-banner pity, pull logging, and a full operator collection (rarity/class/acquisition flags) with an Add/Owned layout and potential levels.

**Mobile companion**
Dedicated mobile build at /mobile/ (mobile user-agents are redirected there automatically), matching the desktop visual language: Fraunces title, frosted glass header, floating tab bar, same color tokens. It shares the same synced data and the same period logic as desktop. Day and week calendar with add/edit/delete events (with start–end times and location) and spend, period logging, a Finance tab for salary/income entry, and editable notes. Installs to the home screen as a PWA and works offline.

**Language**
EN/ID toggle on all public pages.

**Settings**
Full settings modal accessible from the top bar.
- Profile: name, date of birth, timezone, nationalities, locations, currencies, period tracker toggle
- Calendar: first day of week, rename/add/delete event categories
- Spending: rename/add/delete spend categories and subcategories
- Appearance: dark and light theme, accent color (6 presets)
- Data: export backup, import backup, import from v1, clear all data

**Data import**
Browser-based import tool. Apple Health XML (period data). Seratus v1 JSON (full data migration). All parsing is local — nothing leaves your device.

**First-run setup**
Guided setup page on first visit. Everything editable later in settings.

---

## Planned

| Module | Notes |
|---|---|
| Debug panel | Hidden key-combo panel: localStorage inspector, store dump, date override |
| Import: Clue, Flo, Natural Cycles | Browser-based parsers, JSON download only |

---

## Stack

Vanilla JS (ES Modules) · No build step · Supabase (private backend) · localStorage fallback · SortableJS (drag and drop only) · Self-hosted fonts (no external requests) · Service worker (offline, cache-first)

---

## Data

Data is stored in a private Supabase backend for personal use and syncs across devices. A local `localStorage` copy keeps the app working when offline. Export to JSON anytime from Settings.

Apple Health period data and Seratus v1 data can be imported via [import-data.html](import-data.html). Import parsing is local, the file itself never leaves your device.

---

## v1

[v1](https://github.com/jesdonut/lifeOS) is a working monolith. v2 is a full rewrite with a modular architecture.

---

## License

[PolyForm NonCommercial 1.0.0](LICENSE): free for personal use. Attribution required. Commercial use not permitted.

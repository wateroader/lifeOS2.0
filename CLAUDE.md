# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Seratus / lifeOS 2.0 — a personal life OS (calendar, period tracking, finance, budget, notes, gacha).
Vanilla JS ES modules, **no build step, no package.json, no test runner**. Deployed on Vercel as static files.

## Commands

There is no build, lint, or test tooling. Working commands:

```bash
# Serve locally — ES modules and the service worker need http://, not file://
python3 -m http.server 8000      # then open http://localhost:8000/app.html

# Syntax check after editing JS (the only "lint" available)
node --check core/app.js
find core modules mobile -name '*.js' -exec node --check {} \;
```

Ad-hoc logic tests are written as throwaway `.mjs` scripts run with `node` (see the period migration
tests referenced in `CLEANUP.md`); they are not committed.

## Critical workflow rules

**Bump the service worker cache after any JS/CSS/HTML change.** `sw.js` precaches an explicit `SHELL`
list and serves stale-while-revalidate. Increment `CACHE = 'seratus-vNN'` in `sw.js:1`, or deployed
clients keep running old code. If you add or move a file, also add/update its path in `SHELL`.

**Three places break when a file moves:** `sw.js` `SHELL`, the dynamic `import()` map in
`core/app.js` (`MODULE_MAP`, with `?v=N` cache-busters), and every `*.html` `src`/`href`.
`manifest.json` and `vercel.json` matter for `mobile/`.

**Never auto-write migrated data back to Supabase on load.** See "Store" below.

Companion docs: `STATUS.md` (what's built + accumulated design decisions) and `CLEANUP.md`
(in-flight refactor plan, UI consistency audit, and the canonical view-header template).

## Architecture

### Entry points
| File | Role |
|---|---|
| `index.html` | Marketing landing page. Redirects mobile UAs to `mobile/mobile.html`; rewrites `setup.html` links to `app.html` if setup is already done. |
| `setup.html` | First-run onboarding; writes `settings.setupDone` then goes to `app.html`. |
| `app.html` → `core/app.js` | The desktop app shell. |
| `mobile/mobile.html` → `mobile/mobile.js` | A **separate, parallel mobile build** — not a responsive layout. Shares only `core/store.js` and `modules/period/period-data.js`. |
| `about/calendar/finance/notes/period/terms/privacy/license/download/import-data.html` | Static marketing + tooling pages at root, styled by `style/pages.css`, translated by `core/lang.js`. |

`core/app.js` builds the tab bar, lazy-`import()`s a module on first tab visit, and hands it
`(panel, data, save)`. Tabs are conditional on settings (`periodEnabled`, `gachaEnabled`).
Signing in is deliberately hidden: tap the "Seratus" brand pill 10 times.

### Module contract
Every tab module exports `init(container, data, onSave)`, `destroy()`, `onDataChange(newData)`.
Sub-views inside a module (finance's currency/investment/nisa/budget, notes' countdown/draw) use
`mount(container, data, onSave, ...)` / `unmount()` / `update(data)`.

Module CSS is **not** linked in HTML — each module injects its own `<link>` at init via
`new URL('./x.css', import.meta.url)`, guarded against duplicates. Keep a module's CSS in its folder.

### Store (`core/store.js`)
Single source of truth. `load()` → Promise, `get()` → sync snapshot, `save(partial)`, `subscribe(fn)`.

- **Supabase is primary** when a session exists; `localStorage` (`lifeOS_data`) is the offline /
  signed-out fallback. Anon key is in the source on purpose — this is a private personal backend.
- `save(partial)` writes localStorage **first** (phones drop network), then pushes to Supabase with
  one retry. Never reorder this — a failed write used to silently lose the edit on refresh.
- Supabase schema is not one JSON blob: `modules` (row per `MODULE_KEYS` entry), `calendar_events`
  (row per event), `spend_entries` (row per spend). `writeCalendar()` diffs against the previous
  calendar to issue deletes, so `save({ calendar: ... })` must pass the *whole* calendar object.
- `_finishLoad()` runs `migratePeriod()` **in memory only**. Loads must never overwrite the server
  copy; the migrated shape persists only when a real user edit saves it.

### Data shapes
- `calendar.events[]` — flat array; `date: null` means "parked" (shows in the Notes sidebar, not the grid).
- `calendar.spendEntries` — `{ 'YYYY-MM-DD': [entry, ...] }`.
- `period.entries[]` — canonical shape defined in `modules/period/period-data.js`:
  `{ id, start, end, flow: { 'YYYY-MM-DD': 'heavy' }, symptoms, bbt, discharge, notes }`.
  `flow` is a **date-keyed map**, never a single string. Mobile and desktop both go through
  `period-data.js` write helpers (`mergeEntry`, `removeDay`, `setSymptom`, …) — do not reimplement.
  `symptoms`/`bbt`/`discharge` are also mirrored at `period.*` top level so off-period data survives.
- Every user-created record gets `createdAt` (ISO) on create and `updatedAt` on edit.

`modules/period/period-data.js` holds all period math (EWMA λ=0.88 predictions, fertile window,
`mergeEntry` joining entries ≤1 day apart). It is pure and shared — put period logic here, not in UI.

## Conventions

**New views start from the shared header.** Do not invent a header layout. Copy the
`< label >  today  [tabs]  + add` scaffold documented in `CLEANUP.md` STEP 0, using the shared classes
from `style/base.css`: `.cal-header`, `.cal-year-btn`, `.cal-year-label`, `.cal-today-btn`,
`.cal-view-toggle` / `.cal-view-btn`, plus `.cal-add-btn`. Reference: `modules/calendar/calendar.js`
~L170–253. Header height is `--view-head-h`; scroll-body padding is `--view-pad`. Tabs must never shift
position when switching views.

**No hardcoded hex in JS.** All colors come from CSS variables in `style/base.css` (`--accent`,
`--cat-*`, `--flow-*`, `--fin-*`). User-defined custom categories are the one exception — they store
their own hex. Period views override `--accent`/`--accent-2` to pink rather than forking the markup.

Use the spacing (`--s1..s7`), type (`--fs-xs..2xl`), and radius tokens. `CLEANUP.md` tracks an audit of
where raw px values still bypass them — don't add new ones.

Finance is Japan-specific by design (salary/社会保険/税 line items in Japanese in `finance.js`).
Timezone comes from `settings.timezone`, default `Asia/Tokyo`.

Marketing pages translate via `data-en` / `data-id` / `data-jp` attributes read by `core/lang.js`;
add all three when adding copy.

## Note

`Blueprint.md`, `scripts/`, `_local/`, `period-standalone.html`, `changelog.html`, and
`coming-soon.html` are gitignored — local prototypes, personal health data, and orphan pages.
Don't assume they exist, and don't try to restore references to them.

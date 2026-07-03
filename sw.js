const CACHE = 'seratus-v38';

const SHELL = [
  '/app.html',
  '/index.html',
  '/setup.html',
  '/mobile/mobile.html',
  '/lib/Sortable.min.js',
  '/style/base.css',
  '/style/layout.css',
  '/style/settings.css',
  '/modules/period/period.css',
  '/style/pages.css',
  '/style/landing.css',
  '/style/setup.css',
  '/style/import.css',
  '/core/app.js',
  '/core/store.js',
  '/core/settings.js',
  '/core/settings/util.js',
  '/core/settings/data.js',
  '/core/gestures.js',
  '/core/lang.js',
  '/core/import/import-delta.js',
  '/core/import/import-v1.js',
  '/modules/calendar/calendar.js',
  '/modules/calendar/calendar.css',
  '/modules/finance/finance.js',
  '/modules/finance/finance.css',
  '/modules/finance/currency-view.js',
  '/modules/finance/investment-view.js',
  '/modules/finance/investment-calc.js',
  '/modules/finance/investment-products.js',
  '/modules/finance/nisa-view.js',
  '/modules/period/period-ui.js',
  '/modules/period/period-data.js',
  '/modules/notes/notes.js',
  '/modules/notes/notes.css',
  '/modules/notes/notes-tab.js',
  '/modules/notes/draw-view.js',
  '/modules/notes/notes-tab.css',
  '/modules/notes/countdown-view.js',
  '/modules/budget/budget.js',
  '/modules/budget/budget.css',
  '/icons/seratus-100.svg',
  '/icons/seratus-100-512.png',
  '/icons/favicon-32.png',
  '/icons/apple-touch-icon.png',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) return;

  // Network-first for JS and CSS so new code always loads; cache is offline fallback only
  if (url.includes('.js') || url.includes('.css')) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp.ok) caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for everything else (HTML, images, fonts)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp.ok) caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        return resp;
      });
    })
  );
});

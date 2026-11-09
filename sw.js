// sw.js — офлайн-режим, кэш данных и уведомления в 9:00
const VERSION = 'day-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'planner.js', 'content.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const DATA = ['data/schedule.json', 'data/deadlines.json', 'data/extra.json', 'data/meta.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => ![VERSION, 'day-data', 'day-ext'].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    // данные: сначала сеть, без сети — последняя копия
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open('day-data').then((c) => c.put(url.pathname, copy)); }
      return r;
    }).catch(() => caches.open('day-data').then((c) => c.match(url.pathname)).then((r) => r || Response.error())));
    return;
  }
  if (url.origin === location.origin) {
    // оболочка: мгновенно из кэша, в фоне обновляем
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => {
      const net = fetch(req).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return r;
      }).catch(() => cached);
      return cached || net;
    }));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.host)) {
    e.respondWith(caches.open('day-ext').then(async (c) => (await c.match(req)) || fetch(req).then((r) => { c.put(req, r.clone()); return r; })));
  }
});

async function refreshData() {
  const c = await caches.open('day-data');
  await Promise.all(DATA.map((p) => fetch(`${p}?t=${Date.now()}`, { cache: 'no-store' })
    .then((r) => (r.ok ? c.put(new URL(p, self.registration.scope).pathname, r) : null)).catch(() => null)));
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'Мой день', {
      body: d.body || 'План на сегодня готов',
      icon: 'icon-192.png', badge: 'icon-192.png', tag: 'brief', renotify: true,
      data: { url: d.url || self.registration.scope },
    }),
    refreshData(),
  ]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if ('focus' in w) return w.focus();
    return self.clients.openWindow(target);
  }));
});

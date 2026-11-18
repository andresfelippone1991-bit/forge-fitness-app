/**
 * sw.js — Service Worker de FORGE (PWA Offline-First)
 * - Pre-cachea el shell local completo para abrir sin señal en gimnasio o parque
 * - Cachea dinámicamente Tailwind CDN, Google Fonts y Material Symbols
 * - Nunca cachea llamadas dinámicas a /api/ ni endpoints de Gemini IA
 */

const CACHE_NAME = 'forge-pwa-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './js/database-embedded.js',
  './js/engine.js',
  './js/app.js',
  './data/database.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const EXTERNAL_ASSET_HOSTS = [
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca cachear endpoints de IA ni API serverless
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('generativelanguage.googleapis.com') ||
    url.hostname.includes('aiplatform.googleapis.com')
  ) {
    return;
  }

  // Assets externos (Tailwind, Google Fonts, Material Symbols): Cache-First con actualización en segundo plano
  if (EXTERNAL_ASSET_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((resp) => {
            if (resp && (resp.ok || resp.type === 'opaque')) {
              cache.put(req, resp.clone());
            }
            return resp;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Recursos locales del mismo origen: Stale-While-Revalidate con fallback a index.html offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) {
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch (err) {
          if (cached) return cached;
          if (req.mode === 'navigate') {
            return cache.match('./index.html');
          }
          throw err;
        }
      })
    );
  }
});

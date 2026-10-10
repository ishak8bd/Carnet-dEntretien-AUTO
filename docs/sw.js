// Service Worker - Suivi Entretien Véhicule PWA (100% Hors-Ligne & Support Firebase)
const CACHE_NAME = 'entretien-v16';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './room.js',
  './firebase-config.js',
  './manifest.json',
  './icons/logo-dark.png',
  './icons/logo-blue.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  './icons/icon-dark-192.png',
  './icons/icon-dark-512.png',
  './icons/icon-blue-192.png',
  './icons/icon-blue-512.png',
  './icons/icon.svg',
  // Fichiers SDK Firebase versionnés et épinglés pour démarrage 100% hors-ligne
  'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js'
];

// Installation : mise en cache initiale
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activation : nettoyage des anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Stratégie : Network First avec fallback Cache immédiat pour navigation hors-ligne
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Filtrer les requêtes : accepter l'origine locale et le CDN officiel Firebase
  try {
    const requestUrl = new URL(event.request.url);
    const isLocal = requestUrl.origin === self.location.origin;
    const isFirebaseCdn = requestUrl.origin === 'https://www.gstatic.com' && requestUrl.pathname.startsWith('/firebasejs/11.4.0/');
    if (!isLocal && !isFirebaseCdn) return;
  } catch (e) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;

        // Fallback navigation pour accès hors-ligne direct
        if (event.request.mode === 'navigate') {
          const indexCached = await caches.match('./index.html');
          if (indexCached) return indexCached;
          const rootCached = await caches.match('./');
          if (rootCached) return rootCached;
        }

        // Retourner une réponse d'erreur valide au lieu de null pour éviter une TypeError dans respondWith
        return Response.error();
      })
  );
});

// Service Worker - Suivi Entretien Véhicule PWA (100% Hors-Ligne & Support Firebase)
const CACHE_NAME = 'entretien-v19';
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
  './icons/logo-glass.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  './icons/icon-dark-192.png',
  './icons/icon-dark-512.png',
  './icons/icon-blue-192.png',
  './icons/icon-blue-512.png',
  './icons/icon-glass-192.png',
  './icons/icon-glass-512.png',
  './icons/icon.svg',
  './icons/bg-orbits.svg',
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

// ============================================================================
// GESTION DES NOTIFICATIONS PUSH & LOCALES DU TÉLÉPHONE
// ============================================================================

// Événement Push (Web Push distant en arrière-plan)
self.addEventListener('push', (event) => {
  let data = {
    title: "Carnet d'Entretien",
    body: "Vous avez une alerte d'entretien à vérifier !",
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'carnet-auto-alert',
    url: './index.html'
  };

  try {
    if (event.data) {
      const payload = event.data.json();
      data = Object.assign(data, payload);
    }
  } catch (err) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || './icons/icon-192.png',
    badge: data.badge || './icons/icon-192.png',
    tag: data.tag || 'carnet-auto-alert',
    vibrate: [200, 100, 200],
    data: { url: data.url || './index.html' },
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Clic sur une notification du téléphone : ouvrir ou focaliser l'application
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || './index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('index.html') || client.url.endsWith('/')) {
          if ('focus' in client) return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

const CACHE_NAME = 'seating-suite-cache-v1';

// We must cache your local files AND the external CDNs
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './js/app.js',
    './js/canvas-engine.js',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
    'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js',
    'https://unpkg.com/vue@3/dist/vue.global.js'
];

// Install Event: Cache everything listed above
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Opened cache, caching assets...');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate Event: Clean up old caches if we update the version name
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch Event: Serve from cache if available, otherwise go to network
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // Return the cached file if found
            if (cachedResponse) {
                return cachedResponse;
            }
            // Otherwise, fetch from the network
            return fetch(event.request).catch(() => {
                // Optional: Return a fallback page if network fails and it's not cached
                console.error("Network request failed and no cache available for:", event.request.url);
            });
        })
    );
});
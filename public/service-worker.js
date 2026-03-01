const CACHE_NAME = 'zorro-gallina-v29';
const ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/img/ajp.png',
    '/socket.io/socket.io.js',
    'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (e) => {
    // Ignorar solicitudes de socket.io o que no sean GET
    if (e.request.url.includes('socket.io') || e.request.method !== 'GET') {
        return;
    }
    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});
const CACHE = 'suburban-sprint-v16';
const CORE = ['./', './index.html', './src/style.css', './src/main.js', './src/sensors.js', './src/app-data.js', './src/multiplayer.js', './vendor/phaser.esm.min.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './assets/rider-rear-keyed.png', './assets/rider-pedal-strip.png', './assets/nature-grass-clover.png', './assets/nature-oak-tree.png', './assets/nature-rocks-moss.png', './assets/nature-berry-shrubs.png', './assets/nature-wildflowers.png', './assets/nature-pine-tree.png', './assets/nature-maple-tree.png', './assets/nature-birch-cluster.png', './assets/nature-ornamental-grass.png', './assets/nature-flower-bunch.png', './assets/nature-hydrangea-bush.png', './assets/landmark-yellow-house.png', './assets/landmark-coral-house.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => { caches.open(CACHE).then(cache => cache.put('./index.html', response.clone())); return response; }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && new URL(event.request.url).origin === location.origin) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match('./index.html'))));
});

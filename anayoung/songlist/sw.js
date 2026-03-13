const CACHE_NAME='songlist-v1';
const STATIC_ASSETS=['./','./index.html','./style.css','./script.js','./manifest.json','https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(STATIC_ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const url=e.request.url;if(url.includes('docs.google.com')||url.includes('script.google.com')){e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));return}e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)))});

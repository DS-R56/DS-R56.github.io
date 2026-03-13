const CACHE_NAME = 'songlist-v1';

// 정적 파일만 캐시 (노래 데이터는 캐시하지 않음)
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
];

// 설치: 정적 파일 캐시
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// 활성화: 이전 캐시 삭제
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// 요청 처리
self.addEventListener('fetch', e => {
    const url = e.request.url;

    // Google Sheets 데이터: 네트워크 우선 (항상 최신 데이터)
    if (url.includes('docs.google.com')) {
        e.respondWith(
            fetch(e.request)
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // 정적 파일: 캐시 우선 → 네트워크 폴백
    e.respondWith(
        caches.match(e.request)
            .then(cached => cached || fetch(e.request))
    );
});

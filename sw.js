const CACHE_NAME = 'ebv-shell-v4';
const SHELL_FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'config.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// 앱 셸(정적 파일)만 캐싱하고, 그 외 요청(Drive API, Google 로그인, CDN 스크립트 등)은
// 서비스워커가 손대지 않고 브라우저가 그대로 처리하도록 둔다.
// 배포할 때마다 최신 내용을 받아오도록 네트워크를 먼저 시도하고, 오프라인일 때만
// 캐시된 버전으로 대체한다.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('index.html')))
  );
});

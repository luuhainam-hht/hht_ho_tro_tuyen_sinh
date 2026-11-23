/**
 * Service Worker: vỏ ứng dụng chạy được khi rớt mạng. KHÔNG cache /api (dữ liệu tuyển sinh phải mới,
 * thông tin cá nhân không lưu trên máy dùng chung). Tăng CACHE_VERSION mỗi lần đổi file tĩnh.
 */
const CACHE_VERSION = 'hht-ts-v16';
const PRECACHE = [
  '/', '/index.html', '/nganh.html', '/nganh-chi-tiet.html', '/ho-so.html', '/dat-lich.html', '/hen.html', '/lich-tuyen-sinh.html',
  '/huong-dan-dang-ky.html', '/cam-nang.html', '/goi-y-nganh.html', '/lien-he.html', '/nguon-du-lieu.html', '/thanh-vien.html', '/chat.html', '/offline.html', '/404.html',
  '/css/app.css', '/js/apiClient.js', '/js/actionDelegate.js', '/js/common.js', '/js/wsClient.js', '/js/qr.js', '/js/vendor/qrcode.min.js',
  '/js/pages/home.js', '/js/pages/majors.js', '/js/pages/major.js', '/js/pages/checklist.js', '/js/pages/booking.js', '/js/pages/appointment.js',
  '/js/pages/schedule.js', '/js/pages/guide.js', '/js/pages/faq.js', '/js/pages/recommend.js', '/js/pages/contact.js', '/js/pages/sources.js', '/js/pages/chat.js',
  '/img/icon-192.png', '/img/logo-hht.png', '/img/logo-hht-sm.png', '/img/logo-hht-full.png', '/img/team/kieu-thanh-chung.jpg', '/img/team/nguyen-cong-tuan.jpg', '/manifest.webmanifest',
  '/fonts/be-vietnam-pro-vietnamese-400-normal.woff2', '/fonts/be-vietnam-pro-latin-400-normal.woff2',
  '/fonts/be-vietnam-pro-vietnamese-700-normal.woff2', '/fonts/be-vietnam-pro-latin-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api') || url.pathname === '/ws' || url.pathname.startsWith('/admin')) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })
    .then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('/offline.html') : undefined))));
});

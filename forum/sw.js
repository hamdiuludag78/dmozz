/* =================================================================
   DMOZ Q&A — Service Worker
   Amaç: statik varlıkları (HTML kabuğu, CSS, JS, fontlar) önbelleğe
   alarak tekrar ziyaretlerde hızlandırmak ve temel offline destek
   sağlamak. Supabase API çağrıları (auth/db/storage) kasıtlı olarak
   bu SW'nin dışında bırakılır; forum verisi her zaman canlı/güncel
   olmalıdır — statik önbellek verinin bayatlamasına yol açmamalıdır.
   ================================================================= */

const CACHE_VERSION = 'dmoz-qa-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// İlk kurulumda önbelleğe alınacak temel dosyalar
const PRECACHE_URLS = [
    '/forum/',
    '/forum/tema.css',
    '/forum/tema.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k.startsWith('dmoz-qa-') && k !== STATIC_CACHE)
                    .map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

function isSupabaseRequest(url) {
    return url.hostname.endsWith('supabase.co');
}

function isStaticAsset(url) {
    return /\.(css|js|woff2?|ttf|png|jpg|jpeg|webp|svg|ico)$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Supabase (auth/db/storage/realtime) her zaman ağdan — asla önbellekten
    if (isSupabaseRequest(url)) return;

    // Statik varlıklar: cache-first, arka planda güncelle (stale-while-revalidate)
    if (isStaticAsset(url) || url.pathname === '/forum/' || url.pathname.startsWith('/forum/?')) {
        event.respondWith(
            caches.open(STATIC_CACHE).then((cache) =>
                cache.match(req).then((cached) => {
                    const network = fetch(req).then((res) => {
                        if (res && res.status === 200) cache.put(req, res.clone());
                        return res;
                    }).catch(() => cached);
                    return cached || network;
                })
            )
        );
    }
    // Diğer her şey (üçüncü taraf CDN, fontlar vb.) tarayıcının normal davranışına bırakılır
});

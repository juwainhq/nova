/* Generated into dist/sw.js and the published root by build-pwa.mjs.
   Cache only this build's public app shell — never chat, models or browsing. */
const VERSION = '3424ea939ee217f773ac';
const SHELL_FILES = [
  "./assets/index-BHA9-1Tf.css",
  "./assets/index-DeBAQsq0.js",
  "./icons/nova-192.png",
  "./icons/nova-192.svg",
  "./icons/nova-512.png",
  "./icons/nova-512.svg",
  "./index.html",
  "./manifest.json"
];
const SCOPE = new URL(self.registration.scope);
const INDEX = new URL('./index.html', SCOPE).href;
const PREFIX = `nova-shell-${encodeURIComponent(SCOPE.pathname)}-`;
const CACHE = PREFIX + VERSION;
const STATIC_URLS = new Set(SHELL_FILES.map(file => new URL(file, SCOPE).href));

function validShellResponse(url, response) {
  if (!response.ok || response.status !== 200 || response.type === 'opaque') return false;
  if (response.url && new URL(response.url).origin !== SCOPE.origin) return false;
  const type = (response.headers.get('content-type') || '').toLowerCase();
  const path = new URL(url).pathname;
  if (path.endsWith('.html')) return type.includes('text/html');
  if (path.endsWith('.js')) return /(?:java|ecma)script/.test(type);
  if (path.endsWith('.css')) return type.includes('text/css');
  if (path.endsWith('.json')) return /(?:application|text)\/(?:manifest\+)?json/.test(type);
  if (path.endsWith('.svg')) return type.includes('image/svg+xml');
  if (path.endsWith('.png')) return type.includes('image/png');
  return !type.includes('text/html');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Fill a new, version-isolated snapshot. Consume/cache each response as it
    // arrives: retaining all unconsumed bodies first can stall HTTP/1.1 hosts.
    // This worker cannot activate until every write finishes successfully.
    try {
      const cache = await caches.open(CACHE);
      await Promise.all([...STATIC_URLS].map(async url => {
        const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
        if (!validShellResponse(url, response)) throw new Error(`NOVA shell resource unavailable: ${url}`);
        await cache.put(url, response);
      }));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
    // Deliberately no skipWaiting(): updates wait for existing windows/tabs to
    // close instead of replacing code or interrupting an active conversation.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function appShell(key, request, navigation) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key);
  if (cached) return cached;
  // A storage-evicted entry can still load online. Do not mix a newer index
  // with this worker's older hashed assets; runtime responses are not cached.
  try {
    return await fetch(request);
  } catch (error) {
    if (!navigation) throw error;
    return new Response('<!doctype html><title>NOVA is offline</title><h1>NOVA</h1><p>The offline files are not available yet. Connect once and reopen the app.</p>', {
      status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return;
  const navigation = request.mode === 'navigate' && (url.pathname === SCOPE.pathname || url.pathname === new URL(INDEX).pathname);
  const key = navigation ? INDEX : new URL(url.pathname, SCOPE.origin).href;
  // This explicit allow-list leaves /api/ollama, arbitrary configured APIs,
  // external frames, speech/model downloads, and other documents network-only.
  if (!navigation && !STATIC_URLS.has(key)) return;
  event.respondWith(appShell(key, request, navigation));
});

// Makes the app installable and gives it a proper screen when the internet is down.
//
// Only files that hold no personal data are ever stored on the device: the app's own code, icons
// and the offline page. Pages and API replies, which hold member details, always go to the network,
// so nothing is left behind on a shared phone, and attendance is never shown out of date.
const CACHE = "gyansatr-static-v2";
const OFFLINE_PAGE = "/offline.html";
const MAX_ENTRIES = 150;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_PAGE, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    // Old versions of the app's files build up over time, so the oldest are dropped first.
    const removable = keys.filter((key) => new URL(key.url).pathname.startsWith("/_next/static/"));
    await Promise.all(removable.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((key) => cache.delete(key)));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_PAGE)));
    return;
  }
  // These file names change with their contents, so a stored copy can never be out of date.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(fromCacheFirst(request));
  }
});

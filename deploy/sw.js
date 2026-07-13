const CACHE_NAME = "yamamoto-farm-runtime-v20260713-1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("yamamoto-farm-runtime-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request, { cache: "no-store" });

      // Keep a runtime fallback cache for temporary network failures.
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, fresh.clone()).catch(() => {});

      return fresh;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw error;
    }
  })());
});

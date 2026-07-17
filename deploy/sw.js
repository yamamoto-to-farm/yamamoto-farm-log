const CACHE_NAME = "yamamoto-farm-runtime-v20260718-2";

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

  // Chrome may throw for only-if-cached requests unless they are same-origin navigations.
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNurseryLayout = url.pathname === "/logs/nursery/house-layout.json";

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request, { cache: "no-store" });

      if (isNurseryLayout && fresh.status === 404) {
        return new Response(JSON.stringify({
          version: 2,
          updatedAt: new Date(0).toISOString(),
          blocks: [],
          assignments: {}
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        });
      }

      // Keep a runtime fallback cache for temporary network failures.
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, fresh.clone()).catch(() => {});

      return fresh;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      return new Response("Network unavailable", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});

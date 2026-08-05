const scopeUrl = new URL(self.registration.scope);
const scopeKey = scopeUrl.pathname.replace(/[^a-z0-9]+/gi, "-") || "root";
const CACHE_PREFIX = `weather-route-${scopeKey}`;
const CACHE = `${CACHE_PREFIX}v2`;
const scopedUrl = (path) => new URL(path, scopeUrl).toString();
const SHELL = [scopedUrl("./"), scopedUrl("manifest.webmanifest"), scopedUrl("icon.svg")];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== "GET"
    || requestUrl.origin !== self.location.origin
    || requestUrl.pathname.includes("/api/")
  ) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(event.request, response.clone())),
          );
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;

        if (event.request.mode === "navigate") {
          const shell = await caches.match(SHELL[0]);
          if (shell) return shell;
        }

        return Response.error();
      }),
  );
});

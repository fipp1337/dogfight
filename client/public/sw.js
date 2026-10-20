const CACHE = "dogfight-shell-v1";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/assets/manifest.json",
  "/assets/ship-sheet.svg",
  "/assets/asteroid-sheet.svg",
  "/assets/bullet-sheet.svg",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/ws"
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.method === "GET") {
          const copy = response.clone();
          void caches
            .open(CACHE)
            .then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(
        async () => (await caches.match(event.request)) ?? Response.error(),
      ),
  );
});

/* Service worker kill-switch.
   Previous versions cached stale copies of the app and served a broken mix of
   old and new files. This version caches nothing: it deletes all caches,
   unregisters itself, and reloads any open tabs so the browser always fetches
   fresh files directly from the network. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((client) => client.navigate(client.url));
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

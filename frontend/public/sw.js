// Push-only service worker: no offline caching, just enough to receive Web
// Push events while the app isn't open and route a tap back into the game.
// A plain static file (not built/bundled) so it can be registered from
// "/sw.js" with the broadest possible scope ("/").

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Wordplay", body: "", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Non-JSON payload (shouldn't happen — the backend always sends JSON):
    // fall back to the defaults above rather than dropping the notification.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      // No exact-URL match: reuse an already-open tab by navigating it,
      // rather than piling up new windows for a standalone-mode PWA.
      for (const client of clients) {
        if ("focus" in client && "navigate" in client) return client.focus().then(() => client.navigate(url));
      }
      return self.clients.openWindow(url);
    }),
  );
});

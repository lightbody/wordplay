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
  let payload = { title: "Wordplay", body: "", url: "/", tag: undefined, badgeCount: undefined };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Non-JSON payload (shouldn't happen — the backend always sends JSON):
    // fall back to the defaults above rather than dropping the notification.
  }

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: payload.url },
        // Same tag as any other pending notification for this game replaces
        // it in place instead of piling up a second one in the notification
        // center; renotify makes sure that replacement still alerts (sound/
        // vibration) rather than silently swapping unseen.
        tag: payload.tag,
        renotify: payload.tag !== undefined,
      });

      // Home Screen app icon badge -- number of games it's currently your
      // turn in. Supported in a service worker context (no page needs to be
      // open) since Chrome 108ish; guard for browsers without it.
      if (typeof payload.badgeCount === "number" && "setAppBadge" in self.navigator) {
        try {
          if (payload.badgeCount > 0) await self.navigator.setAppBadge(payload.badgeCount);
          else await self.navigator.clearAppBadge();
        } catch {
          // Badging API can reject in some embedder contexts; the
          // notification itself already shipped, so just skip the badge.
        }
      }
    })(),
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

const ICON = "app-icon.svg";

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: "push-notification", notification: data });
    await self.registration.showNotification(data.title || "Shattered Plains", {
      body: data.body || "Your warcamp has news.", icon: ICON, badge: ICON,
      tag: data.id || undefined, renotify: true, silent: Boolean(data.silent),
      data: { destinationView: data.destinationView || "overview", entityId: data.entityId || null },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const view = event.notification.data?.destinationView || "overview";
  const target = new URL(self.registration.scope);
  target.searchParams.set("view", view);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        client.postMessage({ type: "open-view", view });
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});

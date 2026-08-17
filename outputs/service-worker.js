const ICON = "app-icon-192.png";

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: "push-notification", notification: data });
    await self.registration.showNotification(data.title || "Shattered Plains", {
      body: data.body || "Your warcamp has news.", icon: ICON, badge: ICON,
      tag: data.id || undefined, renotify: true, silent: Boolean(data.silent),
      data: {
        destinationView: data.destinationView || "home",
        destinationTab: data.destinationTab || null,
        entityId: data.entityId || null,
        kingdomId: data.kingdomId || null,
        intelligenceCategory: data.intelligenceCategory || null,
      },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const view = data.destinationView || "home";
  const target = new URL(self.registration.scope);
  target.searchParams.set("view", view);
  if (data.destinationTab) target.searchParams.set("tab", data.destinationTab);
  if (data.entityId) target.searchParams.set("focus", data.entityId);
  if (data.kingdomId) target.searchParams.set("kingdom", data.kingdomId);
  if (data.intelligenceCategory) target.searchParams.set("category", data.intelligenceCategory);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        client.postMessage({ type: "open-route", route: { view, tab: data.destinationTab, focus: data.entityId, kingdom: data.kingdomId, category: data.intelligenceCategory } });
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});

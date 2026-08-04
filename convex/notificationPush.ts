"use node";

import { v } from "convex/values";
import webpush from "web-push";
import { internal } from "./_generated/api";
import { env, internalAction } from "./_generated/server";

export const deliver = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const publicKey = env.VAPID_PUBLIC_KEY;
    const privateKey = env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return { delivered: 0, disabled: 0, configured: false };
    webpush.setVapidDetails(env.VAPID_SUBJECT || "mailto:admin@shattered-plains.invalid", publicKey, privateKey);
    const data = await ctx.runQuery(internal.notifications.deliveryData, { notificationId: args.notificationId });
    if (!data) return { delivered: 0, disabled: 0, configured: true };
    let delivered = 0;
    let disabled = 0;
    for (const subscription of data.subscriptions) {
      try {
        const endpoint = new URL(subscription.endpoint);
        const allowed = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com"].includes(endpoint.hostname) || endpoint.hostname.endsWith(".notify.windows.com");
        if (endpoint.protocol !== "https:" || !allowed) {
          await ctx.runMutation(internal.notifications.disableSubscription, { subscriptionId: subscription._id });
          disabled += 1;
          continue;
        }
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({
          id: String(data.notification._id), title: data.notification.title, body: data.notification.body,
          category: data.notification.category, destinationView: data.notification.destinationView,
          entityId: data.notification.entityId, silent: !subscription.soundEnabled,
        }), { TTL: 24 * 60 * 60, urgency: data.notification.category === "combat" ? "high" : "normal" });
        delivered += 1;
      } catch (error) {
        const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
        if (statusCode === 404 || statusCode === 410) {
          await ctx.runMutation(internal.notifications.disableSubscription, { subscriptionId: subscription._id });
          disabled += 1;
        } else console.error("Push delivery failed", statusCode, error);
      }
    }
    return { delivered, disabled, configured: true };
  },
});

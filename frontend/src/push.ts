// Web Push subscribe/unsubscribe + iOS install-state helpers. No 3rd-party
// push provider -- the browser's native Push API talking straight to this
// app's own backend (backend/src/routes/push.ts, backend/src/push.ts).

import { createApi } from "./api";

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** iPadOS 13+ reports as "MacIntel" with touch support, so a UA check alone misses iPads. */
export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** Safari only supports Web Push for a PWA added to the home screen -- a plain browser tab can't subscribe. */
export function needsHomeScreenInstall(): boolean {
  return isIos() && !isStandalone();
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = `${base64}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Must be called from a direct user-interaction handler (e.g. a click) -- iOS refuses the permission prompt otherwise. */
export async function subscribeToPush(token: string): Promise<void> {
  const registration = (await navigator.serviceWorker.getRegistration("/sw.js")) ?? (await registerServiceWorker());
  if (!registration) throw new Error("service_worker_unavailable");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("permission_denied");

  const api = createApi(token);
  const { public_key: publicKey } = await api.getVapidPublicKey();

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });

  await api.subscribePush(subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
}

export async function unsubscribeFromPush(token: string): Promise<void> {
  const subscription = await getPushSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await createApi(token).unsubscribePush(endpoint);
}

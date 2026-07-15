// Web Push sending, via the self-hosted `web-push` package (VAPID-signed,
// no 3rd-party push provider — sends straight to Apple/Google/Mozilla's
// push services). One VAPID identity per process, configured once at boot.

import type { Pool } from "pg";
import webpush from "web-push";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** mailto: or https: URL identifying the sender, required by the Web Push spec. */
  subject: string;
}

export function configureWebPush(vapid: VapidConfig): void {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
}

export interface PushPayload {
  title: string;
  body: string;
  /** Relative path to open on notification click, e.g. `/games/<id>`. */
  url: string;
}

/**
 * Sends `payload` to every device `userId` has subscribed on (multi-device
 * fan-out). Never throws: a dead push service or a single bad subscription
 * must not fail the caller's request. Subscriptions the push service reports
 * as gone (404/410) are pruned.
 */
export async function sendPush(pool: Pool, userId: string, payload: PushPayload): Promise<void> {
  let rows: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
  try {
    ({ rows } = await pool.query(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
      [userId],
    ));
  } catch (e) {
    console.error("push: failed to load subscriptions", e);
    return;
  }
  if (rows.length === 0) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [row.id]).catch(() => {});
        } else {
          console.error(`push: send failed for subscription ${row.id}`, e);
        }
      }
    }),
  );
}

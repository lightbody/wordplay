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
  /**
   * Groups related notifications so a new one replaces (rather than piles
   * on top of) an unread one for the same game -- e.g. `game-<id>`. See the
   * Notifications API's `tag` option, which the service worker passes
   * straight through to `showNotification`.
   */
  tag: string;
}

/** How many of `userId`'s active games it's currently their turn in -- the Home Screen app badge count. */
async function yourTurnCount(pool: Pool, userId: string): Promise<number> {
  try {
    const { rows } = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM games WHERE status = 'active' AND current_player_id = $1",
      [userId],
    );
    return rows[0]?.count ?? 0;
  } catch (e) {
    console.error("push: failed to compute badge count", e);
    return 0;
  }
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

  // badgeCount reflects current state at send time, not a per-event delta --
  // computed here (not by callers) so it's always accurate regardless of
  // which route triggered the notification.
  const badgeCount = await yourTurnCount(pool, userId);
  const body = JSON.stringify({ ...payload, badgeCount });
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

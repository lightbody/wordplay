// Web Push subscription management. Ties a browser's PushSubscription (from
// pushManager.subscribe()) to the authenticated user so sendPush() (push.ts)
// knows where to deliver.

import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth.js";
import type { AppContext } from "../context.js";
import { AppError } from "../errors.js";

interface SubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function parseSubscriptionBody(body: unknown): SubscriptionBody {
  if (typeof body !== "object" || body === null) throw AppError.badRequest("invalid_request");
  const b = body as Record<string, unknown>;
  if (typeof b.endpoint !== "string" || b.endpoint.length === 0) throw AppError.badRequest("invalid_request");
  const keys = b.keys as Record<string, unknown> | undefined;
  if (typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") {
    throw AppError.badRequest("invalid_request");
  }
  return { endpoint: b.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function registerPushRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Not secret — clients need this to call pushManager.subscribe(). */
  app.get("/push/vapid-public-key", async (_req, reply) => {
    return reply.send({ public_key: ctx.vapidPublicKey });
  });

  app.post("/me/push-subscriptions", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const sub = parseSubscriptionBody(req.body);

    // Upsert on endpoint: re-subscribing the same browser/device replaces
    // its keys and reassigns ownership rather than accumulating duplicates.
    await ctx.pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
      [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
    );

    // Freshness signal for "is this user likely receiving pushes" (nudges
    // use it to decide whether to offer a share-sheet backup).
    await ctx.pool.query("UPDATE users SET push_enabled_at = now() WHERE id = $1", [userId]);

    return reply.status(204).send();
  });

  /**
   * The app reports that this open came from tapping a push notification
   * (the service worker marks the navigation). The other half of the
   * push-freshness signal.
   */
  app.post("/me/push-opened", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    await ctx.pool.query("UPDATE users SET push_opened_at = now() WHERE id = $1", [userId]);
    return reply.status(204).send();
  });

  app.delete("/me/push-subscriptions", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const body = req.body as { endpoint?: unknown };
    if (typeof body.endpoint !== "string" || body.endpoint.length === 0) {
      throw AppError.badRequest("invalid_request");
    }

    await ctx.pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2", [
      body.endpoint,
      userId,
    ]);

    return reply.status(204).send();
  });
}

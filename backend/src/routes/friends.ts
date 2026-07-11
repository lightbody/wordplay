// Friends: bidirectional relationships plus each user's reusable personal
// friend link. A friendship is two mirrored rows written/deleted together
// (see migrations/003_friends.sql); the friend_links table is server-only.

import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { authenticate } from "../auth.js";
import type { AppContext } from "../context.js";
import { withTransaction } from "../db.js";
import { AppError } from "../errors.js";
import { alphanumericToken } from "../util.js";

export interface FriendUser {
  id: string;
  username: string;
  avatar_emoji: string;
  avatar_color: string;
}

async function loadUser(client: PoolClient, userId: string): Promise<FriendUser> {
  const { rows } = await client.query(
    "SELECT id, username, avatar_emoji, avatar_color FROM users WHERE id = $1",
    [userId],
  );
  if (rows.length === 0) throw AppError.notFound();
  return rows[0] as FriendUser;
}

/**
 * Insert both mirrored friendship rows. Idempotent: re-friending an existing
 * pair is a no-op. Shared by friend-link accept and game-invite accept.
 */
export async function addFriendship(client: PoolClient, a: FriendUser, b: FriendUser): Promise<void> {
  await client.query(
    `INSERT INTO friendships (user_id, friend_id, friend_username, friend_avatar_emoji, friend_avatar_color)
     VALUES ($1, $2, $3, $4, $5), ($2, $1, $6, $7, $8)
     ON CONFLICT DO NOTHING`,
    [a.id, b.id, b.username, b.avatar_emoji, b.avatar_color, a.username, a.avatar_emoji, a.avatar_color],
  );
}

export function registerFriendRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Get (lazily creating) the caller's reusable friend link. */
  app.get("/friends/link", async (req, reply) => {
    const userId = await authenticate(ctx, req);

    const userRes = await ctx.pool.query("SELECT 1 FROM users WHERE id = $1", [userId]);
    if (userRes.rows.length === 0) throw AppError.notFound();

    // Insert-if-absent, then read back — handles concurrent first calls
    // without relying on unique-violation catches.
    await ctx.pool.query(
      "INSERT INTO friend_links (token, user_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING",
      [alphanumericToken(22), userId],
    );
    const { rows } = await ctx.pool.query("SELECT token FROM friend_links WHERE user_id = $1", [userId]);
    const token: string = rows[0].token;

    return reply.send({ token, url: `${ctx.publicAppUrl}/friend/${token}` });
  });

  /** Regenerate the caller's friend link, invalidating the old URL. */
  app.post("/friends/link", async (req, reply) => {
    const userId = await authenticate(ctx, req);

    const userRes = await ctx.pool.query("SELECT 1 FROM users WHERE id = $1", [userId]);
    if (userRes.rows.length === 0) throw AppError.notFound();

    const token = alphanumericToken(22);
    await ctx.pool.query(
      `INSERT INTO friend_links (token, user_id) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, created_at = now()`,
      [token, userId],
    );

    return reply.status(201).send({ token, url: `${ctx.publicAppUrl}/friend/${token}` });
  });

  /** Public (unauthenticated) preview for the friend-link landing page + OG tags. */
  app.get("/friends/:token/preview", async (req, reply) => {
    const { token } = req.params as { token: string };

    const { rows } = await ctx.pool.query(
      `SELECT u.username, u.avatar_emoji, u.avatar_color
       FROM friend_links fl JOIN users u ON u.id = fl.user_id
       WHERE fl.token = $1`,
      [token],
    );
    if (rows.length === 0) throw AppError.notFound();

    return reply.send(rows[0]);
  });

  /** Follow a friend link: establish the (bidirectional) friendship. */
  app.post("/friends/:token/accept", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const { token } = req.params as { token: string };

    const result = await withTransaction(ctx.pool, async (client) => {
      const linkRes = await client.query("SELECT user_id FROM friend_links WHERE token = $1", [token]);
      if (linkRes.rows.length === 0) throw AppError.notFound();
      const ownerId: string = linkRes.rows[0].user_id;

      if (ownerId === userId) throw AppError.conflict("cannot_friend_self");

      const owner = await loadUser(client, ownerId);
      const me = await loadUser(client, userId); // 404s until onboarded

      await addFriendship(client, me, owner);

      return { friend_id: owner.id, friend_username: owner.username };
    });

    return reply.send(result);
  });

  /** Revoke a friendship — removes both directions. Idempotent. */
  app.delete("/friends/:friendId", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    // friendId is a WorkOS sub (TEXT, not a UUID); the parameterized query
    // below is the only place it touches SQL.
    const { friendId } = req.params as { friendId: string };

    await ctx.pool.query(
      "DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
      [userId, friendId],
    );

    return reply.status(204).send();
  });
}

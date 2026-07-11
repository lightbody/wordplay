// Ported from backend/src/handlers/users.rs.

import type { FastifyInstance } from "fastify";
import { isValidAvatarColorId, isValidAvatarEmoji, randomAvatar } from "@wordplay/shared";
import { authenticate } from "../auth.js";
import type { AppContext } from "../context.js";
import { withTransaction } from "../db.js";
import { AppError } from "../errors.js";

export function validUsername(name: string): boolean {
  const len = Array.from(name).length;
  return len >= 3 && len <= 20 && /^[A-Za-z0-9_]+$/.test(name);
}

export function registerUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/me", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const { rows } = await ctx.pool.query(
      "SELECT id, username, default_deduct_unused, avatar_emoji, avatar_color, created_at FROM users WHERE id = $1",
      [userId],
    );
    if (rows.length === 0) throw AppError.notFound();
    return reply.send(rows[0]);
  });

  app.post("/me", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const body = req.body as { username?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (!validUsername(username)) throw AppError.badRequest("invalid_username");

    const { emoji, colorId } = randomAvatar();
    try {
      const { rows } = await ctx.pool.query(
        `INSERT INTO users (id, username, avatar_emoji, avatar_color) VALUES ($1, $2, $3, $4)
         RETURNING id, username, default_deduct_unused, avatar_emoji, avatar_color, created_at`,
        [userId, username, emoji, colorId],
      );
      return reply.status(201).send(rows[0]);
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (err.code === "23505") {
        // id PK collision means the user already onboarded; username index
        // collision means the name is taken.
        if (err.constraint === "users_pkey") throw AppError.conflict("already_registered");
        throw AppError.conflict("username_taken");
      }
      throw e;
    }
  });

  app.patch("/me", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const body = req.body as { avatar_emoji?: unknown; avatar_color?: unknown };
    const emoji = typeof body.avatar_emoji === "string" ? body.avatar_emoji : "";
    const colorId = typeof body.avatar_color === "string" ? body.avatar_color : "";
    if (!isValidAvatarEmoji(emoji) || !isValidAvatarColorId(colorId)) {
      throw AppError.badRequest("invalid_avatar");
    }

    const user = await withTransaction(ctx.pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE users SET avatar_emoji = $1, avatar_color = $2 WHERE id = $3
         RETURNING id, username, default_deduct_unused, avatar_emoji, avatar_color, created_at`,
        [emoji, colorId, userId],
      );
      if (rows.length === 0) throw AppError.notFound();

      // Propagate to games denormalized rows so an opponent's already-open
      // game picks up the change on its next shape sync.
      await client.query(
        "UPDATE games SET creator_avatar_emoji = $1, creator_avatar_color = $2 WHERE creator_id = $3",
        [emoji, colorId, userId],
      );
      await client.query(
        "UPDATE games SET opponent_avatar_emoji = $1, opponent_avatar_color = $2 WHERE opponent_id = $3",
        [emoji, colorId, userId],
      );
      await client.query(
        "UPDATE games SET pending_opponent_avatar_emoji = $1, pending_opponent_avatar_color = $2 WHERE pending_opponent_id = $3",
        [emoji, colorId, userId],
      );
      await client.query(
        "UPDATE friendships SET friend_avatar_emoji = $1, friend_avatar_color = $2 WHERE friend_id = $3",
        [emoji, colorId, userId],
      );

      return rows[0];
    });

    return reply.send(user);
  });

  app.get("/usernames/:username", async (req, reply) => {
    await authenticate(ctx, req);
    const { username } = req.params as { username: string };
    if (!validUsername(username)) {
      return reply.send({ available: false, reason: "invalid" });
    }
    const { rows } = await ctx.pool.query("SELECT 1 FROM users WHERE lower(username) = lower($1)", [username]);
    return reply.send({ available: rows.length === 0 });
  });
}

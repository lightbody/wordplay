// Ported from backend/src/handlers/users.rs.

import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth.js";
import type { AppContext } from "../context.js";
import { AppError } from "../errors.js";

export function validUsername(name: string): boolean {
  const len = Array.from(name).length;
  return len >= 3 && len <= 20 && /^[A-Za-z0-9_]+$/.test(name);
}

export function registerUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/me", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const { rows } = await ctx.pool.query(
      "SELECT id, username, default_deduct_unused, created_at FROM users WHERE id = $1",
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

    try {
      const { rows } = await ctx.pool.query(
        `INSERT INTO users (id, username) VALUES ($1, $2)
         RETURNING id, username, default_deduct_unused, created_at`,
        [userId, username],
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

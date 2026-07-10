// Ported from backend/src/handlers/invites.rs.

import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth.js";
import type { AppContext } from "../context.js";
import { withTransaction } from "../db.js";
import { AppError } from "../errors.js";
import { GAME_COLUMNS, type Game } from "../models.js";
import { sendPush } from "../push.js";
import { alphanumericToken, parseUuidParam } from "../util.js";
import { attachOpponent } from "./games.js";

export function registerInviteRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/games/:id/invites", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const gameId = parseUuidParam(req);

    const { rows } = await ctx.pool.query(`SELECT ${GAME_COLUMNS} FROM games WHERE id = $1`, [gameId]);
    if (rows.length === 0) throw AppError.notFound();
    const game: Game = rows[0];

    if (game.creator_id !== userId) throw AppError.forbidden();
    if (game.opponent_id !== null) throw AppError.conflict("already_has_opponent");

    const token = alphanumericToken(22);
    await ctx.pool.query("INSERT INTO invites (token, game_id, created_by) VALUES ($1, $2, $3)", [
      token,
      gameId,
      userId,
    ]);

    const url = `${ctx.publicAppUrl}/invite/${token}`;
    return reply.status(201).send({ token, url });
  });

  /** Public (unauthenticated) minimal preview for OpenGraph unfurling. */
  app.get("/invites/:token/preview", async (req, reply) => {
    const { token } = req.params as { token: string };

    const inviteRes = await ctx.pool.query(
      "SELECT created_by, game_id FROM invites WHERE token = $1 AND status = 'pending'",
      [token],
    );
    if (inviteRes.rows.length === 0) throw AppError.notFound();
    const { created_by: createdBy, game_id: gameId } = inviteRes.rows[0];

    const userRes = await ctx.pool.query("SELECT username FROM users WHERE id = $1", [createdBy]);
    const inviterUsername = userRes.rows[0].username;

    // First word played in the game, if any (main word of move 1).
    const wordRes = await ctx.pool.query(
      `SELECT words->0->>'word' AS word FROM moves
       WHERE game_id = $1 AND move_type = 'play' ORDER BY move_number ASC LIMIT 1`,
      [gameId],
    );
    const firstWord = wordRes.rows[0]?.word ?? null;

    return reply.send({ inviter_username: inviterUsername, first_word: firstWord });
  });

  app.post("/invites/:token/accept", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const { token } = req.params as { token: string };

    const result = await withTransaction(ctx.pool, async (client) => {
      const inviteRes = await client.query(
        "SELECT game_id, created_by, status, claimed_by FROM invites WHERE token = $1 FOR UPDATE",
        [token],
      );
      if (inviteRes.rows.length === 0) throw AppError.notFound();
      const { game_id: gameId, created_by: createdBy, status, claimed_by: claimedBy } = inviteRes.rows[0];

      // Idempotent: if this caller already claimed it, just return the game.
      if (status === "claimed") {
        if (claimedBy === userId) return { game_id: gameId, notify: null };
        throw AppError.conflict("already_claimed");
      }
      if (status !== "pending") throw AppError.conflict("invite_revoked");
      if (createdBy === userId) throw AppError.conflict("cannot_accept_own_invite");

      const userRes = await client.query("SELECT username FROM users WHERE id = $1", [userId]);
      if (userRes.rows.length === 0) throw AppError.notFound();
      const username = userRes.rows[0].username;

      const gameRes = await client.query(`SELECT ${GAME_COLUMNS} FROM games WHERE id = $1 FOR UPDATE`, [gameId]);
      const game: Game = gameRes.rows[0];
      if (game.opponent_id !== null) throw AppError.conflict("already_has_opponent");

      await attachOpponent(client, game, userId, username);

      await client.query(
        "UPDATE invites SET status = 'claimed', claimed_by = $1, claimed_at = now() WHERE token = $2",
        [userId, token],
      );

      return { game_id: gameId, notify: { creatorId: createdBy as string, joinerUsername: username as string } };
    });

    if (result.notify) {
      await sendPush(ctx.pool, result.notify.creatorId, {
        title: "Wordplay",
        body: `${result.notify.joinerUsername} accepted your invite!`,
        url: `/games/${result.game_id}`,
      });
    }

    return reply.send({ game_id: result.game_id });
  });
}

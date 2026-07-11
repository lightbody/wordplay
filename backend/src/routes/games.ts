// Ported from backend/src/handlers/games.rs.

import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { draw, shuffledBag } from "@wordplay/shared";
import { authenticate } from "../auth.js";
import type { AppContext } from "../context.js";
import { withTransaction } from "../db.js";
import { AppError } from "../errors.js";
import { GAME_COLUMNS, MOVE_COLUMNS, type Game } from "../models.js";
import { parseUuidParam, systemRng } from "../util.js";

interface UserAvatar {
  username: string;
  avatar_emoji: string;
  avatar_color: string;
}

async function loadUsername(ctx: AppContext, userId: string): Promise<UserAvatar> {
  const { rows } = await ctx.pool.query(
    "SELECT username, avatar_emoji, avatar_color FROM users WHERE id = $1",
    [userId],
  );
  if (rows.length === 0) throw AppError.notFound();
  return rows[0] as UserAvatar;
}

/**
 * Link `opponentId` to the game, deal their rack from the bag, activate the
 * game, and set the current turn. Shared by challenge + invite accept.
 * Assumes the caller holds a `FOR UPDATE` lock on the game row.
 */
export async function attachOpponent(
  client: PoolClient,
  game: Game,
  opponentId: string,
  opponentUsername: string,
  opponentEmoji: string,
  opponentColor: string,
): Promise<Game> {
  const bagRes = await client.query("SELECT bag FROM game_secrets WHERE game_id = $1 FOR UPDATE", [game.id]);
  let bag: string = bagRes.rows[0].bag;
  let rack = "";
  [bag, rack] = draw(bag, rack);

  await client.query("INSERT INTO game_players (game_id, user_id, rack) VALUES ($1, $2, $3)", [
    game.id,
    opponentId,
    rack,
  ]);
  await client.query("UPDATE game_secrets SET bag = $1 WHERE game_id = $2", [bag, game.id]);

  // If the creator already played the opening move, it's the opponent's
  // turn; otherwise the creator still owes the opening move.
  const nextPlayer = game.move_count >= 1 ? opponentId : game.creator_id;

  const { rows } = await client.query(
    `UPDATE games SET status = 'active', opponent_id = $1, opponent_username = $2,
         opponent_avatar_emoji = $3, opponent_avatar_color = $4,
         opponent_rack_count = $5, current_player_id = $6,
         tiles_remaining = $7, updated_at = now(),
         pending_opponent_id = NULL, pending_opponent_username = NULL,
         pending_opponent_avatar_emoji = NULL, pending_opponent_avatar_color = NULL
     WHERE id = $8
     RETURNING ${GAME_COLUMNS}`,
    [opponentId, opponentUsername, opponentEmoji, opponentColor, rack.length, nextPlayer, bag.length, game.id],
  );
  return rows[0];
}

export function registerGameRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/games", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const body = req.body as { deduct_unused?: unknown; friend_id?: unknown };
    const deductUnused = body.deduct_unused === true;
    const friendId = typeof body.friend_id === "string" && body.friend_id !== "" ? body.friend_id : null;
    if (friendId === userId) throw AppError.conflict("cannot_play_self");

    const creator = await loadUsername(ctx, userId);

    const rng = systemRng();
    let bag = shuffledBag(rng);
    let rack = "";
    [bag, rack] = draw(bag, rack);
    const tilesRemaining = bag.length;

    const result = await withTransaction(ctx.pool, async (client) => {
      // Serialize per creator (pending-game reuse below must not race with
      // a concurrent create by the same user).
      await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
      // Remember the option as this user's default for next time.
      await client.query("UPDATE users SET default_deduct_unused = $1 WHERE id = $2", [deductUnused, userId]);

      // A friend game may only be started against a current friend; the
      // friendship row also supplies the denormalized pending_* values.
      let friend: { friend_username: string; friend_avatar_emoji: string; friend_avatar_color: string } | null =
        null;
      if (friendId) {
        const fRes = await client.query(
          `SELECT friend_username, friend_avatar_emoji, friend_avatar_color
           FROM friendships WHERE user_id = $1 AND friend_id = $2`,
          [userId, friendId],
        );
        if (fRes.rows.length === 0) throw AppError.conflict("not_friends");
        friend = fRes.rows[0];
      }

      // Opponent-less games are invisible in the UI, so instead of piling up
      // fresh ones (and letting the creator re-roll opening racks), reuse the
      // newest pending game against the same chosen friend — or the newest
      // open (no-friend) one when none was chosen.
      const reuseRes = await client.query(
        `SELECT ${GAME_COLUMNS} FROM games
         WHERE creator_id = $1 AND status = 'awaiting_opponent' AND opponent_id IS NULL
           AND pending_opponent_id IS NOT DISTINCT FROM $2
         ORDER BY updated_at DESC LIMIT 1`,
        [userId, friendId],
      );
      if (reuseRes.rows.length > 0) {
        let game: Game = reuseRes.rows[0];
        if (game.deduct_unused !== deductUnused) {
          const { rows } = await client.query(
            `UPDATE games SET deduct_unused = $1, updated_at = now() WHERE id = $2 RETURNING ${GAME_COLUMNS}`,
            [deductUnused, game.id],
          );
          game = rows[0];
        }
        const rackRes = await client.query(
          "SELECT rack FROM game_players WHERE game_id = $1 AND user_id = $2",
          [game.id, userId],
        );
        return { status: 200, game, rack: rackRes.rows[0].rack as string };
      }

      const { rows } = await client.query(
        `INSERT INTO games (creator_id, creator_username, creator_avatar_emoji, creator_avatar_color,
             pending_opponent_id, pending_opponent_username,
             pending_opponent_avatar_emoji, pending_opponent_avatar_color,
             current_player_id, deduct_unused, tiles_remaining, creator_rack_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $1, $9, $10, $11)
         RETURNING ${GAME_COLUMNS}`,
        [
          userId,
          creator.username,
          creator.avatar_emoji,
          creator.avatar_color,
          friendId,
          friend?.friend_username ?? null,
          friend?.friend_avatar_emoji ?? null,
          friend?.friend_avatar_color ?? null,
          deductUnused,
          tilesRemaining,
          rack.length,
        ],
      );
      const game = rows[0];

      await client.query("INSERT INTO game_secrets (game_id, bag) VALUES ($1, $2)", [game.id, bag]);
      await client.query("INSERT INTO game_players (game_id, user_id, rack) VALUES ($1, $2, $3)", [
        game.id,
        userId,
        rack,
      ]);

      return { status: 201, game, rack };
    });

    return reply.status(result.status).send({ game: result.game, rack: result.rack });
  });

  app.get("/games/:id", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const id = parseUuidParam(req);

    const { rows } = await ctx.pool.query(`SELECT ${GAME_COLUMNS} FROM games WHERE id = $1`, [id]);
    if (rows.length === 0) throw AppError.notFound();
    const game: Game = rows[0];

    if (game.creator_id !== userId && game.opponent_id !== userId) throw AppError.forbidden();

    const rackRes = await ctx.pool.query("SELECT rack FROM game_players WHERE game_id = $1 AND user_id = $2", [
      id,
      userId,
    ]);
    const rack = rackRes.rows[0]?.rack ?? null;

    const movesRes = await ctx.pool.query(
      `SELECT ${MOVE_COLUMNS} FROM moves WHERE game_id = $1 ORDER BY move_number ASC`,
      [id],
    );

    return reply.send({ game, rack, moves: movesRes.rows });
  });

}

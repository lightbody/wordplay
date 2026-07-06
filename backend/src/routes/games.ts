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

async function loadUsername(ctx: AppContext, userId: string): Promise<string> {
  const { rows } = await ctx.pool.query("SELECT username FROM users WHERE id = $1", [userId]);
  if (rows.length === 0) throw AppError.notFound();
  return rows[0].username as string;
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
         opponent_rack_count = $3, current_player_id = $4,
         tiles_remaining = $5, updated_at = now()
     WHERE id = $6
     RETURNING ${GAME_COLUMNS}`,
    [opponentId, opponentUsername, rack.length, nextPlayer, bag.length, game.id],
  );
  return rows[0];
}

export function registerGameRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/games", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const body = req.body as { deduct_unused?: unknown };
    const deductUnused = body.deduct_unused === true;

    const creatorUsername = await loadUsername(ctx, userId);

    const rng = systemRng();
    let bag = shuffledBag(rng);
    let rack = "";
    [bag, rack] = draw(bag, rack);
    const tilesRemaining = bag.length;

    const result = await withTransaction(ctx.pool, async (client) => {
      // Remember the option as this user's default for next time.
      await client.query("UPDATE users SET default_deduct_unused = $1 WHERE id = $2", [deductUnused, userId]);

      const { rows } = await client.query(
        `INSERT INTO games (creator_id, creator_username, current_player_id, deduct_unused,
             tiles_remaining, creator_rack_count)
         VALUES ($1, $2, $1, $3, $4, $5)
         RETURNING ${GAME_COLUMNS}`,
        [userId, creatorUsername, deductUnused, tilesRemaining, rack.length],
      );
      const game = rows[0];

      await client.query("INSERT INTO game_secrets (game_id, bag) VALUES ($1, $2)", [game.id, bag]);
      await client.query("INSERT INTO game_players (game_id, user_id, rack) VALUES ($1, $2, $3)", [
        game.id,
        userId,
        rack,
      ]);

      return { game, rack };
    });

    return reply.status(201).send(result);
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

  app.post("/games/:id/challenge", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const id = parseUuidParam(req);
    const body = req.body as { username?: unknown };
    const username = typeof body.username === "string" ? body.username : "";

    const game = await withTransaction(ctx.pool, async (client) => {
      const { rows } = await client.query(`SELECT ${GAME_COLUMNS} FROM games WHERE id = $1 FOR UPDATE`, [id]);
      if (rows.length === 0) throw AppError.notFound();
      const game: Game = rows[0];

      if (game.creator_id !== userId) throw AppError.forbidden();
      if (game.opponent_id !== null) throw AppError.conflict("already_has_opponent");

      const oppRes = await client.query("SELECT id, username FROM users WHERE lower(username) = lower($1)", [
        username,
      ]);
      if (oppRes.rows.length === 0) throw AppError.notFound();
      const opponent = oppRes.rows[0];

      if (opponent.id === userId) throw AppError.conflict("cannot_challenge_self");

      return attachOpponent(client, game, opponent.id, opponent.username);
    });

    return reply.send(game);
  });
}

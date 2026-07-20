// Nudge: the waiting player pokes the opponent with a push notification.
// Server-enforced cooldowns — the opponent must have been on the clock for
// at least an hour (games.updated_at is bumped by every move and by opponent
// attach, so it is exactly "when the current player went on the clock"), and
// a player may nudge each game at most once every four hours.

import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth.js";
import type { AppContext } from "../context.js";
import { withTransaction } from "../db.js";
import { AppError } from "../errors.js";
import { GAME_COLUMNS, type Game } from "../models.js";
import { sendPush } from "../push.js";
import { parseUuidParam } from "../util.js";

const NUDGE_TURN_IDLE = "1 hour";
const NUDGE_COOLDOWN = "4 hours";
/** A push signal (enable or notification tap) older than this reads as "probably not receiving pushes". */
const PUSH_SIGNAL_STALE = "30 days";

export interface OpponentPush {
  subscriptions: number;
  last_signal_at: string | null;
  likely_receiving: boolean;
}

export function registerNudgeRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/games/:id/nudge", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const id = parseUuidParam(req);

    const result = await withTransaction(ctx.pool, async (client) => {
      const gameRes = await client.query(`SELECT ${GAME_COLUMNS} FROM games WHERE id = $1 FOR UPDATE`, [id]);
      if (gameRes.rows.length === 0) throw AppError.notFound();
      const game: Game = gameRes.rows[0];

      const amCreator = game.creator_id === userId;
      if (!amCreator && game.opponent_id !== userId) throw AppError.forbidden();
      if (game.status !== "active") throw AppError.conflict("game_not_active");
      // Only the player who is waiting may nudge.
      if (game.current_player_id === userId) throw AppError.conflict("your_turn");

      // Cooldown math on Postgres's clock, against the locked row, so
      // concurrent nudges from two devices serialize cleanly.
      const nudgeCol = amCreator ? "creator_last_nudge_at" : "opponent_last_nudge_at";
      const gateRes = await client.query(
        `SELECT now() - updated_at >= interval '${NUDGE_TURN_IDLE}' AS turn_stale,
                (${nudgeCol} IS NULL OR now() - ${nudgeCol} >= interval '${NUDGE_COOLDOWN}') AS off_cooldown
           FROM games WHERE id = $1`,
        [id],
      );
      const gate = gateRes.rows[0];
      if (!gate.turn_stale) throw AppError.tooManyRequests("turn_too_recent");
      if (!gate.off_cooldown) throw AppError.tooManyRequests("nudge_cooldown");

      // Deliberately NOT bumping updated_at: that would reset the one-hour
      // idle clock and reshuffle the game list, and the nudge isn't game
      // activity. Electric syncs the row change regardless.
      const { rows } = await client.query(`UPDATE games SET ${nudgeCol} = now() WHERE id = $1 RETURNING ${GAME_COLUMNS}`, [
        id,
      ]);
      const updated: Game = rows[0];

      // Opponent push health, so the client can offer the share-sheet backup
      // when the nudge probably won't be seen. GREATEST of two NULLs is NULL,
      // which fails the >= comparison, so a never-signaled user reads false.
      const opponentId = (amCreator ? game.opponent_id : game.creator_id) as string;
      const healthRes = await client.query(
        `SELECT (SELECT count(*)::int FROM push_subscriptions WHERE user_id = $1) AS subscriptions,
                GREATEST(push_enabled_at, push_opened_at) AS last_signal_at,
                COALESCE((SELECT count(*) FROM push_subscriptions WHERE user_id = $1) > 0
                  AND GREATEST(push_enabled_at, push_opened_at) >= now() - interval '${PUSH_SIGNAL_STALE}',
                  false) AS likely_receiving
           FROM users WHERE id = $1`,
        [opponentId],
      );
      const health = healthRes.rows[0];
      const opponentPush: OpponentPush = {
        subscriptions: health.subscriptions,
        last_signal_at: health.last_signal_at,
        likely_receiving: health.likely_receiving === true,
      };

      return {
        game: updated,
        opponentId,
        nudgerUsername: amCreator ? game.creator_username : (game.opponent_username ?? ""),
        opponentPush,
      };
    });

    // After commit, like the move handler. sendPush never throws, and the
    // game-<id> tag replaces any stale "X played WORD" notification in place.
    await sendPush(ctx.pool, result.opponentId, {
      title: `${result.nudgerUsername} nudged you`,
      body: "It's your move in your Wordplay game",
      url: `/games/${id}`,
      tag: `game-${id}`,
    });

    return reply.send({ game: result.game, opponent_push: result.opponentPush });
  });
}

// Ported from backend/src/handlers/moves.rs — the most complex handler:
// transaction + row-locking + turn/authorization logic + engine call +
// persistence + endgame finalization.

import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import {
  adjustment,
  draw,
  evaluate,
  NotInRackError,
  RACK_SIZE,
  swapTiles,
  validatePlay,
  winner,
  type EndReason,
  type PlayError,
  type TurnOutcome,
} from "@wordplay/shared";
import { authenticate } from "../auth.js";
import type { AppContext } from "../context.js";
import { withTransaction } from "../db.js";
import { AppError } from "../errors.js";
import { GAME_COLUMNS, MOVE_COLUMNS, parseMoveRequest, type Game, type Move } from "../models.js";
import { sendPush } from "../push.js";
import { parseUuidParam, systemRng } from "../util.js";

async function insertMove(
  client: PoolClient,
  gameId: string,
  userId: string,
  moveNumber: number,
  moveType: string,
  tiles: string | null,
  words: string | null,
  swapCount: number | null,
  score: number,
): Promise<Move> {
  const { rows } = await client.query(
    `INSERT INTO moves (game_id, user_id, move_number, move_type, tiles, words, swap_count, score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${MOVE_COLUMNS}`,
    [gameId, userId, moveNumber, moveType, tiles, words, swapCount, score],
  );
  return rows[0];
}

/** Apply end-game rack deductions (if the option is on) and decide the winner. */
async function finalize(client: PoolClient, id: string, game: Game, reason: EndReason): Promise<Game> {
  const opponentId = game.opponent_id ?? "";

  const creatorRackRes = await client.query("SELECT rack FROM game_players WHERE game_id = $1 AND user_id = $2", [
    id,
    game.creator_id,
  ]);
  const creatorRack: string = creatorRackRes.rows[0].rack;

  const opponentRackRes = await client.query("SELECT rack FROM game_players WHERE game_id = $1 AND user_id = $2", [
    id,
    opponentId,
  ]);
  const opponentRack: string = opponentRackRes.rows[0]?.rack ?? "";

  const creatorAdj = adjustment(game.deduct_unused, creatorRack);
  const opponentAdj = adjustment(game.deduct_unused, opponentRack);

  const scoreRes = await client.query("SELECT creator_score, opponent_score FROM games WHERE id = $1", [id]);
  const creatorScore: number = scoreRes.rows[0].creator_score;
  const opponentScore: number = scoreRes.rows[0].opponent_score;

  const creatorTotal = creatorScore + creatorAdj;
  const opponentTotal = opponentScore + opponentAdj;
  const winnerId = winner(game.creator_id, opponentId, creatorTotal, opponentTotal);

  const { rows } = await client.query(
    `UPDATE games SET status = 'finished', ended_reason = $1, winner_id = $2,
         creator_adjustment = $3, opponent_adjustment = $4,
         current_player_id = NULL, updated_at = now()
     WHERE id = $5 RETURNING ${GAME_COLUMNS}`,
    [reason, winnerId, creatorAdj, opponentAdj, id],
  );
  return rows[0];
}

function playError(e: PlayError): AppError {
  if (e.code === "invalid_words") {
    return AppError.unprocessable("invalid_words", { words: e.words ?? [] });
  }
  return AppError.unprocessable(e.code);
}

export function registerMoveRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/games/:id/moves", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const id = parseUuidParam(req);
    const moveReq = parseMoveRequest(req.body);

    const result = await withTransaction(ctx.pool, async (client) => {
      const gameRes = await client.query(`SELECT ${GAME_COLUMNS} FROM games WHERE id = $1 FOR UPDATE`, [id]);
      if (gameRes.rows.length === 0) throw AppError.notFound();
      const game: Game = gameRes.rows[0];

      const amCreator = game.creator_id === userId;
      const isParticipant = amCreator || game.opponent_id === userId;
      if (!isParticipant) throw AppError.forbidden();

      // The creator may play the opening move while still awaiting an opponent.
      const openingSolo = game.status === "awaiting_opponent" && amCreator && game.opponent_id === null;
      if (game.status !== "active" && !openingSolo) throw AppError.conflict("game_not_active");
      if (game.current_player_id !== userId) throw AppError.conflict("not_your_turn");

      // Opponent id (only meaningful once the game is active).
      const opponentId = amCreator ? game.opponent_id : game.creator_id;

      // --- Resign short-circuits everything (active games only) ---
      if (moveReq.type === "resign") {
        if (openingSolo) throw AppError.conflict("game_not_active");
        const winnerId = opponentId as string;
        const moveNumber = game.move_count + 1;
        await insertMove(client, id, userId, moveNumber, "resign", null, null, null, 0);
        const { rows } = await client.query(
          `UPDATE games SET status = 'finished', ended_reason = 'resigned',
               winner_id = $1, current_player_id = NULL, move_count = $2, updated_at = now()
           WHERE id = $3 RETURNING ${GAME_COLUMNS}`,
          [winnerId, moveNumber, id],
        );
        const finished: Game = rows[0];
        return {
          body: {
            game: finished,
            move: { move_number: finished.move_count, move_type: "resign" },
            game_over: true,
          },
          notify: null,
          moveType: "resign",
          mainWord: null,
          score: 0,
        };
      }

      // Load the mover's secret rack and the bag.
      const rackRes = await client.query("SELECT rack FROM game_players WHERE game_id = $1 AND user_id = $2", [
        id,
        userId,
      ]);
      let rack: string = rackRes.rows[0].rack;
      const bagRes = await client.query("SELECT bag FROM game_secrets WHERE game_id = $1 FOR UPDATE", [id]);
      let bag: string = bagRes.rows[0].bag;

      if (game.board.length !== 225) throw AppError.badRequest("corrupt_board");
      let board = game.board;

      let score = 0;
      let moveScored = false;
      let moveType: string;
      let tilesJson: string | null = null;
      let wordsJson: string | null = null;
      let swapCount: number | null = null;
      let mainWord: string | null = null;

      if (moveReq.type === "play") {
        moveType = "play";
        const outcome = validatePlay(board, rack, moveReq.tiles, ctx.dictionary);
        if ("code" in outcome) throw playError(outcome);
        board = outcome.newBoard;
        rack = outcome.remainingRack;
        [bag, rack] = draw(bag, rack);
        score = outcome.total;
        moveScored = score > 0;
        tilesJson = JSON.stringify(moveReq.tiles);
        wordsJson = JSON.stringify(outcome.words);
        mainWord = outcome.words[0]?.word ?? null;
      } else if (moveReq.type === "swap") {
        moveType = "swap";
        const count = moveReq.letters.length;
        if (count === 0 || count > RACK_SIZE) throw AppError.badRequest("invalid_swap_count");
        // Standard rule: swapping requires a reasonably full bag.
        if (game.tiles_remaining < RACK_SIZE) throw AppError.conflict("bag_too_small_to_swap");
        try {
          [bag, rack] = swapTiles(bag, rack, moveReq.letters, systemRng());
        } catch (e) {
          if (e instanceof NotInRackError) {
            throw AppError.unprocessable("not_in_rack", { letter: e.letter });
          }
          throw e;
        }
        swapCount = count;
      } else {
        moveType = "pass";
      }

      // Resolve the next turn and end-game state. For the opening solo move
      // there is no opponent yet, so the turn passes to nobody (null) and
      // the game stays in awaiting_opponent until someone joins.
      let turn: TurnOutcome;
      if (openingSolo) {
        turn = {
          finalMovesRemaining: game.final_moves_remaining,
          scorelessStreak: moveScored ? 0 : game.scoreless_streak + 1,
          finished: null,
        };
      } else {
        const nextPlayer = opponentId as string;
        const nextRackRes = await client.query(
          "SELECT length(rack) AS len FROM game_players WHERE game_id = $1 AND user_id = $2",
          [id, nextPlayer],
        );
        const nextRackEmpty = nextRackRes.rows[0] ? nextRackRes.rows[0].len === 0 : false;
        turn = evaluate(bag.length === 0, game.final_moves_remaining, game.scoreless_streak, moveScored, nextRackEmpty);
      }

      // Persist the mover's rack and the bag.
      await client.query("UPDATE game_players SET rack = $1, updated_at = now() WHERE game_id = $2 AND user_id = $3", [
        rack,
        id,
        userId,
      ]);
      await client.query("UPDATE game_secrets SET bag = $1 WHERE game_id = $2", [bag, id]);

      const moveNumber = game.move_count + 1;
      const mv = await insertMove(client, id, userId, moveNumber, moveType, tilesJson, wordsJson, swapCount, score);

      // Column names for the mover's score/rack-count.
      const scoreCol = amCreator ? "creator_score" : "opponent_score";
      const rackCol = amCreator ? "creator_rack_count" : "opponent_rack_count";

      // Turn passes to the opponent unless the game just finished, or this
      // was the opening solo move (no opponent to hand off to yet).
      const currentPlayer = turn.finished !== null || openingSolo ? null : opponentId;

      await client.query(
        `UPDATE games SET board = $1, tiles_remaining = $2, ${scoreCol} = ${scoreCol} + $3,
             ${rackCol} = $4, move_count = $5, scoreless_streak = $6,
             final_moves_remaining = $7, current_player_id = $8, updated_at = now()
         WHERE id = $9`,
        [board, bag.length, score, rack.length, moveNumber, turn.scorelessStreak, turn.finalMovesRemaining, currentPlayer, id],
      );

      const gameOver = turn.finished !== null;
      const updated = gameOver ? await finalize(client, id, game, turn.finished as EndReason) : (await client.query(
          `SELECT ${GAME_COLUMNS} FROM games WHERE id = $1`,
          [id],
        )).rows[0];

      // Push notification for the opponent whose turn it now is. Not sent
      // for the opening solo move (no opponent yet) or a move that ends the
      // game (game-over notifications are a separate, not-yet-built thing).
      const notify =
        currentPlayer !== null
          ? { opponentId: currentPlayer, moverUsername: amCreator ? game.creator_username : (game.opponent_username ?? "") }
          : null;

      return { body: { game: updated, move: mv, rack, game_over: gameOver }, notify, moveType, mainWord, score };
    });

    if (result.notify) {
      const { opponentId, moverUsername } = result.notify;
      const body =
        result.moveType === "play" && result.mainWord && result.score > 0
          ? `${moverUsername} played ${result.mainWord} for ${result.score} points — your turn`
          : result.moveType === "swap"
            ? `${moverUsername} swapped tiles — your turn`
            : `${moverUsername} passed — your turn`;
      await sendPush(ctx.pool, opponentId, { title: "Wordplay", body, url: `/games/${id}` });
    }

    return reply.status(201).send(result.body);
  });
}

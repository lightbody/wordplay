// End-of-game rules. Ported from backend/src/engine/endgame.rs.
//
// House rule (per product spec): when the bag empties, each player gets
// exactly one final move, then the game ends. Additionally the standard
// six-consecutive-scoreless-turns rule prevents endless pass loops, and a
// player whose rack is empty with an empty bag can't move, so the game ends
// immediately rather than waiting on them.

import { rackValue } from "./tiles.js";

export const SCORELESS_LIMIT = 6;

export type EndReason = "played_out" | "bag_final_moves" | "scoreless_limit";

export interface TurnOutcome {
  finalMovesRemaining: number | null;
  scorelessStreak: number;
  finished: EndReason | null;
}

/**
 * Evaluate game-continuation state after a (non-resign) move has been
 * applied and replacement tiles drawn.
 *
 * - bagEmpty — bag state after the mover drew replacements
 * - prevFinalMoves — finalMovesRemaining before this move
 * - prevScoreless — scorelessStreak before this move
 * - moveScored — the move was a play that scored more than 0
 * - nextRackEmpty — the player whose turn is next has no tiles
 */
export function evaluate(
  bagEmpty: boolean,
  prevFinalMoves: number | null,
  prevScoreless: number,
  moveScored: boolean,
  nextRackEmpty: boolean,
): TurnOutcome {
  const scorelessStreak = moveScored ? 0 : prevScoreless + 1;

  // A move made while the countdown is running consumes one final move. The
  // move that empties the bag starts the countdown but is not itself a
  // final move.
  const finalMovesRemaining =
    prevFinalMoves !== null ? prevFinalMoves - 1 : bagEmpty ? 2 : null;

  let finished: EndReason | null = null;
  if (finalMovesRemaining === 0) {
    finished = "bag_final_moves";
  } else if (bagEmpty && nextRackEmpty) {
    finished = "played_out";
  } else if (scorelessStreak >= SCORELESS_LIMIT) {
    finished = "scoreless_limit";
  }

  return { finalMovesRemaining, scorelessStreak, finished };
}

/**
 * End-game score adjustment for one player: minus the value of their unused
 * tiles when the option is on, otherwise 0.
 */
export function adjustment(deductUnused: boolean, rack: string): number {
  return deductUnused ? -rackValue(rack) || 0 : 0; // avoid returning -0
}

/** Winner given final (adjusted) totals. `null` = draw. */
export function winner(
  creatorId: string,
  opponentId: string,
  creatorTotal: number,
  opponentTotal: number,
): string | null {
  if (creatorTotal > opponentTotal) return creatorId;
  if (creatorTotal < opponentTotal) return opponentId;
  return null;
}

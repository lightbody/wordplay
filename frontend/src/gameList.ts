// Pure helpers for the game list (DOM-free, unit-tested in gameList.test.ts).

import type { Game } from "./types";

/**
 * Opponent-less games never show in the list — not while the creator owes
 * the opening move (no zombie moveless games), and not after it either
 * (an open game with an outstanding invite link has no identified opponent
 * yet). They surface the moment an opponent is attached.
 */
export function visibleGame(game: Game): boolean {
  return game.status !== "awaiting_opponent";
}

/** The other participant, from my point of view. */
export function opponentIdOf(game: Game, profileId: string): string | null {
  return game.creator_id === profileId ? game.opponent_id : game.creator_id;
}

/**
 * A finished game offers a one-tap rematch when the opponent is still a
 * friend (they always start as one — any completed game forged the
 * friendship — but it may have been revoked since).
 */
export function canRematch(game: Game, profileId: string, friendIds: Set<string>): boolean {
  if (game.status !== "finished") return false;
  const opponentId = opponentIdOf(game, profileId);
  return opponentId !== null && friendIds.has(opponentId);
}

/** How many active games it's currently my turn in -- drives the Home Screen app icon badge. */
export function yourTurnCount(games: Game[], profileId: string): number {
  return games.filter((g) => g.status === "active" && g.current_player_id === profileId).length;
}

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

// --- Nudge eligibility (mirrors the server's POST /games/:id/nudge gates) ---

/** The opponent must have been on the clock at least this long. */
export const NUDGE_TURN_IDLE_MS = 60 * 60 * 1000;
/** Minimum spacing between one player's nudges in the same game. */
export const NUDGE_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * Electric delivers timestamptz in Postgres text form ("2026-07-20
 * 12:34:56.78+00"), REST responses in ISO form — normalize both for
 * Date.parse (insert the T, expand a bare hour offset to hh:mm).
 */
function parseTimestamp(ts: string): number {
  let s = ts.includes("T") ? ts : ts.replace(" ", "T");
  if (/[+-]\d\d$/.test(s)) s = `${s}:00`;
  return Date.parse(s);
}

/**
 * Epoch ms at which I may next nudge this game, or null if the game isn't
 * nudgeable at all (not active / not their turn). games.updated_at is bumped
 * by every move and by opponent attach, so it is "when they went on the
 * clock" — the same clock the server gates on.
 */
export function nudgeAvailableAt(game: Game, profileId: string): number | null {
  if (game.status !== "active") return null;
  if (game.current_player_id === null || game.current_player_id === profileId) return null;
  const idleReady = parseTimestamp(game.updated_at) + NUDGE_TURN_IDLE_MS;
  const myLastNudge = game.creator_id === profileId ? game.creator_last_nudge_at : game.opponent_last_nudge_at;
  const cooldownReady = myLastNudge !== null ? parseTimestamp(myLastNudge) + NUDGE_COOLDOWN_MS : 0;
  return Math.max(idleReady, cooldownReady);
}

/** Cooldown UX is hide-until-allowed: the nudge button renders only when this is true. */
export function canNudge(game: Game, profileId: string, now: number): boolean {
  const at = nudgeAvailableAt(game, profileId);
  return at !== null && at <= now;
}

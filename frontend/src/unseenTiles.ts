// Computes which tiles a player hasn't seen yet: not on the board, and not
// in their own rack. Deliberately client-side only -- the opponent's rack
// is invisible to this player, so "unseen" can only ever mean "could be in
// the bag or in their rack," and must never be resolved by a shared/backend
// computation that would leak which one.

import { DISTRIBUTION } from "@wordplay/shared";

export interface UnseenTileCount {
  letter: string;
  count: number;
}

/**
 * Remaining count per tile (A-Z plus the blank "?"), in distribution order.
 * A blank played on the board (lowercase board cell) or held in the rack
 * ("?") is counted against the "?" bucket, not the letter it represents --
 * it's a physically distinct tile from a non-blank of that letter.
 */
export function unseenTiles(board: string, rack: string): UnseenTileCount[] {
  const seen: Record<string, number> = {};
  for (const ch of board) {
    if (ch === ".") continue;
    const key = ch >= "a" && ch <= "z" ? "?" : ch;
    seen[key] = (seen[key] ?? 0) + 1;
  }
  for (const ch of rack) {
    seen[ch] = (seen[ch] ?? 0) + 1;
  }
  return DISTRIBUTION.map(([letter, total]) => ({
    letter,
    count: Math.max(0, total - (seen[letter] ?? 0)),
  }));
}

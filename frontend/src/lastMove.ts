import type { Move, PlayedWord } from "./types";

/**
 * Among the words formed by a single play, pick the one to name in the
 * "[You|They] played WORD for N points." summary: longest first, then
 * highest-scoring, then alphabetical, so the choice is deterministic
 * regardless of the order the engine extracted main/cross words in.
 */
export function pickBestWord(words: PlayedWord[]): PlayedWord | undefined {
  return [...words].sort(
    (a, b) => b.word.length - a.word.length || b.score - a.score || a.word.localeCompare(b.word),
  )[0];
}

export interface LastMoveSummary {
  mine: boolean;
  word: string;
  points: number;
}

/** Summarizes the most recent move, or undefined if it wasn't a word play. */
export function summarizeLastMove(moves: Move[], myUserId: string): LastMoveSummary | undefined {
  if (moves.length === 0) return undefined;
  const last = moves.reduce((a, b) => (b.move_number > a.move_number ? b : a));
  if (last.move_type !== "play" || !last.words || last.words.length === 0) return undefined;
  const best = pickBestWord(last.words);
  if (!best) return undefined;
  return { mine: last.user_id === myUserId, word: best.word, points: last.score };
}

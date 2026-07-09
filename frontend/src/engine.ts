// Thin wrapper around @wordplay/shared: re-exports the board/premium/scoring
// primitives, keeps overlay() (frontend-only, since PendingTile carries a
// UI-only rackIndex), and adapts shared's dictionary-blind checkStructure
// into the PlacementCheck shape existing callers (GameScreen.tsx) expect.
// Phase C replaces checkPlacement with a dictionary-aware entry point.

import {
  N,
  CENTER,
  applyPlacedTiles,
  cellAt,
  checkStructure,
  isEmpty,
  letterValue,
  premium,
  validatePlay,
  wordText,
  type Dictionary,
  type PlacedTile,
  type Premium,
} from "@wordplay/shared";
import type { PendingTile } from "./types";

export { N, CENTER, premium, letterValue, cellAt, isEmpty };
export type { Premium };

/** Board with pending tiles overlaid (blanks lowercased). */
export function overlay(board: string, pending: PendingTile[]): string {
  const tiles: PlacedTile[] = pending.map((t) => ({ row: t.row, col: t.col, letter: t.letter, blank: t.blank }));
  return applyPlacedTiles(board, tiles);
}

export interface PlacementCheck {
  valid: boolean;
  reason?: string;
  /** Provisional score (no dictionary check). */
  score: number;
  bingo: boolean;
  /** Union of every word's cells (main word + all cross words, including
   * pre-existing anchor tiles), deduplicated -- empty unless the placement
   * is at least structurally valid. */
  wordCells: Array<{ row: number; col: number }>;
}

const STRUCTURAL_REASONS: Record<string, string> = {
  no_tiles: "No tiles placed",
  too_many_tiles: "Too many tiles",
  off_board: "Off the board",
  occupied: "Square already occupied",
  duplicate_position: "Duplicate tile position",
  not_in_rack: "Tile not in rack",
  not_in_line: "Tiles must be in one line",
  gap: "No gaps allowed",
  first_move_must_cover_center: "Opening move must cover the center",
  first_move_too_short: "Opening move needs 2+ tiles",
  not_connected: "Must connect to an existing word",
  no_word_formed: "No word formed",
};

/**
 * Local placement validation mirroring the server's structural rules
 * (single line, contiguity, center/connectivity) and provisional scoring.
 * Does NOT check the dictionary.
 */
export function checkPlacement(board: string, pending: PendingTile[]): PlacementCheck {
  if (pending.length === 0) return { valid: false, score: 0, bingo: false, wordCells: [] };

  const tiles: PlacedTile[] = pending.map((t) => ({ row: t.row, col: t.col, letter: t.letter, blank: t.blank }));
  // GameScreen already enforces "player holds the tile" via the drag source
  // (a PendingTile only exists because it came out of the rack), so satisfy
  // checkStructure's rack check trivially with a rack built from the tiles
  // themselves rather than re-deriving the real rack here.
  const syntheticRack = tiles.map((t) => (t.blank ? "?" : t.letter.toUpperCase())).join("");
  const result = checkStructure(board, syntheticRack, tiles);
  if ("code" in result) {
    return {
      valid: false,
      reason: STRUCTURAL_REASONS[result.code] ?? "Invalid move",
      score: 0,
      bingo: false,
      wordCells: [],
    };
  }

  let total = 0;
  const seen = new Set<string>();
  const wordCells: Array<{ row: number; col: number }> = [];
  for (const w of result.words) {
    total += scoreExtractedWord(w);
    for (const { row, col } of w.cells) {
      const key = `${row},${col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wordCells.push({ row, col });
    }
  }
  const bingo = pending.length === 7;
  if (bingo) total += 50;

  return { valid: true, score: total, bingo, wordCells };
}

function scoreExtractedWord(word: { cells: Array<{ row: number; col: number; cell: string; newlyPlaced: boolean }> }): number {
  let sum = 0;
  let mult = 1;
  for (const { row, col, cell, newlyPlaced } of word.cells) {
    let v = letterValue(cell);
    if (newlyPlaced) {
      switch (premium(row, col)) {
        case "DL":
          v *= 2;
          break;
        case "TL":
          v *= 3;
          break;
        case "DW":
          mult *= 2;
          break;
        case "TW":
          mult *= 3;
          break;
      }
    }
    sum += v;
  }
  return sum * mult;
}

/** Read a word's letters off a board region (for the move log / display). */
export function wordAt(board: string, cells: Array<[number, number]>): string {
  return wordText(board, cells);
}

export interface PlacementResult {
  valid: boolean;
  reason?: string;
  score: number;
  bingo: boolean;
  /** Union of every word's cells (main word + all cross words), deduplicated. */
  wordCells: Array<{ row: number; col: number }>;
}

/**
 * The dictionary-aware placement check: structural rules plus a dictionary
 * lookup for every word formed, via shared's validatePlay. This is the sole
 * placement-checking entry point for GameScreen -- checkPlacement above only
 * remains for the (dictionary-blind) unit tests/harness scenarios that don't
 * need it.
 */
export function checkPlacementWithDictionary(
  board: string,
  rack: string,
  pending: PendingTile[],
  dictionary: Dictionary,
): PlacementResult {
  if (pending.length === 0) return { valid: false, score: 0, bingo: false, wordCells: [] };

  const tiles: PlacedTile[] = pending.map((t) => ({ row: t.row, col: t.col, letter: t.letter, blank: t.blank }));
  const outcome = validatePlay(board, rack, tiles, dictionary);
  if ("code" in outcome) {
    const reason = outcome.code === "invalid_words" ? "Not a valid word" : STRUCTURAL_REASONS[outcome.code];
    return { valid: false, reason: reason ?? "Invalid move", score: 0, bingo: false, wordCells: [] };
  }

  const seen = new Set<string>();
  const wordCells: Array<{ row: number; col: number }> = [];
  for (const word of outcome.wordCells) {
    for (const { row, col } of word.cells) {
      const key = `${row},${col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wordCells.push({ row, col });
    }
  }

  return { valid: true, score: outcome.total, bingo: outcome.bingo, wordCells };
}

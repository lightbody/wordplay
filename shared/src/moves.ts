// Play validation and word extraction. Ported from backend/src/engine/moves.rs.

import { applyPlacedTiles, CENTER, isBlankBoard, isEmpty, cellAt, N } from "./board.js";
import type { PlacedTile } from "./board.js";
import type { Dictionary } from "./dictionary.js";
import { scoreWord, BINGO_BONUS } from "./scoring.js";
import type { WordCell, WordScore } from "./scoring.js";
import { RACK_SIZE } from "./tiles.js";

export type PlayErrorCode =
  | "no_tiles"
  | "too_many_tiles"
  | "off_board"
  | "occupied"
  | "duplicate_position"
  | "not_in_rack"
  | "not_in_line"
  | "gap"
  | "first_move_must_cover_center"
  | "first_move_too_short"
  | "not_connected"
  | "no_word_formed"
  | "invalid_words";

export interface PlayError {
  code: PlayErrorCode;
  row?: number;
  col?: number;
  letter?: string;
  words?: string[];
}

/** A word's cells plus its resolved text. */
export interface ExtractedWord {
  cells: WordCell[];
  text: string;
}

export interface StructuralResult {
  newBoard: string;
  remainingRack: string;
  /** Main word first, then one cross word per placed tile that forms one. */
  words: ExtractedWord[];
}

export interface PlayOutcome {
  newBoard: string;
  /** Rack after removing the played tiles (before drawing replacements). */
  remainingRack: string;
  /** Main word first, then cross words. */
  words: WordScore[];
  wordCells: ExtractedWord[];
  total: number;
  /** True when all 7 rack tiles were placed (earns the 50-pt bonus). */
  bingo: boolean;
}

function err(code: PlayErrorCode, extra?: Partial<PlayError>): PlayError {
  return { code, ...extra };
}

/**
 * Everything except the dictionary lookup: tile-count, bounds, rack-has-
 * letters, same-line, contiguity, first-move/connectivity, and word
 * extraction. Returns extracted words even though they haven't been checked
 * against a dictionary yet.
 */
export function checkStructure(board: string, rack: string, tiles: PlacedTile[]): StructuralResult | PlayError {
  if (tiles.length === 0) return err("no_tiles");
  if (tiles.length > RACK_SIZE) return err("too_many_tiles");

  for (const t of tiles) {
    if (t.row < 0 || t.row >= N || t.col < 0 || t.col >= N || !/^[a-zA-Z]$/.test(t.letter)) {
      return err("off_board");
    }
    if (!isEmpty(board, t.row, t.col)) {
      return err("occupied", { row: t.row, col: t.col });
    }
  }
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i];
      const b = tiles[j];
      if (a.row === b.row && a.col === b.col) {
        return err("duplicate_position", { row: a.row, col: a.col });
      }
    }
  }

  // The player must hold every tile they place (blanks consume '?').
  let remainingRack = rack;
  for (const t of tiles) {
    const needed = t.blank ? "?" : t.letter.toUpperCase();
    const i = remainingRack.indexOf(needed);
    if (i === -1) return err("not_in_rack", { letter: needed });
    remainingRack = remainingRack.slice(0, i) + remainingRack.slice(i + 1);
  }

  // All tiles in one row or one column.
  const sameRow = tiles.every((t) => t.row === tiles[0].row);
  const sameCol = tiles.every((t) => t.col === tiles[0].col);
  if (!sameRow && !sameCol) return err("not_in_line");

  const newBoard = applyPlacedTiles(board, tiles);

  // Orientation: for a single tile, pick whichever axis forms a run.
  const horizontal =
    tiles.length > 1
      ? sameRow
      : hasHorizontalNeighbor(newBoard, tiles[0].row, tiles[0].col);

  // Contiguity: no holes across the placed span (existing tiles fill gaps).
  if (horizontal && sameRow) {
    const row = tiles[0].row;
    const cols = tiles.map((t) => t.col);
    const min = Math.min(...cols);
    const max = Math.max(...cols);
    for (let c = min; c <= max; c++) {
      if (isEmpty(newBoard, row, c)) return err("gap");
    }
  } else if (sameCol) {
    const col = tiles[0].col;
    const rows = tiles.map((t) => t.row);
    const min = Math.min(...rows);
    const max = Math.max(...rows);
    for (let r = min; r <= max; r++) {
      if (isEmpty(newBoard, r, col)) return err("gap");
    }
  }

  const firstMove = isBlankBoard(board);
  if (firstMove) {
    if (tiles.length < 2) return err("first_move_too_short");
    if (!tiles.some((t) => t.row === CENTER && t.col === CENTER)) {
      return err("first_move_must_cover_center");
    }
  } else {
    // Must touch the existing structure: some placed tile orthogonally
    // adjacent to a pre-existing tile (gap-fills are adjacent by
    // construction).
    const touches = tiles.some((t) => {
      const neighbors: Array<[number, number]> = [];
      if (t.row > 0) neighbors.push([t.row - 1, t.col]);
      if (t.row + 1 < N) neighbors.push([t.row + 1, t.col]);
      if (t.col > 0) neighbors.push([t.row, t.col - 1]);
      if (t.col + 1 < N) neighbors.push([t.row, t.col + 1]);
      return neighbors.some(([r, c]) => !isEmpty(board, r, c));
    });
    if (!touches) return err("not_connected");
  }

  // Extract the main word plus a perpendicular cross word per placed tile.
  const placed = tiles.map((t): [number, number] => [t.row, t.col]);
  const isNew = (r: number, c: number) => placed.some(([pr, pc]) => pr === r && pc === c);

  const words: ExtractedWord[] = [];
  const main = extractRun(newBoard, placed[0][0], placed[0][1], horizontal, isNew);
  if (main.length >= 2) words.push({ cells: main, text: wordCellsText(main) });
  for (const [r, c] of placed) {
    const cross = extractRun(newBoard, r, c, !horizontal, isNew);
    if (cross.length >= 2) words.push({ cells: cross, text: wordCellsText(cross) });
  }
  if (words.length === 0) return err("no_word_formed");

  return { newBoard, remainingRack, words };
}

/** Structural check + dictionary check + scoring: the authoritative entry point. */
export function validatePlay(
  board: string,
  rack: string,
  tiles: PlacedTile[],
  dictionary: Dictionary,
): PlayOutcome | PlayError {
  const structural = checkStructure(board, rack, tiles);
  if ("code" in structural) return structural;

  const invalid = structural.words.filter((w) => !dictionary.isWord(w.text)).map((w) => w.text);
  if (invalid.length > 0) return err("invalid_words", { words: invalid });

  const bingo = tiles.length === RACK_SIZE;
  const words: WordScore[] = structural.words.map((w) => ({ word: w.text, score: scoreWord(w.cells) }));
  const total = words.reduce((sum, w) => sum + w.score, 0) + (bingo ? BINGO_BONUS : 0);

  return {
    newBoard: structural.newBoard,
    remainingRack: structural.remainingRack,
    words,
    wordCells: structural.words,
    total,
    bingo,
  };
}

/**
 * Given an already-committed board and the cells of a historical move,
 * re-extract the word-cell groups the move formed (no rack/turn/gap checks —
 * the move is already known-valid) for reconstructing "what words did the
 * last move form" without persisting cell lists server-side.
 */
export function wordCellsForCommittedPlacement(board: string, placedCells: PlacedTile[]): ExtractedWord[] {
  if (placedCells.length === 0) return [];

  const placed = placedCells.map((t): [number, number] => [t.row, t.col]);
  const isNew = (r: number, c: number) => placed.some(([pr, pc]) => pr === r && pc === c);

  const sameRow = placedCells.every((t) => t.row === placedCells[0].row);
  const horizontal =
    placedCells.length > 1 ? sameRow : hasHorizontalNeighbor(board, placedCells[0].row, placedCells[0].col);

  const words: ExtractedWord[] = [];
  const main = extractRun(board, placed[0][0], placed[0][1], horizontal, isNew);
  if (main.length >= 2) words.push({ cells: main, text: wordCellsText(main) });
  for (const [r, c] of placed) {
    const cross = extractRun(board, r, c, !horizontal, isNew);
    if (cross.length >= 2) words.push({ cells: cross, text: wordCellsText(cross) });
  }
  return words;
}

function hasHorizontalNeighbor(board: string, row: number, col: number): boolean {
  return (col > 0 && !isEmpty(board, row, col - 1)) || (col + 1 < N && !isEmpty(board, row, col + 1));
}

/** The maximal run of tiles through (row, col) along one axis. */
function extractRun(
  board: string,
  row: number,
  col: number,
  horizontal: boolean,
  isNew: (r: number, c: number) => boolean,
): WordCell[] {
  let r = row;
  let c = col;
  // Walk back to the start of the run.
  for (;;) {
    const pr = horizontal ? r : r - 1;
    const pc = horizontal ? c - 1 : c;
    if (pr < 0 || pc < 0 || isEmpty(board, pr, pc)) break;
    r = pr;
    c = pc;
  }
  // Walk forward collecting cells.
  const cells: WordCell[] = [];
  for (;;) {
    if (r >= N || c >= N || isEmpty(board, r, c)) break;
    cells.push({ row: r, col: c, cell: cellAt(board, r, c), newlyPlaced: isNew(r, c) });
    if (horizontal) c++;
    else r++;
  }
  return cells;
}

function wordCellsText(cells: WordCell[]): string {
  return cells.map((c) => c.cell.toUpperCase()).join("");
}

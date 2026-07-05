// Client-side mirror of the Rust engine: board codec, premium layout, tile
// values, a local placement checker, and provisional scoring. The server
// remains authoritative (and owns the dictionary); this only powers the
// Play-button state and the live score preview before a move is submitted.

import type { PendingTile } from "./types";

export const N = 15;
export const CENTER = 7;

export type Premium = "" | "DL" | "TL" | "DW" | "TW";

const LAYOUT = [
  "T..d...T...d..T",
  ".D...t...t...D.",
  "..D...d.d...D..",
  "d..D...d...D..d",
  "....D.....D....",
  ".t...t...t...t.",
  "..d...d.d...d..",
  "T..d...D...d..T",
  "..d...d.d...d..",
  ".t...t...t...t.",
  "....D.....D....",
  "d..D...d...D..d",
  "..D...d.d...D..",
  ".D...t...t...D.",
  "T..d...T...d..T",
];

export function premium(row: number, col: number): Premium {
  switch (LAYOUT[row][col]) {
    case "d":
      return "DL";
    case "t":
      return "TL";
    case "D":
      return "DW";
    case "T":
      return "TW";
    default:
      return "";
  }
}

const VALUES: Record<string, number> = {
  A: 1, E: 1, I: 1, O: 1, U: 1, L: 1, N: 1, S: 1, T: 1, R: 1,
  D: 2, G: 2,
  B: 3, C: 3, M: 3, P: 3,
  F: 4, H: 4, V: 4, W: 4, Y: 4,
  K: 5,
  J: 8, X: 8,
  Q: 10, Z: 10,
};

export function letterValue(cell: string): number {
  // Lowercase board cells are blanks (0 points).
  if (cell >= "a" && cell <= "z") return 0;
  return VALUES[cell.toUpperCase()] ?? 0;
}

/** Board char at (row, col): '.' empty, 'A'-'Z' tile, 'a'-'z' blank. */
export function cellAt(board: string, row: number, col: number): string {
  return board[row * N + col];
}

export function isEmpty(board: string, row: number, col: number): boolean {
  return cellAt(board, row, col) === ".";
}

/** Board with pending tiles overlaid (blanks lowercased). */
export function overlay(board: string, pending: PendingTile[]): string {
  const cells = board.split("");
  for (const t of pending) {
    cells[t.row * N + t.col] = t.blank
      ? t.letter.toLowerCase()
      : t.letter.toUpperCase();
  }
  return cells.join("");
}

export interface PlacementCheck {
  valid: boolean;
  reason?: string;
  /** Provisional score (no dictionary check). */
  score: number;
  bingo: boolean;
}

/**
 * Local placement validation mirroring the server's structural rules
 * (single line, contiguity, center/connectivity) and provisional scoring.
 * Does NOT check the dictionary.
 */
export function checkPlacement(board: string, pending: PendingTile[]): PlacementCheck {
  if (pending.length === 0) return { valid: false, score: 0, bingo: false };

  const firstMove = board.split("").every((c) => c === ".");
  const rows = new Set(pending.map((t) => t.row));
  const cols = new Set(pending.map((t) => t.col));
  const sameRow = rows.size === 1;
  const sameCol = cols.size === 1;
  if (!sameRow && !sameCol) return { valid: false, reason: "Tiles must be in one line", score: 0, bingo: false };

  const merged = overlay(board, pending);
  const horizontal =
    pending.length > 1
      ? sameRow
      : hasHorizontalNeighbor(merged, pending[0].row, pending[0].col);

  // Contiguity across the placed span.
  if (horizontal && sameRow) {
    const row = pending[0].row;
    const cs = pending.map((t) => t.col);
    for (let c = Math.min(...cs); c <= Math.max(...cs); c++) {
      if (isEmpty(merged, row, c)) return { valid: false, reason: "No gaps allowed", score: 0, bingo: false };
    }
  } else if (sameCol) {
    const col = pending[0].col;
    const rs = pending.map((t) => t.row);
    for (let r = Math.min(...rs); r <= Math.max(...rs); r++) {
      if (isEmpty(merged, r, col)) return { valid: false, reason: "No gaps allowed", score: 0, bingo: false };
    }
  }

  if (firstMove) {
    if (pending.length < 2) return { valid: false, reason: "Opening move needs 2+ tiles", score: 0, bingo: false };
    if (!pending.some((t) => t.row === CENTER && t.col === CENTER))
      return { valid: false, reason: "Opening move must cover the center", score: 0, bingo: false };
  } else if (!connectsToBoard(board, pending)) {
    return { valid: false, reason: "Must connect to an existing word", score: 0, bingo: false };
  }

  const placed = new Set(pending.map((t) => `${t.row},${t.col}`));
  const isNew = (r: number, c: number) => placed.has(`${r},${c}`);

  const words: Array<Array<[number, number]>> = [];
  const main = run(merged, pending[0].row, pending[0].col, horizontal);
  if (main.length >= 2) words.push(main);
  for (const t of pending) {
    const cross = run(merged, t.row, t.col, !horizontal);
    if (cross.length >= 2) words.push(cross);
  }
  if (words.length === 0) return { valid: false, reason: "No word formed", score: 0, bingo: false };

  let total = 0;
  for (const cells of words) total += scoreWord(merged, cells, isNew);
  const bingo = pending.length === 7;
  if (bingo) total += 50;

  return { valid: true, score: total, bingo };
}

function hasHorizontalNeighbor(board: string, row: number, col: number): boolean {
  return (
    (col > 0 && !isEmpty(board, row, col - 1)) ||
    (col + 1 < N && !isEmpty(board, row, col + 1))
  );
}

function connectsToBoard(board: string, pending: PendingTile[]): boolean {
  return pending.some((t) => {
    const nb: Array<[number, number]> = [];
    if (t.row > 0) nb.push([t.row - 1, t.col]);
    if (t.row + 1 < N) nb.push([t.row + 1, t.col]);
    if (t.col > 0) nb.push([t.row, t.col - 1]);
    if (t.col + 1 < N) nb.push([t.row, t.col + 1]);
    return nb.some(([r, c]) => !isEmpty(board, r, c));
  });
}

function run(board: string, row: number, col: number, horizontal: boolean): Array<[number, number]> {
  let r = row;
  let c = col;
  // Walk back to the start.
  for (;;) {
    const pr = horizontal ? r : r - 1;
    const pc = horizontal ? c - 1 : c;
    if (pr < 0 || pc < 0 || isEmpty(board, pr, pc)) break;
    r = pr;
    c = pc;
  }
  const cells: Array<[number, number]> = [];
  for (;;) {
    if (r >= N || c >= N || isEmpty(board, r, c)) break;
    cells.push([r, c]);
    if (horizontal) c++;
    else r++;
  }
  return cells;
}

function scoreWord(
  board: string,
  cells: Array<[number, number]>,
  isNew: (r: number, c: number) => boolean,
): number {
  let sum = 0;
  let mult = 1;
  for (const [r, c] of cells) {
    let v = letterValue(cellAt(board, r, c));
    if (isNew(r, c)) {
      switch (premium(r, c)) {
        case "DL": v *= 2; break;
        case "TL": v *= 3; break;
        case "DW": mult *= 2; break;
        case "TW": mult *= 3; break;
      }
    }
    sum += v;
  }
  return sum * mult;
}

/** Read a word's letters off a board region (for the move log / display). */
export function wordAt(board: string, cells: Array<[number, number]>): string {
  return cells.map(([r, c]) => cellAt(board, r, c).toUpperCase()).join("");
}

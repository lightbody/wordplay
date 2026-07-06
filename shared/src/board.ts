// The 15x15 board: premium-square layout and the board string codec.
// Ported from backend/src/engine/board.rs.

export const N = 15;
export const CENTER = 7;

export type Premium = "" | "DL" | "TL" | "DW" | "TW";

// Standard Scrabble premium layout. T = triple word, D = double word
// (center star included), t = triple letter, d = double letter.
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

/** Board char at (row, col): '.' empty, 'A'-'Z' tile, 'a'-'z' blank. */
export function cellAt(board: string, row: number, col: number): string {
  return board[row * N + col];
}

export function isEmpty(board: string, row: number, col: number): boolean {
  return cellAt(board, row, col) === ".";
}

export function isBlankBoard(board: string): boolean {
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== ".") return false;
  }
  return true;
}

export interface PlacedTile {
  row: number;
  col: number;
  /** The letter the tile reads as, A-Z. For a blank this is the letter the player assigned to it. */
  letter: string;
  blank?: boolean;
}

/** Board with tiles overlaid: uppercase for normal tiles, lowercase for blanks. */
export function applyPlacedTiles(board: string, tiles: PlacedTile[]): string {
  const cells = board.split("");
  for (const t of tiles) {
    cells[t.row * N + t.col] = t.blank ? t.letter.toLowerCase() : t.letter.toUpperCase();
  }
  return cells.join("");
}

/** Read a word's letters off a board region (for the move log / display). */
export function wordText(board: string, cells: Array<[number, number]>): string {
  return cells.map(([r, c]) => cellAt(board, r, c).toUpperCase()).join("");
}

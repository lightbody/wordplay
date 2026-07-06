// Word scoring. Premiums count only under newly placed tiles; letter
// premiums apply to the letter, word premiums multiply the whole word and
// stack with each other. A blank (lowercase board cell) is worth 0.
// Ported from backend/src/engine/scoring.rs.

import { premium } from "./board.js";
import { letterValue } from "./tiles.js";

export const BINGO_BONUS = 50;

export interface WordScore {
  word: string;
  score: number;
}

/** One cell of an extracted word. `cell` is the board character (letter, lowercase for a blank). */
export interface WordCell {
  row: number;
  col: number;
  cell: string;
  newlyPlaced: boolean;
}

export function scoreWord(cells: WordCell[]): number {
  let sum = 0;
  let multiplier = 1;
  for (const { row, col, cell, newlyPlaced } of cells) {
    let value = letterValue(cell);
    if (newlyPlaced) {
      switch (premium(row, col)) {
        case "DL":
          value *= 2;
          break;
        case "TL":
          value *= 3;
          break;
        case "DW":
          multiplier *= 2;
          break;
        case "TW":
          multiplier *= 3;
          break;
      }
    }
    sum += value;
  }
  return sum * multiplier;
}

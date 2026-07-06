import { describe, expect, it } from "vitest";
import { scoreWord, type WordCell } from "./scoring.js";

describe("scoreWord", () => {
  it("applies letter premiums only to newly placed tiles", () => {
    // T(6,6) placed on a DL, E(7,6) pre-existing, A(8,6) placed on a DL: TEA.
    const cells: WordCell[] = [
      { row: 6, col: 6, cell: "T", newlyPlaced: true },
      { row: 7, col: 6, cell: "E", newlyPlaced: false },
      { row: 8, col: 6, cell: "A", newlyPlaced: true },
    ];
    expect(scoreWord(cells)).toBe(5); // (1x2) + 1 + (1x2)
  });

  it("multiplies the whole word for a triple-word premium", () => {
    const cells: WordCell[] = [
      { row: 0, col: 0, cell: "B", newlyPlaced: true }, // TW
      { row: 1, col: 0, cell: "E", newlyPlaced: false },
      { row: 2, col: 0, cell: "A", newlyPlaced: false },
      { row: 3, col: 0, cell: "R", newlyPlaced: false },
    ];
    expect(scoreWord(cells)).toBe(18); // (3+1+1+1) x 3
  });

  it("scores blanks as zero", () => {
    const cells: WordCell[] = [
      { row: 7, col: 7, cell: "J", newlyPlaced: true },
      { row: 7, col: 8, cell: "o", newlyPlaced: true }, // blank
    ];
    expect(scoreWord(cells)).toBe(16); // (8+0) x 2 for the center DW
  });
});

import { describe, expect, it } from "vitest";
import { CENTER, N, applyPlacedTiles, cellAt, isEmpty, premium, wordText } from "./board.js";

describe("premium layout", () => {
  it("is four-fold symmetric", () => {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const p = premium(r, c);
        expect(premium(N - 1 - r, c)).toBe(p);
        expect(premium(r, N - 1 - c)).toBe(p);
        expect(premium(c, r)).toBe(p);
      }
    }
  });

  it("matches the standard board's premium counts", () => {
    let tw = 0;
    let dw = 0;
    let tl = 0;
    let dl = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        switch (premium(r, c)) {
          case "TW":
            tw++;
            break;
          case "DW":
            dw++;
            break;
          case "TL":
            tl++;
            break;
          case "DL":
            dl++;
            break;
        }
      }
    }
    expect([tw, dw, tl, dl]).toEqual([8, 17, 12, 24]); // DW includes center
  });

  it("has a double-word center", () => {
    expect(premium(CENTER, CENTER)).toBe("DW");
  });
});

describe("board string codec", () => {
  const EMPTY = ".".repeat(N * N);

  it("reads cells and blanks correctly", () => {
    const board = applyPlacedTiles(EMPTY, [
      { row: 7, col: 7, letter: "Q" },
      { row: 7, col: 8, letter: "i", blank: true },
    ]);
    expect(cellAt(board, 7, 7)).toBe("Q");
    expect(cellAt(board, 7, 8)).toBe("i"); // stored lowercase
    expect(isEmpty(board, 0, 0)).toBe(true);
    expect(isEmpty(board, 7, 7)).toBe(false);
  });

  it("does not mutate the input board", () => {
    const before = EMPTY;
    applyPlacedTiles(EMPTY, [{ row: 0, col: 0, letter: "A" }]);
    expect(before).toBe(EMPTY);
  });

  it("reads a word's text off a region", () => {
    const board = applyPlacedTiles(EMPTY, [
      { row: 7, col: 5, letter: "H" },
      { row: 7, col: 6, letter: "E" },
      { row: 7, col: 7, letter: "L" },
      { row: 7, col: 8, letter: "L" },
      { row: 7, col: 9, letter: "O" },
    ]);
    const cells: Array<[number, number]> = [
      [7, 5],
      [7, 6],
      [7, 7],
      [7, 8],
      [7, 9],
    ];
    expect(wordText(board, cells)).toBe("HELLO");
  });
});

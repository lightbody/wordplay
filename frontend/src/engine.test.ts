import { describe, expect, it } from "vitest";
import { checkPlacement, N, premium } from "./engine";
import type { PendingTile } from "./types";

const EMPTY = ".".repeat(N * N);

function withWord(board: string, row: number, startCol: number, word: string): string {
  const cells = board.split("");
  for (let i = 0; i < word.length; i++) cells[row * N + startCol + i] = word[i];
  return cells.join("");
}

function tile(row: number, col: number, letter: string, blank = false, rackIndex = 0): PendingTile {
  return { row, col, letter, blank, rackIndex };
}

describe("premium layout", () => {
  it("is symmetric and has a center double-word", () => {
    expect(premium(7, 7)).toBe("DW");
    expect(premium(0, 0)).toBe("TW");
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) expect(premium(r, c)).toBe(premium(c, r));
  });
});

describe("placement checking (mirrors the server structural rules)", () => {
  it("scores a first move through the center with the double-word", () => {
    const res = checkPlacement(EMPTY, [
      tile(7, 5, "H"), tile(7, 6, "E"), tile(7, 7, "L"), tile(7, 8, "L"), tile(7, 9, "O"),
    ]);
    expect(res.valid).toBe(true);
    expect(res.score).toBe(16); // (4+1+1+1+1) x 2
  });

  it("rejects a first move that misses the center", () => {
    const res = checkPlacement(EMPTY, [tile(0, 0, "H"), tile(0, 1, "I")]);
    expect(res.valid).toBe(false);
  });

  it("rejects tiles not in a single line", () => {
    const res = checkPlacement(EMPTY, [tile(7, 7, "H"), tile(8, 8, "I")]);
    expect(res.valid).toBe(false);
  });

  it("awards the 50-point bingo for seven tiles", () => {
    const tiles = "AIRLINE".split("").map((l, i) => tile(7, 4 + i, l, false, i));
    const res = checkPlacement(EMPTY, tiles);
    expect(res.bingo).toBe(true);
    expect(res.score).toBe(64); // 7 x 2 (center) + 50
  });

  it("scores main and cross words on a parallel play", () => {
    const board = withWord(EMPTY, 7, 5, "HELLO");
    const res = checkPlacement(board, [tile(8, 5, "A"), tile(8, 6, "S")]);
    expect(res.valid).toBe(true);
    expect(res.score).toBe(11); // AS(3) + HA(5) + ES(3)
  });

  it("blanks score zero but complete the word", () => {
    const res = checkPlacement(EMPTY, [tile(7, 7, "J"), tile(7, 8, "O", true)]);
    expect(res.valid).toBe(true);
    expect(res.score).toBe(16); // (8+0) x 2
  });
});

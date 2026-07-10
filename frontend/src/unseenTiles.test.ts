import { describe, expect, it } from "vitest";
import { N } from "./engine";
import { unseenTiles } from "./unseenTiles";

const EMPTY = ".".repeat(N * N);

function withWord(board: string, row: number, startCol: number, word: string): string {
  const cells = board.split("");
  for (let i = 0; i < word.length; i++) cells[row * N + startCol + i] = word[i];
  return cells.join("");
}

describe("unseenTiles", () => {
  it("with an empty board and empty rack, matches the full distribution", () => {
    const counts = unseenTiles(EMPTY, "");
    expect(counts.find((c) => c.letter === "A")?.count).toBe(9);
    expect(counts.find((c) => c.letter === "Z")?.count).toBe(1);
    expect(counts.find((c) => c.letter === "?")?.count).toBe(2);
    expect(counts.reduce((sum, c) => sum + c.count, 0)).toBe(100);
  });

  it("subtracts tiles on the board", () => {
    const board = withWord(EMPTY, 7, 7, "CAT");
    const counts = unseenTiles(board, "");
    expect(counts.find((c) => c.letter === "C")?.count).toBe(1);
    expect(counts.find((c) => c.letter === "A")?.count).toBe(8);
    expect(counts.find((c) => c.letter === "T")?.count).toBe(5);
  });

  it("subtracts tiles in the rack", () => {
    const counts = unseenTiles(EMPTY, "CARDESK");
    for (const letter of "CARDESK") {
      const expected = letter === "C" ? 1 : letter === "A" ? 8 : letter === "R" ? 5 : letter === "D" ? 3
        : letter === "E" ? 11 : letter === "S" ? 3 : 0; // K
      expect(counts.find((c) => c.letter === letter)?.count).toBe(expected);
    }
  });

  it("a blank played on the board decrements the '?' bucket, not the letter's", () => {
    const board = withWord(EMPTY, 7, 7, "c"); // lowercase = blank played as C
    const counts = unseenTiles(board, "");
    expect(counts.find((c) => c.letter === "C")?.count).toBe(2);
    expect(counts.find((c) => c.letter === "?")?.count).toBe(1);
  });

  it("a blank held in the rack decrements the '?' bucket", () => {
    const counts = unseenTiles(EMPTY, "A?");
    expect(counts.find((c) => c.letter === "A")?.count).toBe(8);
    expect(counts.find((c) => c.letter === "?")?.count).toBe(1);
  });

  it("never goes negative", () => {
    const board = withWord(EMPTY, 0, 0, "Z"); // only 1 Z exists
    const counts = unseenTiles(board, "Z");
    expect(counts.find((c) => c.letter === "Z")?.count).toBe(0);
  });
});

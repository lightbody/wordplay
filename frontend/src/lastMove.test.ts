import { describe, expect, it } from "vitest";
import { pickBestWord, summarizeLastMove } from "./lastMove";
import type { Move } from "./types";

function move(overrides: Partial<Move>): Move {
  return {
    id: "m1",
    game_id: "g1",
    user_id: "me",
    move_number: 1,
    move_type: "play",
    tiles: [],
    words: [],
    swap_count: null,
    score: 0,
    created_at: "",
    ...overrides,
  };
}

describe("pickBestWord", () => {
  it("prefers the longest word", () => {
    const best = pickBestWord([
      { word: "AX", score: 9 },
      { word: "TAXES", score: 8 },
    ]);
    expect(best?.word).toBe("TAXES");
  });

  it("tiebreaks equal length by score", () => {
    const best = pickBestWord([
      { word: "CATS", score: 5 },
      { word: "DOGS", score: 9 },
    ]);
    expect(best?.word).toBe("DOGS");
  });

  it("tiebreaks equal length and score alphabetically", () => {
    const best = pickBestWord([
      { word: "ZEBRA", score: 6 },
      { word: "APPLE", score: 6 },
    ]);
    expect(best?.word).toBe("APPLE");
  });
});

describe("summarizeLastMove", () => {
  it("returns undefined with no moves", () => {
    expect(summarizeLastMove([], "me")).toBeUndefined();
  });

  it("summarizes the highest move_number play as mine", () => {
    const moves = [
      move({ move_number: 1, user_id: "me", score: 10, words: [{ word: "HI", score: 10 }] }),
      move({ move_number: 2, user_id: "them", score: 24, words: [{ word: "QUIZ", score: 24 }] }),
    ];
    expect(summarizeLastMove(moves, "me")).toEqual({ mine: false, word: "QUIZ", points: 24 });
  });

  it("picks the best word among multiple formed in one play", () => {
    const moves = [
      move({
        move_number: 3,
        user_id: "me",
        score: 15,
        words: [
          { word: "AT", score: 4 },
          { word: "CATS", score: 11 },
        ],
      }),
    ];
    expect(summarizeLastMove(moves, "me")).toEqual({ mine: true, word: "CATS", points: 15 });
  });

  it("returns undefined when the last move was a swap/pass/resign", () => {
    const moves = [
      move({ move_number: 1, words: [{ word: "HI", score: 10 }] }),
      move({ move_number: 2, move_type: "swap", words: null, score: 0 }),
    ];
    expect(summarizeLastMove(moves, "me")).toBeUndefined();
  });
});

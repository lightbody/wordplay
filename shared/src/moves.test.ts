// Literal transcription of backend/src/engine/play_tests.rs's ASCII-board
// fixtures — the golden parity suite for validatePlay/checkStructure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { N } from "./board.js";
import { loadDictionaryFromText } from "./dictionary.js";
import { validatePlay, type PlacedTile, type PlayOutcome } from "./moves.js";

const nwl2023TxtPath = fileURLToPath(new URL("../assets/nwl2023.txt", import.meta.url));
const dictionary = loadDictionaryFromText(readFileSync(nwl2023TxtPath, "utf8"));

/** Build a board from 15 rows of 15 chars ('.' = empty). */
function board(rows: string[]): string {
  const s = rows.join("");
  if (s.length !== N * N) throw new Error("invalid fixture board");
  return s;
}

function empty(): string {
  return ".".repeat(N * N);
}

function t(row: number, col: number, letter: string): PlacedTile {
  return { row, col, letter, blank: false };
}

function tb(row: number, col: number, letter: string): PlacedTile {
  return { row, col, letter, blank: true };
}

/** A board with HELLO played across row 7, columns 5-9 (through center). */
function helloBoard(): string {
  return board([
    "...............",
    "...............",
    "...............",
    "...............",
    "...............",
    "...............",
    "...............",
    ".....HELLO.....",
    "...............",
    "...............",
    "...............",
    "...............",
    "...............",
    "...............",
    "...............",
  ]);
}

function play(b: string, rack: string, tiles: PlacedTile[]): PlayOutcome {
  const out = validatePlay(b, rack, tiles, dictionary);
  if ("code" in out) throw new Error(`expected success, got error ${out.code}`);
  return out;
}

function playErr(b: string, rack: string, tiles: PlacedTile[]) {
  const out = validatePlay(b, rack, tiles, dictionary);
  if (!("code" in out)) throw new Error("expected an error, got success");
  return out;
}

// --- first-move rules ---

describe("first-move rules", () => {
  it("first move through center scores double word", () => {
    const tiles = [t(7, 5, "H"), t(7, 6, "E"), t(7, 7, "L"), t(7, 8, "L"), t(7, 9, "O")];
    const out = play(empty(), "HELLOXY", tiles);
    expect(out.words.length).toBe(1);
    expect(out.words[0].word).toBe("HELLO");
    expect(out.total).toBe(16); // (4+1+1+1+1) x 2 for the center DW
    expect(out.bingo).toBe(false);
    expect(out.remainingRack).toBe("XY");
  });

  it("first move must cover center", () => {
    const tiles = [t(0, 0, "H"), t(0, 1, "I")];
    expect(playErr(empty(), "HI", tiles).code).toBe("first_move_must_cover_center");
  });

  it("first move needs at least two tiles", () => {
    const tiles = [t(7, 7, "A")];
    expect(playErr(empty(), "A", tiles).code).toBe("first_move_too_short");
  });
});

// --- placement rules ---

describe("placement rules", () => {
  it("tiles must share a line", () => {
    const tiles = [t(7, 7, "H"), t(8, 8, "I")];
    expect(playErr(empty(), "HI", tiles).code).toBe("not_in_line");
  });

  it("gaps are rejected", () => {
    const tiles = [t(7, 6, "H"), t(7, 9, "I")];
    expect(playErr(empty(), "HI", tiles).code).toBe("gap");
  });

  it("existing tiles fill gaps", () => {
    // T + A around the existing E of HELLO: TEA vertically at column 6.
    const tiles = [t(6, 6, "T"), t(8, 6, "A")];
    const out = play(helloBoard(), "TAZ", tiles);
    expect(out.words.length).toBe(1);
    expect(out.words[0].word).toBe("TEA");
    // (6,6) and (8,6) are both DL: (1x2) + 1 + (1x2) = 5
    expect(out.total).toBe(5);
  });

  it("occupied squares are rejected", () => {
    const tiles = [t(7, 7, "A"), t(7, 6, "B")];
    const e = playErr(helloBoard(), "AB", tiles);
    expect(e.code).toBe("occupied");
    expect(e.row).toBe(7);
    expect(e.col).toBe(7);
  });

  it("duplicate positions are rejected", () => {
    const tiles = [t(3, 3, "A"), t(3, 3, "B")];
    const e = playErr(helloBoard(), "AB", tiles);
    expect(e.code).toBe("duplicate_position");
    expect(e.row).toBe(3);
    expect(e.col).toBe(3);
  });

  it("off board is rejected", () => {
    const tiles = [t(7, 14, "A"), t(7, 15, "B")];
    expect(playErr(helloBoard(), "AB", tiles).code).toBe("off_board");
  });

  it("moves must connect to existing tiles", () => {
    const tiles = [t(0, 0, "H"), t(0, 1, "I")];
    expect(playErr(helloBoard(), "HI", tiles).code).toBe("not_connected");
  });

  it("player must hold the tiles", () => {
    const tiles = [t(7, 10, "S")];
    const e = playErr(helloBoard(), "ABC", tiles);
    expect(e.code).toBe("not_in_rack");
    expect(e.letter).toBe("S");
  });
});

// --- word extraction & dictionary ---

describe("word extraction & dictionary", () => {
  it("extending a word rescores it without old premiums", () => {
    // HELLO -> HELLOS; the center DW under the existing L must not re-apply.
    const tiles = [t(7, 10, "S")];
    const out = play(helloBoard(), "S", tiles);
    expect(out.words.length).toBe(1);
    expect(out.words[0].word).toBe("HELLOS");
    expect(out.total).toBe(9); // 4+1+1+1+1+1, no multipliers
  });

  it("invalid words are all reported", () => {
    const tiles = [t(7, 7, "Z"), t(7, 8, "Q")];
    const e = playErr(empty(), "ZQ", tiles);
    expect(e.code).toBe("invalid_words");
    expect(e.words).toEqual(["ZQ"]);
  });

  it("parallel play scores main and cross words", () => {
    // AS under HELLO's H/E: main AS, crosses HA and ES.
    const tiles = [t(8, 5, "A"), t(8, 6, "S")];
    const out = play(helloBoard(), "AS", tiles);
    const words = out.words.map((w) => [w.word, w.score]);
    // Main word first, then crosses in placement order.
    // (8,6) is DL, so S doubles in both AS and ES.
    expect(words).toEqual([
      ["AS", 3],
      ["HA", 5],
      ["ES", 3],
    ]);
    expect(out.total).toBe(11);
  });

  it("single tile can form two words", () => {
    // HELLO across row 7 cols 4-8, A below the H. Placing S at (8,5)
    // makes AS (main, horizontal) and ES (cross, vertical).
    const b = board([
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "....HELLO......",
      "....A..........",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
    ]);
    const tiles = [t(8, 5, "S")];
    const out = play(b, "S", tiles);
    expect(out.words.map((w) => w.word)).toEqual(["AS", "ES"]);
    expect(out.total).toBe(4);
  });
});

// --- premiums ---

describe("premiums", () => {
  it("triple word multiplies the whole word", () => {
    // EAR down column 0, rows 1-3; B at (0,0) makes BEAR from the TW corner.
    const b = board([
      "...............",
      "E..............",
      "A..............",
      "R..............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
    ]);
    const tiles = [t(0, 0, "B")];
    const out = play(b, "B", tiles);
    expect(out.words[0].word).toBe("BEAR");
    expect(out.total).toBe(18); // (3+1+1+1) x 3
  });

  it("covered premiums do not reapply", () => {
    // TEA down column 7 through the center DW; YES through its E must not
    // get the center multiplier.
    const b = board([
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      ".......T.......",
      ".......E.......",
      ".......A.......",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
      "...............",
    ]);
    const tiles = [t(7, 6, "Y"), t(7, 8, "S")];
    const out = play(b, "YS", tiles);
    expect(out.words[0].word).toBe("YES");
    expect(out.total).toBe(6); // 4+1+1, center DW already covered
  });

  it("seven tile play earns the bingo bonus", () => {
    const word = "AIRLINE";
    const tiles: PlacedTile[] = word.split("").map((letter, i) => t(7, 4 + i, letter));
    const out = play(empty(), "AIRLINE", tiles);
    expect(out.bingo).toBe(true);
    expect(out.total).toBe(64); // 7 x 2 (center DW) + 50
    expect(out.remainingRack).toBe("");
  });
});

// --- blanks ---

describe("blanks", () => {
  it("blank scores zero but completes the word", () => {
    // JO with a blank as the O.
    const tiles = [t(7, 7, "J"), tb(7, 8, "O")];
    const out = play(empty(), "J?", tiles);
    expect(out.words[0].word).toBe("JO");
    expect(out.total).toBe(16); // (8+0) x 2 for the center DW
    expect(out.remainingRack).toBe("");
    expect(out.newBoard[7 * N + 8]).toBe("o"); // stored lowercase
  });

  it("playing a blank requires holding one", () => {
    const tiles = [t(7, 7, "J"), tb(7, 8, "O")];
    const e = playErr(empty(), "JO", tiles);
    expect(e.code).toBe("not_in_rack");
    expect(e.letter).toBe("?");
  });
});

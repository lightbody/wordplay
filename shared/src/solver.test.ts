import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isEmpty, N } from "./board.js";
import type { PlacedTile } from "./board.js";
import { createDictionary, loadDictionaryFromText } from "./dictionary.js";
import type { Dictionary } from "./dictionary.js";
import { validatePlay } from "./moves.js";
import { findTopMoves, ratePlay } from "./solver.js";
import type { SolvedMove } from "./solver.js";
import { seededRng } from "./tiles.js";
import { buildTrie, buildTrieFromText } from "./trie.js";

const nwl2023TxtPath = fileURLToPath(new URL("../assets/nwl2023.txt", import.meta.url));
const nwl2023Text = readFileSync(nwl2023TxtPath, "utf8");
const nwl2023Dictionary = loadDictionaryFromText(nwl2023Text);
const nwl2023Trie = buildTrieFromText(nwl2023Text);

// A small closed word list over the alphabet ABCENOST, shared by the solver
// trie and the brute-force oracle so the two judge identically.
const MINI_WORDS = [
  "AT", "TA", "AN", "NA", "NO", "ON", "TO", "OAT", "EAT", "TEA", "ATE", "ETA",
  "NET", "TEN", "NOT", "TON", "ONE", "EON", "CAT", "CATS", "SCAT", "CAST",
  "ACTS", "ACT", "BAT", "TAB", "CAB", "BET", "BEN", "NAB", "BAN", "NOTE",
  "TONE", "CANE", "OCEAN", "CANOE", "BEAT", "BEAN", "BONE", "CENT", "ONCE",
  "SCENT", "STONE", "NOTES", "ONSET", "OCTANES",
];
const MINI_ALPHABET = "ABCENOST";
const miniDictionary = createDictionary(MINI_WORDS);
const miniTrie = buildTrie(MINI_WORDS);

function emptyBoard(): string {
  return ".".repeat(N * N);
}

function board(rows: string[]): string {
  const s = rows.join("");
  if (s.length !== N * N) throw new Error("invalid fixture board");
  return s;
}

// --- brute-force oracle: every legal play by exhaustive enumeration ---

interface SeqTile {
  letter: string;
  blank: boolean;
}

/** Every ordered sequence of 1..all rack tiles, blanks expanded over `alphabet`. */
function rackSequences(rack: string, alphabet: string): SeqTile[][] {
  const chars = rack.split("");
  const used = new Array<boolean>(chars.length).fill(false);
  const out: SeqTile[][] = [];
  const seen = new Set<string>();
  const seq: SeqTile[] = [];

  const emit = (): void => {
    const key = seq.map((t) => `${t.letter}${t.blank ? "?" : ""}`).join(",");
    if (!seen.has(key)) {
      seen.add(key);
      out.push([...seq]);
    }
  };

  const recurse = (): void => {
    if (seq.length > 0) emit();
    for (let i = 0; i < chars.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const options: SeqTile[] =
        chars[i] === "?" ? alphabet.split("").map((l) => ({ letter: l, blank: true })) : [{ letter: chars[i], blank: false }];
      for (const opt of options) {
        seq.push(opt);
        recurse();
        seq.pop();
      }
      used[i] = false;
    }
  };
  recurse();
  return out;
}

/** Lay a sequence into consecutive empty cells from (r, c), or null if it runs off. */
function laySequence(b: string, seq: SeqTile[], r: number, c: number, horizontal: boolean): PlacedTile[] | null {
  const tiles: PlacedTile[] = [];
  let rr = r;
  let cc = c;
  for (const t of seq) {
    while (rr < N && cc < N && !isEmpty(b, rr, cc)) {
      if (horizontal) cc++;
      else rr++;
    }
    if (rr >= N || cc >= N) return null;
    tiles.push({ row: rr, col: cc, letter: t.letter, blank: t.blank });
    if (horizontal) cc++;
    else rr++;
  }
  return tiles;
}

interface OracleMove {
  tiles: PlacedTile[];
  score: number;
}

function oracleMoves(b: string, rack: string, dictionary: Dictionary, alphabet: string): OracleMove[] {
  const moves: OracleMove[] = [];
  const sequences = rackSequences(rack, alphabet);
  for (const horizontal of [true, false]) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (const seq of sequences) {
          // A single tile lays identically in both directions; skip the dup.
          if (seq.length === 1 && !horizontal) continue;
          const tiles = laySequence(b, seq, r, c, horizontal);
          if (!tiles) continue;
          // Only count layouts anchored at (r, c) so each placement is
          // enumerated once per direction.
          if (tiles[0].row !== r || tiles[0].col !== c) continue;
          const out = validatePlay(b, rack, tiles, dictionary);
          if (!("code" in out)) moves.push({ tiles, score: out.total });
        }
      }
    }
  }
  return moves;
}

function oracleBest(b: string, rack: string): number {
  return oracleMoves(b, rack, miniDictionary, MINI_ALPHABET).reduce((m, mv) => Math.max(m, mv.score), 0);
}

/** Assert a solver candidate is a play validatePlay accepts with the same score. */
function expectLegal(b: string, rack: string, move: SolvedMove, dictionary: Dictionary): void {
  const out = validatePlay(b, rack, move.tiles, dictionary);
  if ("code" in out) {
    throw new Error(`solver emitted illegal move ${JSON.stringify(move.tiles)}: ${out.code}`);
  }
  expect(out.total).toBe(move.score);
  expect(out.bingo).toBe(move.bingo);
}

// --- fixtures ---

function tilesOf(spec: Array<[number, number, string]>): PlacedTile[] {
  return spec.map(([row, col, letter]) => ({ row, col, letter, blank: false }));
}

/** A committed mid-game position built through validatePlay (guaranteed legal). */
function midgameBoard(): string {
  let b = emptyBoard();
  const plays: Array<[string, PlacedTile[]]> = [
    ["HOUSE", tilesOf([[7, 5, "H"], [7, 6, "O"], [7, 7, "U"], [7, 8, "S"], [7, 9, "E"]])],
    ["TE", tilesOf([[6, 5, "T"], [8, 5, "E"]])],
    ["TN", tilesOf([[8, 4, "T"], [8, 6, "N"]])],
    ["S", tilesOf([[7, 10, "S"]])],
    ["UN", tilesOf([[8, 8, "U"], [9, 8, "N"]])],
  ];
  for (const [rack, tiles] of plays) {
    const out = validatePlay(b, rack, tiles, nwl2023Dictionary);
    if ("code" in out) throw new Error(`bad midgame fixture play: ${out.code}`);
    b = out.newBoard;
  }
  return b;
}

// --- tests ---

describe("findTopMoves vs brute-force oracle", () => {
  it("agrees on hand-built fixtures", () => {
    const fixtures: Array<{ board: string; rack: string }> = [
      { board: emptyBoard(), rack: "CAT" },
      { board: emptyBoard(), rack: "SCATBE" },
      {
        board: board([
          "...............",
          "...............",
          "...............",
          "...............",
          "...............",
          "...............",
          "...............",
          ".....CAT.......",
          "...............",
          "...............",
          "...............",
          "...............",
          "...............",
          "...............",
          "...............",
        ]),
        rack: "ONES",
      },
    ];
    for (const f of fixtures) {
      const result = findTopMoves(f.board, f.rack, miniTrie);
      expect(result.bestScore).toBe(oracleBest(f.board, f.rack));
      for (const move of result.top) expectLegal(f.board, f.rack, move, miniDictionary);
    }
  });

  it("agrees on randomized boards and racks (including blanks)", () => {
    const pool = "AAABCCEEENNOOSTTT";
    for (let seed = 1; seed <= 6; seed++) {
      const rng = seededRng(seed);
      const drawRack = (size: number, withBlank: boolean): string => {
        let rack = withBlank ? "?" : "";
        while (rack.length < size) rack += pool[rng.nextInt(pool.length)];
        return rack;
      };

      // Grow a legal board with two committed random oracle plays.
      let b = emptyBoard();
      for (let i = 0; i < 2; i++) {
        const legal = oracleMoves(b, drawRack(4, false), miniDictionary, MINI_ALPHABET);
        if (legal.length === 0) continue;
        const pick = legal[rng.nextInt(legal.length)];
        const out = validatePlay(b, rackFor(pick.tiles), pick.tiles, miniDictionary);
        if ("code" in out) throw new Error(`oracle-built play rejected: ${out.code}`);
        b = out.newBoard;
      }

      const rack = drawRack(3, seed % 2 === 0);
      const result = findTopMoves(b, rack, miniTrie, 1_000_000);
      expect(result.bestScore).toBe(oracleBest(b, rack));
      for (const move of result.top) expectLegal(b, rack, move, miniDictionary);
    }
  });
});

/** The exact rack needed to make `tiles` (blanks become '?'). */
function rackFor(tiles: PlacedTile[]): string {
  return tiles.map((t) => (t.blank ? "?" : t.letter)).join("");
}

describe("findTopMoves rules and edge cases", () => {
  it("first moves cover the center and place at least two tiles", () => {
    const result = findTopMoves(emptyBoard(), "CATS?", miniTrie, 1_000_000);
    expect(result.top.length).toBeGreaterThan(0);
    for (const move of result.top) {
      expect(move.tiles.length).toBeGreaterThanOrEqual(2);
      expect(move.tiles.some((t) => t.row === 7 && t.col === 7)).toBe(true);
      expectLegal(emptyBoard(), "CATS?", move, miniDictionary);
    }
  });

  it("scores a blank as zero", () => {
    // Only word is AT; center DW doubles. Real T: (1+1)*2 = 4; blank T: (1+0)*2 = 2.
    const trie = buildTrie(["AT"]);
    const real = findTopMoves(emptyBoard(), "AT", trie);
    expect(real.bestScore).toBe(4);
    const blank = findTopMoves(emptyBoard(), "A?", trie);
    expect(blank.bestScore).toBe(2);
    expect(blank.top[0].tiles.find((t) => t.letter === "T")?.blank).toBe(true);
  });

  it("finds single-tile plays in either direction", () => {
    // Lone O at (7,7); rack N. ON rightward is a horizontal-pass find,
    // NO downward is a vertical-pass (transposed) find.
    const b = emptyBoard().slice(0, 7 * N + 7) + "O" + emptyBoard().slice(7 * N + 8);
    const result = findTopMoves(b, "N", buildTrie(["ON", "NO"]), 1_000_000);
    const words = result.top.map((m) => m.words[0].word).sort();
    expect(words).toContain("ON");
    expect(words).toContain("NO");
    for (const move of result.top) expect(move.tiles.length).toBe(1);
  });

  it("scores both words of a single tile that connects two runs", () => {
    // O at (7,6) and O at (6,7); N at (7,7) forms ON across and ON down,
    // each doubled by the center star: (1+1)*2 + (1+1)*2 = 8.
    const rows = emptyBoard().split("");
    rows[7 * N + 6] = "O";
    rows[6 * N + 7] = "O";
    const b = rows.join("");
    const result = findTopMoves(b, "N", buildTrie(["ON"]));
    expect(result.bestScore).toBe(8);
    expect(result.top[0].words.length).toBe(2);
    expect(result.top[0].tiles).toEqual([{ row: 7, col: 7, letter: "N", blank: false }]);
  });

  it("awards the bingo bonus", () => {
    // OCTANES with C on the row-7 DL and the center DW: (9+3)*2 + 50 = 74.
    const result = findTopMoves(emptyBoard(), "OCTANES", miniTrie);
    expect(result.bestScore).toBe(74);
    expect(result.top[0].words[0].word).toBe("OCTANES");
    expect(result.top[0].bingo).toBe(true);
  });

  it("dedupes by main word, keeping the best-scoring placement", () => {
    const result = findTopMoves(emptyBoard(), "AT", buildTrie(["AT", "TA"]), 1_000_000);
    const words = result.top.map((m) => m.words[0].word);
    expect(words).toEqual(["AT", "TA"]); // ties break alphabetically
    expect(new Set(words).size).toBe(words.length);
  });

  it("returns empty results when no move exists", () => {
    expect(findTopMoves(emptyBoard(), "AB", buildTrie(["CD"]))).toEqual({ bestScore: 0, top: [] });
    expect(findTopMoves(emptyBoard(), "", miniTrie)).toEqual({ bestScore: 0, top: [] });
  });

  it("caps top at the requested limit", () => {
    const result = findTopMoves(midgameBoard(), "SATIRE", nwl2023Trie);
    expect(result.top.length).toBe(3);
    expect(result.top[0].score).toBe(result.bestScore);
    expect(result.top[0].score).toBeGreaterThanOrEqual(result.top[1].score);
    expect(result.top[1].score).toBeGreaterThanOrEqual(result.top[2].score);
  });
});

describe("findTopMoves on the full NWL2023 dictionary", () => {
  it("emits only legal plays on a mid-game board (invariant check)", () => {
    const b = midgameBoard();
    const rack = "SATIRE?";
    const all = findTopMoves(b, rack, nwl2023Trie, 1_000_000);
    expect(all.top.length).toBeGreaterThan(100);
    for (const move of all.top) expectLegal(b, rack, move, nwl2023Dictionary);
  });

  it("solves representative racks quickly", () => {
    const b = midgameBoard();
    for (const rack of ["SATIRE?", "AB??CDE"]) {
      const start = Date.now();
      const result = findTopMoves(b, rack, nwl2023Trie);
      const ms = Date.now() - start;
      // eslint-disable-next-line no-console
      console.log(`findTopMoves(${rack}): best ${result.bestScore} in ${ms}ms`);
      expect(result.bestScore).toBeGreaterThan(0);
      expect(ms).toBeLessThan(1000); // generous CI bound
    }
  });
});

describe("ratePlay", () => {
  it("maps thresholds exactly", () => {
    expect(ratePlay(100, 100)).toBe("wow");
    expect(ratePlay(90, 100)).toBe("great");
    expect(ratePlay(89, 100)).toBe("good");
    expect(ratePlay(9, 10)).toBe("great"); // 90% boundary in integers
    expect(ratePlay(50, 100)).toBe("good");
    expect(ratePlay(49, 100)).toBe("meh");
    expect(ratePlay(0, 100)).toBe("meh");
  });

  it("handles degenerate bests", () => {
    expect(ratePlay(0, 0)).toBe("wow"); // a legal 0-point play (two blanks) that was also the best
    expect(ratePlay(120, 100)).toBe("wow"); // defensive: solver can never beat a legal play downward
  });
});

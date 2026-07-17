// Best-move search: Appel–Jacobson anchor + cross-check generation over the
// trie, used to rate a submitted play against what was possible. Generation
// runs horizontally on the board and again on its transpose; every candidate
// is re-scored with the same pure functions the game engine uses
// (wordCellsForCommittedPlacement + scoreWord), so scoring can never drift
// from validatePlay. No dictionary lookups happen per candidate — the trie
// walk plus cross-checks already guarantee every emitted word is valid.

import { applyPlacedTiles, CENTER, isBlankBoard, N } from "./board.js";
import type { PlacedTile } from "./board.js";
import { wordCellsForCommittedPlacement } from "./moves.js";
import { BINGO_BONUS, scoreWord } from "./scoring.js";
import type { WordScore } from "./scoring.js";
import { RACK_SIZE } from "./tiles.js";
import type { Trie } from "./trie.js";

export interface SolvedMove {
  tiles: PlacedTile[];
  /** Main word first, then cross words, as validatePlay would report them. */
  words: WordScore[];
  /** Includes the bingo bonus. */
  score: number;
  bingo: boolean;
}

export interface SolverResult {
  /** Highest score over every legal move; 0 when no move exists. */
  bestScore: number;
  /** Top moves by score, deduped by main word (best placement per word). */
  top: SolvedMove[];
}

export type PlayRating = "wow" | "great" | "good" | "meh";

/**
 * wow = matched the best possible score, great = within 90% of it,
 * good = within 50%, meh = the rest. Integer math, no division; a legal
 * 0-point play exists (two blanks, no premium letters), so best may be 0.
 */
export function ratePlay(playedScore: number, bestScore: number): PlayRating {
  // The played move is itself legal, so the solver's best can never be below
  // it; clamp anyway so a solver regression can't produce a bogus rating.
  const best = Math.max(bestScore, playedScore);
  if (playedScore >= best) return "wow";
  if (playedScore * 10 >= best * 9) return "great";
  if (playedScore * 2 >= best) return "good";
  return "meh";
}

const CODE_A = 65; // "A"
const BLANK = 26; // index of the blank count in the rack-counts array
const ALL_LETTERS = (1 << 26) - 1;

export function findTopMoves(board: string, rack: string, trie: Trie, limit = 3): SolverResult {
  // Rack as letter counts; index 26 counts blanks.
  const counts = new Int32Array(27);
  let rackTiles = 0;
  for (const ch of rack.toUpperCase()) {
    const idx = ch === "?" ? BLANK : ch.charCodeAt(0) - CODE_A;
    if (idx >= 0 && idx <= BLANK) {
      counts[idx]++;
      rackTiles++;
    }
  }

  // Best candidate per main word. Keying by main word both collapses the
  // same physical placement found by both passes (identical tiles extract
  // identical words) and keeps "QI 33 / QI 32 / QI 31" from filling every
  // top slot with one word.
  const byWord = new Map<string, SolvedMove>();

  if (rackTiles > 0) {
    runPass(board, board, false, trie, counts, rackTiles, byWord);
    runPass(board, transpose(board), true, trie, counts, rackTiles, byWord);
  }

  const candidates = [...byWord.values()].sort(
    (a, b) => b.score - a.score || a.words[0].word.localeCompare(b.words[0].word),
  );
  return {
    bestScore: candidates.length > 0 ? candidates[0].score : 0,
    top: candidates.slice(0, Math.max(0, limit)),
  };
}

function transpose(board: string): string {
  const out = new Array<string>(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      out[c * N + r] = board[r * N + c];
    }
  }
  return out.join("");
}

/** Empty cells adjacent to a tile; on a blank board, just the center star. */
function computeAnchors(work: string): Uint8Array {
  const anchors = new Uint8Array(N * N);
  if (isBlankBoard(work)) {
    anchors[CENTER * N + CENTER] = 1;
    return anchors;
  }
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      if (work[i] !== ".") continue;
      const filled =
        (r > 0 && work[i - N] !== ".") ||
        (r < N - 1 && work[i + N] !== ".") ||
        (c > 0 && work[i - 1] !== ".") ||
        (c < N - 1 && work[i + 1] !== ".");
      if (filled) anchors[i] = 1;
    }
  }
  return anchors;
}

/**
 * For each empty cell, the set of letters (26-bit mask) that keep the
 * perpendicular run a valid word. Cells with no vertical neighbors form no
 * cross word, so every letter is allowed there.
 */
function computeCrossMasks(work: string, trie: Trie): Int32Array {
  const masks = new Int32Array(N * N).fill(ALL_LETTERS);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      if (work[i] !== ".") continue;
      const upFilled = r > 0 && work[i - N] !== ".";
      const downFilled = r < N - 1 && work[i + N] !== ".";
      if (!upFilled && !downFilled) continue;
      let up = "";
      for (let rr = r - 1; rr >= 0 && work[rr * N + c] !== "."; rr--) up = work[rr * N + c] + up;
      let down = "";
      for (let rr = r + 1; rr < N && work[rr * N + c] !== "."; rr++) down += work[rr * N + c];
      let mask = 0;
      for (let code = 0; code < 26; code++) {
        if (trie.hasWord(up + String.fromCharCode(CODE_A + code) + down)) mask |= 1 << code;
      }
      masks[i] = mask;
    }
  }
  return masks;
}

/**
 * Generate every legal horizontal move on `work` (the real board, or its
 * transpose for the vertical pass) and fold each into `byWord`. Classic
 * left-part/right-part recursion: each move is produced from the leftmost
 * anchor its placed tiles cover, with the left part never crossing another
 * anchor — that anchor would have claimed the move instead.
 */
function runPass(
  realBoard: string,
  work: string,
  transposed: boolean,
  trie: Trie,
  counts: Int32Array,
  rackTiles: number,
  byWord: Map<string, SolvedMove>,
): void {
  const anchors = computeAnchors(work);
  const masks = computeCrossMasks(work, trie);

  // Left-part letters (columns resolved at emit: they end just before the
  // anchor) and right-side placements (columns fixed as they're made).
  const leftStack: Array<{ code: number; blank: boolean }> = [];
  const rightPlaced: Array<{ col: number; code: number; blank: boolean }> = [];

  for (let r = 0; r < N; r++) {
    const rowOff = r * N;

    const emit = (wordStart: number): void => {
      const tiles: PlacedTile[] = [];
      for (let i = 0; i < leftStack.length; i++) {
        tiles.push(toReal(r, wordStart + i, leftStack[i].code, leftStack[i].blank, transposed));
      }
      for (const t of rightPlaced) {
        tiles.push(toReal(r, t.col, t.code, t.blank, transposed));
      }
      const newBoard = applyPlacedTiles(realBoard, tiles);
      const groups = wordCellsForCommittedPlacement(newBoard, tiles);
      if (groups.length === 0) return;
      const words: WordScore[] = groups.map((g) => ({ word: g.text, score: scoreWord(g.cells) }));
      const bingo = tiles.length === RACK_SIZE;
      const score = words.reduce((sum, w) => sum + w.score, 0) + (bingo ? BINGO_BONUS : 0);
      const key = words[0].word;
      const prev = byWord.get(key);
      if (!prev || score > prev.score) byWord.set(key, { tiles, words, score, bingo });
    };

    // Extend rightward from `col`, with `node` matching cells [wordStart, col).
    const extend = (node: number, col: number, wordStart: number, anchor: number): void => {
      const boundary = col === N || work[rowOff + col] === ".";
      if (col > anchor && boundary && col - wordStart >= 2 && trie.isTerminal(node)) {
        // col > anchor means the (empty) anchor cell was consumed, so at
        // least one rack tile is down.
        emit(wordStart);
      }
      if (col === N) return;
      const cell = work[rowOff + col];
      if (cell !== ".") {
        const next = trie.child(node, cell);
        if (next !== -1) extend(next, col + 1, wordStart, anchor);
        return;
      }
      const mask = masks[rowOff + col];
      for (const [letter, next] of trie.children(node)) {
        const code = letter.charCodeAt(0) - CODE_A;
        if (!(mask & (1 << code))) continue;
        if (counts[code] > 0) {
          counts[code]--;
          rightPlaced.push({ col, code, blank: false });
          extend(next, col + 1, wordStart, anchor);
          rightPlaced.pop();
          counts[code]++;
        }
        if (counts[BLANK] > 0) {
          counts[BLANK]--;
          rightPlaced.push({ col, code, blank: true });
          extend(next, col + 1, wordStart, anchor);
          rightPlaced.pop();
          counts[BLANK]++;
        }
      }
    };

    // Build rack-placed left parts of every length up to `limit`. Left-part
    // cells are empty non-anchor squares, which by definition have no filled
    // neighbors — so no cross word forms and no cross-check applies.
    const leftPart = (node: number, remaining: number, anchor: number): void => {
      extend(node, anchor, anchor - leftStack.length, anchor);
      if (remaining <= 0) return;
      for (const [letter, next] of trie.children(node)) {
        const code = letter.charCodeAt(0) - CODE_A;
        if (counts[code] > 0) {
          counts[code]--;
          leftStack.push({ code, blank: false });
          leftPart(next, remaining - 1, anchor);
          leftStack.pop();
          counts[code]++;
        }
        if (counts[BLANK] > 0) {
          counts[BLANK]--;
          leftStack.push({ code, blank: true });
          leftPart(next, remaining - 1, anchor);
          leftStack.pop();
          counts[BLANK]++;
        }
      }
    };

    for (let a = 0; a < N; a++) {
      if (!anchors[rowOff + a]) continue;
      if (a > 0 && work[rowOff + a - 1] !== ".") {
        // Fixed left part: the existing run ending at a-1. If the trie walk
        // dies the run prefixes no word and this anchor yields nothing.
        let start = a - 1;
        while (start > 0 && work[rowOff + start - 1] !== ".") start--;
        let node = trie.root;
        for (let c = start; c < a && node !== -1; c++) {
          node = trie.child(node, work[rowOff + c]);
        }
        if (node !== -1) extend(node, a, start, a);
      } else {
        let room = 0;
        while (a - 1 - room >= 0 && work[rowOff + a - 1 - room] === "." && !anchors[rowOff + a - 1 - room]) {
          room++;
        }
        leftPart(trie.root, Math.min(room, rackTiles - 1), a);
      }
    }
  }
}

function toReal(row: number, col: number, code: number, blank: boolean, transposed: boolean): PlacedTile {
  const letter = String.fromCharCode(CODE_A + code);
  return transposed ? { row: col, col: row, letter, blank } : { row, col, letter, blank };
}

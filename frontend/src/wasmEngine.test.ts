/// <reference types="node" />
// Exercises the actual compiled wasm module (via a --target nodejs build,
// see package.json's gen:wasm-node/pretest scripts), not a mock -- this is
// what catches real Rust<->JSON boundary drift that a TS-side stub can't.
// Node types are referenced locally (not in tsconfig's global `types`) so
// this test-only usage doesn't risk colliding with the app's DOM types.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { check_placement, dictionary_ready, init_dictionary } from "./generated/wasm-engine-node/wordplay_wasm.js";

const N = 15;
const EMPTY_BOARD = ".".repeat(N * N);
const here = path.dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  const dictBytes = readFileSync(path.resolve(here, "generated/dictionary.txt"));
  init_dictionary(new Uint8Array(dictBytes));
});

describe("wasm-engine check_placement (real compiled module)", () => {
  it("reports the dictionary as ready after init", () => {
    expect(dictionary_ready()).toBe(true);
  });

  it("validates a first move through the center", () => {
    const tiles = [
      { row: 7, col: 5, letter: "H", blank: false },
      { row: 7, col: 6, letter: "E", blank: false },
      { row: 7, col: 7, letter: "L", blank: false },
      { row: 7, col: 8, letter: "L", blank: false },
      { row: 7, col: 9, letter: "O", blank: false },
    ];
    const result = JSON.parse(check_placement(EMPTY_BOARD, "HELLOXY", JSON.stringify(tiles)));
    expect(result.valid).toBe(true);
    expect(result.score).toBe(16); // (4+1+1+1+1) x 2 for the center DW
    expect(result.words).toEqual([{ text: "HELLO", cells: [[7, 5], [7, 6], [7, 7], [7, 8], [7, 9]] }]);
  });

  it("rejects a word that isn't in the dictionary", () => {
    const tiles = [
      { row: 7, col: 7, letter: "Z", blank: false },
      { row: 7, col: 8, letter: "Q", blank: false },
    ];
    const result = JSON.parse(check_placement(EMPTY_BOARD, "ZQABCDE", JSON.stringify(tiles)));
    expect(result.valid).toBe(false);
    expect(result.code).toBe("invalid_words");
    expect(result.invalid_words).toEqual(["ZQ"]);
  });

  it("reports a structural error distinct from a dictionary error", () => {
    const tiles = [
      { row: 0, col: 0, letter: "H", blank: false },
      { row: 1, col: 1, letter: "I", blank: false },
    ];
    const result = JSON.parse(check_placement(EMPTY_BOARD, "HI", JSON.stringify(tiles)));
    expect(result.valid).toBe(false);
    expect(result.code).toBe("not_in_line");
    expect(result.invalid_words).toEqual([]);
  });

  it("finds two words formed by a single placed tile (mirrors single_tile_can_form_two_words)", () => {
    const cells = Array(N * N).fill(".");
    "HELLO".split("").forEach((c, i) => (cells[7 * N + 4 + i] = c));
    cells[8 * N + 4] = "A";
    const board = cells.join("");
    const tiles = [{ row: 8, col: 5, letter: "S", blank: false }];
    const result = JSON.parse(check_placement(board, "SXXXXXX", JSON.stringify(tiles)));
    expect(result.valid).toBe(true);
    expect(result.words.map((w: { text: string }) => w.text)).toEqual(["AS", "ES"]);
    expect(result.score).toBe(4);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTrie, buildTrieFromText } from "./trie.js";

const nwl2023TxtPath = fileURLToPath(new URL("../assets/nwl2023.txt", import.meta.url));
const nwl2023Text = readFileSync(nwl2023TxtPath, "utf8");

describe("buildTrie", () => {
  const words = ["cat", "cats", "cab", "at", "dog", "do"];
  const trie = buildTrie(words);

  it("accepts exactly the input words", () => {
    for (const w of words) {
      expect(trie.hasWord(w)).toBe(true);
      expect(trie.hasWord(w.toUpperCase())).toBe(true);
    }
    for (const w of ["c", "ca", "catss", "og", "", "dogs", "ats"]) {
      expect(trie.hasWord(w)).toBe(false);
    }
  });

  it("walks children with terminal flags", () => {
    const c = trie.child(trie.root, "C");
    const ca = trie.child(c, "a");
    const cat = trie.child(ca, "T");
    expect(c).not.toBe(-1);
    expect(trie.isTerminal(c)).toBe(false);
    expect(trie.isTerminal(ca)).toBe(false);
    expect(trie.isTerminal(cat)).toBe(true);
    expect(trie.isTerminal(trie.child(cat, "S"))).toBe(true);
    expect(trie.child(cat, "Z")).toBe(-1);
  });

  it("lists children in ascending letter order", () => {
    const ca = trie.child(trie.child(trie.root, "C"), "A");
    expect(trie.children(ca).map(([l]) => l)).toEqual(["B", "T"]);
    const roots = trie.children(trie.root).map(([l]) => l);
    expect(roots).toEqual(["A", "C", "D"]);
  });

  it("skips words with characters outside A-Z and dedupes", () => {
    const t = buildTrie(["a-b", "ok", "ok", "é", ""]);
    expect(t.hasWord("ok")).toBe(true);
    expect(t.hasWord("a-b")).toBe(false);
    // root + o + k
    expect(t.nodeCount).toBe(3);
  });

  it("never matches the empty string", () => {
    expect(trie.hasWord("")).toBe(false);
  });
});

describe("buildTrieFromText on the full NWL2023 list", () => {
  it("has membership parity with the word list", () => {
    const words = nwl2023Text
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.length > 0);
    const start = Date.now();
    const trie = buildTrieFromText(nwl2023Text);
    const buildMs = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`NWL2023 trie: ${trie.nodeCount} nodes in ${buildMs}ms`);
    expect(buildMs).toBeLessThan(2000);

    for (const w of words) {
      if (!trie.hasWord(w)) throw new Error(`trie missing word: ${w}`);
    }
    // Negative probes: every word with one letter appended stays a word only
    // if the list says so — spot-check a slice rather than all 196k * 26.
    const set = new Set(words);
    for (let i = 0; i < words.length; i += 997) {
      const probe = words[i] + "q";
      expect(trie.hasWord(probe)).toBe(set.has(probe));
    }
    expect(trie.hasWord("zzzzz")).toBe(false);
  });
});

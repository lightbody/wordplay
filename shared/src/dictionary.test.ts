import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDictionary, loadDictionaryFromText } from "./dictionary.js";

const enableTxtPath = fileURLToPath(new URL("../assets/enable.txt", import.meta.url));
const enableTxt = readFileSync(enableTxtPath, "utf8");

describe("loadDictionaryFromText", () => {
  const dict = loadDictionaryFromText(enableTxt);

  it("knows common words in any case", () => {
    expect(dict.isWord("hello")).toBe(true);
    expect(dict.isWord("HELLO")).toBe(true);
    expect(dict.isWord("Jo")).toBe(true);
    expect(dict.isWord("zyzzyvas")).toBe(true);
  });

  it("rejects non-words", () => {
    expect(dict.isWord("qzx")).toBe(false);
    expect(dict.isWord("")).toBe(false);
    expect(dict.isWord("hello world")).toBe(false);
  });

  it("loads the full ENABLE list", () => {
    expect(dict.size).toBeGreaterThan(170_000);
  });
});

describe("createDictionary", () => {
  it("builds a dictionary from an arbitrary word iterable", () => {
    const dict = createDictionary(["cat", "DOG"]);
    expect(dict.isWord("cat")).toBe(true);
    expect(dict.isWord("CAT")).toBe(true);
    expect(dict.isWord("dog")).toBe(true);
    expect(dict.isWord("bird")).toBe(false);
    expect(dict.size).toBe(2);
  });
});

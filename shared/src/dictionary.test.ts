import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDictionary, loadDictionaryFromText } from "./dictionary.js";

const nwl2023TxtPath = fileURLToPath(new URL("../assets/nwl2023.txt", import.meta.url));
const nwl2023Txt = readFileSync(nwl2023TxtPath, "utf8");

describe("loadDictionaryFromText", () => {
  const dict = loadDictionaryFromText(nwl2023Txt);

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

  it("loads the full NWL2023 list", () => {
    expect(dict.size).toBe(196_601);
  });

  it("includes NWL2023 additions missing from the old ENABLE list", () => {
    for (const w of ["za", "qi", "zas", "qis"]) {
      expect(dict.isWord(w)).toBe(true);
    }
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

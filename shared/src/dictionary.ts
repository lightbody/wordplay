// Word list membership. Ported from backend/src/engine/dictionary.rs.
// Not a singleton: both frontend and backend construct their own instance
// from whatever text they have (embedded asset, fetched bytes, etc).

export interface Dictionary {
  isWord(word: string): boolean;
  readonly size: number;
}

export function createDictionary(words: Iterable<string>): Dictionary {
  const set = new Set<string>();
  for (const w of words) set.add(w.toLowerCase());
  return {
    isWord(word: string): boolean {
      return set.has(word.toLowerCase());
    },
    get size(): number {
      return set.size;
    },
  };
}

export function loadDictionaryFromText(text: string): Dictionary {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, "")).filter((line) => line.length > 0);
  return createDictionary(lines);
}

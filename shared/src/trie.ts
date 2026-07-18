// Compact static trie over a word list, used by the move solver for prefix
// walks the Set-backed Dictionary can't do. First-child/next-sibling layout
// over parallel typed arrays: ~4MB resident for the full NWL2023 list vs
// ~90MB for Map-based nodes, which matters on the 256MB backend VM.

const CODE_A = 65; // "A"

export interface Trie {
  readonly nodeCount: number;
  /** The root node index (always 0). */
  readonly root: number;
  /** Child of `node` along `letter` (case-insensitive), or -1 if absent. */
  child(node: number, letter: string): number;
  isTerminal(node: number): boolean;
  /** All children of `node` as [letter, childIndex], letters ascending. */
  children(node: number): Array<[string, number]>;
  hasWord(word: string): boolean;
}

/** Words with any character outside A-Z (after uppercasing) are skipped. */
export function buildTrie(words: Iterable<string>): Trie {
  const list: string[] = [];
  for (const w of words) {
    const up = w.toUpperCase();
    let ok = up.length > 0;
    for (let i = 0; i < up.length && ok; i++) {
      const c = up.charCodeAt(i);
      if (c < CODE_A || c > CODE_A + 25) ok = false;
    }
    if (ok) list.push(up);
  }
  list.sort();

  let capacity = 1024;
  let letter: Uint8Array = new Uint8Array(capacity);
  let terminal: Uint8Array = new Uint8Array(capacity);
  let firstChild: Int32Array = new Int32Array(capacity).fill(-1);
  let nextSibling: Int32Array = new Int32Array(capacity).fill(-1);
  // Build-time scratch for O(1) sibling appends; discarded after the build.
  let lastChild: Int32Array = new Int32Array(capacity).fill(-1);
  let count = 1; // node 0 is the root

  function grow(): void {
    capacity *= 2;
    const grow8 = (a: Uint8Array): Uint8Array => {
      const b = new Uint8Array(capacity);
      b.set(a);
      return b;
    };
    const grow32 = (a: Int32Array): Int32Array => {
      const b = new Int32Array(capacity).fill(-1);
      b.set(a);
      return b;
    };
    letter = grow8(letter);
    terminal = grow8(terminal);
    firstChild = grow32(firstChild);
    nextSibling = grow32(nextSibling);
    lastChild = grow32(lastChild);
  }

  // Sorted input means each word shares a prefix with its predecessor and
  // appends strictly new suffix nodes; path[i] is the node for the current
  // word's first i letters. Sibling chains come out letter-ascending.
  const path: number[] = [0];
  let prev = "";
  for (const w of list) {
    if (w === prev) continue;
    let p = 0;
    const maxP = Math.min(prev.length, w.length);
    while (p < maxP && prev.charCodeAt(p) === w.charCodeAt(p)) p++;
    for (let i = p; i < w.length; i++) {
      if (count === capacity) grow();
      const node = count++;
      letter[node] = w.charCodeAt(i);
      const parent = path[i];
      if (firstChild[parent] === -1) firstChild[parent] = node;
      else nextSibling[lastChild[parent]] = node;
      lastChild[parent] = node;
      path[i + 1] = node;
    }
    terminal[path[w.length]] = 1;
    prev = w;
  }

  // Trim to exact size (slice copies, releasing the doubled buffers).
  letter = letter.slice(0, count);
  terminal = terminal.slice(0, count);
  firstChild = firstChild.slice(0, count);
  nextSibling = nextSibling.slice(0, count);

  function childByCode(node: number, code: number): number {
    for (let n = firstChild[node]; n !== -1; n = nextSibling[n]) {
      if (letter[n] === code) return n;
      if (letter[n] > code) return -1; // chains are sorted ascending
    }
    return -1;
  }

  return {
    nodeCount: count,
    root: 0,
    child(node: number, ch: string): number {
      return childByCode(node, ch.toUpperCase().charCodeAt(0));
    },
    isTerminal(node: number): boolean {
      return terminal[node] === 1;
    },
    children(node: number): Array<[string, number]> {
      const out: Array<[string, number]> = [];
      for (let n = firstChild[node]; n !== -1; n = nextSibling[n]) {
        out.push([String.fromCharCode(letter[n]), n]);
      }
      return out;
    },
    hasWord(word: string): boolean {
      const up = word.toUpperCase();
      let node = 0;
      for (let i = 0; i < up.length; i++) {
        node = childByCode(node, up.charCodeAt(i));
        if (node === -1) return false;
      }
      return node !== 0 && terminal[node] === 1;
    },
  };
}

/** Same line parsing as loadDictionaryFromText. */
export function buildTrieFromText(text: string): Trie {
  return buildTrie(
    text
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.length > 0),
  );
}

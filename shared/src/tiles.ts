// Tile distribution, letter values, and bag operations.
// Ported from backend/src/engine/tiles.rs.
//
// The bag is a string of tiles in draw order (A-Z plus ? for blanks);
// drawing pops from the front. Racks use the same alphabet. All functions
// are pure: they return new strings rather than mutating their arguments.

export const RACK_SIZE = 7;
export const BAG_SIZE = 100;

/** Standard English distribution: [tile, count]. */
export const DISTRIBUTION: Array<[string, number]> = [
  ["A", 9],
  ["B", 2],
  ["C", 2],
  ["D", 4],
  ["E", 12],
  ["F", 2],
  ["G", 3],
  ["H", 2],
  ["I", 9],
  ["J", 1],
  ["K", 1],
  ["L", 4],
  ["M", 2],
  ["N", 6],
  ["O", 8],
  ["P", 2],
  ["Q", 1],
  ["R", 6],
  ["S", 4],
  ["T", 6],
  ["U", 4],
  ["V", 2],
  ["W", 2],
  ["X", 1],
  ["Y", 2],
  ["Z", 1],
  ["?", 2],
];

const VALUES: Record<string, number> = {
  A: 1, E: 1, I: 1, O: 1, U: 1, L: 1, N: 1, S: 1, T: 1, R: 1,
  D: 2, G: 2,
  B: 3, C: 3, M: 3, P: 3,
  F: 4, H: 4, V: 4, W: 4, Y: 4,
  K: 5,
  J: 8, X: 8,
  Q: 10, Z: 10,
};

/** Point value of a tile. Blanks ('?' or lowercase board cells) are 0. */
export function letterValue(tile: string): number {
  if (tile >= "a" && tile <= "z") return 0; // blank played as this letter
  return VALUES[tile.toUpperCase()] ?? 0; // '?' falls through to 0
}

/** Total value of the tiles on a rack (for end-game deductions). */
export function rackValue(rack: string): number {
  let sum = 0;
  for (const c of rack) sum += letterValue(c);
  return sum;
}

/** A seedable RNG, so bag shuffles and swap-tile placements are reproducible. */
export interface Rng {
  /** Returns an integer in [0, max) (max exclusive). */
  nextInt(max: number): number;
}

/** A simple deterministic RNG (mulberry32) for tests and any seeded use. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    nextInt(max: number): number {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const frac = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(frac * max);
    },
  };
}

function shuffle<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
}

export function shuffledBag(rng: Rng): string {
  const tiles: string[] = [];
  for (const [tile, count] of DISTRIBUTION) {
    for (let i = 0; i < count; i++) tiles.push(tile);
  }
  shuffle(tiles, rng);
  return tiles.join("");
}

/**
 * Draw from the front of the bag until the rack holds RACK_SIZE tiles or the
 * bag is empty. Returns the new [bag, rack].
 */
export function draw(bag: string, rack: string): [string, string] {
  let b = bag;
  let r = rack;
  while (r.length < RACK_SIZE && b.length > 0) {
    r += b[0];
    b = b.slice(1);
  }
  return [b, r];
}

export class NotInRackError extends Error {
  constructor(public readonly letter: string) {
    super(`letter not in rack: ${letter}`);
  }
}

/** Remove `letters` from `rack` (error if any aren't held). Returns [remainingRack, takenLetters]. */
export function takeFromRack(rack: string, letters: string): [string, string] {
  let remaining = rack;
  let taken = "";
  for (const raw of letters) {
    const l = raw === "?" ? raw : raw.toUpperCase();
    const i = remaining.indexOf(l);
    if (i === -1) throw new NotInRackError(l);
    remaining = remaining.slice(0, i) + remaining.slice(i + 1);
    taken += l;
  }
  return [remaining, taken];
}

/**
 * Swap: remove `letters` from the rack, draw replacements, then return the
 * removed letters to the bag at random positions. Returns [newBag, newRack].
 */
export function swapTiles(bag: string, rack: string, letters: string, rng: Rng): [string, string] {
  const [rackAfterTake, returned] = takeFromRack(rack, letters);
  let [b, r] = draw(bag, rackAfterTake);
  for (const tile of returned) {
    const pos = rng.nextInt(b.length + 1);
    b = b.slice(0, pos) + tile + b.slice(pos);
  }
  return [b, r];
}

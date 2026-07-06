import { describe, expect, it } from "vitest";
import {
  DISTRIBUTION,
  RACK_SIZE,
  draw,
  letterValue,
  rackValue,
  seededRng,
  shuffledBag,
  swapTiles,
  takeFromRack,
  NotInRackError,
} from "./tiles.js";

const BAG_SIZE = 100;

function multiset(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of s) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

describe("shuffledBag", () => {
  it("has 100 tiles with the standard distribution", () => {
    const bag = shuffledBag(seededRng(1));
    expect(bag.length).toBe(BAG_SIZE);
    const counts = multiset(bag);
    expect(counts.get("E")).toBe(12);
    expect(counts.get("A")).toBe(9);
    expect(counts.get("Q")).toBe(1);
    expect(counts.get("?")).toBe(2);
    let totalValue = 0;
    for (const c of bag) totalValue += letterValue(c);
    expect(totalValue).toBe(187); // standard Scrabble tile-set value
  });

  it("is deterministic given a seed", () => {
    const a = shuffledBag(seededRng(42));
    const b = shuffledBag(seededRng(42));
    expect(a).toBe(b);
    const c = shuffledBag(seededRng(43));
    expect(a).not.toBe(c);
  });
});

describe("draw", () => {
  it("replenishes the rack to seven", () => {
    const [bag, rack] = draw("ABCDEFGHIJ", "XY");
    expect(rack).toBe("XYABCDE");
    expect(bag).toBe("FGHIJ");
  });

  it("stops at an empty bag", () => {
    const [bag, rack] = draw("AB", "");
    expect(rack).toBe("AB");
    expect(bag).toBe("");
  });
});

describe("takeFromRack", () => {
  it("errors on a missing letter", () => {
    expect(() => takeFromRack("ABC", "AZ")).toThrow(NotInRackError);
    try {
      takeFromRack("ABC", "AZ");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NotInRackError);
      expect((e as NotInRackError).letter).toBe("Z");
    }
  });
});

describe("swapTiles", () => {
  it("conserves the tile multiset", () => {
    const rng = seededRng(7);
    let bag = shuffledBag(rng);
    let rack = "";
    [bag, rack] = draw(bag, rack);
    const before = multiset(bag + rack);

    const toSwap = rack.slice(0, 3);
    [bag, rack] = swapTiles(bag, rack, toSwap, rng);

    expect(rack.length).toBe(RACK_SIZE);
    expect(bag.length).toBe(BAG_SIZE - RACK_SIZE);
    const after = multiset(bag + rack);
    expect(after).toEqual(before);
  });
});

describe("rackValue", () => {
  it("sums letter values", () => {
    expect(rackValue("QZ?E")).toBe(21);
    expect(rackValue("")).toBe(0);
  });
});

describe("DISTRIBUTION", () => {
  it("has 27 entries summing to 100 tiles", () => {
    expect(DISTRIBUTION.length).toBe(27);
    expect(DISTRIBUTION.reduce((sum, [, count]) => sum + count, 0)).toBe(BAG_SIZE);
  });
});

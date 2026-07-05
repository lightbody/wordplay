import { describe, expect, it } from "vitest";
import { moveItem, rackColumnAt } from "./dragMath";

describe("moveItem", () => {
  it("moves an item forward", () => {
    expect(moveItem([0, 1, 2, 3], 0, 2)).toEqual([1, 2, 0, 3]);
  });

  it("moves an item backward", () => {
    expect(moveItem([0, 1, 2, 3], 3, 1)).toEqual([0, 3, 1, 2]);
  });

  it("is a no-op when from equals to", () => {
    const arr = [0, 1, 2];
    expect(moveItem(arr, 1, 1)).toBe(arr);
  });

  it("is a no-op for out-of-range indices", () => {
    const arr = [0, 1, 2];
    expect(moveItem(arr, -1, 1)).toBe(arr);
    expect(moveItem(arr, 1, 5)).toBe(arr);
  });

  it("does not mutate the input array", () => {
    const arr = [0, 1, 2, 3];
    moveItem(arr, 0, 3);
    expect(arr).toEqual([0, 1, 2, 3]);
  });
});

describe("rackColumnAt", () => {
  it("picks the first column at the left edge", () => {
    expect(rackColumnAt(0, 0, 700, 7)).toBe(0);
  });

  it("picks the last column at the right edge", () => {
    expect(rackColumnAt(699, 0, 700, 7)).toBe(6);
  });

  it("picks the middle column in the middle", () => {
    expect(rackColumnAt(350, 0, 700, 7)).toBe(3);
  });

  it("clamps points outside the rect", () => {
    expect(rackColumnAt(-50, 0, 700, 7)).toBe(0);
    expect(rackColumnAt(5000, 0, 700, 7)).toBe(6);
  });

  it("accounts for a non-zero rect offset", () => {
    expect(rackColumnAt(120, 100, 700, 7)).toBe(0);
  });
});

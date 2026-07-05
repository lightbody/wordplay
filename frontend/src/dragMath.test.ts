import { describe, expect, it } from "vitest";
import { moveItem } from "./dragMath";

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

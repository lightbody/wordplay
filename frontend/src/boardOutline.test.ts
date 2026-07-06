import { describe, expect, it } from "vitest";
import { outlinePath, trackRect, type Cell } from "./boardOutline";

const BOARD_PX = 540;
const GAP = 2;

function parsePath(d: string): Array<[number, number]> {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [parseFloat(m[1]), parseFloat(m[2])]);
}

function shoelaceArea(points: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// Index 5 is safely interior (away from the grid's outer edge), where every
// track's slot extends a full `gap` beyond its own tile box.
function unitCellArea(): number {
  const { size } = trackRect(5, BOARD_PX, GAP);
  return size * size;
}

describe("trackRect", () => {
  it("tiles the full board with no gap between adjacent slots", () => {
    for (let i = 0; i < 14; i++) {
      const a = trackRect(i, BOARD_PX, GAP);
      const b = trackRect(i + 1, BOARD_PX, GAP);
      expect(a.start + a.size).toBeCloseTo(b.start, 9);
    }
  });

  it("spans exactly the board's pixel extent at the outer edges", () => {
    const first = trackRect(0, BOARD_PX, GAP);
    const last = trackRect(14, BOARD_PX, GAP);
    expect(first.start).toBe(0);
    expect(last.start + last.size).toBe(BOARD_PX);
  });
});

describe("outlinePath", () => {
  it("returns null for an empty cell set", () => {
    expect(outlinePath([], BOARD_PX, GAP)).toBeNull();
  });

  it("traces a single cell as a plain rectangle", () => {
    const d = outlinePath([[7, 7]], BOARD_PX, GAP)!;
    const points = parsePath(d);
    expect(d.endsWith("Z")).toBe(true);
    expect(points).toHaveLength(4);
    expect(shoelaceArea(points)).toBeCloseTo(unitCellArea(), 5);
  });

  it("traces a straight run as one seamless rectangle, not one box per tile", () => {
    const cells: Cell[] = [[7, 5], [7, 6], [7, 7], [7, 8], [7, 9]];
    const d = outlinePath(cells, BOARD_PX, GAP)!;
    const points = parsePath(d);
    expect(points).toHaveLength(4); // still just 4 corners
    expect(shoelaceArea(points)).toBeCloseTo(cells.length * unitCellArea(), 5);
  });

  it("traces an L-shape (main word plus one cross word) with 6 corners", () => {
    // Mirrors single_tile_can_form_two_words: a horizontal run sharing its
    // last cell with a vertical run hanging off it.
    const cells: Cell[] = [
      [7, 5], [7, 6], [7, 7],
      [8, 7], [9, 7],
    ];
    const d = outlinePath(cells, BOARD_PX, GAP)!;
    const points = parsePath(d);
    expect(points).toHaveLength(6);
    expect(shoelaceArea(points)).toBeCloseTo(cells.length * unitCellArea(), 5);
  });

  it("traces a plus-shape (main word plus two cross words) with 12 corners", () => {
    // Mirrors parallel_play_scores_main_and_cross_words: a main run with two
    // separate cross words hanging off different (interior) cells of it --
    // each cross word attaches mid-edge rather than flush with the main
    // run's own corner, so each contributes 4 new corners (4 base + 4 + 4).
    const cells: Cell[] = [
      [7, 5], [7, 6], [7, 7], [7, 8], [7, 9],
      [6, 6],
      [8, 8],
    ];
    const d = outlinePath(cells, BOARD_PX, GAP)!;
    const points = parsePath(d);
    expect(points).toHaveLength(12);
    expect(shoelaceArea(points)).toBeCloseTo(cells.length * unitCellArea(), 5);
  });
});

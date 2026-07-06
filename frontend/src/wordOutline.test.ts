import { describe, expect, it } from "vitest";
import { outlineEdges } from "./wordOutline";

function cell(row: number, col: number) {
  return { row, col };
}

function edgesAt(edges: ReturnType<typeof outlineEdges>, row: number, col: number) {
  return edges.get(`${row},${col}`);
}

describe("outlineEdges", () => {
  it("outlines a single straight horizontal word with no interior seams", () => {
    const cells = [cell(7, 5), cell(7, 6), cell(7, 7)];
    const edges = outlineEdges(cells);

    // Left end: outer on top/bottom/left, but not on the right (shared with the next cell).
    expect(edgesAt(edges, 7, 5)).toEqual({ top: true, right: false, bottom: true, left: true });
    // Middle cell: outer top/bottom only.
    expect(edgesAt(edges, 7, 6)).toEqual({ top: true, right: false, bottom: true, left: false });
    // Right end: outer on top/bottom/right, but not on the left.
    expect(edgesAt(edges, 7, 7)).toEqual({ top: true, right: true, bottom: true, left: false });
  });

  it("outlines an L-shape (main word plus one cross word sharing a corner) seamlessly", () => {
    // Horizontal word at row 7, cols 5-7; vertical cross word at col 7, rows 7-9,
    // sharing the corner cell (7,7).
    const cells = [cell(7, 5), cell(7, 6), cell(7, 7), cell(8, 7), cell(9, 7)];
    const edges = outlineEdges(cells);

    // The shared corner cell has no seam on the side connecting to either arm.
    expect(edgesAt(edges, 7, 7)).toEqual({ top: true, right: true, bottom: false, left: false });
    // The horizontal arm's middle cell only has top/bottom exposed.
    expect(edgesAt(edges, 7, 6)).toEqual({ top: true, right: false, bottom: true, left: false });
    // The vertical arm's tail cell has bottom/left/right exposed, top shared with (8,7).
    expect(edgesAt(edges, 9, 7)).toEqual({ top: false, right: true, bottom: true, left: true });
    // No internal seams: every cell-to-cell adjacency in the shape has both sides false.
    expect(edgesAt(edges, 7, 5)!.right).toBe(false); // (7,5)-(7,6) boundary
    expect(edgesAt(edges, 7, 6)!.left).toBe(false);
    expect(edgesAt(edges, 8, 7)!.top).toBe(false); // (7,7)-(8,7) boundary
    expect(edgesAt(edges, 8, 7)!.bottom).toBe(false); // (8,7)-(9,7) boundary
    expect(edgesAt(edges, 9, 7)!.top).toBe(false);
  });

  it("outlines a plus/T-shape (main word plus two cross words) seamlessly", () => {
    // Horizontal word at row 7, cols 5-9; two vertical cross words crossing it
    // at (7,6) [rows 6-8] and (7,8) [rows 6-8].
    const cells = [
      cell(7, 5),
      cell(7, 6),
      cell(7, 7),
      cell(7, 8),
      cell(7, 9),
      cell(6, 6),
      cell(8, 6),
      cell(6, 8),
      cell(8, 8),
    ];
    const edges = outlineEdges(cells);

    // The two T-junction cells (7,6) and (7,8) have no vertical seam (shared with cross words).
    expect(edgesAt(edges, 7, 6)).toEqual({ top: false, right: false, bottom: false, left: false });
    expect(edgesAt(edges, 7, 8)).toEqual({ top: false, right: false, bottom: false, left: false });
    // The cross-word tips are fully outer except the side touching the main word.
    expect(edgesAt(edges, 6, 6)).toEqual({ top: true, right: true, bottom: false, left: true });
    expect(edgesAt(edges, 8, 6)).toEqual({ top: false, right: true, bottom: true, left: true });
    // The main word's untouched middle cell (7,7) is outer top/bottom only.
    expect(edgesAt(edges, 7, 7)).toEqual({ top: true, right: false, bottom: true, left: false });
  });

  it("marks cells at row 0 / col 0 / the last row-col (14) as outer without any board-size input", () => {
    // A vertical word running from the very top-left corner down the first column.
    const cells = [cell(0, 0), cell(1, 0), cell(2, 0)];
    const edges = outlineEdges(cells);
    expect(edgesAt(edges, 0, 0)).toEqual({ top: true, right: true, bottom: false, left: true });
    expect(edgesAt(edges, 2, 0)).toEqual({ top: false, right: true, bottom: true, left: true });

    // A horizontal word ending at the last column/row (14 on a 15x15 board) --
    // outlineEdges never needs to know 15 is the bound, it only looks at the set.
    const edgeCells = [cell(14, 12), cell(14, 13), cell(14, 14)];
    const edgeEdges = outlineEdges(edgeCells);
    expect(edgesAt(edgeEdges, 14, 14)).toEqual({ top: true, right: true, bottom: true, left: false });
  });

  it("treats a single isolated cell as outer on all four sides", () => {
    const edges = outlineEdges([cell(3, 3)]);
    expect(edgesAt(edges, 3, 3)).toEqual({ top: true, right: true, bottom: true, left: true });
  });
});

// Traces a single perimeter around a connected set of board cells (the union
// of every newly-formed word's cells) for the "gold border" placement
// feedback, replacing a per-tile ring with one outline around the whole
// group. Pure and DOM-free so it's unit-testable like engine.ts.

import { N } from "./engine";

export type Cell = readonly [row: number, col: number];
type Point = readonly [number, number];

/**
 * Pixel position of the grid line before track `index` (0..N). Each track's
 * "slot" extends halfway into the gaps on either side of it, so that two
 * same-word adjacent cells share an exact boundary with no gap-sized notch
 * between them -- the perimeter should look like one seamless outline around
 * a run of tiles, not a zigzag around each tile's own box.
 */
function gridLine(index: number, boardSizePx: number, gap: number): number {
  const tileSize = (boardSizePx - gap * (N - 1)) / N;
  if (index <= 0) return 0;
  if (index >= N) return boardSizePx;
  return index * (tileSize + gap) - gap / 2;
}

/** Pixel start+size of grid track `index` (0..14), see `gridLine`. */
export function trackRect(index: number, boardSizePx: number, gap: number): { start: number; size: number } {
  const start = gridLine(index, boardSizePx, gap);
  const end = gridLine(index + 1, boardSizePx, gap);
  return { start, size: end - start };
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function pointKey([x, y]: Point): string {
  return `${x},${y}`;
}

/**
 * Traces the outer boundary of a connected, hole-free set of grid cells --
 * guaranteed by construction: every cross-word run shares its cell with the
 * main run, so the union of all formed-word cells is always one connected
 * orthogonal polyomino with no holes and no diagonal-only pinch points,
 * never a general multi-polygon case. Returns an SVG path `d` string in
 * pixel units (for an `<svg width={boardSizePx} height={boardSizePx}>` with
 * no viewBox scaling), or null for an empty cell set.
 */
export function outlinePath(cells: Cell[], boardSizePx: number, gap: number): string | null {
  if (cells.length === 0) return null;

  const set = new Set(cells.map(([r, c]) => cellKey(r, c)));
  const edges: Array<{ from: Point; to: Point }> = [];

  for (const [r, c] of cells) {
    const left = gridLine(c, boardSizePx, gap);
    const right = gridLine(c + 1, boardSizePx, gap);
    const top = gridLine(r, boardSizePx, gap);
    const bottom = gridLine(r + 1, boardSizePx, gap);
    const topLeft: Point = [left, top];
    const topRight: Point = [right, top];
    const bottomRight: Point = [right, bottom];
    const bottomLeft: Point = [left, bottom];

    // Each side is a boundary edge only if that neighbor isn't in the set.
    // Orientation (top: L->R, right: T->B, bottom: R->L, left: B->T) traces
    // a single isolated cell clockwise in screen (y-down) coordinates; for a
    // merged region the shared/internal edges drop out and the remaining
    // edges chain together at shared vertices into one continuous walk.
    if (!set.has(cellKey(r - 1, c))) edges.push({ from: topLeft, to: topRight });
    if (!set.has(cellKey(r, c + 1))) edges.push({ from: topRight, to: bottomRight });
    if (!set.has(cellKey(r + 1, c))) edges.push({ from: bottomRight, to: bottomLeft });
    if (!set.has(cellKey(r, c - 1))) edges.push({ from: bottomLeft, to: topLeft });
  }

  if (edges.length === 0) return null;

  const nextFrom = new Map<string, Point>();
  for (const e of edges) nextFrom.set(pointKey(e.from), e.to);

  const start = edges[0].from;
  const points: Point[] = [start];
  let current = start;
  for (let i = 0; i < edges.length; i++) {
    const next = nextFrom.get(pointKey(current));
    if (!next) break; // malformed input (not actually connected/hole-free)
    if (pointKey(next) === pointKey(start)) break;
    points.push(next);
    current = next;
  }

  const corners = dropCollinearPoints(points);
  return corners.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ") + " Z";
}

/**
 * Two adjacent same-word cells share an internal edge whose endpoint is a
 * straight pass-through, not a real corner (e.g. the seam between two cells
 * in the middle of a straight run). Drop those so the path has only actual
 * direction changes -- a shorter, cleaner outline, and the natural shape for
 * "one seamless perimeter" rather than one segment per unit cell edge.
 */
function dropCollinearPoints(points: Point[]): Point[] {
  const n = points.length;
  return points.filter((curr, i) => {
    const [px, py] = points[(i - 1 + n) % n];
    const [nx, ny] = points[(i + 1) % n];
    const dx1 = curr[0] - px;
    const dy1 = curr[1] - py;
    const dx2 = nx - curr[0];
    const dy2 = ny - curr[1];
    return Math.abs(dx1 * dy2 - dy1 * dx2) > 1e-9;
  });
}

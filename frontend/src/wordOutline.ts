// Pure/DOM-free: given the cell union of one or more words (main word plus
// any cross words from a single placement), computes which side of each cell
// sits on the outer perimeter of that shape so a border can be drawn there.
// An edge is "outer" whenever the orthogonal neighbor in that direction is
// not itself in the cell set -- this naturally covers the board's own edges
// too, since an out-of-range neighbor can never be in the set, so no board
// dimension is needed here at all.

export interface EdgeSet {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export function outlineEdges(cells: Array<{ row: number; col: number }>): Map<string, EdgeSet> {
  const keys = new Set(cells.map(({ row, col }) => `${row},${col}`));
  const edges = new Map<string, EdgeSet>();

  for (const { row, col } of cells) {
    edges.set(`${row},${col}`, {
      top: !keys.has(`${row - 1},${col}`),
      right: !keys.has(`${row},${col + 1}`),
      bottom: !keys.has(`${row + 1},${col}`),
      left: !keys.has(`${row},${col - 1}`),
    });
  }

  return edges;
}

import { useRef } from "react";
import { cellAt, N, premium } from "../engine";
import type { PendingTile } from "../types";
import type { EdgeSet } from "../wordOutline";
import { Tile } from "./Tile";

interface BoardProps {
  board: string;
  pending: PendingTile[];
  /** Perimeter outline for the pending (not-yet-submitted) move, when valid. */
  wordEdges?: Map<string, EdgeSet>;
  onCellClick?: (row: number, col: number) => void;
  interactive?: boolean;
  /** Cell currently hovered while dragging a tile in from the rack or off the board. */
  dropTarget?: { row: number; col: number; valid: boolean } | null;
  /** The pending tile currently being drag-picked-up off the board, if any. */
  draggingFrom?: { row: number; col: number } | null;
  onTileDragStart?: (row: number, col: number, clientX: number, clientY: number, rect: DOMRect) => void;
  onTileDragMove?: (clientX: number, clientY: number) => void;
  onTileDragEnd?: (clientX: number, clientY: number) => void;
  onTileDragCancel?: () => void;
}

const PREMIUM_LABEL: Record<string, string> = {
  DL: "2L",
  TL: "3L",
  DW: "2W",
  TW: "3W",
};

// Movement (px) beyond which a press on a pending tile is treated as a drag
// rather than a tap-to-remove. Matches the rack's own DRAG_THRESHOLD.
const DRAG_THRESHOLD = 8;

// How far (px) a highlight fill bleeds past a cell's own boundary on every
// side, always -- toward a same-shape neighbor (guaranteeing no grid-line
// sliver ever shows between two highlighted cells, independent of whether
// the tiles' own bleed covers it) and outward past the shape's true outer
// edge (reading as a margin/frame around the whole word).
const FILL_MARGIN = 6;

/** Style for the highlight fill layer of one cell: bleeds past every side by
 * FILL_MARGIN and stays fully square (no rounded corners at all, unlike the
 * tiles) so it never leaves a gap and never mimics the tile's own corner
 * cut. */
function fillStyle(background: string): React.CSSProperties {
  return {
    top: -FILL_MARGIN,
    right: -FILL_MARGIN,
    bottom: -FILL_MARGIN,
    left: -FILL_MARGIN,
    background,
    borderRadius: 0,
  };
}

// How far (px) every board tile bleeds past its own cell, on all four sides
// *uniformly*. The board's grid gap is 2px, so two adjacent tiles each
// bleeding 1.5px overlap by 1px past the gap's center -- guaranteeing a
// continuous fill with no sliver at any zoom. Crucially the bleed is uniform
// (not per-neighbor): if a tile only bled toward sides that *have* a
// neighbor, a tile with a letter above it (e.g. a cross-word junction) would
// grow taller/wider than its in-row siblings that don't, so their faces
// would no longer line up -- the exact "this tile sits higher / sticks out
// to the left" misalignment we're avoiding. Bleeding every side equally
// keeps every tile face on the same grid lines; the only cost is that an
// outer edge pokes ~1.5px into the gap toward an empty cell, which just
// reads as the played word being one slightly-raised capsule.
const TILE_BLEED = 1.5;

const TILE_BLEED_STYLE: React.CSSProperties = {
  position: "absolute",
  top: -TILE_BLEED,
  right: -TILE_BLEED,
  bottom: -TILE_BLEED,
  left: -TILE_BLEED,
};

// Same bleed, but forced *below* the green move-fill (which is z-index 1;
// tiles are z-index 2 by default). Used only for committed tiles that are
// NOT part of the word(s) the current pending move forms -- e.g. the rest of
// an existing word that the play merely butts up against. Dropping them under
// the fill lets the green bleed paint over their abutting edge, so the
// highlight reads as fully enclosing the played words: it draws a clean green
// divider between the last played letter and the pre-existing tile next to it
// (the C|A boundary), instead of stopping short because that neighbor tile
// covered it. Play tiles (pending + the committed anchors that ARE in a formed
// word, like the shared C) stay above the fill so their faces and letters show
// through with the green only framing them. */
const TILE_BLEED_STYLE_UNDER_FILL: React.CSSProperties = {
  ...TILE_BLEED_STYLE,
  zIndex: 0,
};

export function Board({
  board,
  pending,
  wordEdges,
  onCellClick,
  interactive,
  dropTarget,
  draggingFrom,
  onTileDragStart,
  onTileDragMove,
  onTileDragEnd,
  onTileDragCancel,
}: BoardProps) {
  const pendingAt = new Map(pending.map((t) => [`${t.row},${t.col}`, t]));

  // Pointer handling lives on the stable `.board` container rather than on
  // individual cells, same reasoning as Rack: it's immune to any future
  // reordering/remount churn, and it lets us intercept only the cells that
  // actually hold a not-yet-played tile without disturbing plain
  // place-on-empty-cell clicks (those keep working via the per-cell onClick
  // below, since we only setPointerCapture -- and only then retarget the
  // compatibility click event -- for presses that start on a pending tile).
  const gesture = useRef<{
    pointerId: number;
    row: number;
    col: number;
    startX: number;
    startY: number;
    dragging: boolean;
    rect: DOMRect;
  } | null>(null);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const cellEl = (e.target as HTMLElement).closest<HTMLElement>("[data-board-row]");
    if (!cellEl) return;
    const row = Number(cellEl.dataset.boardRow);
    const col = Number(cellEl.dataset.boardCol);
    if (!pendingAt.has(`${row},${col}`)) return; // only not-yet-played tiles are draggable
    const tileEl = cellEl.querySelector<HTMLElement>(".tile");
    if (!tileEl) return;
    e.stopPropagation(); // keep BoardViewport's pan/pinch tracking from ever seeing this pointer
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      pointerId: e.pointerId,
      row,
      col,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      rect: tileEl.getBoundingClientRect(),
    };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.dragging) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      g.dragging = true;
      onTileDragStart?.(g.row, g.col, e.clientX, e.clientY, g.rect);
    }
    onTileDragMove?.(e.clientX, e.clientY);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (g.dragging) {
      onTileDragEnd?.(e.clientX, e.clientY);
    } else {
      // A plain tap on a pending tile removes it, same as the native click
      // this replaces (retargeted away by our own setPointerCapture above).
      onCellClick?.(g.row, g.col);
    }
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (g.dragging) onTileDragCancel?.();
  }

  // Any cell holding a letter -- pending or already committed -- counts as
  // "content" for deciding a tile's square (interior) vs rounded (word-end)
  // corners, regardless of which of the two a neighbor is.
  function hasContent(row: number, col: number) {
    if (row < 0 || row >= N || col < 0 || col >= N) return false;
    return cellAt(board, row, col) !== "." || pendingAt.has(`${row},${col}`);
  }

  const cells = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const key = `${row},${col}`;
      const committed = cellAt(board, row, col);
      const pend = pendingAt.get(key);
      const prem = premium(row, col);
      const isCenter = row === 7 && col === 7;
      const wordEdge = wordEdges?.get(key);
      const isDropTarget = dropTarget?.row === row && dropTarget?.col === col;

      let content = null;
      if (pend || committed !== ".") {
        // Squares the corner facing any flush neighbor -- pending or
        // committed, doesn't matter -- so a whole run of tiles (even a
        // brand-new placement touching an existing letter) reads as one
        // rounded capsule instead of each letter showing its own corner cut
        // (which would otherwise leave a tiny diamond-shaped gap at every
        // interior seam). See Tile's squareTL/squareBR doc.
        const squareTL = hasContent(row, col - 1) || hasContent(row - 1, col);
        const squareBR = hasContent(row, col + 1) || hasContent(row + 1, col);
        // A committed tile that a valid pending move exists but which is NOT
        // itself part of any word that move forms drops below the green fill,
        // so the fill's bleed paints the enclosing divider over its edge (see
        // TILE_BLEED_STYLE_UNDER_FILL). Play tiles -- every pending tile, and
        // committed anchors that ARE in a formed word -- stay above the fill.
        const underFill = !pend && !!wordEdges && !wordEdges.has(key);
        content = pend ? (
          <Tile
            letter={pend.letter}
            blank={pend.blank}
            dragging={draggingFrom?.row === row && draggingFrom?.col === col}
            pending
            squareTL={squareTL}
            squareBR={squareBR}
            small
            style={TILE_BLEED_STYLE}
          />
        ) : (
          <Tile
            letter={committed}
            blank={committed >= "a" && committed <= "z"}
            board
            squareTL={squareTL}
            squareBR={squareBR}
            small
            style={underFill ? TILE_BLEED_STYLE_UNDER_FILL : TILE_BLEED_STYLE}
          />
        );
      }

      // Green highlight fill behind the in-progress (valid) pending word.
      const fill = wordEdge ? { style: fillStyle("var(--word-fill)") } : null;

      cells.push(
        <button
          key={key}
          type="button"
          data-board-row={row}
          data-board-col={col}
          className={[
            "cell",
            prem ? `cell-${prem.toLowerCase()}` : "",
            isCenter ? "cell-center" : "",
            content ? "cell-filled" : "",
            isDropTarget ? (dropTarget!.valid ? "cell-drop-valid" : "cell-drop-invalid") : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={interactive ? () => onCellClick?.(row, col) : undefined}
          disabled={!interactive}
        >
          {fill && <span className="cell-fill" style={fill.style} />}
          {content ??
            (prem ? (
              <span className="cell-premium">{isCenter ? "★" : PREMIUM_LABEL[prem]}</span>
            ) : null)}
        </button>,
      );
    }
  }

  return (
    <div
      className="board"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {cells}
    </div>
  );
}

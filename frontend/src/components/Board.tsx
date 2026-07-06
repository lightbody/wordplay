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
  /** Perimeter outline for the most recently committed move. */
  lastMoveEdges?: Map<string, EdgeSet>;
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

// How far (px) a highlight fill bleeds *outward* past a cell that sits on
// the true outer perimeter of the shape, so the highlight reads as a margin
///frame around the whole word rather than hugging each tile's edge.
// Interior sides (shared with another cell of the same shape) get no bleed
// at all -- the tiles there are already flush (see tileBleedStyle/the
// squareTL/squareBR corner logic below), so there's no seam for the fill to
// need to cover.
const FILL_MARGIN = 5;
const FILL_RADIUS = 12;

/** Style for the highlight fill layer of one cell: extends past the cell on
 * any side that's an outer edge of the shape (creating the visible margin),
 * stays flush on interior sides, and only rounds the corners that sit on two
 * outer edges (the shape's own corners), matching the board's diagonal
 * top-left/bottom-right cut. */
function fillStyle(edge: EdgeSet, background: string): React.CSSProperties {
  return {
    top: edge.top ? -FILL_MARGIN : 0,
    right: edge.right ? -FILL_MARGIN : 0,
    bottom: edge.bottom ? -FILL_MARGIN : 0,
    left: edge.left ? -FILL_MARGIN : 0,
    background,
    borderTopLeftRadius: edge.top && edge.left ? FILL_RADIUS : 0,
    borderBottomRightRadius: edge.bottom && edge.right ? FILL_RADIUS : 0,
  };
}

// How far (px) a tile itself bleeds past its own cell toward a neighboring
// tile, so the board's grid-line gap is fully covered and no letter tile
// ever shows a seam next to another -- bigger than half the board's 2px
// grid gap so the two neighbors' bleed fully overlaps rather than leaving a
// sub-pixel sliver at some zoom levels.
const TILE_BLEED = 2;

/** Inset style for a tile that should bleed into any side with a neighboring
 * tile (pending or committed), so adjacent letters merge into one
 * continuous strip instead of leaving the grid's white gap visible between
 * them. Unlike the highlight fill above, this applies to every tile
 * regardless of word membership -- it's purely about hiding the grid. */
function tileBleedStyle(hasTop: boolean, hasRight: boolean, hasBottom: boolean, hasLeft: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: hasTop ? -TILE_BLEED : 0,
    right: hasRight ? -TILE_BLEED : 0,
    bottom: hasBottom ? -TILE_BLEED : 0,
    left: hasLeft ? -TILE_BLEED : 0,
  };
}

export function Board({
  board,
  pending,
  wordEdges,
  lastMoveEdges,
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
  // "content" for the purpose of hiding the grid gap between neighboring
  // tiles (tileBleedStyle below), regardless of which of the two a
  // neighbor is.
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
      const lastEdge = lastMoveEdges?.get(key);
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
        const bleed = tileBleedStyle(
          hasContent(row - 1, col),
          hasContent(row, col + 1),
          hasContent(row + 1, col),
          hasContent(row, col - 1),
        );
        content = pend ? (
          <Tile
            letter={pend.letter}
            blank={pend.blank}
            dragging={draggingFrom?.row === row && draggingFrom?.col === col}
            pending
            squareTL={squareTL}
            squareBR={squareBR}
            small
            style={bleed}
          />
        ) : (
          <Tile
            letter={committed}
            blank={committed >= "a" && committed <= "z"}
            board
            squareTL={squareTL}
            squareBR={squareBR}
            small
            style={bleed}
          />
        );
      }

      // Only one highlight fill renders per cell: the in-progress pending
      // word (green) takes priority over the previous move's marker (accent)
      // -- in practice the two never actually land on the same cell, since
      // pending tiles only ever occupy cells that were previously empty.
      const fill = wordEdge
        ? { style: fillStyle(wordEdge, "var(--word-fill)") }
        : lastEdge
          ? { style: fillStyle(lastEdge, "var(--last-move-fill)") }
          : null;

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

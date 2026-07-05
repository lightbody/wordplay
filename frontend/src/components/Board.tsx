import { useRef } from "react";
import { cellAt, N, premium } from "../engine";
import type { PendingTile } from "../types";
import { Tile } from "./Tile";

interface BoardProps {
  board: string;
  pending: PendingTile[];
  lastMove?: Set<string>;
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

export function Board({
  board,
  pending,
  lastMove,
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

  const cells = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const key = `${row},${col}`;
      const committed = cellAt(board, row, col);
      const pend = pendingAt.get(key);
      const prem = premium(row, col);
      const isCenter = row === 7 && col === 7;
      const isLast = lastMove?.has(key);
      const isDropTarget = dropTarget?.row === row && dropTarget?.col === col;

      let content = null;
      if (pend) {
        content = (
          <Tile
            letter={pend.letter}
            blank={pend.blank}
            dragging={draggingFrom?.row === row && draggingFrom?.col === col}
            pending
            small
          />
        );
      } else if (committed !== ".") {
        content = (
          <Tile
            letter={committed}
            blank={committed >= "a" && committed <= "z"}
            small
          />
        );
      }

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
            isLast ? "cell-last" : "",
            content ? "cell-filled" : "",
            isDropTarget ? (dropTarget!.valid ? "cell-drop-valid" : "cell-drop-invalid") : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={interactive ? () => onCellClick?.(row, col) : undefined}
          disabled={!interactive}
        >
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

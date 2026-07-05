// Persistent manual/scripted test harness for the board + rack drag-and-drop
// interactions (Board, BoardViewport, Rack, Tile). GameScreen itself needs
// WorkOS auth + a live backend + ElectricSQL, none of which are available in
// a Claude Code remote session, so this mounts the real components with
// hand-built mock data instead. Not part of the app: not imported from
// main.tsx, not linked from any route. Vite's dev server serves any .html
// file at the project root automatically -- `npm run dev` and navigate to
// /drag-harness.html. See CLAUDE.md for how to drive it with Playwright.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LayoutGroup } from "motion/react";
import { N, isEmpty } from "./engine";
import { moveItem, rackColumnAt } from "./dragMath";
import type { PendingTile } from "./types";
import { Board } from "./components/Board";
import { BoardViewport } from "./components/BoardViewport";
import { Rack } from "./components/Rack";
import { Tile } from "./components/Tile";
import "./App.css";

type DropTarget = { type: "board"; row: number; col: number; valid: boolean } | { type: "rack"; index: number };

const EMPTY_BOARD = ".".repeat(N * N);

function Harness() {
  const rack = "HELLO?Z";
  const [order, setOrder] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [pending, setPending] = useState<PendingTile[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState<{
    rackIndex: number;
    letter: string;
    width: number;
    height: number;
    x: number;
    y: number;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragInfoRef = useRef<number | null>(null);
  const dragStartOrderRef = useRef<number[] | null>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);

  const usedIndices = new Set(pending.map((p) => p.rackIndex));

  function placeLetterAt(rackIndex: number, row: number, col: number) {
    const letter = rack[rackIndex];
    setPending((p) => [...p, { row, col, rackIndex, letter: letter === "?" ? "X" : letter, blank: letter === "?" }]);
  }

  function placeOnCell(row: number, col: number) {
    const existing = pending.find((p) => p.row === row && p.col === col);
    if (existing) {
      setPending((p) => p.filter((t) => t !== existing));
      return;
    }
    if (selected === null || !isEmpty(EMPTY_BOARD, row, col)) return;
    placeLetterAt(selected, row, col);
    setSelected(null);
  }

  function dragHitTest(clientX: number, clientY: number): DropTarget | null {
    const rackEl = document.querySelector(".rack");
    if (rackEl) {
      const rect = rackEl.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return { type: "rack", index: rackColumnAt(clientX, rect.left, rect.width, order.length) };
      }
    }
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const cellEl = el.closest<HTMLElement>("[data-board-row]");
    if (cellEl) {
      const row = Number(cellEl.dataset.boardRow);
      const col = Number(cellEl.dataset.boardCol);
      const occupied = !isEmpty(EMPTY_BOARD, row, col) || pending.some((p) => p.row === row && p.col === col);
      return { type: "board", row, col, valid: !occupied };
    }
    return null;
  }

  function sameDropTarget(a: DropTarget | null, b: DropTarget | null): boolean {
    if (a === b) return true;
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === "board" && b.type === "board") return a.row === b.row && a.col === b.col && a.valid === b.valid;
    if (a.type === "rack" && b.type === "rack") return a.index === b.index;
    return false;
  }

  function positionGhost(x: number, y: number) {
    if (dragGhostRef.current) {
      dragGhostRef.current.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(1.08)`;
    }
  }

  function applyOrderPreview(hit: DropTarget | null) {
    const startOrder = dragStartOrderRef.current;
    const rackIndex = dragInfoRef.current;
    if (startOrder === null || rackIndex === null) return;
    if (hit?.type === "rack") {
      const from = startOrder.indexOf(rackIndex);
      setOrder(from === -1 ? startOrder : moveItem(startOrder, from, hit.index));
    } else {
      setOrder(startOrder);
    }
  }

  function startTileDrag(rackIndex: number, x: number, y: number, rect: DOMRect) {
    setSelected(null);
    dragInfoRef.current = rackIndex;
    dragStartOrderRef.current = order;
    setDragActive({ rackIndex, letter: rack[rackIndex], width: rect.width, height: rect.height, x, y });
    const hit = dragHitTest(x, y);
    setDropTarget(hit);
    applyOrderPreview(hit);
  }

  function moveTileDrag(x: number, y: number) {
    positionGhost(x, y);
    const next = dragHitTest(x, y);
    if (sameDropTarget(dropTarget, next)) return;
    setDropTarget(next);
    applyOrderPreview(next);
  }

  function endTileDrag(x: number, y: number) {
    const rackIndex = dragInfoRef.current;
    const startOrder = dragStartOrderRef.current;
    dragInfoRef.current = null;
    dragStartOrderRef.current = null;
    setDragActive(null);
    setDropTarget(null);
    if (rackIndex === null) return;
    const hit = dragHitTest(x, y);
    if (hit?.type === "board" && hit.valid) {
      if (startOrder) setOrder(startOrder);
      placeLetterAt(rackIndex, hit.row, hit.col);
    } else if (hit?.type === "rack" && startOrder) {
      const from = startOrder.indexOf(rackIndex);
      setOrder(from === -1 ? startOrder : moveItem(startOrder, from, hit.index));
    } else if (startOrder) {
      setOrder(startOrder);
    }
  }

  function cancelTileDrag() {
    const startOrder = dragStartOrderRef.current;
    dragInfoRef.current = null;
    dragStartOrderRef.current = null;
    setDragActive(null);
    setDropTarget(null);
    if (startOrder) setOrder(startOrder);
  }

  return (
    <div className="app-page game-screen" id="harness-root">
      <div
        id="debug-log"
        style={{ position: "fixed", top: 0, right: 0, fontSize: 10, background: "#fff", color: "#000", zIndex: 999 }}
      >
        order: {JSON.stringify(order)} | pending: {JSON.stringify(pending.map((p) => `${p.row},${p.col}=${p.letter}`))}
      </div>
      <LayoutGroup>
        <div className="game-middle">
          <BoardViewport>
            <Board
              board={EMPTY_BOARD}
              pending={pending}
              interactive
              onCellClick={placeOnCell}
              dropTarget={dropTarget?.type === "board" ? dropTarget : null}
            />
          </BoardViewport>
        </div>
        <div className="bottom-bar">
          <div className="rack-area">
            <Rack
              rack={rack}
              order={order}
              usedIndices={usedIndices}
              selectedIndex={selected}
              onSelect={(rackIndex) => setSelected((cur) => (cur === rackIndex ? null : rackIndex))}
              draggingIndex={dragActive?.rackIndex ?? null}
              dropIndex={dropTarget?.type === "rack" ? dropTarget.index : null}
              onDragStart={startTileDrag}
              onDragMove={moveTileDrag}
              onDragEnd={endTileDrag}
              onDragCancel={cancelTileDrag}
            />
          </div>
        </div>
      </LayoutGroup>
      {dragActive && (
        <div
          ref={dragGhostRef}
          className="drag-ghost"
          style={{
            width: dragActive.width,
            height: dragActive.height,
            transform: `translate(${dragActive.x}px, ${dragActive.y}px) translate(-50%, -50%) scale(1.08)`,
          }}
        >
          <Tile letter={dragActive.letter === "?" ? "" : dragActive.letter} blank={dragActive.letter === "?"} />
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

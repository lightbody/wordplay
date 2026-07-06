// Persistent manual/scripted test harness for the board + rack drag-and-drop
// interactions (Board, BoardViewport, Rack, Tile). GameScreen itself needs
// WorkOS auth + a live backend + ElectricSQL, none of which are available in
// a Claude Code remote session, so this mounts the real components with
// hand-built mock data instead. Not part of the app: not imported from
// main.tsx, not linked from any route. Vite's dev server serves any .html
// file at the project root automatically -- `npm run dev` and navigate to
// /drag-harness.html. See CLAUDE.md for how to drive it with Playwright.
//
// Placement is drag-only (no tap-to-select-then-place), matching GameScreen:
// drag a rack tile onto the board to place it, drag within the rack to
// reorder, drag a pending (not yet submitted) board tile back to the rack to
// recall it or onto a different empty cell to reposition it. Tapping a
// pending board tile still removes it, as a quick alternative to dragging.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { N, isEmpty, checkPlacement } from "./engine";
import { moveItem, rackColumnAt } from "./dragMath";
import type { Cell } from "./boardOutline";
import { checkPlacementWasm, loadEngine, toWireTile, useEngineStatus } from "./wasmEngine";
import type { PendingTile } from "./types";
import { Board } from "./components/Board";
import { BoardViewport } from "./components/BoardViewport";
import { Rack } from "./components/Rack";
import { Tile } from "./components/Tile";
import "./App.css";

type DropTarget = { type: "board"; row: number; col: number; valid: boolean } | { type: "rack"; index: number };
type DragSource = { kind: "rack"; rackIndex: number } | { kind: "board"; rackIndex: number; row: number; col: number };

const EMPTY_BOARD = ".".repeat(N * N);

// HELLO across row 7 cols 4-8, with an "A" below the H -- mirrors the Rust
// `single_tile_can_form_two_words` fixture, so placing "S" at (8,5) forms
// both AS (main, horizontal) and ES (cross, vertical) at once.
const PREFILLED_BOARD = (() => {
  const cells = EMPTY_BOARD.split("");
  for (let i = 0; i < "HELLO".length; i++) cells[7 * N + 4 + i] = "HELLO"[i];
  cells[8 * N + 4] = "A";
  return cells.join("");
})();

type Scenario = "valid" | "invalid-word" | "structurally-invalid";

/** rackIndex 0='S' 1='Z' 2='X' -- see the rack string below. */
function scenarioTiles(scenario: Scenario): PendingTile[] {
  switch (scenario) {
    case "valid":
      // Forms AS + ES, both real dictionary words -- expect a gold border.
      return [{ row: 8, col: 5, rackIndex: 0, letter: "S", blank: false }];
    case "invalid-word":
      // Extends HELLO -> HELLOZ, structurally fine but not a real word --
      // expect no border and Play to stay disabled once the dictionary
      // check is ready.
      return [{ row: 7, col: 9, rackIndex: 1, letter: "Z", blank: false }];
    case "structurally-invalid":
      // Disconnected from any existing tile -- fails the structural check
      // before the dictionary is even consulted.
      return [{ row: 0, col: 0, rackIndex: 2, letter: "X", blank: false }];
  }
}

function dedupeCells(cells: Cell[]): Cell[] {
  const seen = new Set<string>();
  const result: Cell[] = [];
  for (const c of cells) {
    const key = `${c[0]},${c[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(c);
    }
  }
  return result;
}

function Harness() {
  const rack = "SZXHE?O";
  const [order, setOrder] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [pending, setPending] = useState<PendingTile[]>([]);
  const engineStatus = useEngineStatus();

  useEffect(() => {
    loadEngine();
  }, []);
  const [dragActive, setDragActive] = useState<{
    rackIndex: number;
    letter: string;
    blank: boolean;
    width: number;
    height: number;
    x: number;
    y: number;
    origin: DragSource;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragInfoRef = useRef<DragSource | null>(null);
  const dragStartOrderRef = useRef<number[] | null>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);

  const usedIndices = new Set(pending.map((p) => p.rackIndex));
  const rackUsedIndices =
    dragActive?.origin.kind === "board"
      ? new Set([...usedIndices].filter((i) => i !== dragActive.rackIndex))
      : usedIndices;

  const placement = checkPlacement(PREFILLED_BOARD, pending);
  const wasmResult =
    engineStatus === "ready" ? checkPlacementWasm(PREFILLED_BOARD, rack, pending.map(toWireTile)) : null;
  const loadingBlock = engineStatus === "loading" && pending.length > 0;
  const wordsValid = placement.valid && (engineStatus !== "ready" || (wasmResult?.valid ?? false));
  const canPlay = pending.length > 0 && !loadingBlock && wordsValid;
  const highlightCells: Cell[] = wasmResult?.valid
    ? dedupeCells(wasmResult.words.flatMap((w) => w.cells))
    : [];

  function setScenario(scenario: Scenario) {
    setPending(scenarioTiles(scenario));
  }

  function placeLetterAt(rackIndex: number, row: number, col: number) {
    const letter = rack[rackIndex];
    setPending((p) => [...p, { row, col, rackIndex, letter: letter === "?" ? "X" : letter, blank: letter === "?" }]);
  }

  function removePendingTile(row: number, col: number) {
    const existing = pending.find((p) => p.row === row && p.col === col);
    if (existing) setPending((p) => p.filter((t) => t !== existing));
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
      const draggedRackIndex = dragInfoRef.current?.rackIndex;
      const occupied =
        !isEmpty(PREFILLED_BOARD, row, col) ||
        pending.some((p) => p.row === row && p.col === col && p.rackIndex !== draggedRackIndex);
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
      dragGhostRef.current.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  const GHOST_SCALE = 1.35;
  function ghostSize(fallbackRect: DOMRect): number {
    const rackTile = document.querySelector<HTMLElement>(".rack .tile");
    const base = rackTile ? rackTile.getBoundingClientRect().width : fallbackRect.width;
    return base * GHOST_SCALE;
  }

  function applyOrderPreview(hit: DropTarget | null) {
    const startOrder = dragStartOrderRef.current;
    const info = dragInfoRef.current;
    if (startOrder === null || info === null) return;
    if (hit?.type === "rack") {
      const from = startOrder.indexOf(info.rackIndex);
      setOrder(from === -1 ? startOrder : moveItem(startOrder, from, hit.index));
    } else {
      setOrder(startOrder);
    }
  }

  function startTileDrag(rackIndex: number, x: number, y: number, rect: DOMRect) {
    dragInfoRef.current = { kind: "rack", rackIndex };
    dragStartOrderRef.current = order;
    const letter = rack[rackIndex];
    const blank = letter === "?";
    const size = ghostSize(rect);
    setDragActive({
      rackIndex,
      letter: blank ? "" : letter,
      blank,
      width: size,
      height: size,
      x,
      y,
      origin: { kind: "rack", rackIndex },
    });
    const hit = dragHitTest(x, y);
    setDropTarget(hit);
    applyOrderPreview(hit);
  }

  function startBoardTileDrag(row: number, col: number, x: number, y: number, rect: DOMRect) {
    const pend = pending.find((p) => p.row === row && p.col === col);
    if (!pend) return;
    dragInfoRef.current = { kind: "board", rackIndex: pend.rackIndex, row, col };
    dragStartOrderRef.current = order;
    const size = ghostSize(rect);
    setDragActive({
      rackIndex: pend.rackIndex,
      letter: pend.letter,
      blank: pend.blank,
      width: size,
      height: size,
      x,
      y,
      origin: { kind: "board", rackIndex: pend.rackIndex, row, col },
    });
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
    const info = dragInfoRef.current;
    const startOrder = dragStartOrderRef.current;
    dragInfoRef.current = null;
    dragStartOrderRef.current = null;
    setDragActive(null);
    setDropTarget(null);
    if (!info) return;
    const hit = dragHitTest(x, y);

    if (hit?.type === "rack" && startOrder) {
      const from = startOrder.indexOf(info.rackIndex);
      setOrder(from === -1 ? startOrder : moveItem(startOrder, from, hit.index));
    } else if (startOrder) {
      setOrder(startOrder);
    }

    if (info.kind === "rack") {
      if (hit?.type === "board" && hit.valid) placeLetterAt(info.rackIndex, hit.row, hit.col);
      return;
    }

    if (hit?.type === "rack") {
      setPending((p) => p.filter((t) => !(t.row === info.row && t.col === info.col)));
    } else if (hit?.type === "board" && hit.valid) {
      setPending((p) =>
        p.map((t) => (t.row === info.row && t.col === info.col ? { ...t, row: hit.row, col: hit.col } : t)),
      );
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
        {" | "}engineStatus: {engineStatus} | placement.valid: {String(placement.valid)} | wasmResult:{" "}
        {JSON.stringify(wasmResult)} | canPlay: {String(canPlay)}
      </div>
      <div style={{ position: "fixed", top: 40, right: 0, zIndex: 999, display: "flex", gap: 4 }}>
        <button onClick={() => setScenario("valid")}>Valid word (AS/ES)</button>
        <button onClick={() => setScenario("invalid-word")}>Invalid word (HELLOZ)</button>
        <button onClick={() => setScenario("structurally-invalid")}>Structurally invalid</button>
        <button onClick={() => setPending([])}>Clear</button>
      </div>
      <div className="game-middle">
        <BoardViewport>
          <Board
            board={PREFILLED_BOARD}
            pending={pending}
            interactive
            onCellClick={removePendingTile}
            dropTarget={dropTarget?.type === "board" ? dropTarget : null}
            draggingFrom={dragActive?.origin.kind === "board" ? dragActive.origin : null}
            highlightCells={highlightCells}
            onTileDragStart={startBoardTileDrag}
            onTileDragMove={moveTileDrag}
            onTileDragEnd={endTileDrag}
            onTileDragCancel={cancelTileDrag}
          />
        </BoardViewport>
      </div>
      <div className="bottom-bar">
        <div className="rack-area">
          <Rack
            rack={rack}
            order={order}
            usedIndices={rackUsedIndices}
            draggingIndex={dragActive?.rackIndex ?? null}
            onDragStart={startTileDrag}
            onDragMove={moveTileDrag}
            onDragEnd={endTileDrag}
            onDragCancel={cancelTileDrag}
          />
        </div>
        <div className="game-actions">
          <button className="btn btn-primary" disabled={!canPlay} onClick={() => undefined}>
            {loadingBlock
              ? "Play (checking dictionary…)"
              : wordsValid && pending.length > 0
                ? `Play (${wasmResult?.score ?? placement.score})`
                : "Play"}
          </button>
        </div>
      </div>
      {dragActive && (
        <div
          ref={dragGhostRef}
          className={["drag-ghost", dropTarget?.type === "board" ? "drag-ghost-over-board" : ""]
            .filter(Boolean)
            .join(" ")}
          style={{
            width: dragActive.width,
            height: dragActive.height,
            transform: `translate(${dragActive.x}px, ${dragActive.y}px) translate(-50%, -50%)`,
          }}
        >
          <Tile letter={dragActive.letter} blank={dragActive.blank} />
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

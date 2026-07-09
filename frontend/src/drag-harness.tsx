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
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Dictionary } from "@wordplay/shared";
import { N, checkPlacement, checkPlacementWithDictionary, isEmpty } from "./engine";
import { moveItem, rackColumnAt } from "./dragMath";
import { outlineEdges } from "./wordOutline";
import type { PendingTile } from "./types";
import { Board } from "./components/Board";
import { BoardViewport } from "./components/BoardViewport";
import { Rack } from "./components/Rack";
import { Tile } from "./components/Tile";
import { MoreIcon, RecallIcon, SwapIcon } from "./components/icons";
import "./App.css";

type DropTarget = { type: "board"; row: number; col: number; valid: boolean } | { type: "rack"; index: number };
type DragSource = { kind: "rack"; rackIndex: number } | { kind: "board"; rackIndex: number; row: number; col: number };

const EMPTY_BOARD = ".".repeat(N * N);

function Harness() {
  const rack = "HELLO?Z";
  const [order, setOrder] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [pending, setPending] = useState<PendingTile[]>([]);
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
        !isEmpty(EMPTY_BOARD, row, col) ||
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
      </div>
      <div className="game-middle">
        <BoardViewport>
          <Board
            board={EMPTY_BOARD}
            pending={pending}
            interactive
            onCellClick={removePendingTile}
            dropTarget={dropTarget?.type === "board" ? dropTarget : null}
            draggingFrom={dragActive?.origin.kind === "board" ? dragActive.origin : null}
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

// Scenario for visually verifying the move-highlight UI: a small pre-existing
// board with a committed word (connectivity anchor for the pending move) and
// a separate committed word elsewhere, plus a pending L-shaped multi-word
// placement (a 3-letter main word with one perpendicular cross word, sharing
// a corner cell -- see wordOutline.test.ts for the same shape category). A
// mock Dictionary accepts every word the scenario forms except one toggleable
// "bad" word, so the green valid / no-highlight invalid states and the Play
// button's disabled state can all be confirmed by flipping one button.
const OUTLINE_BOARD = (() => {
  const cells = ".".repeat(N * N).split("");
  const place = (row: number, col: number, letter: string) => {
    cells[row * N + col] = letter;
  };
  // Committed word: connectivity anchor for the pending placement below it.
  place(7, 7, "C");
  place(7, 8, "A");
  place(7, 9, "R");
  place(7, 10, "T");
  // A separate committed word elsewhere (a plain vertical committed run, to
  // eyeball committed-tile rendering).
  place(2, 2, "P");
  place(3, 2, "E");
  place(4, 2, "N");
  return cells.join("");
})();

// Forms main word "SIT" (row 8, cols 5-7, all new) plus one cross word "CT"
// with the existing "C" at (7,7) -- an L-shape: a horizontal run with one
// tile sticking up from its right end.
const OUTLINE_PENDING: PendingTile[] = [
  { row: 8, col: 5, rackIndex: 0, letter: "S", blank: false },
  { row: 8, col: 6, rackIndex: 1, letter: "I", blank: false },
  { row: 8, col: 7, rackIndex: 2, letter: "T", blank: false },
];

const BAD_WORD = "SIT";

function makeMockDictionary(rejectWord: string | null): Dictionary {
  return {
    isWord(word: string) {
      if (rejectWord && word.toUpperCase() === rejectWord.toUpperCase()) return false;
      return true;
    },
    size: 2,
  };
}

function OutlineHarness({ initialInvalid }: { initialInvalid: boolean }) {
  const [invalid, setInvalid] = useState(initialInvalid);

  const rack = OUTLINE_PENDING.map((t) => t.letter).join("");
  const dictionary = makeMockDictionary(invalid ? BAD_WORD : null);
  const placement = checkPlacementWithDictionary(OUTLINE_BOARD, rack, OUTLINE_PENDING, dictionary);
  const wordEdges = placement.valid ? outlineEdges(placement.wordCells) : undefined;
  // Same "lowest/rightmost pending tile" + dictionary-blind fallback score
  // logic as GameScreen -- see its scoreBadge comment.
  const corner = OUTLINE_PENDING.reduce((best, t) =>
    t.row > best.row || (t.row === best.row && t.col > best.col) ? t : best,
  );
  const scoreBadge = {
    row: corner.row,
    col: corner.col,
    score: placement.valid ? placement.score : checkPlacement(OUTLINE_BOARD, OUTLINE_PENDING).score,
    valid: placement.valid,
  };

  return (
    <div className="app-page game-screen" id="harness-root">
      <div
        id="debug-log"
        style={{ position: "fixed", top: 0, right: 0, fontSize: 10, background: "#fff", color: "#000", zIndex: 999 }}
      >
        dict: {invalid ? "invalid (SIT rejected)" : "valid"} | placement.valid: {String(placement.valid)} | badge
        score: {scoreBadge.score}
        {" · "}
        {/* Harness-only control (not part of the shipped app): flips the mock
         * dictionary to preview both the valid/invalid score-badge states. */}
        <button id="toggle-dict" onClick={() => setInvalid((v) => !v)}>
          toggle dictionary
        </button>
      </div>
      <div className="game-middle">
        <BoardViewport>
          <Board board={OUTLINE_BOARD} pending={OUTLINE_PENDING} wordEdges={wordEdges} scoreBadge={scoreBadge} />
        </BoardViewport>
      </div>
      <div className="bottom-bar">
        <div className="game-actions">
          <button className="action-btn" disabled>
            <MoreIcon />
            <span>More</span>
          </button>
          <button className="action-btn" disabled>
            <SwapIcon />
            <span>Swap</span>
          </button>
          <button className="action-btn" disabled>
            <RecallIcon />
            <span>Recall</span>
          </button>
          <button className="btn btn-primary action-play" id="play-button" disabled={!placement.valid}>
            Play
          </button>
        </div>
      </div>
    </div>
  );
}

const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario");
const initialInvalid = params.get("dict") === "invalid";

createRoot(document.getElementById("root")!).render(
  scenario === "outline" ? <OutlineHarness initialInvalid={initialInvalid} /> : <Harness />,
);

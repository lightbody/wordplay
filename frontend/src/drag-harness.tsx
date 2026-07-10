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

// Mirrors GameScreen's cascade constants/helpers for the Play-button
// simulation below (see submitPlay/playedHorizontally/orderCellsForCascade
// in pages/GameScreen.tsx).
const PLAY_CASCADE_STAGGER_MS = 90;
const JUST_PLAYED_FALLBACK_MS = 5000;
const FILL_FADE_MS = 400;
function playedHorizontally(tiles: PendingTile[]): boolean {
  return tiles.length <= 1 || tiles.every((t) => t.row === tiles[0].row);
}
function orderCellsForCascade<T extends { row: number; col: number }>(cells: T[], horizontal: boolean): T[] {
  return [...cells].sort((a, b) => (horizontal ? a.col - b.col || a.row - b.row : a.row - b.row || a.col - b.col));
}
// Accepts every word -- this harness is about the animation, not dictionary
// validation, so any placed run of tiles should show the green highlight.
const ACCEPT_ALL_DICTIONARY: Dictionary = { isWord: () => true, size: 0 };

function Harness() {
  const rack = "HELLO?Z";
  const [order, setOrder] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [pending, setPending] = useState<PendingTile[]>([]);
  const [board, setBoard] = useState(EMPTY_BOARD);
  const [justPlayed, setJustPlayed] = useState<
    { row: number; col: number; letter: string; blank: boolean; delayMs: number }[]
  >([]);
  const justPlayedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [justPlayedFill, setJustPlayedFill] = useState<Map<string, number>>(new Map());
  const justPlayedFillTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placement = checkPlacementWithDictionary(board, rack, pending, ACCEPT_ALL_DICTIONARY);
  const wordEdges = placement.valid ? outlineEdges(placement.wordCells) : undefined;
  // Simulates the real app's ElectricSQL sync lag: the committed `board`
  // catches up to the just-played tiles some time *after* the play "submits"
  // (pending clears), reproducing the exact race that used to cause a
  // flash -- see justPlayed's doc on Board.tsx. Deliberately longer than the
  // cascade's own stagger+transition time, so this harness actually exercises
  // the "board syncs after the animation would have finished" case.
  const SIMULATED_SYNC_LAG_MS = 700;

  // Mirrors GameScreen's board-sync effect: drop the just-played snapshot
  // only once the (simulated) synced board actually reflects it, not on a
  // fixed timer -- see that effect's comment for why.
  useEffect(() => {
    if (justPlayed.length === 0) return;
    const synced = justPlayed.every((t) => {
      const ch = board[t.row * N + t.col];
      return ch === (t.blank ? t.letter.toLowerCase() : t.letter.toUpperCase());
    });
    if (!synced) return;
    if (justPlayedTimeoutRef.current) clearTimeout(justPlayedTimeoutRef.current);
    setJustPlayed([]);
  }, [board]);

  function submitPending() {
    if (pending.length === 0) return;
    const horizontal = playedHorizontally(pending);
    const ordered = orderCellsForCascade(pending, horizontal);
    if (justPlayedTimeoutRef.current) clearTimeout(justPlayedTimeoutRef.current);
    setJustPlayed(
      ordered.map((t, i) => ({ row: t.row, col: t.col, letter: t.letter, blank: t.blank, delayMs: i * PLAY_CASCADE_STAGGER_MS })),
    );
    justPlayedTimeoutRef.current = setTimeout(() => setJustPlayed([]), JUST_PLAYED_FALLBACK_MS);

    const fillCells = orderCellsForCascade(placement.valid ? placement.wordCells : pending, horizontal);
    if (justPlayedFillTimeoutRef.current) clearTimeout(justPlayedFillTimeoutRef.current);
    setJustPlayedFill(new Map(fillCells.map((c, i) => [`${c.row},${c.col}`, i * PLAY_CASCADE_STAGGER_MS])));
    justPlayedFillTimeoutRef.current = setTimeout(
      () => setJustPlayedFill(new Map()),
      fillCells.length * PLAY_CASCADE_STAGGER_MS + FILL_FADE_MS,
    );

    setPending([]);
    setTimeout(() => {
      setBoard((b) => {
        const cells = b.split("");
        for (const t of ordered) cells[t.row * N + t.col] = t.blank ? t.letter.toLowerCase() : t.letter.toUpperCase();
        return cells.join("");
      });
    }, SIMULATED_SYNC_LAG_MS);
  }
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
            board={board}
            pending={pending}
            wordEdges={wordEdges}
            justPlayed={justPlayed}
            justPlayedFill={justPlayedFill}
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
        <div className="game-actions">
          <button className="btn btn-primary action-play" id="play-button" disabled={pending.length === 0} onClick={submitPending}>
            Play
          </button>
        </div>
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

// Regression fixture for the score badge landing on the wrong tile: a
// pending vertical word (M-E-E, all new) played *above* a pre-existing
// committed word ("INKS"), so it anchors on the committed "K" -- the badge
// must land on that K (the lowest/rightmost cell of the whole word "MEEK"),
// not on the lowest *pending* tile (the second E), which sits one row above
// it. Mirrors the exact board shape from the bug report.
const ANCHOR_BOARD = (() => {
  const cells = ".".repeat(N * N).split("");
  const place = (row: number, col: number, letter: string) => {
    cells[row * N + col] = letter;
  };
  place(9, 5, "I");
  place(9, 6, "N");
  place(9, 7, "K");
  place(9, 8, "S");
  return cells.join("");
})();

const ANCHOR_PENDING: PendingTile[] = [
  { row: 6, col: 7, rackIndex: 0, letter: "M", blank: false },
  { row: 7, col: 7, rackIndex: 1, letter: "E", blank: false },
  { row: 8, col: 7, rackIndex: 2, letter: "E", blank: false },
];

// Regression fixture for the pale-blue partial ring reported around interior
// board tiles (those with content on 3-4 sides) -- reproduces the exact
// crossword shape from the bug report: "GODS" horizontal through "SOD" (down
// through the O), "GUSTY" (down through the S), and "GAY" (down through the
// G), so the O and S cells each have all four neighbors filled. Crucially
// the O and S are BLANKS (lowercase in the board string), matching the
// reported game: the artifact turned out to be the blank tile's inset ring
// marker (since removed entirely -- blanks now get no special face) getting
// partially painted over by neighboring tiles' bleeds (DOM-order
// dependent), which only ever manifested on a blank with neighbors -- a
// fixture without blanks could never reproduce it.
// All-committed, no pending/wordEdges highlighting, matching the screenshot
// (a past board state, not an in-progress move).
const SEAM_BOARD = (() => {
  const cells = ".".repeat(N * N).split("");
  const place = (row: number, col: number, letter: string) => {
    cells[row * N + col] = letter;
  };
  // "GODS" horizontal -- the O and S are blanks (lowercase).
  place(7, 6, "G");
  place(7, 7, "o");
  place(7, 8, "D");
  place(7, 9, "s");
  // "GAY" down through the G
  place(8, 6, "A");
  place(9, 6, "Y");
  // "SOD" down through the O (S above, D below)
  place(6, 7, "S");
  place(8, 7, "D");
  // "GUSTY" down through the S
  place(5, 9, "G");
  place(6, 9, "U");
  place(8, 9, "T");
  place(9, 9, "Y");
  // Second, denser cluster (reported as "notches...whenever they
  // intersect" on a busier board than the 4-word GODS cluster above) --
  // "MOONY" horizontal, "LO" down through the second O, "OX" down through
  // the first O, "ME" down through the M. Several 3-of-4-neighbor corners
  // with a genuinely empty diagonal cell, close together.
  place(10, 2, "M");
  place(10, 3, "O");
  place(10, 4, "O");
  place(10, 5, "N");
  place(10, 6, "Y");
  place(9, 4, "L");
  place(11, 3, "X");
  place(11, 2, "E");
  return cells.join("");
})();

function SeamHarness() {
  return (
    <div className="app-page game-screen" id="harness-root">
      <div className="game-middle">
        <BoardViewport>
          <Board board={SEAM_BOARD} pending={[]} />
        </BoardViewport>
      </div>
    </div>
  );
}

function makeMockDictionary(rejectWord: string | null): Dictionary {
  return {
    isWord(word: string) {
      if (rejectWord && word.toUpperCase() === rejectWord.toUpperCase()) return false;
      return true;
    },
    size: 2,
  };
}

function ScoreHarness({
  board,
  pending,
  badWord,
  initialInvalid,
}: {
  board: string;
  pending: PendingTile[];
  badWord: string;
  initialInvalid: boolean;
}) {
  const [invalid, setInvalid] = useState(initialInvalid);

  const rack = pending.map((t) => t.letter).join("");
  const dictionary = makeMockDictionary(invalid ? badWord : null);
  const placement = checkPlacementWithDictionary(board, rack, pending, dictionary);
  const wordEdges = placement.valid ? outlineEdges(placement.wordCells) : undefined;
  // Same "lowest/rightmost cell of the word(s) formed" + dictionary-blind
  // fallback logic as GameScreen -- see its scoreBadge comment.
  const region = placement.valid
    ? placement.wordCells
    : (() => {
        const structural = checkPlacement(board, pending);
        return structural.wordCells.length > 0 ? structural.wordCells : pending;
      })();
  const corner = region.reduce((best, t) => (t.row > best.row || (t.row === best.row && t.col > best.col) ? t : best));
  const scoreBadge = {
    row: corner.row,
    col: corner.col,
    score: placement.valid ? placement.score : checkPlacement(board, pending).score,
    valid: placement.valid,
  };

  return (
    <div className="app-page game-screen" id="harness-root">
      <div
        id="debug-log"
        style={{ position: "fixed", top: 0, right: 0, fontSize: 10, background: "#fff", color: "#000", zIndex: 999 }}
      >
        dict: {invalid ? `invalid (${badWord} rejected)` : "valid"} | placement.valid: {String(placement.valid)} |
        badge score: {scoreBadge.score}
        {" · "}
        {/* Harness-only control (not part of the shipped app): flips the mock
         * dictionary to preview both the valid/invalid score-badge states. */}
        <button id="toggle-dict" onClick={() => setInvalid((v) => !v)}>
          toggle dictionary
        </button>
      </div>
      <div className="game-middle">
        <BoardViewport>
          <Board board={board} pending={pending} wordEdges={wordEdges} scoreBadge={scoreBadge} />
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

const scenarios: Record<string, JSX.Element> = {
  outline: <ScoreHarness board={OUTLINE_BOARD} pending={OUTLINE_PENDING} badWord="SIT" initialInvalid={initialInvalid} />,
  anchor: <ScoreHarness board={ANCHOR_BOARD} pending={ANCHOR_PENDING} badWord="MEEK" initialInvalid={initialInvalid} />,
  seams: <SeamHarness />,
};

createRoot(document.getElementById("root")!).render(scenarios[scenario ?? ""] ?? <Harness />);

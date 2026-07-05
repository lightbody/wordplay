import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api";
import { checkPlacement, isEmpty } from "../engine";
import { moveItem, rackColumnAt } from "../dragMath";
import { useApi, useProfile } from "../profile";
import { useGamesShape, useMovesShape, useRacksShape } from "../shapes";
import type { Game, PendingTile, PlacedTileDto } from "../types";
import { Board } from "../components/Board";
import { BoardViewport } from "../components/BoardViewport";
import { Rack } from "../components/Rack";
import { Tile } from "../components/Tile";
import { Spinner } from "../components/Spinner";
import { ScoreBar } from "../components/ScoreBar";
import { BlankPicker } from "../components/BlankPicker";
import { SwapDialog } from "../components/SwapDialog";
import { MoreMenu } from "../components/MoreMenu";
import { SharePanel } from "../components/SharePanel";

type DropTarget = { type: "board"; row: number; col: number; valid: boolean } | { type: "rack"; index: number };

/** Where a tile currently being dragged came from. */
type DragSource = { kind: "rack"; rackIndex: number } | { kind: "board"; rackIndex: number; row: number; col: number };

export function GameScreen() {
  const { id } = useParams<{ id: string }>();
  const profile = useProfile();
  const getApi = useApi();
  const navigate = useNavigate();

  const { data: games } = useGamesShape();
  const { data: racks } = useRacksShape();
  const { data: moves } = useMovesShape(id!);

  const game = useMemo<Game | undefined>(
    () => games?.find((g) => g.id === id),
    [games, id],
  );
  const myRack = useMemo(
    () => racks?.find((r) => r.game_id === id)?.rack ?? "",
    [racks, id],
  );

  const [pending, setPending] = useState<PendingTile[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [blankFor, setBlankFor] = useState<{ row: number; col: number; rackIndex: number } | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  // Reset transient move state when the rack changes (i.e. after any move).
  useEffect(() => {
    setPending([]);
    setOrder(Array.from({ length: myRack.length }, (_, i) => i));
  }, [myRack]);

  // iOS Safari ignores the viewport meta's zoom restrictions and doesn't
  // reliably honor touch-action:none on ancestors for the pinch/double-tap
  // zoom gesture specifically, so block it directly at the source: Safari's
  // legacy gesturestart event (fires before any native pinch-zoom), and any
  // 2+-finger touch outside the board (covers Chrome/Android too). Only
  // BoardViewport's own custom pinch handling should be able to zoom
  // anything on this screen.
  useEffect(() => {
    const preventGesture = (e: Event) => e.preventDefault();
    function blockMultiTouchOutsideBoard(e: TouchEvent) {
      const target = e.target as Element | null;
      if (e.touches.length > 1 && !target?.closest(".board-viewport")) {
        e.preventDefault();
      }
    }
    document.addEventListener("gesturestart", preventGesture);
    document.addEventListener("touchstart", blockMultiTouchOutsideBoard, { passive: false });
    document.addEventListener("touchmove", blockMultiTouchOutsideBoard, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("touchstart", blockMultiTouchOutsideBoard);
      document.removeEventListener("touchmove", blockMultiTouchOutsideBoard);
    };
  }, []);

  if (!game) return <Spinner full />;

  const meCreator = game.creator_id === profile.id;
  const myTurn = game.current_player_id === profile.id;
  const finished = game.status === "finished";
  const awaiting = game.status === "awaiting_opponent";
  const usedIndices = new Set(pending.map((p) => p.rackIndex));
  const hasPending = usedIndices.size > 0;

  const phase: "finished" | "opening" | "sharing" | "playing" = finished
    ? "finished"
    : awaiting && game.move_count === 0 && meCreator
      ? "opening"
      : awaiting
        ? "sharing"
        : "playing";

  const lastMove = new Set<string>();
  const lastPlay = [...(moves ?? [])].reverse().find((m) => m.move_type === "play");
  if (lastPlay?.tiles) for (const t of lastPlay.tiles) lastMove.add(`${t.row},${t.col}`);

  const placement = checkPlacement(game.board, pending);
  const canPlay = myTurn && !finished && pending.length > 0 && placement.valid && !busy;

  function placeLetterAt(rackIndex: number, row: number, col: number) {
    const letter = myRack[rackIndex];
    if (letter === "?") {
      setBlankFor({ row, col, rackIndex });
    } else {
      setPending((p) => [...p, { row, col, rackIndex, letter, blank: false }]);
    }
  }

  // Placement is drag-only; a tap on a pending (not yet submitted) board
  // tile still removes it, as a quick alternative to dragging it back.
  function removePendingTile(row: number, col: number) {
    setError(null);
    const existing = pending.find((p) => p.row === row && p.col === col);
    if (existing) setPending((p) => p.filter((t) => t !== existing));
  }

  function dragHitTest(clientX: number, clientY: number): DropTarget | null {
    // Rack columns are computed from the container's own (static) bounding
    // box rather than via elementFromPoint: reordering animates sibling
    // tiles' rendered position with `layout`, and elementFromPoint measures
    // the painted/transformed box, which can transiently overlap a
    // neighboring column mid-slide. The rack container itself never moves.
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
      // Exclude the tile currently being dragged from its own occupancy
      // check, so hovering it back over its own cell (or a board-origin
      // drag that hasn't actually moved) doesn't read as blocked.
      const draggedRackIndex = dragInfoRef.current?.rackIndex;
      const occupied =
        !isEmpty(game!.board, row, col) ||
        pending.some((p) => p.row === row && p.col === col && p.rackIndex !== draggedRackIndex);
      return { type: "board", row, col, valid: myTurn && !finished && !occupied };
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

  // The floating drag ghost is always sized off the rack tile (not
  // whatever was actually pressed), so it stays a consistent size whether
  // the drag started on the rack or on a smaller board tile.
  const GHOST_SCALE = 1.2;
  function ghostSize(fallbackRect: DOMRect): number {
    const rackTile = document.querySelector<HTMLElement>(".rack .tile");
    const base = rackTile ? rackTile.getBoundingClientRect().width : fallbackRect.width;
    return base * GHOST_SCALE;
  }

  // Live-previews the rack shifting to "make room" at the hovered slot,
  // recomputed from the drag's start order each time so it's idempotent
  // regardless of the path the pointer took to get there. Only meaningful
  // for a rack-origin drag -- a board-origin drag never touches `order`,
  // since removing it from `pending` reveals it at its existing slot.
  function applyOrderPreview(hit: DropTarget | null) {
    const startOrder = dragStartOrderRef.current;
    const info = dragInfoRef.current;
    if (startOrder === null || info?.kind !== "rack") return;
    if (hit?.type === "rack") {
      const from = startOrder.indexOf(info.rackIndex);
      setOrder(from === -1 ? startOrder : moveItem(startOrder, from, hit.index));
    } else {
      setOrder(startOrder);
    }
  }

  function startTileDrag(rackIndex: number, x: number, y: number, rect: DOMRect) {
    setError(null);
    dragInfoRef.current = { kind: "rack", rackIndex };
    dragStartOrderRef.current = order;
    const letter = myRack[rackIndex];
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
    setError(null);
    dragInfoRef.current = { kind: "board", rackIndex: pend.rackIndex, row, col };
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
    setDropTarget(dragHitTest(x, y));
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

    if (info.kind === "rack") {
      if (hit?.type === "board" && hit.valid) {
        if (startOrder) setOrder(startOrder);
        placeLetterAt(info.rackIndex, hit.row, hit.col);
      } else if (hit?.type === "rack" && startOrder) {
        const from = startOrder.indexOf(info.rackIndex);
        setOrder(from === -1 ? startOrder : moveItem(startOrder, from, hit.index));
      } else if (startOrder) {
        setOrder(startOrder);
      }
      return;
    }

    // Board-origin: dropping on the rack recalls the tile (it reappears at
    // its existing rack slot once it's no longer pending); dropping on a
    // different empty cell repositions it; anything else snaps back, which
    // needs no state change since `pending` was never mutated mid-drag.
    if (hit?.type === "rack") {
      setPending((p) => p.filter((t) => !(t.row === info.row && t.col === info.col)));
    } else if (hit?.type === "board" && hit.valid) {
      setPending((p) =>
        p.map((t) => (t.row === info.row && t.col === info.col ? { ...t, row: hit.row, col: hit.col } : t)),
      );
    }
  }

  function cancelTileDrag() {
    const info = dragInfoRef.current;
    const startOrder = dragStartOrderRef.current;
    dragInfoRef.current = null;
    dragStartOrderRef.current = null;
    setDragActive(null);
    setDropTarget(null);
    if (info?.kind === "rack" && startOrder) setOrder(startOrder);
  }

  function chooseBlank(letter: string) {
    if (!blankFor) return;
    setPending((p) => [
      ...p,
      { row: blankFor.row, col: blankFor.col, rackIndex: blankFor.rackIndex, letter, blank: true },
    ]);
    setBlankFor(null);
  }

  function recall() {
    setPending([]);
  }

  function shuffle() {
    setOrder((o) => {
      const next = [...o];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  }

  async function submitPlay() {
    setBusy(true);
    setError(null);
    try {
      const api = await getApi();
      const tiles: PlacedTileDto[] = pending.map((p) => ({
        row: p.row,
        col: p.col,
        letter: p.letter.toUpperCase(),
        blank: p.blank,
      }));
      const res = await api.play(id!, tiles);
      setPending([]);
      if (res.game_over) navigate(`/games/${id}/summary`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function doPass() {
    if (!confirm("Pass your turn without playing?")) return;
    await runAction((api) => api.pass(id!));
  }

  async function doResign() {
    if (!confirm("Resign this game? Your opponent wins.")) return;
    await runAction((api) => api.resign(id!));
  }

  async function doSwap(letters: string) {
    setSwapOpen(false);
    await runAction((api) => api.swap(id!, letters));
  }

  async function runAction(fn: (api: Awaited<ReturnType<typeof getApi>>) => Promise<{ game_over: boolean }>) {
    setBusy(true);
    setError(null);
    try {
      const api = await getApi();
      const res = await fn(api);
      setPending([]);
      if (res.game_over) navigate(`/games/${id}/summary`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const orderedRack = order.length === myRack.length ? order : myRack.split("").map((_, i) => i);

  return (
    <div className="app-page game-screen">
      <header className="topbar">
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          ← Games
        </button>
        <span className="wordmark wordmark-sm">Wordplay</span>
        <span />
      </header>

      <div className="game-middle">
        <ScoreBar game={game} meCreator={meCreator} myTurn={myTurn} />

        <BoardViewport>
          <Board
            board={game.board}
            pending={pending}
            lastMove={lastMove}
            interactive={myTurn && !finished}
            onCellClick={removePendingTile}
            dropTarget={dropTarget?.type === "board" ? dropTarget : null}
            draggingFrom={dragActive?.origin.kind === "board" ? dragActive.origin : null}
            onTileDragStart={startBoardTileDrag}
            onTileDragMove={moveTileDrag}
            onTileDragEnd={endTileDrag}
            onTileDragCancel={cancelTileDrag}
          />
        </BoardViewport>

        {phase === "sharing" && <SharePanel game={game} />}
        {error && <div className="error-banner">{error}</div>}
      </div>

      {phase !== "sharing" && (
        <div className="bottom-bar">
          {phase === "finished" ? (
            <div className="game-actions">
              <button className="btn btn-primary btn-block" onClick={() => navigate(`/games/${id}/summary`)}>
                View summary
              </button>
            </div>
          ) : phase === "opening" ? (
            <>
              <RackArea
                rack={myRack}
                order={orderedRack}
                usedIndices={usedIndices}
                draggingIndex={dragActive?.rackIndex ?? null}
                dropIndex={dropTarget?.type === "rack" ? dropTarget.index : null}
                onDragStart={startTileDrag}
                onDragMove={moveTileDrag}
                onDragEnd={endTileDrag}
                onDragCancel={cancelTileDrag}
              />
              <div className="game-actions">
                <button className="btn" onClick={hasPending ? recall : shuffle}>
                  {hasPending ? "Recall" : "Shuffle"}
                </button>
                <button className="btn btn-primary" disabled={!canPlay} onClick={submitPlay}>
                  Play opening {placement.valid ? `(${placement.score})` : ""}
                </button>
              </div>
              <p className="hint-text">Play your opening word, then invite an opponent.</p>
            </>
          ) : (
            <>
              <RackArea
                rack={myRack}
                order={orderedRack}
                usedIndices={usedIndices}
                draggingIndex={dragActive?.rackIndex ?? null}
                dropIndex={dropTarget?.type === "rack" ? dropTarget.index : null}
                onDragStart={startTileDrag}
                onDragMove={moveTileDrag}
                onDragEnd={endTileDrag}
                onDragCancel={cancelTileDrag}
              />
              <div className="game-actions">
                <button className="btn" onClick={() => setMoreOpen(true)}>
                  More
                </button>
                <button className="btn" disabled={!myTurn || busy} onClick={() => setSwapOpen(true)}>
                  Swap
                </button>
                <button className="btn" onClick={hasPending ? recall : shuffle}>
                  {hasPending ? "Recall" : "Shuffle"}
                </button>
                <button className="btn btn-primary" disabled={!canPlay} onClick={submitPlay}>
                  Play {placement.valid && pending.length > 0 ? `(${placement.score})` : ""}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {blankFor && <BlankPicker onChoose={chooseBlank} onCancel={() => setBlankFor(null)} />}
      {swapOpen && (
        <SwapDialog
          rack={myRack}
          disabled={game.tiles_remaining < 7}
          onSwap={doSwap}
          onCancel={() => setSwapOpen(false)}
        />
      )}
      {moreOpen && (
        <MoreMenu
          passDisabled={!myTurn || busy}
          resignDisabled={busy}
          onPass={() => {
            setMoreOpen(false);
            doPass();
          }}
          onResign={() => {
            setMoreOpen(false);
            doResign();
          }}
          onClose={() => setMoreOpen(false)}
        />
      )}

      {dragActive && (
        <div
          ref={dragGhostRef}
          className="drag-ghost"
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

function RackArea({
  rack,
  order,
  usedIndices,
  draggingIndex,
  dropIndex,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: {
  rack: string;
  order: number[];
  usedIndices: Set<number>;
  draggingIndex: number | null;
  dropIndex: number | null;
  onDragStart: (rackIndex: number, x: number, y: number, rect: DOMRect) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onDragCancel: () => void;
}) {
  return (
    <div className="rack-area">
      <Rack
        rack={rack}
        order={order}
        usedIndices={usedIndices}
        draggingIndex={draggingIndex}
        dropIndex={dropIndex}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      />
    </div>
  );
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "invalid_words") {
      const words = (e.detail.words as string[] | undefined) ?? [];
      return `Not in dictionary: ${words.join(", ")}`;
    }
    const map: Record<string, string> = {
      not_your_turn: "It's not your turn.",
      first_move_must_cover_center: "Opening move must cover the center star.",
      first_move_too_short: "Opening move needs at least two tiles.",
      not_connected: "Your word must connect to an existing one.",
      gap: "Tiles can't have gaps.",
      not_in_line: "Tiles must be in a single row or column.",
      bag_too_small_to_swap: "Not enough tiles left in the bag to swap.",
    };
    return map[e.code] ?? "That move wasn't allowed.";
  }
  return "Something went wrong.";
}

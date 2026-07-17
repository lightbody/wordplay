import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useNavigate, useParams } from "react-router-dom";
import { wordCellsForCommittedPlacement } from "@wordplay/shared";
import { ApiError } from "../api";
import { cellAt, checkPlacement, checkPlacementWithDictionary, isEmpty } from "../engine";
import { useDictionary } from "../dictionary";
import { moveItem, rackColumnAt } from "../dragMath";
import { useApi, useProfile } from "../profile";
import { useSound } from "../sound";
import { playSound } from "../sounds";
import { useGamesShape, useMovesShape, useRacksShape } from "../shapes";
import type { Game, Move, PendingTile, PlacedTileDto, PlayRating, TopMoveDto } from "../types";
import { outlineEdges } from "../wordOutline";
import { summarizeLastMove } from "../lastMove";
import { Board } from "../components/Board";
import { BoardViewport } from "../components/BoardViewport";
import { Rack } from "../components/Rack";
import { Tile } from "../components/Tile";
import { Spinner } from "../components/Spinner";
import { ScoreBar } from "../components/ScoreBar";
import { LastMoveSummary } from "../components/LastMoveSummary";
import { BlankPicker } from "../components/BlankPicker";
import { SwapDialog } from "../components/SwapDialog";
import { MoreMenu } from "../components/MoreMenu";
import { UnseenTiles } from "../components/UnseenTiles";
import { SharePanel } from "../components/SharePanel";
import { MoreIcon, RecallIcon, ShuffleIcon, SwapIcon } from "../components/icons";

type DropTarget = { type: "board"; row: number; col: number; valid: boolean } | { type: "rack"; index: number };

/** Where a tile currently being dragged came from. */
type DragSource = { kind: "rack"; rackIndex: number } | { kind: "board"; rackIndex: number; row: number; col: number };

/** Milliseconds between each played letter's dark-to-light transition start
 * (and, for the word-highlight fill, between each cell's fade-out start), so
 * a multi-letter play visibly cascades rather than recoloring/vanishing all
 * at once. */
const PLAY_CASCADE_STAGGER_MS = 90;
/** Ceiling on how long we keep showing the just-played tile snapshot if the
 * synced `game.board` never catches up to it (should not happen in
 * practice -- just a safety net against a stuck stale style). Normal
 * cleanup is driven by the board-sync effect below, not this timer. */
const JUST_PLAYED_FALLBACK_MS = 5000;
/** Must comfortably exceed .cell-fill's opacity transition duration in
 * App.css -- sizes the cleanup timeout for the word-highlight fade below
 * (which, unlike the tiles, has no synced-data race to wait out: it's a
 * purely local/cosmetic fade, so a fixed timer is enough). */
const FILL_FADE_MS = 400;

/** How long the post-move rating flash ("WOW!"/"Great"/...) stays up once it
 * appears. It appears only after the play cascade + word-highlight fade have
 * finished (see submitPlay), so the verdict lands as its own beat instead of
 * competing with the tile animation. */
const RATING_FLASH_MS = 1500;

const RATING_FLASH_LABELS: Record<PlayRating, string> = {
  wow: "WOW!",
  great: "Great!",
  good: "Good",
  meh: "Meh",
};

/** How long one opponent tile takes to fly in from the score bar to its
 * board cell (see startIncomingMove). Kept as a single fixed-duration tween
 * (not a spring) so its end time is deterministic -- the reveal timeout
 * below fires exactly when the flight's own transition finishes, handing
 * off to the real committed tile with no gap or double-render. */
const INCOMING_FLIGHT_MS = 320;
/** Delay between successive opponent tiles starting their flight, so a
 * multi-letter play reads as being laid down one tile after another rather
 * than all arriving at once. */
const INCOMING_STAGGER_MS = 110;
/** How long the opponent's post-landing yellow highlight stays fully solid
 * before it starts fading. */
const INCOMING_HIGHLIGHT_HOLD_MS = 2200;
/** Duration of the yellow highlight's own fade-out, once triggered -- much
 * slower than the green fade (FILL_FADE_MS-ish) since this one is meant to
 * read as "gradually" dissolving rather than a quick undraw. */
const INCOMING_HIGHLIGHT_FADE_MS = 900;
/** Ceiling on how many animation frames the incoming-move effect will wait
 * for BoardViewport's board to settle into its final laid-out size (see its
 * `size` state, which starts at 0 and is set asynchronously by a
 * ResizeObserver) before measuring cell positions anyway -- bounds the wait
 * rather than blocking forever if the board somehow never reports a stable
 * size. */
const INCOMING_LAYOUT_WAIT_FRAMES = 45;
/** A `.board` width below this is treated as a transient/collapsed layout
 * pass rather than the real thing -- comfortably smaller than any board
 * will realistically render at, but well above the few-px slivers a
 * mid-layout frame can transiently report. */
const INCOMING_LAYOUT_MIN_WIDTH = 100;

interface IncomingFlight {
  hidden: Set<string>;
  flying: {
    row: number;
    col: number;
    letter: string;
    blank: boolean;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    size: number;
    delayMs: number;
    tilt: number;
  }[];
  highlightCells: Set<string>;
}

/** Pure DOM-measurement step for the incoming-move animation: where each
 * opponent tile should fly from (the score bar) and to (its board cell),
 * and which cells the eventual yellow highlight covers. Split out from the
 * effect that calls it so the effect can freely retry it once layout is
 * actually ready (see INCOMING_LAYOUT_WAIT_FRAMES) without duplicating this
 * measurement logic. */
function computeIncomingFlight(board: string, tiles: PlacedTileDto[]): IncomingFlight {
  const words = wordCellsForCommittedPlacement(board, tiles);
  const highlightCells = new Set<string>();
  for (const w of words) for (const c of w.cells) highlightCells.add(`${c.row},${c.col}`);

  const asPending: PendingTile[] = tiles.map((t, i) => ({
    row: t.row,
    col: t.col,
    rackIndex: i,
    letter: t.letter,
    blank: t.blank,
  }));
  const horizontal = playedHorizontally(asPending);
  const ordered = orderCellsForCascade(tiles, horizontal);

  const scoreEl = document.querySelector<HTMLElement>(".scorebar-player:last-child .player-score");
  const scoreRect = scoreEl?.getBoundingClientRect();
  const origin = scoreRect
    ? { x: scoreRect.left + scoreRect.width / 2, y: scoreRect.top + scoreRect.height / 2 }
    : { x: window.innerWidth - 40, y: 72 };

  const hidden = new Set<string>();
  const flying = ordered.map((t, i) => {
    const key = `${t.row},${t.col}`;
    hidden.add(key);
    const cellEl = document.querySelector<HTMLElement>(`[data-board-row="${t.row}"][data-board-col="${t.col}"]`);
    const rect = cellEl?.getBoundingClientRect();
    const size = rect?.width || 32;
    return {
      row: t.row,
      col: t.col,
      letter: t.letter,
      blank: t.blank,
      x0: origin.x - size / 2,
      y0: origin.y - size / 2,
      x1: rect?.left ?? origin.x - size / 2,
      y1: rect?.top ?? origin.y - size / 2,
      size,
      delayMs: i * INCOMING_STAGGER_MS,
      tilt: (i % 2 === 0 ? -1 : 1) * (12 + (i % 3) * 5),
    };
  });

  return { hidden, flying, highlightCells };
}

/** True if a just-submitted move's tiles read left-to-right (a single tile
 * counts as horizontal, arbitrarily -- there's no direction to detect). */
function playedHorizontally(tiles: PendingTile[]): boolean {
  return tiles.length <= 1 || tiles.every((t) => t.row === tiles[0].row);
}

/** Orders a just-submitted move's cells for the cascade animation:
 * left-to-right for a horizontal play, top-to-bottom for a vertical one.
 * Shared by the tile color cascade (over just the newly-placed tiles) and
 * the word-highlight fade (over the whole word shape, including any
 * pre-existing anchor tiles it hooks onto). */
function orderCellsForCascade<T extends { row: number; col: number }>(cells: T[], horizontal: boolean): T[] {
  return [...cells].sort((a, b) => (horizontal ? a.col - b.col || a.row - b.row : a.row - b.row || a.col - b.col));
}

export function GameScreen() {
  const { id } = useParams<{ id: string }>();
  const profile = useProfile();
  const getApi = useApi();
  const navigate = useNavigate();
  const { enabled: soundEnabled } = useSound();

  const { data: games } = useGamesShape();
  const { data: racks } = useRacksShape();
  const { data: moves } = useMovesShape(id!);
  const { dictionary } = useDictionary();

  const game = useMemo<Game | undefined>(
    () => games?.find((g) => g.id === id),
    [games, id],
  );
  const myRack = useMemo(
    () => racks?.find((r) => r.game_id === id)?.rack ?? "",
    [racks, id],
  );
  const lastMove = useMemo(
    () => summarizeLastMove(moves ?? [], profile.id),
    [moves, profile.id],
  );
  // The full record of the most recent move (unlike `lastMove` above, which
  // is just the display summary) -- needed for its `tiles` to drive the
  // incoming-move flight animation below.
  const lastMoveRecord = useMemo<Move | undefined>(() => {
    if (!moves || moves.length === 0) return undefined;
    return moves.reduce((a, b) => (b.move_number > a.move_number ? b : a));
  }, [moves]);

  const [pending, setPending] = useState<PendingTile[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  // Tiles from the move just submitted, still mid-transition from the dark
  // "placing" shade to the lighter "committed" one -- see submitPlay and
  // Board's justPlayed prop.
  const [justPlayed, setJustPlayed] = useState<{ row: number; col: number; letter: string; blank: boolean; delayMs: number }[]>([]);
  const justPlayedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The just-submitted word's green highlight, fading out -- see submitPlay
  // and Board's justPlayedFill prop. Keyed by `${row},${col}` -> delayMs.
  const [justPlayedFill, setJustPlayedFill] = useState<Map<string, number>>(new Map());
  const justPlayedFillTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Opponent tiles currently flying in from the score bar to their board
  // cell, and the cells they're headed for (which Board renders as empty
  // until each tile's flight lands) -- see the incoming-move effect below.
  const [incomingTiles, setIncomingTiles] = useState<IncomingFlight["flying"]>([]);
  const [incomingHidden, setIncomingHidden] = useState<Set<string>>(new Set());
  // The opponent's just-landed word, highlighted yellow once every tile has
  // landed -- see Board's opponentHighlight prop.
  const [opponentHighlight, setOpponentHighlight] = useState<{ cells: Set<string>; fading: boolean } | null>(null);
  // Rating + best-play alternatives for the move this session just
  // submitted, from the play response. The alternatives never arrive via
  // sync (they'd leak rack letters to the opponent), so they exist only
  // here, only for the mover, and only until the next move replaces them.
  const [playResult, setPlayResult] = useState<{ moveId: string; rating: PlayRating; topMoves: TopMoveDto[] } | null>(
    null,
  );
  // The big rating verdict currently flashing over the board, if any.
  const [ratingFlash, setRatingFlash] = useState<PlayRating | null>(null);
  const ratingFlashShowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ratingFlashHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [blankFor, setBlankFor] = useState<{ row: number; col: number; rackIndex: number } | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [unseenOpen, setUnseenOpen] = useState(false);
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

  useEffect(() => {
    return () => {
      if (justPlayedTimeoutRef.current) clearTimeout(justPlayedTimeoutRef.current);
      if (justPlayedFillTimeoutRef.current) clearTimeout(justPlayedFillTimeoutRef.current);
      if (ratingFlashShowTimeoutRef.current) clearTimeout(ratingFlashShowTimeoutRef.current);
      if (ratingFlashHideTimeoutRef.current) clearTimeout(ratingFlashHideTimeoutRef.current);
    };
  }, []);

  // Plays the fly-in-and-highlight animation for the opponent's most recent
  // move -- both the instant it arrives live, and (per the feature's other
  // half) the first time this screen mounts onto a game where the opponent's
  // last move was already sitting there unseen.
  //
  // Depends on lastMoveRecord's *id* (a stable primitive), not the object
  // itself -- moves/games re-render with new object references on every
  // Electric sync tick even when nothing relevant changed, which would
  // otherwise re-fire this on totally unrelated updates.
  //
  // Fully self-contained (measures, schedules, and tears down within one
  // effect instance) rather than relying on a ref to remember "already
  // animated": React 18 StrictMode intentionally mounts every effect twice
  // in dev (setup -> cleanup -> setup) to catch exactly this kind of bug,
  // and a separate always-mounted cleanup effect canceling *this* effect's
  // timeouts mid-flight was silently corrupting the animation on whichever
  // mounts happened to have the moves shape already cached (hence "works on
  // reload sometimes, not others"). Cleanup now undoes exactly what setup
  // did, so the double-invoke is harmless and a genuine unmount mid-flight
  // can't leave stuck flying tiles or a permanently-hidden board cell either.
  useEffect(() => {
    if (!game || !lastMoveRecord) return;
    if (lastMoveRecord.user_id === profile.id) return;
    if (lastMoveRecord.move_type !== "play" || !lastMoveRecord.tiles || lastMoveRecord.tiles.length === 0) return;

    const tiles = lastMoveRecord.tiles;
    const board = game.board;
    let cancelled = false;
    let rafId: number | null = null;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    // BoardViewport sizes itself via a ResizeObserver that only fires
    // *after* mount (its `size` state starts at 0), so every board cell is
    // still 0x0 -- and collapsed to one point -- for at least the first
    // render or two, and its *first* delivered size can itself be a
    // transient sliver (a few px) from an intermediate layout pass before
    // the surrounding flex chrome (header/scorebar/rack) has settled into
    // its final height, before growing to the real board size a frame or
    // two later. Measuring during either of those windows flies every tile
    // in from (and lands it on) that same collapsed/wrong point with no
    // real cell size, which reads as tiles converging on the middle of the
    // screen with no visible tile color. So wait not just for *a* width,
    // but for the *same* width on two consecutive frames and comfortably
    // larger than any transient sliver, i.e. actually settled.
    function waitForBoardLayout(attempt: number, lastWidth: number) {
      if (cancelled) return;
      const width = document.querySelector(".board")?.getBoundingClientRect().width ?? 0;
      if ((width > INCOMING_LAYOUT_MIN_WIDTH && width === lastWidth) || attempt >= INCOMING_LAYOUT_WAIT_FRAMES) {
        start();
        return;
      }
      rafId = requestAnimationFrame(() => waitForBoardLayout(attempt + 1, width));
    }

    function start() {
      if (cancelled) return;
      const { hidden, flying, highlightCells } = computeIncomingFlight(board, tiles);
      setIncomingHidden(hidden);
      setIncomingTiles(flying);
      setOpponentHighlight(null);

      for (const t of flying) {
        timeouts.push(
          setTimeout(() => {
            if (cancelled) return;
            setIncomingHidden((prev) => {
              const next = new Set(prev);
              next.delete(`${t.row},${t.col}`);
              return next;
            });
            setIncomingTiles((prev) => prev.filter((f) => f.row !== t.row || f.col !== t.col));
          }, t.delayMs + INCOMING_FLIGHT_MS),
        );
      }

      const totalFlightMs =
        flying.length === 0 ? 0 : (flying.length - 1) * INCOMING_STAGGER_MS + INCOMING_FLIGHT_MS;
      timeouts.push(
        setTimeout(() => {
          if (cancelled) return;
          setOpponentHighlight({ cells: highlightCells, fading: false });
          timeouts.push(
            setTimeout(() => {
              if (cancelled) return;
              setOpponentHighlight((prev) => (prev ? { ...prev, fading: true } : prev));
              timeouts.push(
                setTimeout(() => {
                  if (!cancelled) setOpponentHighlight(null);
                }, INCOMING_HIGHLIGHT_FADE_MS),
              );
            }, INCOMING_HIGHLIGHT_HOLD_MS),
          );
        }, totalFlightMs),
      );
    }

    waitForBoardLayout(0, -1);

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      timeouts.forEach(clearTimeout);
      setIncomingTiles([]);
      setIncomingHidden(new Set());
      setOpponentHighlight(null);
    };
  }, [lastMoveRecord?.id, game?.board, profile.id]);

  // Drops the just-played snapshot as soon as the synced board actually
  // reflects it -- the cascade's own CSS transition-delay/duration already
  // finished painting by then (or is still finishing, which is unaffected by
  // this cleanup; see Board.tsx's justPlayed doc), so this is purely about
  // not clearing the fallback-letter rendering *before* the real board data
  // arrives, which would otherwise reopen the gap-flash this feature exists
  // to close.
  useEffect(() => {
    if (justPlayed.length === 0 || !game) return;
    const synced = justPlayed.every((t) => {
      const ch = cellAt(game.board, t.row, t.col);
      return ch === (t.blank ? t.letter.toLowerCase() : t.letter.toUpperCase());
    });
    if (!synced) return;
    if (justPlayedTimeoutRef.current) clearTimeout(justPlayedTimeoutRef.current);
    setJustPlayed([]);
  }, [game?.board]);

  // Tiles can be planned on the board while waiting for the opponent to
  // move (see placement/interactive below, which no longer require
  // myTurn). If their move lands on a square we've planned a tile on, that
  // plan is no longer valid -- recall the whole planned move rather than
  // leaving a partial/stale one sitting on the board.
  useEffect(() => {
    if (!game) return;
    setPending((p) => (p.some((t) => !isEmpty(game.board, t.row, t.col)) ? [] : p));
  }, [game?.board]);

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
  // While dragging a tile off the board, briefly stop treating its rack
  // slot as "used" so Rack renders it as a normal (currently hidden, via
  // draggingIndex) slot instead of a gap -- that's what lets the other
  // tiles slide to make room for it, the same as reordering within the
  // rack, instead of the drag having nothing to visually preview against.
  const rackUsedIndices =
    dragActive?.origin.kind === "board"
      ? new Set([...usedIndices].filter((i) => i !== dragActive.rackIndex))
      : usedIndices;

  const phase: "finished" | "opening" | "sharing" | "playing" = finished
    ? "finished"
    : awaiting && game.move_count === 0 && meCreator
      ? "opening"
      : awaiting
        ? "sharing"
        : "playing";

  // While the dictionary hasn't loaded yet, treat placement as invalid
  // (Play stays disabled) rather than falling back to a dictionary-blind
  // check -- a one-time cost, since the dictionary is cached aggressively
  // afterward (see dictionary.ts).
  const placement = dictionary
    ? checkPlacementWithDictionary(game.board, myRack, pending, dictionary)
    : { valid: false, score: 0, bingo: false, wordCells: [] };
  const wordEdges = placement.valid ? outlineEdges(placement.wordCells) : undefined;
  const canPlay = myTurn && !finished && pending.length > 0 && placement.valid && !busy;

  // Live provisional-score badge on the board, anchored to the lowest/
  // rightmost cell of the word(s) the pending move forms -- the same region
  // the green outline traces (or would trace, if the move were valid), which
  // can include pre-existing committed tiles the pending tiles hook onto
  // (e.g. playing M-E-E above an existing committed K anchors the word at
  // that K, not at the lowest *pending* tile). Falls back to the
  // dictionary-blind structural check (still meaningful for a real word the
  // dictionary just hasn't loaded yet, or a word that isn't in the
  // dictionary) so the player gets score feedback even before/without a
  // dictionary-valid placement, and falls back further to the pending tiles
  // themselves if the placement isn't even structurally valid yet (e.g. a
  // gap or disconnected tiles, where no word region exists at all).
  const scoreBadge = (() => {
    if (pending.length === 0) return null;
    let region: Array<{ row: number; col: number }> = placement.wordCells;
    let score = placement.score;
    if (!placement.valid) {
      const structural = checkPlacement(game.board, pending);
      region = structural.wordCells.length > 0 ? structural.wordCells : pending;
      score = structural.score;
    }
    const corner = region.reduce((best, t) =>
      t.row > best.row || (t.row === best.row && t.col > best.col) ? t : best,
    );
    return { row: corner.row, col: corner.col, score, valid: placement.valid };
  })();

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
      return { type: "board", row, col, valid: !finished && !occupied };
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
  const GHOST_SCALE = 1.35;
  function ghostSize(fallbackRect: DOMRect): number {
    const rackTile = document.querySelector<HTMLElement>(".rack .tile");
    const base = rackTile ? rackTile.getBoundingClientRect().width : fallbackRect.width;
    return base * GHOST_SCALE;
  }

  // Live-previews the rack shifting to "make room" at the hovered slot,
  // recomputed from the drag's start order each time so it's idempotent
  // regardless of the path the pointer took to get there. Applies equally
  // to a board-origin drag: the dragged tile's rackIndex stays in `order`
  // the whole time (only `pending` marks it as a gap), so sliding it to a
  // new slot while still hovering the board tile is exactly the same
  // computation as reordering from the rack.
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

  function endTileDrag() {
    const info = dragInfoRef.current;
    const startOrder = dragStartOrderRef.current;
    // Commit to whatever target was last highlighted (the green/red outline
    // the user actually saw), not a freshly recomputed hit test at the raw
    // pointerup coordinates. A quick flick-and-release often ends a pixel or
    // two past the last pointermove sample (touch/mouse don't reliably fire
    // a move right before the up event), so re-hit-testing at that literal
    // release point could land on a different cell -- or off the board
    // entirely -- than what was just shown as the drop target, which read as
    // the tile snapping back even though the highlighted cell was valid.
    const hit = dropTarget;
    dragInfoRef.current = null;
    dragStartOrderRef.current = null;
    setDragActive(null);
    setDropTarget(null);
    if (!info) return;
    if (hit && (hit.type === "rack" || hit.valid)) {
      playSound("tileDrop", soundEnabled);
    }

    // Resolve the rack arrangement first, the same way regardless of where
    // the drag started: dropping on the rack finalizes the tile at the
    // hovered slot (letting a board-origin tile land anywhere, not just
    // back where it started); anything else reverts to how the rack looked
    // before this drag, undoing any "make room" preview from hovering it.
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

    // Board-origin: dropping on the rack recalls the tile (it reappears at
    // whichever slot it was just reordered to above); dropping on a
    // different empty cell repositions it; anything else snaps back, which
    // needs no `pending` change since it was never mutated mid-drag.
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
      const horizontal = playedHorizontally(pending);
      const ordered = orderCellsForCascade(pending, horizontal);
      if (justPlayedTimeoutRef.current) clearTimeout(justPlayedTimeoutRef.current);
      setJustPlayed(
        ordered.map((t, i) => ({
          row: t.row,
          col: t.col,
          letter: t.letter,
          blank: t.blank,
          delayMs: i * PLAY_CASCADE_STAGGER_MS,
        })),
      );
      justPlayedTimeoutRef.current = setTimeout(() => setJustPlayed([]), JUST_PLAYED_FALLBACK_MS);

      // Fade the green word-highlight out in the same left-to-right/top-to-
      // bottom order the tiles cascade in, over the whole word shape
      // (including any pre-existing anchor tile it hooks onto) -- see
      // Board's justPlayedFill doc.
      const fillCells = orderCellsForCascade(placement.valid ? placement.wordCells : pending, horizontal);
      if (justPlayedFillTimeoutRef.current) clearTimeout(justPlayedFillTimeoutRef.current);
      setJustPlayedFill(new Map(fillCells.map((c, i) => [`${c.row},${c.col}`, i * PLAY_CASCADE_STAGGER_MS])));
      justPlayedFillTimeoutRef.current = setTimeout(
        () => setJustPlayedFill(new Map()),
        fillCells.length * PLAY_CASCADE_STAGGER_MS + FILL_FADE_MS,
      );

      // Rating feedback: hold the flash until the play cascade above has
      // finished (same expression as the fill cleanup), then show the
      // verdict for RATING_FLASH_MS. The chip + best-plays panel (via
      // playResult) stick around until the next move.
      if (res.move.rating) {
        const rating = res.move.rating;
        setPlayResult({ moveId: res.move.id, rating, topMoves: res.top_moves ?? [] });
        const flashDelay = fillCells.length * PLAY_CASCADE_STAGGER_MS + FILL_FADE_MS;
        if (ratingFlashShowTimeoutRef.current) clearTimeout(ratingFlashShowTimeoutRef.current);
        if (ratingFlashHideTimeoutRef.current) clearTimeout(ratingFlashHideTimeoutRef.current);
        ratingFlashShowTimeoutRef.current = setTimeout(() => setRatingFlash(rating), flashDelay);
        ratingFlashHideTimeoutRef.current = setTimeout(() => setRatingFlash(null), flashDelay + RATING_FLASH_MS);
      }

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
      <header className="topbar game-header">
        <button className="icon-btn" aria-label="Back to games" onClick={() => navigate("/")}>
          <span className="chevron-left" />
        </button>
      </header>

      <div className="game-middle">
        <ScoreBar game={game} meCreator={meCreator} myTurn={myTurn} onOpenUnseenTiles={() => setUnseenOpen(true)} />
        <LastMoveSummary
          summary={lastMove}
          topMoves={playResult && lastMove && playResult.moveId === lastMove.moveId ? playResult.topMoves : undefined}
        />

        <AnimatePresence>
          {ratingFlash && (
            <motion.div
              key={ratingFlash}
              className={`rating-flash rating-flash-${ratingFlash}`}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.08 }}
              transition={{ type: "spring", stiffness: 420, damping: 22 }}
            >
              <span className="rating-flash-text">{RATING_FLASH_LABELS[ratingFlash]}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <BoardViewport>
          <Board
            board={game.board}
            pending={pending}
            wordEdges={wordEdges}
            scoreBadge={scoreBadge}
            justPlayed={justPlayed}
            justPlayedFill={justPlayedFill}
            hiddenCells={incomingHidden}
            opponentHighlight={opponentHighlight}
            interactive={!finished}
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
                usedIndices={rackUsedIndices}
                draggingIndex={dragActive?.rackIndex ?? null}
                onDragStart={startTileDrag}
                onDragMove={moveTileDrag}
                onDragEnd={endTileDrag}
                onDragCancel={cancelTileDrag}
              />
              <div className="game-actions">
                <button className="action-btn" onClick={hasPending ? recall : shuffle}>
                  {hasPending ? <RecallIcon /> : <ShuffleIcon />}
                  <span>{hasPending ? "Recall" : "Shuffle"}</span>
                </button>
                <button className="btn btn-primary action-play" disabled={!canPlay} onClick={submitPlay}>
                  Play
                </button>
              </div>
            </>
          ) : (
            <>
              <RackArea
                rack={myRack}
                order={orderedRack}
                usedIndices={rackUsedIndices}
                draggingIndex={dragActive?.rackIndex ?? null}
                onDragStart={startTileDrag}
                onDragMove={moveTileDrag}
                onDragEnd={endTileDrag}
                onDragCancel={cancelTileDrag}
              />
              <div className="game-actions">
                <button className="action-btn" onClick={() => setMoreOpen(true)}>
                  <MoreIcon />
                  <span>More</span>
                </button>
                <button className="action-btn" disabled={!myTurn || busy} onClick={() => setSwapOpen(true)}>
                  <SwapIcon />
                  <span>Swap</span>
                </button>
                <button className="action-btn" onClick={hasPending ? recall : shuffle}>
                  {hasPending ? <RecallIcon /> : <ShuffleIcon />}
                  <span>{hasPending ? "Recall" : "Shuffle"}</span>
                </button>
                <button className="btn btn-primary action-play" disabled={!canPlay} onClick={submitPlay}>
                  {myTurn ? "Play" : "Their turn"}
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
          onUnseenTiles={() => {
            setMoreOpen(false);
            setUnseenOpen(true);
          }}
          onClose={() => setMoreOpen(false)}
        />
      )}
      {unseenOpen && (
        <UnseenTiles board={game.board} rack={myRack} onClose={() => setUnseenOpen(false)} />
      )}

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

      {incomingTiles.map((t) => (
        <motion.div
          key={`${t.row}-${t.col}`}
          className="incoming-tile-fly"
          style={{ width: t.size, height: t.size }}
          initial={{ x: t.x0, y: t.y0, rotate: t.tilt, scale: 0.7, opacity: 0.85 }}
          animate={{ x: t.x1, y: t.y1, rotate: 0, scale: 1, opacity: 1 }}
          transition={{ duration: INCOMING_FLIGHT_MS / 1000, delay: t.delayMs / 1000, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <Tile letter={t.letter} blank={t.blank} board />
        </motion.div>
      ))}
    </div>
  );
}

function RackArea({
  rack,
  order,
  usedIndices,
  draggingIndex,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: {
  rack: string;
  order: number[];
  usedIndices: Set<number>;
  draggingIndex: number | null;
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
    // "invalid_words" is intentionally absent here: the client now refuses
    // to submit a dictionary-invalid move (see checkPlacementWithDictionary),
    // so this code should be unreachable in normal play. Kept as a safety
    // net for a stale client or race condition, falling through to the
    // generic message below.
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

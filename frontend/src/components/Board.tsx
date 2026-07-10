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
  /** Tiles from the move just submitted, mid-transition from the dark
   * "placing" shade to the lighter "committed" one. Rendered as board tiles
   * (not draggable/interactive) so there's no gap between the pending tile
   * disappearing and the synced board data reflecting it, and each carries a
   * `delayMs` so the color transition cascades one letter at a time instead
   * of changing all at once (see GameScreen's justPlayed state). */
  justPlayed?: { row: number; col: number; letter: string; blank: boolean; delayMs: number }[];
  /** Per-cell fade-out delay (ms) for the just-submitted word's green
   * highlight, keyed by `${row},${col}`. Once a move is submitted, wordEdges
   * goes back to undefined (no in-flight pending move to outline anymore),
   * so without this the highlight would simply vanish; this keeps the same
   * cells' fill mounted and fades it to opacity 0 with a stagger matching
   * justPlayed's, so the green frame visibly "undraws" instead of snapping
   * off (see GameScreen's justPlayedFill state). */
  justPlayedFill?: Map<string, number>;
  /** Live provisional score for the in-flight pending move, shown as a badge
   * on the lowest/rightmost pending tile -- green once the placement is
   * dictionary-valid, dark blue (still showing the potential score) while
   * it isn't. */
  scoreBadge?: { row: number; col: number; score: number; valid: boolean } | null;
  /** Cells (`${row},${col}`) whose already-committed letter should render as
   * empty for now, even though the synced board data already has it -- used
   * while an opponent's just-landed move is still flying in from the score
   * bar, so the destination cell doesn't "pop" full before the flying tile
   * visually arrives (see GameScreen's incoming-move animation). */
  hiddenCells?: Set<string>;
  /** The opponent's just-landed move's word outline, shown in the same
   * fill-bleed style as wordEdges/justPlayedFill but yellow, held solid for
   * a few seconds and then faded -- see GameScreen's incoming-move
   * animation. `fading` flips true once the hold elapses to trigger the
   * opacity transition down to 0. */
  opponentHighlight?: { cells: Set<string>; fading: boolean } | null;
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
// bleeding past the gap's center guarantee a continuous fill with no sliver
// -- in principle 1.5px on each side (overlapping the 2px gap by 1px) is
// enough, but on iOS Safari each tile is independently promoted to its own
// compositing layer (every Tile is a motion.button animating opacity, see
// Tile.tsx), and adjacent layers' edges can snap to slightly different
// subpixel boundaries -- a real hairline gap even though the CSS boxes
// mathematically overlap. 3px leaves several px of slack for that per-layer
// rounding instead of the bare ~1px 1.5 left, at the cost of tiles poking
// slightly further (~3px) into the gap toward an empty cell (see below).
// Crucially the bleed is uniform (not per-neighbor): if a tile only bled
// toward sides that *have* a neighbor, a tile with a letter above it (e.g. a
// cross-word junction) would grow taller/wider than its in-row siblings that
// don't, so their faces would no longer line up -- the exact "this tile sits
// higher / sticks out to the left" misalignment we're avoiding. Bleeding
// every side equally keeps every tile face on the same grid lines; the only
// cost is that an outer edge pokes into the gap toward an empty cell, which
// just reads as the played word being one slightly-raised capsule.
const TILE_BLEED = 3;

const TILE_BLEED_STYLE: React.CSSProperties = {
  position: "absolute",
  top: -TILE_BLEED,
  right: -TILE_BLEED,
  bottom: -TILE_BLEED,
  left: -TILE_BLEED,
  // .tile-value (the score-letter badge) is corner-anchored via right/bottom
  // offsets measured from *this* box -- which the bleed just grew past the
  // cell's true edge. Without compensating, growing TILE_BLEED pushes the
  // badge further into the gap each tile bleeds into, straight into the
  // z-index-2 sibling tile bleeding the other way from across that gap
  // (siblings share one z-index, so stacking is DOM order -- a later,
  // overlapping tile paints over an earlier one's badge with no way for the
  // badge to "win" via its own z-index). See App.css's --tile-bleed use.
  ["--tile-bleed" as string]: `${TILE_BLEED}px`,
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
  scoreBadge,
  justPlayed,
  justPlayedFill,
  hiddenCells,
  opponentHighlight,
  onTileDragStart,
  onTileDragMove,
  onTileDragEnd,
  onTileDragCancel,
}: BoardProps) {
  const pendingAt = new Map(pending.map((t) => [`${t.row},${t.col}`, t]));
  const justPlayedAt = new Map((justPlayed ?? []).map((t) => [`${t.row},${t.col}`, t]));

  // Cells still mid-flight-in from the score bar read as empty here, even
  // though the synced board string already has the letter -- see
  // hiddenCells's doc.
  const displayBoard =
    hiddenCells && hiddenCells.size > 0
      ? (() => {
          const cells = board.split("");
          for (const key of hiddenCells) {
            const [r, c] = key.split(",").map(Number);
            cells[r * N + c] = ".";
          }
          return cells.join("");
        })()
      : board;

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
    const key = `${row},${col}`;
    return cellAt(displayBoard, row, col) !== "." || pendingAt.has(key) || justPlayedAt.has(key);
  }

  const cells = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const key = `${row},${col}`;
      const committed = cellAt(displayBoard, row, col);
      const pend = pendingAt.get(key);
      const justPlayedTile = justPlayedAt.get(key);
      const prem = premium(row, col);
      const isCenter = row === 7 && col === 7;
      const wordEdge = wordEdges?.get(key);
      const isDropTarget = dropTarget?.row === row && dropTarget?.col === col;

      let content = null;
      if (pend || committed !== "." || justPlayedTile) {
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
        // The same applies to the opponent's yellow post-landing highlight,
        // so its own anchor tiles get the same enclosing-divider treatment.
        const inHighlightGroup = wordEdges ? wordEdges.has(key) : !!opponentHighlight?.cells.has(key);
        const underFill = !pend && !!(wordEdges || opponentHighlight) && !inHighlightGroup;
        const bleedStyle = underFill ? TILE_BLEED_STYLE_UNDER_FILL : TILE_BLEED_STYLE;
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
            // While the board sync catches up after a submit, fall back to
            // the letter/blank we already know from the move we just sent --
            // `committed` may still read "." for a beat.
            letter={justPlayedTile ? justPlayedTile.letter : committed}
            blank={justPlayedTile ? justPlayedTile.blank : committed >= "a" && committed <= "z"}
            board
            justPlayed={!!justPlayedTile}
            squareTL={squareTL}
            squareBR={squareBR}
            small
            style={
              justPlayedTile ? { ...bleedStyle, transitionDelay: `${justPlayedTile.delayMs}ms` } : bleedStyle
            }
          />
        );
      }

      // Green highlight fill behind the in-progress (valid) pending word --
      // or, once that word has just been submitted, the same fill fading out
      // (see justPlayedFill's doc) -- or, once an opponent's move has just
      // landed, the same fill in yellow, held solid and then faded (see
      // opponentHighlight's doc).
      const fillFadeDelay = justPlayedFill?.get(key);
      const oppHighlighted = opponentHighlight?.cells.has(key) ?? false;
      const fill = wordEdge
        ? { style: fillStyle("var(--word-fill)") }
        : fillFadeDelay !== undefined
          ? { style: { ...fillStyle("var(--word-fill)"), opacity: 0, transitionDelay: `${fillFadeDelay}ms` } }
          : oppHighlighted
            ? {
                style: {
                  ...fillStyle("var(--word-fill-highlight)"),
                  opacity: opponentHighlight!.fading ? 0 : 1,
                  transitionDuration: "900ms",
                },
              }
            : null;

      const badge =
        scoreBadge && scoreBadge.row === row && scoreBadge.col === col ? (
          <span className={`board-score-badge ${scoreBadge.valid ? "board-score-badge-valid" : "board-score-badge-invalid"}`}>
            {scoreBadge.score}
          </span>
        ) : null;

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
          {badge}
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

import type { CSSProperties } from "react";
import { motion } from "motion/react";
import { letterValue } from "../engine";

interface TileProps {
  letter: string;
  blank?: boolean;
  pending?: boolean;
  selected?: boolean;
  dragging?: boolean;
  small?: boolean;
  /** Passed straight through to the underlying button -- used by Board to
   * bleed a board tile's edges over the grid gap toward any neighboring
   * tile (see Board.tsx's TILE_BLEED_STYLE). */
  style?: CSSProperties;
  /** True for a tile already locked in on the board (the lighter blue
   * shade); omitted for rack tiles and the not-yet-submitted tiles the
   * player is currently placing (the darker blue shade). */
  board?: boolean;
  /** Forces a square (non-rounded) top-left/bottom-right corner. Used on
   * `board` tiles that are flush against another played tile in that
   * direction, so a multi-letter word reads as one rounded run rather
   * than each letter showing its own corner cut. */
  squareTL?: boolean;
  squareBR?: boolean;
  /** Enables the press-feedback animation and non-disabled cursor styling
   * for tiles that are draggable but have no click handler of their own
   * (rack tiles -- placement is drag-only, dragging is handled by Rack's
   * own container-level pointer listeners, not by this button's onClick). */
  interactive?: boolean;
  onClick?: () => void;
}

export function Tile({
  letter,
  blank,
  pending,
  selected,
  dragging,
  small,
  board,
  squareTL,
  squareBR,
  style,
  interactive,
  onClick,
}: TileProps) {
  const value = blank ? 0 : letterValue(letter);
  const display = letter ? letter.toUpperCase() : "";
  const clickable = interactive || !!onClick;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      style={style}
      className={[
        "tile",
        board ? "tile-board" : "",
        pending ? "tile-pending" : "",
        selected ? "tile-selected" : "",
        small ? "tile-small" : "",
        blank ? "tile-blank" : "",
        squareTL ? "tile-square-tl" : "",
        squareBR ? "tile-square-br" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // Driven through motion's own `animate` (rather than a CSS class)
      // because once whileTap puts a value under motion's control, it
      // asserts its own inline style for that value on every render --
      // an inline style always wins over a stylesheet rule, so a
      // `tile-dragging { opacity: 0 }` class gets silently overridden.
      //
      // `initial` matches `animate` so a Tile that mounts *already*
      // dragging (a board-origin drag reveals its rack slot the moment
      // the drag starts) renders straight at opacity 0 -- without it,
      // motion tweens fresh mounts from their unstyled default (opacity 1)
      // to the target, producing a visible flash-then-fade-out.
      initial={{ opacity: dragging ? 0 : 1 }}
      animate={{ opacity: dragging ? 0 : 1 }}
      whileTap={clickable ? { scale: 0.92 } : undefined}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
    >
      <span className="tile-letter">{display || (blank ? "" : "")}</span>
      {value > 0 && <span className="tile-value">{value}</span>}
    </motion.button>
  );
}

import { motion } from "motion/react";
import { letterValue } from "../engine";

interface TileProps {
  letter: string;
  blank?: boolean;
  pending?: boolean;
  selected?: boolean;
  dragging?: boolean;
  small?: boolean;
  /** Enables the press-feedback animation and non-disabled cursor styling
   * for tiles that are draggable but have no click handler of their own
   * (rack tiles -- placement is drag-only, dragging is handled by Rack's
   * own container-level pointer listeners, not by this button's onClick). */
  interactive?: boolean;
  onClick?: () => void;
}

export function Tile({ letter, blank, pending, selected, dragging, small, interactive, onClick }: TileProps) {
  const value = blank ? 0 : letterValue(letter);
  const display = letter ? letter.toUpperCase() : "";
  const clickable = interactive || !!onClick;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={[
        "tile",
        pending ? "tile-pending" : "",
        selected ? "tile-selected" : "",
        small ? "tile-small" : "",
        blank ? "tile-blank" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // Driven through motion's own `animate` (rather than a CSS class)
      // because once whileTap puts a value under motion's control, it
      // asserts its own inline style for that value on every render --
      // an inline style always wins over a stylesheet rule, so a
      // `tile-dragging { opacity: 0 }` class gets silently overridden.
      animate={{ opacity: dragging ? 0 : 1 }}
      whileTap={clickable ? { scale: 0.92 } : undefined}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
    >
      <span className="tile-letter">{display || (blank ? "" : "")}</span>
      {value > 0 && <span className="tile-value">{value}</span>}
    </motion.button>
  );
}

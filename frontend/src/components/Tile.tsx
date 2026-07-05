import { motion } from "motion/react";
import { letterValue } from "../engine";

interface TileProps {
  letter: string;
  blank?: boolean;
  layoutId?: string;
  pending?: boolean;
  selected?: boolean;
  dragging?: boolean;
  small?: boolean;
  onClick?: () => void;
}

export function Tile({ letter, blank, layoutId, pending, selected, dragging, small, onClick }: TileProps) {
  const value = blank ? 0 : letterValue(letter);
  const display = letter ? letter.toUpperCase() : "";
  return (
    <motion.button
      type="button"
      layoutId={layoutId}
      onClick={onClick}
      disabled={!onClick}
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
      whileTap={onClick ? { scale: 0.92 } : undefined}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
    >
      <span className="tile-letter">{display || (blank ? "" : "")}</span>
      {value > 0 && <span className="tile-value">{value}</span>}
    </motion.button>
  );
}

import { motion } from "motion/react";
import { letterValue } from "../engine";

interface TileProps {
  letter: string;
  blank?: boolean;
  layoutId?: string;
  pending?: boolean;
  selected?: boolean;
  small?: boolean;
  onClick?: () => void;
}

export function Tile({ letter, blank, layoutId, pending, selected, small, onClick }: TileProps) {
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
      whileTap={onClick ? { scale: 0.92 } : undefined}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
    >
      <span className="tile-letter">{display || (blank ? "" : "")}</span>
      {value > 0 && <span className="tile-value">{value}</span>}
    </motion.button>
  );
}

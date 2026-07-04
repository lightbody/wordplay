import { AnimatePresence } from "motion/react";
import { Tile } from "./Tile";

interface RackProps {
  /** Full rack letters (includes tiles currently placed as pending). */
  letters: string;
  /** Rack indices currently placed on the board (rendered as gaps). */
  usedIndices: Set<number>;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

export function Rack({ letters, usedIndices, selectedIndex, onSelect }: RackProps) {
  return (
    <div className="rack">
      <AnimatePresence>
        {letters.split("").map((letter, i) => {
          if (usedIndices.has(i)) {
            return <div key={i} className="rack-slot rack-slot-empty" />;
          }
          return (
            <div key={i} className="rack-slot">
              <Tile
                letter={letter === "?" ? "" : letter}
                blank={letter === "?"}
                layoutId={`tile-${i}`}
                selected={selectedIndex === i}
                onClick={() => onSelect(i)}
              />
            </div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

import { useState } from "react";
import { Tile } from "./Tile";

export function SwapDialog({
  rack,
  disabled,
  onSwap,
  onCancel,
}: {
  rack: string;
  disabled: boolean;
  onSwap: (letters: string) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const letters = [...selected].map((i) => rack[i]).join("");

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Swap tiles</h3>
        {disabled ? (
          <p className="muted">Not enough tiles left in the bag to swap.</p>
        ) : (
          <>
            <p className="muted">Pick 1–7 tiles to return. You'll lose this turn.</p>
            <div className="swap-rack">
              {rack.split("").map((l, i) => (
                <Tile
                  key={i}
                  letter={l === "?" ? "" : l}
                  blank={l === "?"}
                  selected={selected.has(i)}
                  onClick={() => toggle(i)}
                />
              ))}
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={disabled || selected.size === 0}
            onClick={() => onSwap(letters)}
          >
            Swap {selected.size > 0 ? selected.size : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

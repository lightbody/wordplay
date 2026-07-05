import { useRef } from "react";
import { AnimatePresence } from "motion/react";
import { DRAG_THRESHOLD } from "../dragMath";
import { Tile } from "./Tile";

interface RackProps {
  /** Full rack letters (includes tiles currently placed as pending). */
  letters: string;
  /** Rack indices currently placed on the board (rendered as gaps). */
  usedIndices: Set<number>;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  /** Display index of the tile currently being drag-picked-up, if any. */
  draggingIndex?: number | null;
  /** Display index of the rack slot currently hovered as a reorder target. */
  dropIndex?: number | null;
  onDragStart?: (index: number, clientX: number, clientY: number, rect: DOMRect) => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnd?: (clientX: number, clientY: number) => void;
  onDragCancel?: () => void;
}

function swallowClick(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}

export function Rack({
  letters,
  usedIndices,
  selectedIndex,
  onSelect,
  draggingIndex,
  dropIndex,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: RackProps) {
  const gesture = useRef<{ pointerId: number; index: number; startX: number; startY: number; dragging: boolean } | null>(
    null,
  );

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, index: number) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { pointerId: e.pointerId, index, startX: e.clientX, startY: e.clientY, dragging: false };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.dragging) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      g.dragging = true;
      onDragStart?.(g.index, e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    }
    onDragMove?.(e.clientX, e.clientY);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (g.dragging) {
      e.currentTarget.addEventListener("click", swallowClick, { capture: true, once: true });
      onDragEnd?.(e.clientX, e.clientY);
    }
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (g.dragging) onDragCancel?.();
  }

  return (
    <div className="rack">
      <AnimatePresence>
        {letters.split("").map((letter, i) => {
          if (usedIndices.has(i)) {
            return <div key={i} className="rack-slot rack-slot-empty" data-rack-slot={i} />;
          }
          return (
            <div
              key={i}
              className={["rack-slot", dropIndex === i ? "rack-slot-drop-target" : ""].filter(Boolean).join(" ")}
              data-rack-slot={i}
            >
              <Tile
                letter={letter === "?" ? "" : letter}
                blank={letter === "?"}
                layoutId={`tile-${i}`}
                selected={selectedIndex === i}
                dragging={draggingIndex === i}
                onClick={() => onSelect(i)}
                onPointerDown={(e) => handlePointerDown(e, i)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
              />
            </div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

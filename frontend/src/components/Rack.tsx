import { useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DRAG_THRESHOLD } from "../dragMath";
import { Tile } from "./Tile";

const SLOT_TRANSITION = { type: "spring", stiffness: 500, damping: 30 } as const;

interface RackProps {
  /** Full (unordered) rack letters. */
  rack: string;
  /** Display position -> original rack index. */
  order: number[];
  /** Original rack indices currently placed on the board (rendered as gaps). */
  usedIndices: Set<number>;
  /** Original rack index of the currently selected tile, if any. */
  selectedIndex: number | null;
  onSelect: (rackIndex: number) => void;
  /** Original rack index of the tile currently being drag-picked-up, if any. */
  draggingIndex?: number | null;
  /** Display position currently hovered as a reorder target. */
  dropIndex?: number | null;
  onDragStart?: (rackIndex: number, clientX: number, clientY: number, rect: DOMRect) => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnd?: (clientX: number, clientY: number) => void;
  onDragCancel?: () => void;
}

function swallowClick(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}

export function Rack({
  rack,
  order,
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
  const gesture = useRef<{ pointerId: number; rackIndex: number; startX: number; startY: number; dragging: boolean } | null>(
    null,
  );

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>, rackIndex: number) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { pointerId: e.pointerId, rackIndex, startX: e.clientX, startY: e.clientY, dragging: false };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.dragging) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      g.dragging = true;
      onDragStart?.(g.rackIndex, e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
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
        {order.map((rackIndex, displayIndex) => {
          // Keying by the stable rack index (not display position) is what
          // makes reordering a real DOM move rather than a prop update, so
          // motion's `layout` can FLIP-animate the slide.
          if (usedIndices.has(rackIndex)) {
            return (
              <motion.div
                layout
                transition={SLOT_TRANSITION}
                key={rackIndex}
                className="rack-slot rack-slot-empty"
                data-rack-slot={displayIndex}
              />
            );
          }
          const letter = rack[rackIndex];
          return (
            <motion.div
              layout
              transition={SLOT_TRANSITION}
              key={rackIndex}
              className={["rack-slot", dropIndex === displayIndex ? "rack-slot-drop-target" : ""]
                .filter(Boolean)
                .join(" ")}
              data-rack-slot={displayIndex}
            >
              <Tile
                letter={letter === "?" ? "" : letter}
                blank={letter === "?"}
                layoutId={`tile-${rackIndex}`}
                selected={selectedIndex === rackIndex}
                dragging={draggingIndex === rackIndex}
                onClick={() => onSelect(rackIndex)}
                onPointerDown={(e) => handlePointerDown(e, rackIndex)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

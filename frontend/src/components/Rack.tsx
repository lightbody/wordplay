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
  /** Original rack index of the tile currently being drag-picked-up, if any. */
  draggingIndex?: number | null;
  onDragStart?: (rackIndex: number, clientX: number, clientY: number, rect: DOMRect) => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnd?: (clientX: number, clientY: number) => void;
  onDragCancel?: () => void;
}

export function Rack({
  rack,
  order,
  usedIndices,
  draggingIndex,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: RackProps) {
  // Pointer handling lives on the stable `.rack` container rather than on
  // individual tile buttons. Reordering physically moves a tile's DOM node
  // (React relocates it via the keyed reconciliation that makes the
  // `layout` slide animation possible) -- and Chromium releases pointer
  // capture the instant a captured element is removed/reinserted, even
  // though it lands right back in the document a moment later. Capturing
  // on a tile meant any mid-drag reorder silently killed the gesture: no
  // more pointermove events ever arrived, so the drag looked "stuck".
  // `.rack` itself is never reordered, so it's immune to that.
  const gesture = useRef<{
    pointerId: number;
    rackIndex: number;
    startX: number;
    startY: number;
    dragging: boolean;
    rect: DOMRect;
  } | null>(null);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const slotEl = (e.target as HTMLElement).closest<HTMLElement>("[data-rack-index]");
    const tileEl = slotEl?.querySelector<HTMLElement>(".tile");
    if (!slotEl || !tileEl) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      pointerId: e.pointerId,
      rackIndex: Number(slotEl.dataset.rackIndex),
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
      onDragStart?.(g.rackIndex, e.clientX, e.clientY, g.rect);
    }
    onDragMove?.(e.clientX, e.clientY);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (g.dragging) onDragEnd?.(e.clientX, e.clientY);
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (g.dragging) onDragCancel?.();
  }

  return (
    <div
      className="rack"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <AnimatePresence>
        {order.map((rackIndex) => {
          // Keying by the stable rack index (not display position) is what
          // makes reordering a real DOM move rather than a prop update, so
          // motion's `layout` can FLIP-animate the slide.
          if (usedIndices.has(rackIndex)) {
            return <motion.div layout transition={SLOT_TRANSITION} key={rackIndex} className="rack-slot" />;
          }
          const letter = rack[rackIndex];
          return (
            <motion.div layout transition={SLOT_TRANSITION} key={rackIndex} className="rack-slot" data-rack-index={rackIndex}>
              <Tile
                letter={letter === "?" ? "" : letter}
                blank={letter === "?"}
                dragging={draggingIndex === rackIndex}
                interactive
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

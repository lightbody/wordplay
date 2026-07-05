import { useEffect, useRef } from "react";
import {
  TAP_MOVE_THRESHOLD,
  clampPan,
  clampScale,
  distance,
  isDoubleTap,
  zoomAtPoint,
  DOUBLE_TAP_SCALE,
  type Point,
  type Tap,
  type Transform,
} from "../zoomMath";

interface Gesture {
  mode: "idle" | "pan" | "pinch";
  rect: DOMRect;
  totalMove: number;
  startDist: number;
  startTransform: Transform;
  panStart: Point;
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };
const SETTLE_MS = 260;

/** Wraps a board element with a pinch-to-zoom / double-tap-to-zoom gesture,
 * scoped entirely to this viewport (touch/pen only — mouse passes through
 * untouched so the wrapped board's own click handlers keep working as-is). */
export function BoardViewport({ children }: { children: React.ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<Transform>(IDENTITY);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<Tap | null>(null);
  const rafId = useRef<number | null>(null);

  useEffect(() => () => {
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
  }, []);

  function applyTransform(t: Transform) {
    transformRef.current = t;
    if (surfaceRef.current) {
      surfaceRef.current.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
    }
  }

  function clamp(t: Transform, rect: DOMRect): Transform {
    const pan = clampPan(t.scale, t.x, t.y, rect.width, rect.width);
    return { scale: t.scale, x: pan.x, y: pan.y };
  }

  function animateTo(target: Transform) {
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    const start = { ...transformRef.current };
    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / SETTLE_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      applyTransform({
        scale: start.scale + (target.scale - start.scale) * eased,
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
      });
      if (t < 1) rafId.current = requestAnimationFrame(tick);
      else rafId.current = null;
    };
    rafId.current = requestAnimationFrame(tick);
  }

  function toggleZoom(tap: Point, rect: DOMRect) {
    const zoomedIn = transformRef.current.scale > 1.01;
    const target = zoomedIn
      ? IDENTITY
      : clamp(zoomAtPoint(transformRef.current, DOUBLE_TAP_SCALE, tap), rect);
    animateTo(target);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse") return;
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = viewportRef.current!.getBoundingClientRect();

    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      gesture.current = {
        mode: "pinch",
        rect,
        totalMove: gesture.current?.totalMove ?? 0,
        startDist: distance(p1, p2),
        startTransform: { ...transformRef.current },
        panStart: { x: e.clientX, y: e.clientY },
      };
    } else if (pointers.current.size === 1) {
      gesture.current = {
        mode: transformRef.current.scale > 1.01 ? "pan" : "idle",
        rect,
        totalMove: 0,
        startDist: 0,
        startTransform: { ...transformRef.current },
        panStart: { x: e.clientX, y: e.clientY },
      };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (e.pointerType === "mouse") return;
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current.totalMove += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);

    const g = gesture.current;
    const rect = g.rect;

    if (g.mode === "pinch" && pointers.current.size === 2) {
      e.preventDefault();
      const [p1, p2] = [...pointers.current.values()];
      const dist = distance(p1, p2);
      const nextScale = clampScale(g.startTransform.scale * (dist / g.startDist));
      const mid = { x: (p1.x + p2.x) / 2 - rect.left, y: (p1.y + p2.y) / 2 - rect.top };
      const zoomed = zoomAtPoint(g.startTransform, nextScale, mid);
      applyTransform(clamp(zoomed, rect));
    } else if (g.mode === "pan" && pointers.current.size === 1) {
      e.preventDefault();
      const dx = e.clientX - g.panStart.x;
      const dy = e.clientY - g.panStart.y;
      const next = { scale: g.startTransform.scale, x: g.startTransform.x + dx, y: g.startTransform.y + dy };
      applyTransform(clamp(next, rect));
    }
  }

  function endPointer(e: React.PointerEvent, isTap: boolean) {
    if (e.pointerType === "mouse") return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;

    if (pointers.current.size === 0) {
      if (isTap && g.totalMove > TAP_MOVE_THRESHOLD) {
        const viewport = viewportRef.current;
        if (viewport) {
          const swallow = (ev: Event) => {
            ev.preventDefault();
            ev.stopPropagation();
          };
          viewport.addEventListener("click", swallow, { capture: true, once: true });
        }
      } else if (isTap) {
        const tap: Tap = { t: performance.now(), x: e.clientX - g.rect.left, y: e.clientY - g.rect.top };
        if (isDoubleTap(lastTap.current, tap)) {
          lastTap.current = null;
          toggleZoom(tap, g.rect);
        } else {
          lastTap.current = tap;
        }
      }
      gesture.current = null;
    } else if (pointers.current.size === 1) {
      // Dropped from a pinch back to a single finger: resume as a pan.
      const [[, remaining]] = [...pointers.current.entries()];
      gesture.current = {
        mode: transformRef.current.scale > 1.01 ? "pan" : "idle",
        rect: g.rect,
        totalMove: g.totalMove,
        startDist: 0,
        startTransform: { ...transformRef.current },
        panStart: remaining,
      };
    }
  }

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, true)}
      onPointerCancel={(e) => endPointer(e, false)}
    >
      <div ref={surfaceRef} className="board-surface" style={{ transform: "translate(0px, 0px) scale(1)" }}>
        {children}
      </div>
    </div>
  );
}

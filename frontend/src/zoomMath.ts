// Pure math for the board's pinch/double-tap zoom gesture. Kept free of
// React/DOM so it can be unit tested without simulating real touch events.

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_DIST = 30;
export const TAP_MOVE_THRESHOLD = 10;

export interface Point {
  x: number;
  y: number;
}

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export interface Tap {
  t: number;
  x: number;
  y: number;
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Recompute translate so that `anchor` (in viewport-local px) stays under the
 * same screen point after scaling from `prev.scale` to `nextScale`.
 */
export function zoomAtPoint(prev: Transform, nextScale: number, anchor: Point): Transform {
  const scale = clampScale(nextScale);
  const ratio = scale / prev.scale;
  return {
    scale,
    x: anchor.x - (anchor.x - prev.x) * ratio,
    y: anchor.y - (anchor.y - prev.y) * ratio,
  };
}

/**
 * Clamp a translate so the surface (boardSize * scale) never reveals empty
 * space past the board's true edge within a viewportSize-sized window.
 */
export function clampPan(scale: number, x: number, y: number, viewportSize: number, boardSize: number): Point {
  const surface = boardSize * scale;
  const min = Math.min(0, viewportSize - surface);
  const max = 0;
  return {
    x: Math.min(max, Math.max(min, x)),
    y: Math.min(max, Math.max(min, y)),
  };
}

export function distance(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

export function isDoubleTap(prev: Tap | null, cur: Tap): boolean {
  if (!prev) return false;
  return cur.t - prev.t < DOUBLE_TAP_MS && distance(prev, cur) < DOUBLE_TAP_DIST;
}

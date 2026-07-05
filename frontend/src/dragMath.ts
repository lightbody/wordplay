// Pure helpers for the rack tile drag gesture, kept DOM-free so the
// reorder logic can be unit tested without simulating real pointer events.

/** Pointer movement (px) beyond which a tile press is treated as a drag
 * rather than a tap. */
export const DRAG_THRESHOLD = 8;

/** Number of tile slots across the rack (matches the CSS grid's column count). */
export const RACK_SIZE = 7;

/**
 * Which rack column a pointer x-coordinate falls in, given the rack
 * container's own bounding box. Geometry-based rather than element
 * hit-testing so it stays correct while sibling tiles are mid-slide from a
 * `layout` reorder animation (their rendered/painted box can transiently
 * overlap a neighboring column while the container itself never moves).
 */
export function rackColumnAt(clientX: number, rectLeft: number, rectWidth: number, columns = RACK_SIZE): number {
  const col = Math.floor(((clientX - rectLeft) / rectWidth) * columns);
  return Math.min(columns - 1, Math.max(0, col));
}

/** Move the item at `from` to position `to`, shifting the rest over. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

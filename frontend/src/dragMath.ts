// Pure helpers for the rack tile drag gesture, kept DOM-free so the
// reorder logic can be unit tested without simulating real pointer events.

/** Pointer movement (px) beyond which a tile press is treated as a drag
 * rather than a tap. */
export const DRAG_THRESHOLD = 8;

/** Move the item at `from` to position `to`, shifting the rest over. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

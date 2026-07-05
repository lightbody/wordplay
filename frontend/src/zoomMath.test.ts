import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_DIST,
  DOUBLE_TAP_MS,
  MAX_SCALE,
  MIN_SCALE,
  clampPan,
  clampScale,
  isDoubleTap,
  zoomAtPoint,
} from "./zoomMath";

describe("clampScale", () => {
  it("clamps below the minimum", () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE);
  });
  it("clamps above the maximum", () => {
    expect(clampScale(10)).toBe(MAX_SCALE);
  });
  it("passes through in-range values", () => {
    expect(clampScale(2.5)).toBe(2.5);
  });
});

describe("zoomAtPoint", () => {
  it("keeps the anchor point pixel-stable across a zoom", () => {
    const prev = { scale: 1, x: 0, y: 0 };
    const anchor = { x: 100, y: 150 };
    const next = zoomAtPoint(prev, 2, anchor);
    // The anchor's screen position before and after must match:
    // screen = surfacePoint * scale + translate
    const surfaceX = (anchor.x - prev.x) / prev.scale;
    const surfaceY = (anchor.y - prev.y) / prev.scale;
    expect(surfaceX * next.scale + next.x).toBeCloseTo(anchor.x);
    expect(surfaceY * next.scale + next.y).toBeCloseTo(anchor.y);
  });

  it("clamps the resulting scale", () => {
    const prev = { scale: 1, x: 0, y: 0 };
    const next = zoomAtPoint(prev, 50, { x: 0, y: 0 });
    expect(next.scale).toBe(MAX_SCALE);
  });
});

describe("clampPan", () => {
  it("collapses to the origin once fully zoomed out", () => {
    expect(clampPan(1, 40, -40, 300, 300)).toEqual({ x: 0, y: 0 });
  });

  it("never reveals space past the board edge when zoomed in", () => {
    const viewportSize = 300;
    const boardSize = 300;
    const scale = 2;
    // surface is 600px in a 300px window: valid x/y range is [-300, 0]
    expect(clampPan(scale, 50, 50, viewportSize, boardSize)).toEqual({ x: 0, y: 0 });
    expect(clampPan(scale, -1000, -1000, viewportSize, boardSize)).toEqual({ x: -300, y: -300 });
    expect(clampPan(scale, -150, -150, viewportSize, boardSize)).toEqual({ x: -150, y: -150 });
  });
});

describe("isDoubleTap", () => {
  it("is false with no previous tap", () => {
    expect(isDoubleTap(null, { t: 0, x: 0, y: 0 })).toBe(false);
  });

  it("is true within the time and distance window", () => {
    const prev = { t: 1000, x: 10, y: 10 };
    const cur = { t: 1000 + DOUBLE_TAP_MS - 1, x: 10 + DOUBLE_TAP_DIST - 1, y: 10 };
    expect(isDoubleTap(prev, cur)).toBe(true);
  });

  it("is false past the time window", () => {
    const prev = { t: 1000, x: 10, y: 10 };
    const cur = { t: 1000 + DOUBLE_TAP_MS + 1, x: 10, y: 10 };
    expect(isDoubleTap(prev, cur)).toBe(false);
  });

  it("is false past the distance window", () => {
    const prev = { t: 1000, x: 10, y: 10 };
    const cur = { t: 1000 + 10, x: 10 + DOUBLE_TAP_DIST + 1, y: 10 };
    expect(isDoubleTap(prev, cur)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { getTrackHoverLayout, getTrackHoverTolerance } from "../src/trackHoverLayout";

describe("getTrackHoverLayout", () => {
  it("keeps a fixed-size panel inside the viewport near the right edge", () => {
    const layout = getTrackHoverLayout(
      { x: 785, y: 295 },
      { width: 800, height: 600 },
    );

    expect(layout).not.toBeNull();
    expect(layout?.width).toBe(360);
    expect(layout?.height).toBe(136);
    expect(layout?.left).toBeGreaterThanOrEqual(12);
    expect((layout?.left ?? 0) + (layout?.width ?? 0)).toBeLessThanOrEqual(788);
    expect(layout?.top).toBeGreaterThanOrEqual(12);
    expect((layout?.top ?? 0) + (layout?.height ?? 0)).toBeLessThanOrEqual(588);
  });

  it("shrinks only when the viewport is too small to contain the panel", () => {
    const layout = getTrackHoverLayout(
      { x: 150, y: 100 },
      { width: 300, height: 200 },
    );

    expect(layout?.width).toBeLessThan(360);
    expect(layout?.height).toBeLessThan(180);
    expect(layout?.left).toBeGreaterThanOrEqual(12);
    expect((layout?.left ?? 0) + (layout?.width ?? 0)).toBeLessThanOrEqual(288);
  });
});

describe("getTrackHoverTolerance", () => {
  it("increases scene-space tolerance as the camera zooms out", () => {
    const closeTolerance = getTrackHoverTolerance(2, 20, Math.PI / 4, 600);
    const distantTolerance = getTrackHoverTolerance(2, 200, Math.PI / 4, 600);

    expect(closeTolerance).toBeGreaterThan(2);
    expect(distantTolerance).toBeGreaterThan(closeTolerance);
  });
});
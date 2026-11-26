import { describe, expect, it } from "vitest";
import { findNearestScreenPointIndex } from "../src/trackPointFocus";

describe("track point focus selection", () => {
  it("selects the closest projected route point within the click tolerance", () => {
    expect(findNearestScreenPointIndex(
      [{ x: 10, y: 10 }, { x: 40, y: 45 }, { x: 80, y: 80 }],
      { x: 42, y: 44 },
      8,
    )).toBe(1);
  });

  it("ignores clicks too far from the projected route points", () => {
    expect(findNearestScreenPointIndex(
      [{ x: 10, y: 10 }, { x: 40, y: 45 }],
      { x: 60, y: 60 },
      8,
    )).toBeNull();
  });

  it("rejects invalid coordinates and tolerances", () => {
    expect(findNearestScreenPointIndex([{ x: Number.NaN, y: 10 }], { x: 10, y: 10 }, 8)).toBeNull();
    expect(findNearestScreenPointIndex([{ x: 10, y: 10 }], { x: 10, y: 10 }, -1)).toBeNull();
  });
});
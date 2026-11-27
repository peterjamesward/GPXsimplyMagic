import { describe, expect, it } from "vitest";
import { getRideTreeKind, getRideTreeLod, getRideTreeTargetCount } from "../src/rideFoliage";

describe("Ride foliage", () => {
  it("reduces tree targets by 30% from the already-reduced density at each terrain LOD", () => {
    expect(getRideTreeTargetCount(33)).toBe(26);
    expect(getRideTreeTargetCount(17)).toBe(14);
    expect(getRideTreeTargetCount(9)).toBe(5);
  });

  it("selects pine, oak, and aspen prototypes deterministically", () => {
    expect(getRideTreeKind(0.2)).toBe("pine");
    expect(getRideTreeKind(0.7)).toBe("oak");
    expect(getRideTreeKind(0.9)).toBe("aspen");
  });

  it("maps the terrain chunk resolution to the matching tree preset LOD", () => {
    expect(getRideTreeLod(33)).toBe("large");
    expect(getRideTreeLod(17)).toBe("medium");
    expect(getRideTreeLod(9)).toBe("small");
  });
});
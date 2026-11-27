import { describe, expect, it } from "vitest";
import { createMappedRoadMeshData } from "../src/mappedRoadGeometry";
import type { OpenStreetMapRoad } from "../src/openStreetMap";

const road: OpenStreetMapRoad = Object.freeze({
  points: Object.freeze([{ x: -20, z: 0 }, { x: 20, z: 0 }]),
  highway: "residential",
  surface: "gravel",
  bounds: Object.freeze({ minX: -20, maxX: 20, minZ: 0, maxZ: 0 }),
});

describe("mapped road chunk geometry", () => {
  it("clips mapped roads to a terrain chunk and preserves their width and surface type", () => {
    const [mesh] = createMappedRoadMeshData(
      [road],
      { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      1,
      () => 3,
    );
    if (mesh === undefined) {
      throw new Error("The test road must overlap the terrain chunk.");
    }

    expect(mesh.surface).toBe("unpaved");
    expect(Math.min(...mesh.geometry.positions.filter((_value, index) => index % 3 === 0))).toBe(-10);
    expect(Math.max(...mesh.geometry.positions.filter((_value, index) => index % 3 === 0))).toBe(10);
    expect(Math.min(...mesh.geometry.positions.filter((_value, index) => index % 3 === 2))).toBe(-2.5);
    expect(Math.max(...mesh.geometry.positions.filter((_value, index) => index % 3 === 2))).toBe(2.5);
    mesh.geometry.positions.filter((_value, index) => index % 3 === 1).forEach((height) => expect(height).toBeCloseTo(3.035));
    expect(mesh.geometry.indices).toEqual([0, 2, 1, 0, 3, 2]);
  });

  it("ignores mapped road geometry outside the streamed terrain bounds", () => {
    expect(createMappedRoadMeshData(
      [road],
      { minX: 40, maxX: 60, minZ: 40, maxZ: 60 },
      1,
      () => 0,
    )).toEqual([]);
  });
});
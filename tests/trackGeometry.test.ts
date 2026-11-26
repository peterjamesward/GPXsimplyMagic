import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../src/gpx";
import { createTrackMeshData } from "../src/trackGeometry";

const samplePoints: readonly TrackPoint[] = [
  { latitude: 46.8, longitude: 9.5, elevationMeters: 1200 },
  { latitude: 46.81, longitude: 9.52, elevationMeters: 1260 },
  { latitude: 46.82, longitude: 9.515, elevationMeters: 1240 },
];

describe("createTrackMeshData", () => {
  it("returns finite, centered tube geometry with valid indices", () => {
    const geometry = createTrackMeshData(samplePoints, 6);
    const vertexCount = samplePoints.length * 6;

    expect(geometry.positions).toHaveLength(vertexCount * 3);
    expect(geometry.normals).toHaveLength(vertexCount * 3);
    expect(geometry.indices).toHaveLength((samplePoints.length - 1) * 6 * 6);
    expect(geometry.positions.every(Number.isFinite)).toBe(true);
    expect(geometry.normals.every(Number.isFinite)).toBe(true);
    expect(Math.max(...geometry.indices)).toBeLessThan(vertexCount);
    expect(Object.isFrozen(geometry)).toBe(true);
    expect(Object.isFrozen(geometry.positions)).toBe(true);
  });

  it("uses the 2-degree short arc between longitudes across the date line", () => {
    const points: readonly TrackPoint[] = [
      { latitude: 0, longitude: -179, elevationMeters: 0 },
      { latitude: 1, longitude: 179, elevationMeters: 0 },
    ];
    const geometry = createTrackMeshData(points);
    const xCoordinates = geometry.positions.filter((_value, index) => index % 3 === 0);
    const zCoordinates = geometry.positions.filter((_value, index) => index % 3 === 2);
    const horizontalWidth = Math.max(...xCoordinates) - Math.min(...xCoordinates);
    const verticalDepth = Math.max(...zCoordinates) - Math.min(...zCoordinates);

    expect(horizontalWidth / verticalDepth).toBeCloseTo(2, 1);
  });

  it("rejects routes or tube settings that cannot form a mesh", () => {
    expect(() => createTrackMeshData(samplePoints.slice(0, 1))).toThrow("At least two");
    expect(() => createTrackMeshData(samplePoints, 2)).toThrow("at least three");
  });
});
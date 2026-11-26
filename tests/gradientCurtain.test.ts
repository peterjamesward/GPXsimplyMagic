import { describe, expect, it } from "vitest";
import { createTrackMeshData } from "../src/trackGeometry";
import { createGradientCurtainMeshData } from "../src/gradientCurtain";
import type { TrackPoint } from "../src/gpx";

describe("gradient curtain geometry", () => {
  it("creates a visible curtain for a level route beneath the road", () => {
    const points: readonly TrackPoint[] = [
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0.001, longitude: 0, elevationMeters: 100 },
    ];
    const track = createTrackMeshData(points);
    const curtain = createGradientCurtainMeshData(track);
    const routeMinimumY = Math.min(...track.routePoints.map((point) => point.y));
    const expectedBaseline = routeMinimumY - 4 * track.projection.sceneUnitsPerMeter;
    const vertexYs = curtain.positions.filter((_value, index) => index % 3 === 1);

    expect(curtain.positions).toHaveLength(12);
    expect(curtain.indices).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Math.min(...vertexYs)).toBeCloseTo(expectedBaseline, 10);
    expect(Math.max(...vertexYs)).toBeLessThan(routeMinimumY);
    expect(curtain.bounds.minY).toBeCloseTo(expectedBaseline, 10);
    expect(curtain.colors).toHaveLength(curtain.positions.length / 3 * 4);
    expect(curtain.colors.slice(0, 4)).toEqual([0.2, 0.72, 0.28, 1]);
  });

  it("colors each section from its following gradient and returns immutable valid geometry", () => {
    const track = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0.001, longitude: 0, elevationMeters: 120 },
      { latitude: 0.002, longitude: 0, elevationMeters: 100 },
    ]);
    const curtain = createGradientCurtainMeshData(track);
    const vertexCount = curtain.positions.length / 3;

    expect(curtain.positions).toHaveLength(24);
    expect(curtain.normals).toHaveLength(curtain.positions.length);
    expect(curtain.colors).toHaveLength(vertexCount * 4);
    expect(curtain.colors.slice(0, 4)).toEqual([0.9, 0.14, 0.08, 1]);
    expect(curtain.colors.slice(16, 20)).toEqual([0.12, 0.38, 0.92, 1]);
    expect(curtain.positions.every(Number.isFinite)).toBe(true);
    expect(curtain.normals.every(Number.isFinite)).toBe(true);
    expect(Math.max(...curtain.indices)).toBeLessThan(vertexCount);
    expect(Object.isFrozen(curtain)).toBe(true);
    expect(Object.isFrozen(curtain.bounds)).toBe(true);
    expect(Object.isFrozen(curtain.colors)).toBe(true);
  });
});
import { describe, expect, it } from "vitest";
import { createTrackMeshData } from "../src/trackGeometry";
import { createTrackPointRayIndex, findTrackPointNearRay } from "../src/trackHover";

const geometry = createTrackMeshData([
  { latitude: 0, longitude: 0, elevationMeters: 100 },
  { latitude: 0, longitude: 0.001, elevationMeters: 110 },
  { latitude: 0, longitude: 0.002, elevationMeters: 105 },
]);

describe("findTrackPointNearRay", () => {
  it("returns the closest route point's index and measurements when the ray is near the track", () => {
    const point = findTrackPointNearRay(
      { origin: { x: 4, y: 3, z: 0 }, direction: { x: 0, y: -1, z: 0 } },
      geometry.routePoints,
      geometry.roadHalfWidth,
    );

    expect(point?.pointNumber).toBe(3);
    expect(point?.distanceMeters).toBeCloseTo(222.39, 0);
    expect(point?.altitudeMeters).toBe(105);
    expect(point?.gradientPercent).toBeNull();
  });

  it("returns null when the ray misses the route or points away from it", () => {
    expect(findTrackPointNearRay(
      { origin: { x: 100, y: 3, z: 0 }, direction: { x: 0, y: -1, z: 0 } },
      geometry.routePoints,
      geometry.roadHalfWidth,
    )).toBeNull();
    expect(findTrackPointNearRay(
      { origin: { x: 0, y: -3, z: 0 }, direction: { x: 0, y: -1, z: 0 } },
      geometry.routePoints,
      geometry.roadHalfWidth,
    )).toBeNull();
  });

  it("uses the closest point on a segment when the ray origin is nearest", () => {
    const point = findTrackPointNearRay(
      { origin: { x: 4, y: 0, z: 0 }, direction: { x: 0, y: -1, z: 0 } },
      geometry.routePoints,
      1,
    );

    expect(point?.pointNumber).toBe(3);
  });

  it("shows the gradient of the following segment at each route point", () => {
    expect(geometry.routePoints[0].gradientPercent).toBeCloseTo(9, 0);
    expect(geometry.routePoints[1].gradientPercent).toBeCloseTo(-4.5, 0);
    expect(geometry.routePoints[2].gradientPercent).toBeNull();
    expect(Object.isFrozen(geometry.routePoints)).toBe(true);
    expect(geometry.routePoints.every(Object.isFrozen)).toBe(true);
  });

  it("matches exhaustive picking for indexed route segments", () => {
    const points = Array.from({ length: 400 }, (_value, index) => ({
      x: (index % 40) * 0.6 + Math.sin(index * 0.31) * 0.12,
      y: Math.sin(index * 0.17) * 1.5,
      z: Math.floor(index / 40) * 0.7 + Math.cos(index * 0.23) * 0.1,
      pointNumber: index + 1,
      distanceMeters: index * 2,
      gradientPercent: null,
      altitudeMeters: 100 + index * 0.1,
    }));
    const findIndexedPoint = createTrackPointRayIndex(points);
    let seed = 37;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };

    for (let query = 0; query < 120; query += 1) {
      const ray = {
        origin: { x: random() * 25, y: 8, z: random() * 7 },
        direction: { x: (random() - 0.5) * 0.3, y: -1, z: (random() - 0.5) * 0.3 },
      };

      expect(findIndexedPoint(ray, 0.8)).toBe(findTrackPointNearRay(ray, points, 0.8));
    }
  });
});
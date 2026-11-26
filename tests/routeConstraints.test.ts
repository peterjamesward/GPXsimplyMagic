import { describe, expect, it } from "vitest";
import { createRouteConstraintIndex, type RouteConstraints } from "../src/routeConstraints";
import type { TrackRoutePoint } from "../src/trackGeometry";

const routePoint = (x: number, y: number, z: number, altitudeMeters = y): TrackRoutePoint => ({
  x,
  y,
  z,
  altitudeMeters,
  pointNumber: 1,
  distanceMeters: 0,
  gradientPercent: null,
});

const findRouteConstraintsByScan = (
  x: number,
  z: number,
  points: readonly TrackRoutePoint[],
  maximumDistance: number,
): RouteConstraints => {
  let nearest: RouteConstraints["nearest"] = {
    distance: Number.POSITIVE_INFINITY,
    x: points[0].x,
    z: points[0].z,
    y: points[0].y,
    elevation: points[0].altitudeMeters,
  };
  let lowestNearbyRouteHeight = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const ratio = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared));
    const routeX = start.x + dx * ratio;
    const routeZ = start.z + dz * ratio;
    const distance = Math.hypot(x - routeX, z - routeZ);
    const routeHeight = start.y + (end.y - start.y) * ratio;

    if (distance < nearest.distance) {
      nearest = {
        distance,
        x: routeX,
        z: routeZ,
        y: routeHeight,
        elevation: start.altitudeMeters + (end.altitudeMeters - start.altitudeMeters) * ratio,
      };
    }

    if (distance <= maximumDistance) {
      lowestNearbyRouteHeight = Math.min(lowestNearbyRouteHeight, routeHeight);
    }
  }

  return {
    nearest,
    lowestNearbyRouteHeight: Number.isFinite(lowestNearbyRouteHeight) ? lowestNearbyRouteHeight : null,
  };
};

describe("route constraint spatial index", () => {
  it("finds the nearest segment and the lowest nearby section at crossings", () => {
    const points = [
      routePoint(-10, 100, 0),
      routePoint(10, 100, 0),
      routePoint(0, 300, -10),
      routePoint(0, 300, 10),
    ];
    const findConstraints = createRouteConstraintIndex(points);

    expect(findConstraints(0, 0, 1)).toEqual({
      nearest: { distance: 0, x: 0, z: 0, y: 100, elevation: 100 },
      lowestNearbyRouteHeight: 100,
    });
    expect(findConstraints(0, 12, 1).lowestNearbyRouteHeight).toBeNull();
  });

  it("matches exhaustive nearest and clearance searches for varied routes and queries", () => {
    const points = Array.from({ length: 300 }, (_value, index) => {
      const column = index % 30;
      const row = Math.floor(index / 30);
      return routePoint(
        column * 4 + Math.sin(index * 0.41),
        80 + Math.sin(index * 0.17) * 70,
        row * 5 + Math.cos(index * 0.23),
      );
    });
    const findConstraints = createRouteConstraintIndex(points);
    let seed = 41;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };

    for (let query = 0; query < 200; query += 1) {
      const x = random() * 140 - 10;
      const z = random() * 60 - 10;
      const maximumDistance = [0, 2, 8, 25][query % 4];

      expect(findConstraints(x, z, maximumDistance))
        .toEqual(findRouteConstraintsByScan(x, z, points, maximumDistance));
    }
  });

  it("supports degenerate route segments and distant lookups", () => {
    const points = [routePoint(0, 10, 0), routePoint(0, 20, 0), routePoint(5, 30, 0)];
    const findConstraints = createRouteConstraintIndex(points);

    expect(findConstraints(0, 0, 0)).toEqual(findRouteConstraintsByScan(0, 0, points, 0));
    expect(findConstraints(1_000, 1_000, 5)).toEqual(findRouteConstraintsByScan(1_000, 1_000, points, 5));
  });
});
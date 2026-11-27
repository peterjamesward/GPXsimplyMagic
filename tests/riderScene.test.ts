import { describe, expect, it } from "vitest";
import { createTrackMeshData } from "../src/trackGeometry";
import {
  advanceRideWindClock,
  createRideRoadMarkings,
  createRideWindClock,
  getRideCameraPose,
  getRideTerrainChunkPlan,
  getRideViewportSize,
} from "../src/riderScene";

const geometry = createTrackMeshData([
  { latitude: 0, longitude: 0, elevationMeters: 100 },
  { latitude: 0, longitude: 0.001, elevationMeters: 110 },
  { latitude: 0.001, longitude: 0.001, elevationMeters: 90 },
]);

describe("first-person ride scene", () => {
  it("freezes stylized wind while paused and resumes without a time jump", () => {
    let clock = createRideWindClock(0);
    clock = advanceRideWindClock(clock, 1, false);
    expect(clock.timeSeconds).toBe(1);

    clock = advanceRideWindClock(clock, 5, true);
    expect(clock.timeSeconds).toBe(1);

    clock = advanceRideWindClock(clock, 5, false);
    expect(clock.timeSeconds).toBe(1);
    clock = advanceRideWindClock(clock, 5.5, false);
    expect(clock.timeSeconds).toBe(1.5);
  });

  it("uses the visible Ride canvas dimensions instead of the hidden route canvas", () => {
    expect(getRideViewportSize(
      "ride",
      { width: 0, height: 0 },
      { width: 800, height: 450 },
    )).toEqual({ width: 800, height: 450 });
  });

  it("skips terrain updates when the active view has no measurable viewport", () => {
    expect(getRideViewportSize(
      "ride",
      { width: 800, height: 450 },
      { width: 0, height: 0 },
    )).toBeNull();
  });

  it("interpolates the rider position by route distance rather than point index", () => {
    const [start, middle, end] = geometry.routePoints;
    const halfwayDistance = (start.distanceMeters + middle.distanceMeters) / 2;
    const pose = getRideCameraPose(geometry.routePoints, halfwayDistance, geometry.projection.sceneUnitsPerMeter);

    expect(pose.position.x).toBeCloseTo((start.x + middle.x) / 2);
    expect(pose.position.z).toBeCloseTo((start.z + middle.z) / 2);
    expect(pose.position.y).toBeCloseTo((start.y + middle.y) / 2 + 1.65 * geometry.projection.sceneUnitsPerMeter * 2);
    expect(pose.target.x).toBeGreaterThan(pose.position.x);
    expect(end.distanceMeters).toBeGreaterThan(middle.distanceMeters);
  });

  it("clamps the ride camera to the route and looks back from its endpoint", () => {
    const last = geometry.routePoints[geometry.routePoints.length - 1];
    if (last === undefined) {
      throw new Error("The test route must contain points.");
    }
    const pose = getRideCameraPose(geometry.routePoints, Number.MAX_SAFE_INTEGER, geometry.projection.sceneUnitsPerMeter);

    expect(pose.position.x).toBeCloseTo(last.x);
    expect(pose.position.z).toBeCloseTo(last.z);
    expect(pose.target.z).toBeLessThan(pose.position.z);
  });

  it("keeps a forward camera heading when all route points are duplicated", () => {
    const duplicateRoute = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0, longitude: 0, elevationMeters: 100 },
    ]);
    const pose = getRideCameraPose(duplicateRoute.routePoints, 0, duplicateRoute.projection.sceneUnitsPerMeter);

    expect(pose.target.z).toBeGreaterThan(pose.position.z);
  });

  it("builds colored road-edge and broken center markings above the route surface", () => {
    const markings = createRideRoadMarkings(geometry.routePoints, geometry.roadHalfWidth, geometry.projection.sceneUnitsPerMeter);
    const elevations = geometry.routePoints.map((point) => point.y);

    expect(markings.indices.length).toBeGreaterThan(0);
    expect(markings.positions.length).toBe(markings.normals.length);
    expect(markings.positions.some((value, index) => index % 3 === 1 && elevations.some((elevation) => value > elevation))).toBe(true);
    expect(Object.isFrozen(markings)).toBe(true);
  });

  it("streams terrain chunks ahead of the rider and assigns progressively coarser LOD", () => {
    const plan = getRideTerrainChunkPlan(
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      1,
      160,
      560,
    );

    expect(plan.length).toBeGreaterThan(10);
    expect(plan.length).toBeLessThanOrEqual(48);
    expect(plan.some((chunk) => chunk.gridSize === 33)).toBe(true);
    expect(plan.some((chunk) => chunk.gridSize === 17)).toBe(true);
    expect(plan.some((chunk) => chunk.gridSize === 9)).toBe(true);
    expect(plan.every((chunk) => {
      const centerX = (chunk.bounds.minX + chunk.bounds.maxX) / 2;
      return centerX >= -120;
    })).toBe(true);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it("rejects invalid scene scales for streamed terrain coverage", () => {
    expect(() => getRideTerrainChunkPlan({ x: 0, z: 0 }, { x: 1, z: 0 }, 0)).toThrow(/positive world scales/);
  });
});
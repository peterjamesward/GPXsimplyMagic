import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../src/gpx";
import { createTrackMeshData, getContinuousLongitudes } from "../src/trackGeometry";

const samplePoints: readonly TrackPoint[] = [
  { latitude: 46.8, longitude: 9.5, elevationMeters: 1200 },
  { latitude: 46.81, longitude: 9.52, elevationMeters: 1260 },
  { latitude: 46.82, longitude: 9.515, elevationMeters: 1240 },
];

describe("createTrackMeshData", () => {
  it("returns finite road geometry with valid indices", () => {
    const geometry = createTrackMeshData(samplePoints);
    const vertexCount = geometry.positions.length / 3;

    expect(geometry.positions.length).toBeGreaterThan(0);
    expect(geometry.normals).toHaveLength(geometry.positions.length);
    expect(geometry.indices.length).toBeGreaterThan(0);
    expect(geometry.positions.every(Number.isFinite)).toBe(true);
    expect(geometry.normals.every(Number.isFinite)).toBe(true);
    expect(Math.max(...geometry.indices)).toBeLessThan(vertexCount);
    expect(Object.isFrozen(geometry)).toBe(true);
    expect(Object.isFrozen(geometry.positions)).toBe(true);
  });

  it("includes the road surface in its bounds", () => {
    const geometry = createTrackMeshData(samplePoints);
    const coordinates = geometry.topSurface.positions;
    const xCoordinates = coordinates.filter((_value, index) => index % 3 === 0);
    const yCoordinates = coordinates.filter((_value, index) => index % 3 === 1);
    const zCoordinates = coordinates.filter((_value, index) => index % 3 === 2);

    expect(geometry.bounds.minX).toBe(Math.min(...xCoordinates));
    expect(geometry.bounds.maxX).toBe(Math.max(...xCoordinates));
    expect(geometry.bounds.minY).toBe(Math.min(...yCoordinates));
    expect(geometry.bounds.maxY).toBe(Math.max(...yCoordinates));
    expect(geometry.bounds.minZ).toBe(Math.min(...zCoordinates));
    expect(geometry.bounds.maxZ).toBe(Math.max(...zCoordinates));
    expect(Object.isFrozen(geometry.bounds)).toBe(true);
  });

  it("creates a six-meter-wide single-layer road with an upward-facing tarmac surface", () => {
    const points: readonly TrackPoint[] = [
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0.001, longitude: 0, elevationMeters: 100 },
    ];
    const geometry = createTrackMeshData(points);
    const xCoordinates = geometry.topSurface.positions.filter((_value, index) => index % 3 === 0);
    const yCoordinates = geometry.topSurface.positions.filter((_value, index) => index % 3 === 1);
    const expectedScale = 12 / 111.32;

    expect(Math.max(...xCoordinates) - Math.min(...xCoordinates)).toBeCloseTo(6 * expectedScale, 5);
    expect(Math.max(...yCoordinates) - Math.min(...yCoordinates)).toBeCloseTo(0, 5);
    expect(geometry.positions).toEqual(geometry.topSurface.positions);
    expect(geometry.topSurface.normals.filter((_value, index) => index % 3 === 1).every((normalY) => normalY > 0)).toBe(true);
    expect(geometry.topSurface.uvs).toHaveLength((geometry.topSurface.positions.length / 3) * 2);
  });

  it("maps increasing longitude westward and increasing latitude north", () => {
    const eastbound = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 0 },
      { latitude: 0, longitude: 0.001, elevationMeters: 0 },
    ]);
    const northbound = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 0 },
      { latitude: 0.001, longitude: 0, elevationMeters: 0 },
    ]);
    const eastStartX = eastbound.routePoints[0].x;
    const eastEndX = eastbound.routePoints[1].x;
    const northStartZ = northbound.routePoints[0].z;
    const northEndZ = northbound.routePoints[1].z;

    expect(eastEndX).toBeLessThan(eastStartX);
    expect(northEndZ).toBeGreaterThan(northStartZ);
    expect(eastbound.projection.longitudeScale).toBeLessThan(0);
  });

  it("keeps each uphill road surface at route altitude across the full width", () => {
    const points: readonly TrackPoint[] = [
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0.001, longitude: 0, elevationMeters: 100.1 },
    ];
    const geometry = createTrackMeshData(points);
    const surfaceYs = geometry.topSurface.positions.filter((_value, index) => index % 3 === 1);
    const surfaceNormalYs = geometry.topSurface.normals.filter((_value, index) => index % 3 === 1);

    expect(Math.min(...surfaceYs)).toBeCloseTo(geometry.routePoints[0].y, 10);
    expect(Math.max(...surfaceYs)).toBeCloseTo(geometry.routePoints[1].y, 10);
    expect(surfaceNormalYs.every((normalY) => normalY > 0)).toBe(true);
  });

  it("keeps each uphill segment's cross-road edges horizontal through bends", () => {
    const points: readonly TrackPoint[] = [
      { latitude: 0, longitude: 0, elevationMeters: 0 },
      { latitude: 0.001, longitude: 0, elevationMeters: 10 },
      { latitude: 0.001, longitude: 0.001, elevationMeters: 20 },
    ];
    const geometry = createTrackMeshData(points);
    const topFace = geometry.topSurface.positions.slice(0, 12);
    const startAcross = {
      x: topFace[9] - topFace[0],
      z: topFace[11] - topFace[2],
    };
    const endAcross = {
      x: topFace[6] - topFace[3],
      z: topFace[8] - topFace[5],
    };

    expect(topFace[10]).toBeCloseTo(topFace[1], 10);
    expect(topFace[7]).toBeCloseTo(topFace[4], 10);
    expect(endAcross.x).toBeCloseTo(startAcross.x, 10);
    expect(endAcross.z).toBeCloseTo(startAcross.z, 10);
    expect(topFace[4]).toBeGreaterThan(topFace[1]);
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
    expect(geometry.projection.centerLongitude).toBeCloseTo(-180);
  });

  it("unwraps route longitudes continuously for map rendering", () => {
    expect(getContinuousLongitudes([
      { latitude: 0, longitude: -179, elevationMeters: 0 },
      { latitude: 0, longitude: 179, elevationMeters: 0 },
    ])).toEqual([-179, -181]);
  });

  it("unwraps long routes in a single immutable longitude array", () => {
    const longitudes = getContinuousLongitudes(Array.from({ length: 20_000 }, (_value, index) => ({
      latitude: 0,
      longitude: index / 1_000,
      elevationMeters: 0,
    })));

    expect(longitudes).toHaveLength(20_000);
    expect(longitudes[19_999]).toBeCloseTo(19.999);
    expect(Object.isFrozen(longitudes)).toBe(true);
  });

  it("rejects routes that cannot form a mesh", () => {
    expect(() => createTrackMeshData(samplePoints.slice(0, 1))).toThrow("At least two");
  });
});
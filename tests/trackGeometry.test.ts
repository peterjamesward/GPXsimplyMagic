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

  it("includes the full road slab in its bounds", () => {
    const geometry = createTrackMeshData(samplePoints);
    const parts = [geometry, geometry.topSurface, geometry.leftSide, geometry.rightSide];
    const coordinates = parts.flatMap((part) => part.positions);
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

  it("creates a four-meter-wide road with a one-meter-deep underside", () => {
    const points: readonly TrackPoint[] = [
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0.001, longitude: 0, elevationMeters: 100 },
    ];
    const geometry = createTrackMeshData(points);
    const xCoordinates = geometry.positions.filter((_value, index) => index % 3 === 0);
    const yCoordinates = geometry.positions.filter((_value, index) => index % 3 === 1);
    const expectedScale = 12 / 111.32;

    expect(Math.max(...xCoordinates) - Math.min(...xCoordinates)).toBeCloseTo(4 * expectedScale, 5);
    expect(Math.max(...yCoordinates) - Math.min(...yCoordinates)).toBeCloseTo(2 * expectedScale, 5);
  });

  it("maps increasing longitude east and increasing latitude north", () => {
    const eastbound = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 0 },
      { latitude: 0, longitude: 0.001, elevationMeters: 0 },
    ]);
    const northbound = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 0 },
      { latitude: 0.001, longitude: 0, elevationMeters: 0 },
    ]);
    const eastStartX = eastbound.topSurface.positions[0];
    const eastEndX = eastbound.topSurface.positions[3];
    const northStartZ = northbound.topSurface.positions[2];
    const northEndZ = northbound.topSurface.positions[5];

    expect(eastEndX).toBeGreaterThan(eastStartX);
    expect(northEndZ).toBeGreaterThan(northStartZ);
  });

  it("keeps the tarmac surface above the underside of each road section", () => {
    const points: readonly TrackPoint[] = [
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0.001, longitude: 0, elevationMeters: 100.1 },
    ];
    const geometry = createTrackMeshData(points);
    const surfaceYs = geometry.topSurface.positions.filter((_value, index) => index % 3 === 1);
    const undersideYs = geometry.positions.slice(0, 12).filter((_value, index) => index % 3 === 1);
    const surfaceNormalYs = geometry.topSurface.normals.filter((_value, index) => index % 3 === 1);

    expect(Math.min(...surfaceYs)).toBeGreaterThan(Math.max(...undersideYs));
    expect(surfaceNormalYs.every((normalY) => normalY > 0)).toBe(true);
  });

  it("keeps the left and right outer sides in separate geometry", () => {
    const points: readonly TrackPoint[] = [
      { latitude: 0, longitude: 0, elevationMeters: 0 },
      { latitude: 0.001, longitude: 0, elevationMeters: 0 },
    ];
    const geometry = createTrackMeshData(points);
    const leftXCoordinates = geometry.leftSide.positions.filter((_value, index) => index % 3 === 0);
    const rightXCoordinates = geometry.rightSide.positions.filter((_value, index) => index % 3 === 0);

    expect(leftXCoordinates.length).toBeGreaterThan(0);
    expect(rightXCoordinates.length).toBeGreaterThan(0);
    expect(Math.max(...leftXCoordinates)).toBeLessThan(0);
    expect(Math.min(...rightXCoordinates)).toBeGreaterThan(0);
    expect(geometry.leftSide.normals.filter((_value, index) => index % 3 === 0).every((normalX) => normalX < 0)).toBe(true);
    expect(geometry.rightSide.normals.filter((_value, index) => index % 3 === 0).every((normalX) => normalX > 0)).toBe(true);
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

  it("rejects routes that cannot form a mesh", () => {
    expect(() => createTrackMeshData(samplePoints.slice(0, 1))).toThrow("At least two");
  });
});
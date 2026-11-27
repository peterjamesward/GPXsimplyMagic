import { describe, expect, it } from "vitest";
import { createTrackMeshData } from "../src/trackGeometry";
import {
  decodeTerrariumElevation,
  getTerrainDemZoom,
  getTerrainTileCoverage,
  retainBestTerrainElevation,
  type TerrainDemData,
} from "../src/terrainDem";
import { createTerrainChunkMeshData, createTerrainHeightSampler, createTerrainMeshData } from "../src/terrainGeometry";
import { createTerrainScenery } from "../src/terrainScenery";
import type { TrackPoint } from "../src/gpx";

const points: readonly TrackPoint[] = [
  { latitude: 46.8, longitude: 9.5, elevationMeters: 1200 },
  { latitude: 46.801, longitude: 9.502, elevationMeters: 1250 },
  { latitude: 46.802, longitude: 9.504, elevationMeters: 1230 },
];

describe("terrain geometry", () => {
  it("maps camera zoom to a bounded integer DEM level", () => {
    expect(getTerrainDemZoom(8.9)).toBe(8);
    expect(getTerrainDemZoom(-3)).toBe(0);
    expect(getTerrainDemZoom(18)).toBe(15);
    expect(getTerrainDemZoom(Number.NaN)).toBeNull();
  });

  it("limits requested terrain coverage to 64 tiles without exceeding the requested zoom", () => {
    const geometry = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0, longitude: 5, elevationMeters: 100 },
    ]);
    const coverage = getTerrainTileCoverage(geometry, 15);
    const tileCount = (coverage.maxX - coverage.minX + 1) * (coverage.maxY - coverage.minY + 1);

    expect(coverage.zoom).toBeLessThan(15);
    expect(tileCount).toBeLessThanOrEqual(64);
    expect(getTerrainTileCoverage(geometry, 4).zoom).toBeLessThanOrEqual(4);
  });

  it("loads high-resolution coverage around the camera instead of an entire long route", () => {
    const geometry = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0, longitude: 5, elevationMeters: 100 },
    ]);
    const view = { center: [2.5, 0] as const, zoom: 15, width: 400, height: 300, pitch: 0 };
    const coverage = getTerrainTileCoverage(geometry, 15, view);
    const shiftedCoverage = getTerrainTileCoverage(geometry, 15, { ...view, center: [2.8, 0] });
    const tileCount = (coverage.maxX - coverage.minX + 1) * (coverage.maxY - coverage.minY + 1);

    expect(coverage.zoom).toBe(15);
    expect(tileCount).toBeLessThanOrEqual(64);
    expect(shiftedCoverage.minX).not.toBe(coverage.minX);

    const zoomedOutCoverage = getTerrainTileCoverage(geometry, 0, {
      center: [0, 0],
      zoom: -2,
      width: 800,
      height: 600,
      pitch: 85,
    });
    expect(zoomedOutCoverage.zoom).toBe(0);
  });

  it("prefers higher-resolution elevations and falls back where those tiles have gaps", () => {
    const coarse = Object.freeze({ zoom: 6, elevationAt: () => 1200 });
    const fine = Object.freeze({ zoom: 8, elevationAt: (latitude: number) => latitude > 0 ? 1250 : null });
    const best = retainBestTerrainElevation(coarse, fine);
    const nearbyFine = Object.freeze({ zoom: 8, elevationAt: (latitude: number) => latitude < 0 ? 1300 : null });
    const merged = retainBestTerrainElevation(best, nearbyFine);

    expect(merged.zoom).toBe(8);
    expect(merged.elevationAt(1, 0)).toBe(1250);
    expect(merged.elevationAt(-1, 0)).toBe(1300);
    expect(merged.elevationAt(0, 0)).toBe(1200);
    expect(retainBestTerrainElevation(merged, coarse)).toBe(merged);
  });

  it("bounds retained elevation layers while keeping the newest patch preferred", () => {
    const patches: readonly TerrainDemData[] = Array.from({ length: 10 }, (_value, index) =>
      Object.freeze({ zoom: 8, elevationAt: () => index }));
    const merged = patches.reduce<TerrainDemData | null>(
      (current, patch) => retainBestTerrainElevation(current, patch),
      null,
    );

    expect(merged?.layers).toHaveLength(4);
    expect(merged?.elevationAt(0, 0)).toBe(9);
  });

  it("decodes Terrarium RGB pixels to elevation metres", () => {
    expect(decodeTerrariumElevation(128, 0, 0)).toBe(0);
    expect(decodeTerrariumElevation(128, 0, 128)).toBeCloseTo(0.5);
    expect(decodeTerrariumElevation(127, 255, 255)).toBeCloseTo(-0.00390625);
  });

  it("keeps terrain below the road while matching the GPX route profile", () => {
    const geometry = createTrackMeshData(points);
    const sampleHeight = createTerrainHeightSampler(geometry, () => 800);
    const [start, middle, end] = geometry.routePoints;
    const roadClearance = 2.1 * geometry.projection.sceneUnitsPerMeter;

    expect(sampleHeight(start.x, start.z)).toBeCloseTo(start.y - roadClearance, 8);
    expect(sampleHeight(middle.x, middle.z)).toBeCloseTo(middle.y - roadClearance, 8);
    expect(sampleHeight(end.x, end.z)).toBeCloseTo(end.y - roadClearance, 8);
    expect(sampleHeight((start.x + middle.x) / 2, (start.z + middle.z) / 2))
      .toBeCloseTo((start.y + middle.y) / 2 - roadClearance, 8);
  });

  it("builds bounded high-resolution terrain chunks that retain GPX road clearance", () => {
    const geometry = createTrackMeshData(points);
    const routePoint = geometry.routePoints[1];
    const margin = 30 * geometry.projection.sceneUnitsPerMeter;
    const chunk = createTerrainChunkMeshData(
      geometry,
      () => 800,
      {
        minX: routePoint.x - margin,
        maxX: routePoint.x + margin,
        minZ: routePoint.z - margin,
        maxZ: routePoint.z + margin,
      },
      33,
    );

    expect(chunk.columns).toBe(33);
    expect(chunk.rows).toBe(33);
    expect(chunk.bounds.minX).toBeCloseTo(routePoint.x - margin);
    expect(chunk.bounds.maxZ).toBeCloseTo(routePoint.z + margin);
    expect(chunk.sampleHeightAt(routePoint.x, routePoint.z)).toBeCloseTo(
      routePoint.y - 2.1 * geometry.projection.sceneUnitsPerMeter,
      8,
    );
    expect(chunk.positions.length).toBe(chunk.normals.length);
    expect(chunk.indices.length).toBe(32 * 32 * 6);
  });

  it("keeps GPX road clearance identical across chunk LOD levels", () => {
    const geometry = createTrackMeshData(points);
    const routePoint = geometry.routePoints[1];
    const margin = 30 * geometry.projection.sceneUnitsPerMeter;
    const bounds = {
      minX: routePoint.x - margin,
      maxX: routePoint.x + margin,
      minZ: routePoint.z - margin,
      maxZ: routePoint.z + margin,
    };
    const safetyDiagonalMeters = (160 * Math.SQRT2) / 8;
    const coarse = createTerrainChunkMeshData(geometry, () => 800, bounds, 9, undefined, safetyDiagonalMeters);
    const fine = createTerrainChunkMeshData(geometry, () => 800, bounds, 33, undefined, safetyDiagonalMeters);

    expect(coarse.sampleHeightAt(routePoint.x, routePoint.z)).toBeCloseTo(routePoint.y - 2.1 * geometry.projection.sceneUnitsPerMeter, 8);
    expect(fine.sampleHeightAt(routePoint.x, routePoint.z)).toBeCloseTo(coarse.sampleHeightAt(routePoint.x, routePoint.z), 8);
  });

  it("keeps coarse terrain below the road underside across the road width", () => {
    const geometry = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0, longitude: 0.004, elevationMeters: 100 },
    ]);
    const terrain = createTerrainMeshData(geometry, () => 900, 9);
    const roadCenterX = (geometry.routePoints[0].x + geometry.routePoints[1].x) / 2;
    const roadCenterZ = (geometry.routePoints[0].z + geometry.routePoints[1].z) / 2;
    const withinRoadZ = roadCenterZ + geometry.roadHalfWidth / 2;
    const roadBottomY = geometry.routePoints[0].y - 2 * geometry.projection.sceneUnitsPerMeter;

    expect(terrain.sampleHeightAt(roadCenterX, withinRoadZ)).toBeLessThan(roadBottomY);
  });

  it("keeps the complete lower road segment clear when route sections pass close together", () => {
    const geometry = createTrackMeshData([
      { latitude: 0, longitude: -0.001, elevationMeters: 100 },
      { latitude: 0, longitude: 0.001, elevationMeters: 100 },
      { latitude: 0.00009, longitude: 0.001, elevationMeters: 300 },
      { latitude: 0.00009, longitude: -0.001, elevationMeters: 300 },
    ]);
    const terrain = createTerrainMeshData(geometry, () => 900, 9);
    const [start, end] = geometry.routePoints;
    const roadDepth = 2 * geometry.projection.sceneUnitsPerMeter;

    for (let step = 1; step < 20; step += 1) {
      const progress = step / 20;
      const x = start.x + (end.x - start.x) * progress;
      const z = start.z + (end.z - start.z) * progress;
      const roadBottom = start.y + (end.y - start.y) * progress - roadDepth;

      expect(terrain.sampleHeightAt(x, z)).toBeLessThan(roadBottom);
    }
  });

  it("anchors the route elevation correction at the outer road edge", () => {
    const geometry = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0, longitude: 0.004, elevationMeters: 100 },
    ]);
    const sampleHeight = createTerrainHeightSampler(geometry, () => 500);
    const [start, end] = geometry.routePoints;
    const centerX = (start.x + end.x) / 2;
    const centerZ = (start.z + end.z) / 2;
    const distanceBeyondRoadEdgeMeters = 1;
    const sampleZ = centerZ + geometry.roadHalfWidth + distanceBeyondRoadEdgeMeters * geometry.projection.sceneUnitsPerMeter;
    const minimumElevation = Math.min(start.altitudeMeters, end.altitudeMeters);
    const mapHeight = 0.12 + (500 - minimumElevation) * geometry.projection.sceneUnitsPerMeter * 2;
    const edgeDistanceInfluence = Math.exp(-((distanceBeyondRoadEdgeMeters / 90) ** 2));
    const expectedHeight = mapHeight + (start.y - mapHeight) * edgeDistanceInfluence;

    expect(sampleHeight(centerX, sampleZ)).toBeCloseTo(expectedHeight, 8);
  });

  it("samples map elevation at terrain locations away from the route", () => {
    const geometry = createTrackMeshData(points);
    const queriedLatitudes: number[] = [];
    const sampleHeight = createTerrainHeightSampler(geometry, (latitude) => {
      queriedLatitudes.push(latitude);
      return 500 + (latitude - geometry.projection.centerLatitude) * 111_320;
    });
    const middle = geometry.routePoints[1];
    const targetZ = middle.z + 600 * geometry.projection.sceneUnitsPerMeter;
    const targetLatitude = geometry.projection.centerLatitude + targetZ / (geometry.projection.sceneUnitsPerMeter * 111_320);
    const terrainElevation = 500 + (targetLatitude - geometry.projection.centerLatitude) * 111_320;
    const minimumTrackElevation = Math.min(...geometry.routePoints.map((point) => point.altitudeMeters));
    const expectedHeight = 0.12 + (terrainElevation - minimumTrackElevation) * geometry.projection.sceneUnitsPerMeter * 2;
    const actualHeight = sampleHeight(middle.x, targetZ);

    expect(queriedLatitudes.some((latitude) => Math.abs(latitude - targetLatitude) < 1e-10)).toBe(true);
    expect(actualHeight).toBeCloseTo(expectedHeight, 5);
  });

  it("creates a finite, upward-facing terrain mesh around the route", () => {
    const geometry = createTrackMeshData(points);
    const terrain = createTerrainMeshData(geometry, () => 1200, 17);
    const vertexCount = terrain.positions.length / 3;

    expect(terrain.positions.length).toBeGreaterThan(0);
    expect(terrain.normals).toHaveLength(terrain.positions.length);
    expect(terrain.positions.every(Number.isFinite)).toBe(true);
    expect(terrain.normals.every(Number.isFinite)).toBe(true);
    expect(terrain.normals.filter((_value, index) => index % 3 === 1).every((normalY) => normalY > 0)).toBe(true);
    expect(Math.max(...terrain.indices)).toBeLessThan(vertexCount);
    expect(terrain.bounds.minX).toBeLessThan(geometry.bounds.minX);
    expect(terrain.bounds.maxX).toBeGreaterThan(geometry.bounds.maxX);
    expect(Object.isFrozen(terrain.positions)).toBe(true);
  });

  it("generates deterministic terrain foliage and buildings", () => {
    const geometry = createTrackMeshData(points);
    const terrain = createTerrainMeshData(geometry, () => 1200, 17);
    const first = createTerrainScenery(terrain, geometry, 42);
    const second = createTerrainScenery(terrain, geometry, 42);

    expect(first.foliage.positions.length).toBeGreaterThan(0);
    expect(first.buildingWalls.positions.length).toBeGreaterThan(0);
    expect(first.foliage.positions).toEqual(second.foliage.positions);
    expect(first.grassPlacements).toEqual(second.grassPlacements);
    expect(first.treePlacements).toEqual(second.treePlacements);
    expect(first.grassPlacements.length).toBeGreaterThan(0);
    expect(first.treePlacements.every((tree) => tree.height > 0 && Number.isFinite(tree.rotation))).toBe(true);
    expect(first.buildingRoofs.positions).toEqual(second.buildingRoofs.positions);
    expect(first.foliage.normals.every(Number.isFinite)).toBe(true);
    expect(first.buildingWalls.indices.length).toBeGreaterThan(0);
  });

  it("keeps dense procedural foliage beside long routes instead of spreading it across the full terrain bounds", () => {
    const geometry = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0, longitude: 0.25, elevationMeters: 100 },
    ]);
    const terrain = createTerrainMeshData(geometry, () => 100, 9);
    const scenery = createTerrainScenery(terrain, geometry, 24);
    let foliageVerticesBesideRoute = 0;
    for (let index = 2; index < scenery.foliage.positions.length; index += 3) {
      if (Math.abs(scenery.foliage.positions[index]) <= 130 * geometry.projection.sceneUnitsPerMeter) {
        foliageVerticesBesideRoute += 1;
      }
    }

    expect(scenery.foliage.positions.length / 135).toBe(200);
    expect(foliageVerticesBesideRoute / (scenery.foliage.positions.length / 3)).toBeGreaterThan(0.75);
  });
});
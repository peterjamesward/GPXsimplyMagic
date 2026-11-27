import { describe, expect, it } from "vitest";
import { createLandUseSpatialIndex, type OpenStreetMapArea } from "../src/openStreetMap";
import { createTerrainMeshData } from "../src/terrainGeometry";
import { createRouteConstraintIndex } from "../src/routeConstraints";
import { createTrackMeshData } from "../src/trackGeometry";
import {
  createStylizedGrassPlacements,
  getRideGrassPlacementTarget,
  getRideTreePlacementTarget,
  getRouteGrassPlacementTarget,
  getRouteTreePlacementTarget,
} from "../src/vegetationPlacement";

const geometry = createTrackMeshData([
  { latitude: 46.8, longitude: 9.5, elevationMeters: 1200 },
  { latitude: 46.801, longitude: 9.502, elevationMeters: 1250 },
  { latitude: 46.802, longitude: 9.504, elevationMeters: 1230 },
]);

const terrain = createTerrainMeshData(geometry, () => 1200, 9);

describe("stylized vegetation placement", () => {
  it("uses the reduced route and Ride tree and grass targets", () => {
    expect(getRouteTreePlacementTarget(30_000)).toBe(200);
    expect(getRouteTreePlacementTarget(0)).toBe(6);
    expect(getRouteGrassPlacementTarget(1_000)).toBe(10_000);
    expect(getRouteGrassPlacementTarget(0)).toBe(1_500);
    expect(getRouteGrassPlacementTarget(10_000)).toBe(20_000);
    expect(getRideTreePlacementTarget(33)).toBe(16);
    expect(getRideTreePlacementTarget(17)).toBe(9);
    expect(getRideTreePlacementTarget(16)).toBe(3);
    expect(getRideGrassPlacementTarget(33)).toBe(4_500);
    expect(getRideGrassPlacementTarget(17)).toBe(1_800);
    expect(getRideGrassPlacementTarget(16)).toBe(500);
  });

  it("creates deterministic grass within terrain bounds and clear of the GPX road", () => {
    const landUse = createLandUseSpatialIndex([]);
    const first = createStylizedGrassPlacements(terrain, geometry, landUse, 42, 600, terrain.bounds, "route");
    const second = createStylizedGrassPlacements(terrain, geometry, landUse, 42, 600, terrain.bounds, "route");
    const findRouteConstraints = createRouteConstraintIndex(geometry.routePoints);
    const minimumRoadDistance = geometry.roadHalfWidth + 0.5 * geometry.projection.sceneUnitsPerMeter;

    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
    expect(first.every(({ x, y, z, scale, rotation, colorIndex }) =>
      [x, y, z, scale, rotation, colorIndex].every(Number.isFinite) && scale > 0 && colorIndex >= 0 && colorIndex < 5 &&
      x >= terrain.bounds.minX && x <= terrain.bounds.maxX && z >= terrain.bounds.minZ && z <= terrain.bounds.maxZ &&
      findRouteConstraints(x, z, 0).nearest.distance >= minimumRoadDistance)).toBe(true);
  });

  it("does not plant grass in mapped water", () => {
    const { bounds } = terrain;
    const waterArea: OpenStreetMapArea = Object.freeze({
      category: "water",
      treesAllowed: false,
      points: Object.freeze([
        Object.freeze({ x: bounds.minX, z: bounds.minZ }),
        Object.freeze({ x: bounds.maxX, z: bounds.minZ }),
        Object.freeze({ x: bounds.maxX, z: bounds.maxZ }),
        Object.freeze({ x: bounds.minX, z: bounds.maxZ }),
        Object.freeze({ x: bounds.minX, z: bounds.minZ }),
      ]),
      bounds,
    });
    const landUse = createLandUseSpatialIndex([waterArea]);
    const placements = createStylizedGrassPlacements(terrain, geometry, landUse, 42, 100, bounds, "area");

    expect(placements).toHaveLength(0);
  });

  it("does not plant grass in mapped built-up land use", () => {
    const { bounds } = terrain;
    const residentialArea: OpenStreetMapArea = Object.freeze({
      category: "residential",
      treesAllowed: false,
      points: Object.freeze([
        Object.freeze({ x: bounds.minX, z: bounds.minZ }),
        Object.freeze({ x: bounds.maxX, z: bounds.minZ }),
        Object.freeze({ x: bounds.maxX, z: bounds.maxZ }),
        Object.freeze({ x: bounds.minX, z: bounds.maxZ }),
        Object.freeze({ x: bounds.minX, z: bounds.minZ }),
      ]),
      bounds,
    });
    const landUse = createLandUseSpatialIndex([residentialArea]);

    expect(createStylizedGrassPlacements(terrain, geometry, landUse, 42, 100, bounds, "area")).toHaveLength(0);
  });

  it("does not plant grass inside mapped building footprints", () => {
    const { bounds } = terrain;
    const building = Object.freeze({
      points: Object.freeze([
        Object.freeze({ x: bounds.minX, z: bounds.minZ }),
        Object.freeze({ x: bounds.maxX, z: bounds.minZ }),
        Object.freeze({ x: bounds.maxX, z: bounds.maxZ }),
        Object.freeze({ x: bounds.minX, z: bounds.maxZ }),
        Object.freeze({ x: bounds.minX, z: bounds.minZ }),
      ]),
      heightMeters: 8,
      wallColor: Object.freeze([0.6, 0.5, 0.4] as const),
      roofColor: Object.freeze([0.4, 0.2, 0.1] as const),
    });
    const landUse = createLandUseSpatialIndex([], [building]);

    expect(createStylizedGrassPlacements(terrain, geometry, landUse, 42, 100, bounds, "area")).toHaveLength(0);
  });
});
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTrackMeshData } from "../src/trackGeometry";
import { createTerrainMeshData } from "../src/terrainGeometry";
import { createTerrainScenery } from "../src/terrainScenery";
import {
  canPlaceProceduralTreeAt,
  createOpenStreetMapQuery,
  createLandUseSpatialIndex,
  getLandUseCategoryAt,
  getLandUseColorAt,
  getOpenStreetMapBounds,
  loadOpenStreetMapFeatures,
  parseOpenStreetMapFeatures,
  type OpenStreetMapArea,
} from "../src/openStreetMap";

const geometry = createTrackMeshData([
  { latitude: -0.001, longitude: -0.001, elevationMeters: 100 },
  { latitude: 0.001, longitude: 0.001, elevationMeters: 100 },
]);

const box = (distance: number): readonly { lat: number; lon: number }[] => {
  const { centerLatitude, centerLongitude } = geometry.projection;
  const latitudeOffset = distance / 111_320;
  const longitudeOffset = distance / (Math.max(0.00001, Math.abs(geometry.projection.longitudeScale)) * 111_320);
  return [
    { lat: centerLatitude - latitudeOffset, lon: centerLongitude - longitudeOffset },
    { lat: centerLatitude - latitudeOffset, lon: centerLongitude + longitudeOffset },
    { lat: centerLatitude + latitudeOffset, lon: centerLongitude + longitudeOffset },
    { lat: centerLatitude + latitudeOffset, lon: centerLongitude - longitudeOffset },
    { lat: centerLatitude - latitudeOffset, lon: centerLongitude - longitudeOffset },
  ];
};

describe("OpenStreetMap route features", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("queries land-use classes and full building geometries in the requested area", () => {
    const query = createOpenStreetMapQuery({ south: 1, west: 2, north: 3, east: 4 });

    expect(query).toContain("[timeout:20]");
    expect(query).toContain('way["natural"~');
    expect(query).toContain('way["building"]');
    expect(query).toContain("out geom");
    expect(query).toContain("1.000000,2.000000,3.000000,4.000000");
  });

  it("splits the route query around the international date line", () => {
    const dateLineGeometry = createTrackMeshData([
      { latitude: 0, longitude: 179.999, elevationMeters: 100 },
      { latitude: 0, longitude: -179.999, elevationMeters: 100 },
    ]);
    const bounds = getOpenStreetMapBounds(dateLineGeometry);

    expect(bounds).toHaveLength(2);
    expect(bounds[0].west).toBeGreaterThan(0);
    expect(bounds[0].east).toBe(180);
    expect(bounds[1].west).toBe(-180);
    expect(bounds[1].east).toBeLessThan(0);
  });

  it("loads route-area features from Overpass with an abortable form request", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      controller.abort();
      return new Response(JSON.stringify({
        elements: [{ type: "way", id: 8, tags: { landuse: "farmland" }, geometry: box(40) }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const features = await loadOpenStreetMapFeatures(geometry, controller.signal);
    const [url, options] = fetchMock.mock.calls[0];
    expect(options).toBeDefined();
    if (options === undefined) {
      throw new Error("Overpass request options were not provided.");
    }
    const body = options.body as URLSearchParams;

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(url).toBe("https://overpass-api.de/api/interpreter");
    expect(options.method).toBe("POST");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect((options.signal as AbortSignal).aborted).toBe(true);
    expect(body.get("data")).toContain('"landuse"');
    expect(features.areas[0].category).toBe("farmland");
  });

  it("parses land-use polygons and individual building shapes, height, and colors", () => {
    const features = parseOpenStreetMapFeatures({
      elements: [
        { type: "way", id: 1, tags: { landuse: "farmland" }, geometry: box(100) },
        {
          type: "way",
          id: 2,
          tags: { building: "house", height: "12.5 m", "building:colour": "#cc8844", "roof:colour": "red" },
          geometry: box(20),
        },
      ],
    }, geometry);

    expect(features.areas).toHaveLength(1);
    expect(features.areas[0].category).toBe("farmland");
    expect(features.areas[0].points).toHaveLength(5);
    expect(features.buildings).toHaveLength(1);
    expect(features.buildings[0].points).toHaveLength(5);
    expect(features.buildings[0].heightMeters).toBe(12.5);
    expect(features.buildings[0].wallColor).toEqual([204 / 255, 136 / 255, 68 / 255]);
    expect(features.buildings[0].roofColor).toEqual([168 / 255, 67 / 255, 53 / 255]);
    expect(Object.isFrozen(features)).toBe(true);
  });

  it("joins outer relation members into polygons and uses building levels as a height fallback", () => {
    const ring = box(50);
    const features = parseOpenStreetMapFeatures({
      elements: [{
        type: "relation",
        id: 3,
        tags: { type: "multipolygon", natural: "water", building: "yes", "building:levels": "4" },
        members: [
          { role: "outer", geometry: ring.slice(0, 3) },
          { role: "outer", geometry: ring.slice(2, 5) },
          { role: "outer", geometry: [ring[4], ring[0]] },
        ],
      }],
    }, geometry);

    expect(features.areas[0].category).toBe("water");
    expect(features.areas[0].points).toHaveLength(5);
    expect(features.buildings[0].heightMeters).toBe(12);
  });

  it("classifies a mapped area at a scene point and returns its style color", () => {
    const features = parseOpenStreetMapFeatures({
      elements: [{ type: "way", id: 4, tags: { landuse: "residential" }, geometry: box(80) }],
    }, geometry);

    expect(getLandUseCategoryAt(0, 0, features.areas)).toBe("residential");
    expect(getLandUseColorAt(0, 0, features.areas)).toEqual([0.58, 0.54, 0.46]);
    expect(getLandUseCategoryAt(100, 100, features.areas)).toBeNull();
    expect(canPlaceProceduralTreeAt(0, 0, features.areas)).toBe(false);
    expect(canPlaceProceduralTreeAt(100, 100, features.areas)).toBe(true);
  });

  it("matches exhaustive land-use lookups across overlapping spatially indexed areas", () => {
    const categories = ["water", "farmland", "woodland", "grassland", "residential", "industrial", "bare"] as const;
    const areas: OpenStreetMapArea[] = Array.from({ length: 40 }, (_value, index) => {
      const centerX = (index % 8) * 20 - 70;
      const centerZ = Math.floor(index / 8) * 20 - 40;
      const radius = index % 5 === 0 ? 14 : 8;
      const points = Object.freeze([
        Object.freeze({ x: centerX - radius, z: centerZ - radius }),
        Object.freeze({ x: centerX + radius, z: centerZ - radius }),
        Object.freeze({ x: centerX + radius, z: centerZ + radius }),
        Object.freeze({ x: centerX - radius, z: centerZ + radius }),
        Object.freeze({ x: centerX - radius, z: centerZ - radius }),
      ]);
      return Object.freeze({
        category: categories[index % categories.length],
        treesAllowed: index % 2 === 0,
        points,
        bounds: Object.freeze({
          minX: centerX - radius,
          maxX: centerX + radius,
          minZ: centerZ - radius,
          maxZ: centerZ + radius,
        }),
      });
    });
    const overlappingArea = areas[0];
    const allAreas = [...areas, Object.freeze({
      ...overlappingArea,
      category: "water" as const,
      treesAllowed: false,
    })];
    const index = createLandUseSpatialIndex(allAreas);

    expect(index.getCategoryAt(-70, -40)).toBe("water");
    expect(index.canPlaceTreeAt(-70, -40)).toBe(true);

    for (let query = 0; query < 240; query += 1) {
      const x = (query * 37 % 190) - 90;
      const z = (query * 53 % 130) - 60;
      const expectedCategory = getLandUseCategoryAt(x, z, allAreas);
      const expectedColor = getLandUseColorAt(x, z, allAreas);
      const expectedTreePlacement = canPlaceProceduralTreeAt(x, z, allAreas);

      expect(index.getCategoryAt(x, z)).toBe(expectedCategory);
      expect(index.getColorAt(x, z)).toEqual(expectedColor);
      expect(index.canPlaceTreeAt(x, z)).toBe(expectedTreePlacement);
    }
  });

  it("applies land-use vertex colors and extrudes an OSM building footprint", () => {
    const features = parseOpenStreetMapFeatures({
      elements: [
        { type: "way", id: 5, tags: { landuse: "farmland" }, geometry: box(100) },
        {
          type: "way",
          id: 6,
          tags: { building: "house", height: "12 m", "building:colour": "#cc8844", "roof:colour": "#456789" },
          geometry: box(20),
        },
      ],
    }, geometry);
    const terrain = createTerrainMeshData(
      geometry,
      () => 100,
      9,
      (x, z) => getLandUseColorAt(x, z, features.areas) ?? [0.3, 0.4, 0.24],
    );
    const scenery = createTerrainScenery(terrain, geometry, 42, features);
    const orchard = parseOpenStreetMapFeatures({
      elements: [{ type: "way", id: 7, tags: { landuse: "orchard" }, geometry: box(80) }],
    }, geometry);
    const mappedRoof = scenery.buildingRoofs.positions.findIndex((_value, index) => index % 3 === 1);
    const firstBuildingPoint = features.buildings[0].points[0];

    expect(terrain.colors).toHaveLength((terrain.positions.length / 3) * 4);
    expect(terrain.colors).toContain(0.55);
    expect(scenery.buildingWalls.colors?.slice(0, 4)).toEqual([...features.buildings[0].wallColor, 1]);
    expect(scenery.buildingRoofs.colors?.slice(0, 4)).toEqual([...features.buildings[0].roofColor, 1]);
    expect(scenery.buildingWalls.positions.length).toBeGreaterThan(0);
    expect(scenery.buildingRoofs.positions.length).toBeGreaterThan(0);
    expect(scenery.buildingRoofs.positions[mappedRoof]).toBeGreaterThan(terrain.sampleHeightAt(firstBuildingPoint.x, firstBuildingPoint.z));
    expect(Object.isFrozen(scenery.buildingWalls.colors)).toBe(true);
    expect(canPlaceProceduralTreeAt(0, 0, orchard.areas)).toBe(true);
  });

  it("keeps procedural trees and buildings out of mapped farmland", () => {
    const features = parseOpenStreetMapFeatures({
      elements: [{ type: "way", id: 9, tags: { landuse: "farmland" }, geometry: box(1_000) }],
    }, geometry);
    const terrain = createTerrainMeshData(geometry, () => 100, 9);
    const scenery = createTerrainScenery(terrain, geometry, 42, features);

    expect(scenery.foliage.positions).toHaveLength(0);
    expect(scenery.trunks.positions).toHaveLength(0);
    expect(scenery.buildingWalls.positions).toHaveLength(0);
    expect(scenery.buildingRoofs.positions).toHaveLength(0);
  });
});
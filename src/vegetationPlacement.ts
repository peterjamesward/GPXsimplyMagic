import type { TerrainMeshData, TerrainChunkBounds } from "./terrainGeometry";
import type { LandUseSpatialIndex } from "./openStreetMap";
import { createRouteConstraintIndex } from "./routeConstraints";
import type { TrackMeshData } from "./trackGeometry";

export type StylizedTreePlacement = Readonly<{
  x: number;
  y: number;
  z: number;
  height: number;
  rotation: number;
}>;

export type StylizedGrassPlacement = Readonly<{
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  colorIndex: number;
}>;

export type GrassPlacementMode = "area" | "route";

export const getRouteTreePlacementTarget = (routeLengthMeters: number): number =>
  Math.round(Math.max(24, Math.min(800, Math.round(routeLengthMeters / 30))) / 2);

export const getRouteGrassPlacementTarget = (routeLengthMeters: number): number =>
  Math.min(40_000, Math.max(3_000, Math.round(routeLengthMeters * 20)));

export const getRideTreePlacementTarget = (gridSize: number): number =>
  gridSize >= 33 ? 31 : gridSize >= 17 ? 17 : 6;

export const getRideGrassPlacementTarget = (gridSize: number): number =>
  gridSize >= 33 ? 9_000 : gridSize >= 17 ? 3_600 : 1_000;

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const getRoutePositionAtDistance = (geometry: TrackMeshData, distanceMeters: number): Readonly<{ x: number; z: number }> => {
  const points = geometry.routePoints;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].distanceMeters < distanceMeters) low = middle + 1;
    else high = middle;
  }
  const end = points[low];
  const start = points[Math.max(0, low - 1)];
  const span = end.distanceMeters - start.distanceMeters;
  const progress = span > 0 ? (distanceMeters - start.distanceMeters) / span : 0;
  return Object.freeze({
    x: start.x + (end.x - start.x) * progress,
    z: start.z + (end.z - start.z) * progress,
  });
};

export const createStylizedGrassPlacements = (
  terrain: Pick<TerrainMeshData, "bounds" | "sampleHeightAt">,
  geometry: TrackMeshData,
  landUseIndex: LandUseSpatialIndex,
  seed: number,
  requestedCount: number,
  bounds: TerrainChunkBounds = terrain.bounds,
  mode: GrassPlacementMode = "area",
): readonly StylizedGrassPlacement[] => {
  const count = Math.max(0, Math.min(40_000, Math.round(requestedCount)));
  if (count === 0) return Object.freeze([]);

  const random = createRandom(seed);
  const routeIndex = createRouteConstraintIndex(geometry.routePoints);
  const sceneUnitsPerMeter = geometry.projection.sceneUnitsPerMeter;
  const routeStart = geometry.routePoints[0].distanceMeters;
  const routeEnd = geometry.routePoints.at(-1)?.distanceMeters ?? routeStart;
  const routeLength = Math.max(0, routeEnd - routeStart);
  const minimumRoadDistance = geometry.roadHalfWidth + 0.5 * sceneUnitsPerMeter;
  const placements: StylizedGrassPlacement[] = [];

  for (let attempt = 0; placements.length < count && attempt < count * 16; attempt += 1) {
    let x: number;
    let z: number;
    if (mode === "route" && routeLength > 0) {
      const position = getRoutePositionAtDistance(geometry, routeStart + random() * routeLength);
      const angle = random() * Math.PI * 2;
      const distance = (3.5 + random() * 32) * sceneUnitsPerMeter;
      x = position.x + Math.cos(angle) * distance;
      z = position.z + Math.sin(angle) * distance;
    } else {
      x = bounds.minX + random() * (bounds.maxX - bounds.minX);
      z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ);
    }

    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
    if (routeIndex(x, z, 0).nearest.distance < minimumRoadDistance) continue;
    if (landUseIndex.getCategoryAt(x, z) === "water") continue;

    placements.push(Object.freeze({
      x,
      y: terrain.sampleHeightAt(x, z),
      z,
      scale: sceneUnitsPerMeter * (0.25 + random() * 0.25),
      rotation: random() * Math.PI * 2,
      colorIndex: Math.floor(random() * 5),
    }));
  }

  return Object.freeze(placements);
};
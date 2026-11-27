import type { TrackMeshPart, TrackMeshData } from "./trackGeometry";
import type { TerrainMeshData } from "./terrainGeometry";
import { createRouteConstraintIndex } from "./routeConstraints";
import {
  createLandUseSpatialIndex,
  emptyOpenStreetMapFeatures,
  type MapColor,
  type LandUseSpatialIndex,
  type OpenStreetMapBuilding,
  type OpenStreetMapFeatures,
} from "./openStreetMap";
import {
  createStylizedGrassPlacements,
  getRouteGrassPlacementTarget,
  getRouteTreePlacementTarget,
  type StylizedGrassPlacement,
  type StylizedTreePlacement,
} from "./vegetationPlacement";

export type TerrainSceneryData = Readonly<{
  foliage: TrackMeshPart;
  trunks: TrackMeshPart;
  grassPlacements: readonly StylizedGrassPlacement[];
  treePlacements: readonly StylizedTreePlacement[];
  buildingWalls: TrackMeshPart;
  buildingRoofs: TrackMeshPart;
}>;

type Point3 = Readonly<{ x: number; y: number; z: number }>;
type MutableMeshPart = { positions: number[]; normals: number[]; indices: number[]; colors?: number[] };
type Placement = Readonly<{ x: number; z: number }>;

const createMutableMeshPart = (withColors = false): MutableMeshPart => ({
  positions: [],
  normals: [],
  indices: [],
  ...(withColors ? { colors: [] } : {}),
});

const subtract = (left: Point3, right: Point3): Point3 => ({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
});

const cross = (left: Point3, right: Point3): Point3 => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x,
});

const normalize = (point: Point3): Point3 => {
  const length = Math.hypot(point.x, point.y, point.z);
  return length === 0 ? { x: 0, y: 1, z: 0 } : { x: point.x / length, y: point.y / length, z: point.z / length };
};

const dot = (left: Point3, right: Point3): number => left.x * right.x + left.y * right.y + left.z * right.z;

const appendTriangle = (
  part: MutableMeshPart,
  vertices: readonly [Point3, Point3, Point3],
  expectedNormal: Point3,
  color?: MapColor,
): void => {
  const firstNormal = cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0]));
  const oriented = dot(firstNormal, expectedNormal) < 0 ? [vertices[0], vertices[2], vertices[1]] as const : vertices;
  const normal = normalize(cross(subtract(oriented[1], oriented[0]), subtract(oriented[2], oriented[0])));
  const firstIndex = part.positions.length / 3;
  oriented.forEach((point) => {
    part.positions.push(point.x, point.y, point.z);
    part.normals.push(normal.x, normal.y, normal.z);
    part.colors?.push(...(color ?? [1, 1, 1]), 1);
  });
  part.indices.push(firstIndex, firstIndex + 1, firstIndex + 2);
};

const appendQuad = (
  part: MutableMeshPart,
  vertices: readonly [Point3, Point3, Point3, Point3],
  expectedNormal: Point3,
  color?: MapColor,
): void => {
  appendTriangle(part, [vertices[0], vertices[1], vertices[2]], expectedNormal, color);
  appendTriangle(part, [vertices[0], vertices[2], vertices[3]], expectedNormal, color);
};

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

const isSpacedFrom = (position: Placement, others: readonly Placement[], minimumDistance: number): boolean =>
  others.every((other) => Math.hypot(position.x - other.x, position.z - other.z) >= minimumDistance);

const createTree = (
  trunks: MutableMeshPart,
  foliage: MutableMeshPart,
  x: number,
  groundY: number,
  z: number,
  scale: number,
  heightMeters: number,
  rotation: number,
): void => {
  const height = heightMeters * scale;
  const trunkBottom = 0.06 * height;
  const trunkTop = 0.48 * height;
  const trunkBottomRadius = 0.055 * height;
  const trunkTopRadius = 0.035 * height;
  const sides = 5;
  const rotate = (localX: number, localZ: number): Readonly<{ x: number; z: number }> => ({
    x: x + localX * Math.cos(rotation) - localZ * Math.sin(rotation),
    z: z + localX * Math.sin(rotation) + localZ * Math.cos(rotation),
  });

  for (let side = 0; side < sides; side += 1) {
    const firstAngle = (side / sides) * Math.PI * 2;
    const secondAngle = ((side + 1) / sides) * Math.PI * 2;
    const bottomA = rotate(Math.cos(firstAngle) * trunkBottomRadius, Math.sin(firstAngle) * trunkBottomRadius);
    const bottomB = rotate(Math.cos(secondAngle) * trunkBottomRadius, Math.sin(secondAngle) * trunkBottomRadius);
    const topA = rotate(Math.cos(firstAngle) * trunkTopRadius, Math.sin(firstAngle) * trunkTopRadius);
    const topB = rotate(Math.cos(secondAngle) * trunkTopRadius, Math.sin(secondAngle) * trunkTopRadius);
    const middleAngle = (firstAngle + secondAngle) / 2 + rotation;
    appendQuad(trunks, [
      { x: bottomA.x, y: groundY + trunkBottom, z: bottomA.z },
      { x: bottomB.x, y: groundY + trunkBottom, z: bottomB.z },
      { x: topB.x, y: groundY + trunkTop, z: topB.z },
      { x: topA.x, y: groundY + trunkTop, z: topA.z },
    ], { x: Math.cos(middleAngle), y: 0, z: Math.sin(middleAngle) });
  }

  const layers = [
    { base: 0.28, tip: 0.76, radius: 0.34 },
    { base: 0.46, tip: 0.91, radius: 0.28 },
    { base: 0.64, tip: 1, radius: 0.21 },
  ];
  layers.forEach((layer) => {
    const apex = { x, y: groundY + layer.tip * height, z };
    const radius = layer.radius * height;
    for (let side = 0; side < sides; side += 1) {
      const firstAngle = (side / sides) * Math.PI * 2;
      const secondAngle = ((side + 1) / sides) * Math.PI * 2;
      const first = rotate(Math.cos(firstAngle) * radius, Math.sin(firstAngle) * radius);
      const second = rotate(Math.cos(secondAngle) * radius, Math.sin(secondAngle) * radius);
      const middleAngle = (firstAngle + secondAngle) / 2 + rotation;
      appendTriangle(foliage, [
        { x: first.x, y: groundY + layer.base * height, z: first.z },
        apex,
        { x: second.x, y: groundY + layer.base * height, z: second.z },
      ], { x: Math.cos(middleAngle), y: 0.25, z: Math.sin(middleAngle) });
    }
  });
};

const createBuilding = (
  walls: MutableMeshPart,
  roofs: MutableMeshPart,
  x: number,
  groundY: number,
  z: number,
  scale: number,
  widthMeters: number,
  depthMeters: number,
  wallHeightMeters: number,
  roofHeightMeters: number,
  rotation: number,
): void => {
  const width = widthMeters * scale;
  const depth = depthMeters * scale;
  const wallHeight = wallHeightMeters * scale;
  const roofHeight = roofHeightMeters * scale;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const point = (localX: number, y: number, localZ: number): Point3 => ({
    x: x + localX * cos - localZ * sin,
    y,
    z: z + localX * sin + localZ * cos,
  });
  const normal = (localX: number, localZ: number): Point3 => ({
    x: localX * cos - localZ * sin,
    y: 0,
    z: localX * sin + localZ * cos,
  });
  const leftFront = point(-width / 2, groundY, -depth / 2);
  const rightFront = point(width / 2, groundY, -depth / 2);
  const leftBack = point(-width / 2, groundY, depth / 2);
  const rightBack = point(width / 2, groundY, depth / 2);
  const leftFrontEave = point(-width / 2, groundY + wallHeight, -depth / 2);
  const rightFrontEave = point(width / 2, groundY + wallHeight, -depth / 2);
  const leftBackEave = point(-width / 2, groundY + wallHeight, depth / 2);
  const rightBackEave = point(width / 2, groundY + wallHeight, depth / 2);
  const frontRidge = point(0, groundY + wallHeight + roofHeight, -depth / 2);
  const backRidge = point(0, groundY + wallHeight + roofHeight, depth / 2);

  appendQuad(walls, [leftFront, leftFrontEave, rightFrontEave, rightFront], normal(0, -1));
  appendQuad(walls, [rightFront, rightFrontEave, rightBackEave, rightBack], normal(1, 0));
  appendQuad(walls, [rightBack, rightBackEave, leftBackEave, leftBack], normal(0, 1));
  appendQuad(walls, [leftBack, leftBackEave, leftFrontEave, leftFront], normal(-1, 0));
  appendTriangle(walls, [leftFrontEave, frontRidge, rightFrontEave], normal(0, -1));
  appendTriangle(walls, [rightBackEave, backRidge, leftBackEave], normal(0, 1));

  appendQuad(roofs, [leftFrontEave, frontRidge, backRidge, leftBackEave], {
    x: -roofHeight * cos,
    y: width / 2,
    z: -roofHeight * sin,
  });
  appendQuad(roofs, [frontRidge, rightFrontEave, rightBackEave, backRidge], {
    x: roofHeight * cos,
    y: width / 2,
    z: roofHeight * sin,
  });
};

const signedArea = (points: readonly Placement[]): number => points.reduce((area, point, index) => {
  const next = points[(index + 1) % points.length];
  return area + point.x * next.z - next.x * point.z;
}, 0) / 2;

const cross2d = (a: Placement, b: Placement, c: Placement): number =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

const isInsideTriangle = (point: Placement, a: Placement, b: Placement, c: Placement): boolean => {
  const first = cross2d(a, b, point);
  const second = cross2d(b, c, point);
  const third = cross2d(c, a, point);
  return first >= -1e-8 && second >= -1e-8 && third >= -1e-8;
};

const triangulatePolygon = (polygon: readonly Placement[]): readonly (readonly [number, number, number])[] => {
  const orientation = signedArea(polygon) >= 0 ? 1 : -1;
  const remaining = polygon.map((_point, index) => index);
  const triangles: (readonly [number, number, number])[] = [];

  while (remaining.length > 3) {
    let clippedEar = false;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previous = remaining[(cursor + remaining.length - 1) % remaining.length];
      const current = remaining[cursor];
      const next = remaining[(cursor + 1) % remaining.length];
      if (cross2d(polygon[previous], polygon[current], polygon[next]) * orientation <= 1e-8) {
        continue;
      }
      const containsVertex = remaining.some((index) =>
        index !== previous && index !== current && index !== next &&
        isInsideTriangle(polygon[index], polygon[previous], polygon[current], polygon[next]));
      if (containsVertex) {
        continue;
      }
      triangles.push(orientation > 0 ? [previous, current, next] : [next, current, previous]);
      remaining.splice(cursor, 1);
      clippedEar = true;
      break;
    }
    if (!clippedEar) {
      return Object.freeze([]);
    }
  }

  if (remaining.length === 3) {
    triangles.push(orientation > 0
      ? [remaining[0], remaining[1], remaining[2]]
      : [remaining[2], remaining[1], remaining[0]]);
  }
  return Object.freeze(triangles);
};

const createMappedBuilding = (
  building: OpenStreetMapBuilding,
  terrain: TerrainMeshData,
  scale: number,
  walls: MutableMeshPart,
  roofs: MutableMeshPart,
): void => {
  const points = building.points.slice(0, -1).filter((point, index, polygon) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    return Math.hypot(point.x - previous.x, point.z - previous.z) > 1e-7;
  });
  if (points.length < 3 || Math.abs(signedArea(points)) < 1e-6) {
    return;
  }

  const height = (building.heightMeters ?? 6) * scale;
  const ground = points.map((point) => terrain.sampleHeightAt(point.x, point.z));
  const baseVertices = points.map((point, index) => ({ x: point.x, y: ground[index], z: point.z }));
  const roofVertices = points.map((point, index) => ({ x: point.x, y: ground[index] + height, z: point.z }));
  const orientation = signedArea(points) >= 0 ? 1 : -1;

  points.forEach((point, index) => {
    const next = (index + 1) % points.length;
    const dx = points[next].x - point.x;
    const dz = points[next].z - point.z;
    appendQuad(walls, [baseVertices[index], baseVertices[next], roofVertices[next], roofVertices[index]], {
      x: dz * orientation,
      y: 0,
      z: -dx * orientation,
    }, building.wallColor);
  });

  triangulatePolygon(points).forEach(([first, second, third]) => {
    appendTriangle(roofs, [roofVertices[first], roofVertices[second], roofVertices[third]], { x: 0, y: 1, z: 0 }, building.roofColor);
  });
};

const freezePart = (part: MutableMeshPart): TrackMeshPart => Object.freeze({
  positions: Object.freeze(part.positions),
  normals: Object.freeze(part.normals),
  indices: Object.freeze(part.indices),
  ...(part.colors === undefined ? {} : { colors: Object.freeze(part.colors) }),
});

export const createTerrainScenery = (
  terrain: TerrainMeshData,
  geometry: TrackMeshData,
  seed = 0x4b1d7e2a,
  features: OpenStreetMapFeatures = emptyOpenStreetMapFeatures,
  landUseIndex: LandUseSpatialIndex = createLandUseSpatialIndex(features.areas, features.buildings),
): TerrainSceneryData => {
  const random = createRandom(seed);
  const scale = geometry.projection.sceneUnitsPerMeter;
  const findRouteConstraints = createRouteConstraintIndex(geometry.routePoints);
  const firstRoutePoint = geometry.routePoints[0];
  const lastRoutePoint = geometry.routePoints[geometry.routePoints.length - 1];
  const areaMeters = ((terrain.bounds.maxX - terrain.bounds.minX) * (terrain.bounds.maxZ - terrain.bounds.minZ)) / (scale * scale);
  const routeStartDistance = firstRoutePoint.distanceMeters;
  const routeEndDistance = lastRoutePoint.distanceMeters;
  const routeLengthMeters = Math.max(0, routeEndDistance - routeStartDistance);
  const targetTreeCount = getRouteTreePlacementTarget(routeLengthMeters);
  const targetBuildingCount = Math.max(1, Math.min(24, Math.round(areaMeters / 22_000)));
  const planted: Placement[] = [];
  const treePlacements: StylizedTreePlacement[] = [];
  const buildings: Placement[] = [];
  const foliage = createMutableMeshPart();
  const trunks = createMutableMeshPart();
  const hasMappedBuildings = features.buildings.length > 0;
  const buildingWalls = createMutableMeshPart(hasMappedBuildings);
  const buildingRoofs = createMutableMeshPart(hasMappedBuildings);
  const getRoutePositionAtDistance = (distanceMeters: number): Placement => {
    let low = 0;
    let high = geometry.routePoints.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (geometry.routePoints[middle].distanceMeters < distanceMeters) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const end = geometry.routePoints[low];
    const start = geometry.routePoints[Math.max(0, low - 1)];
    const distanceSpan = end.distanceMeters - start.distanceMeters;
    const progress = distanceSpan > 0 ? (distanceMeters - start.distanceMeters) / distanceSpan : 0;
    return Object.freeze({
      x: start.x + (end.x - start.x) * progress,
      z: start.z + (end.z - start.z) * progress,
    });
  };
  const createPlacement = (): Placement => {
    if (routeLengthMeters > 0 && random() < 0.85) {
      const routePosition = getRoutePositionAtDistance(routeStartDistance + random() * routeLengthMeters);
      const offsetMeters = 12 + random() * 110;
      const angle = random() * Math.PI * 2;
      return Object.freeze({
        x: Math.max(terrain.bounds.minX, Math.min(terrain.bounds.maxX, routePosition.x + Math.cos(angle) * offsetMeters * scale)),
        z: Math.max(terrain.bounds.minZ, Math.min(terrain.bounds.maxZ, routePosition.z + Math.sin(angle) * offsetMeters * scale)),
      });
    }
    return Object.freeze({
      x: terrain.bounds.minX + random() * (terrain.bounds.maxX - terrain.bounds.minX),
      z: terrain.bounds.minZ + random() * (terrain.bounds.maxZ - terrain.bounds.minZ),
    });
  };

  for (let attempt = 0; planted.length < targetTreeCount && attempt < targetTreeCount * 80; attempt += 1) {
    const placement = createPlacement();
    if (
      findRouteConstraints(placement.x, placement.z, 0).nearest.distance < 9 * scale ||
      !landUseIndex.canPlaceTreeAt(placement.x, placement.z) ||
      !isSpacedFrom(placement, planted, 10 * scale)
    ) {
      continue;
    }

    planted.push(placement);
    const heightMeters = 8 + random() * 10;
    const height = heightMeters * scale;
    const rotation = random() * Math.PI * 2;
    const y = terrain.sampleHeightAt(placement.x, placement.z);
    treePlacements.push(Object.freeze({ x: placement.x, y, z: placement.z, height, rotation }));
    createTree(
      trunks,
      foliage,
      placement.x,
      y,
      placement.z,
      scale,
      heightMeters,
      rotation,
    );
  }

  features.buildings.forEach((building) => createMappedBuilding(building, terrain, scale, buildingWalls, buildingRoofs));

  for (let attempt = 0; !hasMappedBuildings && buildings.length < targetBuildingCount && attempt < targetBuildingCount * 150; attempt += 1) {
    const placement = createPlacement();
    const landUse = landUseIndex.getCategoryAt(placement.x, placement.z);
    if (
      findRouteConstraints(placement.x, placement.z, 0).nearest.distance < 18 * scale ||
      (landUse !== null && landUse !== "residential" && landUse !== "industrial") ||
      !isSpacedFrom(placement, buildings, 38 * scale) ||
      !isSpacedFrom(placement, planted, 9 * scale)
    ) {
      continue;
    }

    buildings.push(placement);
    createBuilding(
      buildingWalls,
      buildingRoofs,
      placement.x,
      terrain.sampleHeightAt(placement.x, placement.z),
      placement.z,
      scale,
      8 + random() * 5,
      7 + random() * 4,
      3.5 + random() * 1.5,
      2 + random() * 1.5,
      random() * Math.PI * 2,
    );
  }

  const grassPlacements = createStylizedGrassPlacements(
    terrain,
    geometry,
    landUseIndex,
    seed ^ 0x71a55,
    getRouteGrassPlacementTarget(routeLengthMeters),
    terrain.bounds,
    "route",
  );

  return Object.freeze({
    foliage: freezePart(foliage),
    trunks: freezePart(trunks),
    grassPlacements,
    treePlacements: Object.freeze(treePlacements),
    buildingWalls: freezePart(buildingWalls),
    buildingRoofs: freezePart(buildingRoofs),
  });
};
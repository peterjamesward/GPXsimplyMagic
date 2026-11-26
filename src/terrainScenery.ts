import type { TrackMeshPart, TrackMeshData } from "./trackGeometry";
import type { TerrainMeshData } from "./terrainGeometry";

export type TerrainSceneryData = Readonly<{
  foliage: TrackMeshPart;
  trunks: TrackMeshPart;
  buildingWalls: TrackMeshPart;
  buildingRoofs: TrackMeshPart;
}>;

type Point3 = Readonly<{ x: number; y: number; z: number }>;
type MutableMeshPart = { positions: number[]; normals: number[]; indices: number[] };
type Placement = Readonly<{ x: number; z: number }>;

const createMutableMeshPart = (): MutableMeshPart => ({ positions: [], normals: [], indices: [] });

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

const appendTriangle = (part: MutableMeshPart, vertices: readonly [Point3, Point3, Point3], expectedNormal: Point3): void => {
  const firstNormal = cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0]));
  const oriented = dot(firstNormal, expectedNormal) < 0 ? [vertices[0], vertices[2], vertices[1]] as const : vertices;
  const normal = normalize(cross(subtract(oriented[1], oriented[0]), subtract(oriented[2], oriented[0])));
  const firstIndex = part.positions.length / 3;
  oriented.forEach((point) => {
    part.positions.push(point.x, point.y, point.z);
    part.normals.push(normal.x, normal.y, normal.z);
  });
  part.indices.push(firstIndex, firstIndex + 1, firstIndex + 2);
};

const appendQuad = (part: MutableMeshPart, vertices: readonly [Point3, Point3, Point3, Point3], expectedNormal: Point3): void => {
  appendTriangle(part, [vertices[0], vertices[1], vertices[2]], expectedNormal);
  appendTriangle(part, [vertices[0], vertices[2], vertices[3]], expectedNormal);
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

const getDistanceFromRoute = (x: number, z: number, geometry: TrackMeshData): number => {
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < geometry.routePoints.length - 1; index += 1) {
    const start = geometry.routePoints[index];
    const end = geometry.routePoints[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    const ratio = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSquared));
    nearestDistance = Math.min(nearestDistance, Math.hypot(x - start.x - dx * ratio, z - start.z - dz * ratio));
  }
  return nearestDistance;
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

const freezePart = (part: MutableMeshPart): TrackMeshPart => Object.freeze({
  positions: Object.freeze(part.positions),
  normals: Object.freeze(part.normals),
  indices: Object.freeze(part.indices),
});

export const createTerrainScenery = (
  terrain: TerrainMeshData,
  geometry: TrackMeshData,
  seed = 0x4b1d7e2a,
): TerrainSceneryData => {
  const random = createRandom(seed);
  const scale = geometry.projection.sceneUnitsPerMeter;
  const areaMeters = ((terrain.bounds.maxX - terrain.bounds.minX) * (terrain.bounds.maxZ - terrain.bounds.minZ)) / (scale * scale);
  const targetTreeCount = Math.max(24, Math.min(240, Math.round(areaMeters / 1_100)));
  const targetBuildingCount = Math.max(1, Math.min(24, Math.round(areaMeters / 22_000)));
  const planted: Placement[] = [];
  const buildings: Placement[] = [];
  const foliage = createMutableMeshPart();
  const trunks = createMutableMeshPart();
  const buildingWalls = createMutableMeshPart();
  const buildingRoofs = createMutableMeshPart();
  const createPlacement = (): Placement => Object.freeze({
    x: terrain.bounds.minX + random() * (terrain.bounds.maxX - terrain.bounds.minX),
    z: terrain.bounds.minZ + random() * (terrain.bounds.maxZ - terrain.bounds.minZ),
  });

  for (let attempt = 0; planted.length < targetTreeCount && attempt < targetTreeCount * 80; attempt += 1) {
    const placement = createPlacement();
    if (
      getDistanceFromRoute(placement.x, placement.z, geometry) < 9 * scale ||
      !isSpacedFrom(placement, planted, 10 * scale)
    ) {
      continue;
    }

    planted.push(placement);
    createTree(
      trunks,
      foliage,
      placement.x,
      terrain.sampleHeightAt(placement.x, placement.z),
      placement.z,
      scale,
      8 + random() * 10,
      random() * Math.PI * 2,
    );
  }

  for (let attempt = 0; buildings.length < targetBuildingCount && attempt < targetBuildingCount * 150; attempt += 1) {
    const placement = createPlacement();
    if (
      getDistanceFromRoute(placement.x, placement.z, geometry) < 18 * scale ||
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

  return Object.freeze({
    foliage: freezePart(foliage),
    trunks: freezePart(trunks),
    buildingWalls: freezePart(buildingWalls),
    buildingRoofs: freezePart(buildingRoofs),
  });
};
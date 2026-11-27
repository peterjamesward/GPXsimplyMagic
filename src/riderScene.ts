import type { TrackMeshPart, TrackRoutePoint } from "./trackGeometry";

export type RideCameraPose = Readonly<{
  position: Readonly<{ x: number; y: number; z: number }>;
  target: Readonly<{ x: number; y: number; z: number }>;
}>;

export type RideTerrainChunk = Readonly<{
  key: string;
  bounds: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  distanceMeters: number;
  gridSize: number;
}>;

export const rideTerrainChunkSizeMeters = 160;
export const rideTerrainMaximumDistanceMeters = 560;

export type RideViewportSize = Readonly<{ width: number; height: number }>;

export const getRideViewportSize = (
  activeView: "route" | "map" | "ride",
  routeViewport: RideViewportSize,
  rideViewport: RideViewportSize,
): RideViewportSize | null => {
  const viewport = activeView === "ride" ? rideViewport : routeViewport;
  if (![viewport.width, viewport.height].every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }
  return Object.freeze({ width: viewport.width, height: viewport.height });
};

type MutableMeshPart = { positions: number[]; normals: number[]; indices: number[]; colors: number[] };

const interpolateRoutePoint = (
  points: readonly TrackRoutePoint[],
  requestedDistance: number,
): Readonly<{ x: number; y: number; z: number }> => {
  const first = points[0];
  const last = points[points.length - 1];
  const distance = Math.max(first.distanceMeters, Math.min(last.distanceMeters, requestedDistance));
  let low = 0;
  let high = points.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].distanceMeters < distance) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const end = points[low];
  const start = points[Math.max(0, low - 1)];
  const distanceSpan = end.distanceMeters - start.distanceMeters;
  const progress = distanceSpan > 0 ? (distance - start.distanceMeters) / distanceSpan : 0;
  return Object.freeze({
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
    z: start.z + (end.z - start.z) * progress,
  });
};

export const getRideCameraPose = (
  points: readonly TrackRoutePoint[],
  distanceMeters: number,
  sceneUnitsPerMeter: number,
  eyeHeightMeters = 1.65,
  lookAheadMeters = 12,
): RideCameraPose => {
  if (points.length < 2) {
    throw new Error("At least two route points are required for a first-person ride.");
  }
  if (![distanceMeters, sceneUnitsPerMeter, eyeHeightMeters, lookAheadMeters].every(Number.isFinite) || sceneUnitsPerMeter <= 0) {
    throw new Error("Ride camera inputs must be finite and use a positive scene scale.");
  }

  const firstDistance = points[0].distanceMeters;
  const lastDistance = points[points.length - 1].distanceMeters;
  const distance = Math.max(firstDistance, Math.min(lastDistance, distanceMeters));
  const aheadDistance = Math.min(lastDistance, distance + Math.max(0.1, lookAheadMeters));
  const behindDistance = Math.max(firstDistance, distance - Math.max(0.1, lookAheadMeters));
  const lookDistance = aheadDistance > distance ? aheadDistance : behindDistance;
  const roadPosition = interpolateRoutePoint(points, distance);
  const lookPosition = interpolateRoutePoint(points, lookDistance);
  const eyeHeight = eyeHeightMeters * sceneUnitsPerMeter * 2;
  const horizontalLookDistance = Math.hypot(lookPosition.x - roadPosition.x, lookPosition.z - roadPosition.z);
  const targetPosition = horizontalLookDistance > 1e-8
    ? lookPosition
    : { x: roadPosition.x, y: roadPosition.y, z: roadPosition.z + Math.max(1, lookAheadMeters) * sceneUnitsPerMeter };

  return Object.freeze({
    position: Object.freeze({ x: roadPosition.x, y: roadPosition.y + eyeHeight, z: roadPosition.z }),
    target: Object.freeze({
      x: targetPosition.x,
      y: targetPosition.y + eyeHeight * 0.58,
      z: targetPosition.z,
    }),
  });
};

export const getRideTerrainChunkPlan = (
  position: Readonly<{ x: number; z: number }>,
  direction: Readonly<{ x: number; z: number }>,
  sceneUnitsPerMeter: number,
  chunkSizeMeters = rideTerrainChunkSizeMeters,
  maximumDistanceMeters = rideTerrainMaximumDistanceMeters,
): readonly RideTerrainChunk[] => {
  if (
    ![position.x, position.z, direction.x, direction.z, sceneUnitsPerMeter, chunkSizeMeters, maximumDistanceMeters].every(Number.isFinite) ||
    sceneUnitsPerMeter <= 0 || chunkSizeMeters <= 0 || maximumDistanceMeters <= 0
  ) {
    throw new Error("Ride terrain chunk planning requires finite positions and positive world scales.");
  }

  const directionLength = Math.hypot(direction.x, direction.z);
  const forwardX = directionLength > 1e-8 ? direction.x / directionLength : 0;
  const forwardZ = directionLength > 1e-8 ? direction.z / directionLength : 1;
  const chunkSize = chunkSizeMeters * sceneUnitsPerMeter;
  const centerX = Math.floor(position.x / chunkSize);
  const centerZ = Math.floor(position.z / chunkSize);
  const searchRadius = Math.ceil(maximumDistanceMeters / chunkSizeMeters) + 1;
  const chunks: RideTerrainChunk[] = [];

  for (let zIndex = centerZ - searchRadius; zIndex <= centerZ + searchRadius; zIndex += 1) {
    for (let xIndex = centerX - searchRadius; xIndex <= centerX + searchRadius; xIndex += 1) {
      const minX = xIndex * chunkSize;
      const maxX = minX + chunkSize;
      const minZ = zIndex * chunkSize;
      const maxZ = minZ + chunkSize;
      const deltaX = (minX + maxX) / 2 - position.x;
      const deltaZ = (minZ + maxZ) / 2 - position.z;
      const distanceMeters = Math.hypot(deltaX, deltaZ) / sceneUnitsPerMeter;
      const forwardMeters = (deltaX * forwardX + deltaZ * forwardZ) / sceneUnitsPerMeter;
      const lateralMeters = Math.abs(deltaX * forwardZ - deltaZ * forwardX) / sceneUnitsPerMeter;
      const halfWidthMeters = Math.max(100, Math.max(0, forwardMeters) * 0.72);

      if (
        distanceMeters > maximumDistanceMeters ||
        forwardMeters < -120 ||
        (forwardMeters > 120 && lateralMeters > halfWidthMeters)
      ) {
        continue;
      }

      chunks.push(Object.freeze({
        key: `${xIndex}:${zIndex}`,
        bounds: Object.freeze({ minX, maxX, minZ, maxZ }),
        distanceMeters,
        gridSize: distanceMeters < 150 ? 33 : distanceMeters < 340 ? 17 : 9,
      }));
    }
  }

  return Object.freeze(chunks.sort((left, right) => left.distanceMeters - right.distanceMeters).slice(0, 48));
};

const createMutableMeshPart = (): MutableMeshPart => ({ positions: [], normals: [], indices: [], colors: [] });

const appendRoadRibbon = (
  part: MutableMeshPart,
  start: Readonly<{ x: number; y: number; z: number }>,
  end: Readonly<{ x: number; y: number; z: number }>,
  offset: number,
  width: number,
  sceneUnitsPerMeter: number,
  color: readonly [number, number, number],
): void => {
  const directionX = end.x - start.x;
  const directionZ = end.z - start.z;
  const length = Math.hypot(directionX, directionZ);
  if (length <= 1e-8) {
    return;
  }

  const sideX = -directionZ / length;
  const sideZ = directionX / length;
  const lift = 0.02 * sceneUnitsPerMeter;
  const halfWidth = width / 2;
  const vertices = [
    { x: start.x + sideX * (offset - halfWidth), y: start.y + lift, z: start.z + sideZ * (offset - halfWidth) },
    { x: start.x + sideX * (offset + halfWidth), y: start.y + lift, z: start.z + sideZ * (offset + halfWidth) },
    { x: end.x + sideX * (offset + halfWidth), y: end.y + lift, z: end.z + sideZ * (offset + halfWidth) },
    { x: end.x + sideX * (offset - halfWidth), y: end.y + lift, z: end.z + sideZ * (offset - halfWidth) },
  ];
  const firstIndex = part.positions.length / 3;
  vertices.forEach((point) => {
    part.positions.push(point.x, point.y, point.z);
    part.normals.push(0, 1, 0);
    part.colors.push(...color, 1);
  });
  part.indices.push(firstIndex, firstIndex + 1, firstIndex + 2, firstIndex, firstIndex + 2, firstIndex + 3);
};

export const createRideRoadMarkings = (
  points: readonly TrackRoutePoint[],
  roadHalfWidth: number,
  sceneUnitsPerMeter: number,
): TrackMeshPart => {
  if (points.length < 2 || !Number.isFinite(roadHalfWidth) || !Number.isFinite(sceneUnitsPerMeter) || sceneUnitsPerMeter <= 0) {
    return Object.freeze({ positions: Object.freeze([]), normals: Object.freeze([]), indices: Object.freeze([]), colors: Object.freeze([]) });
  }

  const part = createMutableMeshPart();
  const edgeLineWidth = 0.12 * sceneUnitsPerMeter;
  const edgeOffset = Math.max(0, roadHalfWidth - edgeLineWidth);
  const centerLineWidth = 0.09 * sceneUnitsPerMeter;
  const edgeColor = [0.9, 0.91, 0.84] as const;
  const centerColor = [1, 0.78, 0.3] as const;

  points.slice(0, -1).forEach((start, index) => {
    const end = points[index + 1];
    appendRoadRibbon(part, start, end, -edgeOffset, edgeLineWidth, sceneUnitsPerMeter, edgeColor);
    appendRoadRibbon(part, start, end, edgeOffset, edgeLineWidth, sceneUnitsPerMeter, edgeColor);
  });

  const firstDistance = points[0].distanceMeters;
  const lastDistance = points[points.length - 1].distanceMeters;
  const dashSpacing = 18;
  const dashLength = 7;
  for (let distance = firstDistance; distance < lastDistance; distance += dashSpacing) {
    const dashEnd = Math.min(lastDistance, distance + dashLength);
    appendRoadRibbon(
      part,
      interpolateRoutePoint(points, distance),
      interpolateRoutePoint(points, dashEnd),
      0,
      centerLineWidth,
      sceneUnitsPerMeter,
      centerColor,
    );
  }

  return Object.freeze({
    positions: Object.freeze(part.positions),
    normals: Object.freeze(part.normals),
    indices: Object.freeze(part.indices),
    colors: Object.freeze(part.colors),
  });
};
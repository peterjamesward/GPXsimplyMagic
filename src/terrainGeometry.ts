import type { TrackMeshPart, TrackBounds, TrackMeshData } from "./trackGeometry";
import { createRouteConstraintIndex } from "./routeConstraints";

export type TerrainElevationSampler = (latitude: number, longitude: number) => number | null;

export type TerrainMeshData = TrackMeshPart & Readonly<{
  bounds: TrackBounds;
  columns: number;
  rows: number;
  sampleHeightAt: (x: number, z: number) => number;
}>;

type Point3 = Readonly<{ x: number; y: number; z: number }>;
type MutableMeshPart = { positions: number[]; normals: number[]; indices: number[] };
type TerrainAreaBounds = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;

const createMutableMeshPart = (): MutableMeshPart => ({ positions: [], normals: [], indices: [] });

const normalize = (point: Point3): Point3 => {
  const length = Math.hypot(point.x, point.y, point.z);
  return length === 0 ? { x: 0, y: 1, z: 0 } : { x: point.x / length, y: point.y / length, z: point.z / length };
};

const toGeographicPoint = (x: number, z: number, geometry: TrackMeshData): Readonly<{ latitude: number; longitude: number }> => {
  const { projection } = geometry;
  const scale = projection.sceneUnitsPerMeter;
  const longitudeScale = Math.max(Math.abs(projection.longitudeScale), 0.00001);
  return {
    latitude: projection.centerLatitude + (z / scale / 111_320),
    longitude: projection.centerLongitude + (x / scale / (longitudeScale * 111_320)),
  };
};

export const createTerrainHeightSampler = (
  geometry: TrackMeshData,
  elevationAt: TerrainElevationSampler,
  terrainCellDiagonalMeters = 0,
): ((x: number, z: number) => number) => {
  const route = geometry.routePoints;
  const findRouteConstraints = createRouteConstraintIndex(route);
  const minimumElevation = route.reduce((minimum, point) => Math.min(minimum, point.altitudeMeters), Number.POSITIVE_INFINITY);
  const sceneUnitsPerMeter = geometry.projection.sceneUnitsPerMeter;
  const sceneYForElevation = (elevation: number): number => 0.12 + (elevation - minimumElevation) * sceneUnitsPerMeter * 2;

  return (x: number, z: number): number => {
    const roadClearanceRadius = geometry.roadHalfWidth / sceneUnitsPerMeter + terrainCellDiagonalMeters;
    const { nearest: constraint, lowestNearbyRouteHeight } = findRouteConstraints(
      x,
      z,
      roadClearanceRadius * sceneUnitsPerMeter,
    );
    const terrainLocation = toGeographicPoint(x, z, geometry);
    const routeLocation = toGeographicPoint(constraint.x, constraint.z, geometry);
    const terrainElevation = elevationAt(terrainLocation.latitude, terrainLocation.longitude) ?? constraint.elevation;
    const routeDemElevation = elevationAt(routeLocation.latitude, routeLocation.longitude) ?? constraint.elevation;
    const uncorrectedY = sceneYForElevation(terrainElevation);
    const routeCorrection = constraint.y - sceneYForElevation(routeDemElevation);
    const distanceMeters = constraint.distance / sceneUnitsPerMeter;
    const terrainAnchorDistanceMeters = Math.max(0, distanceMeters - geometry.roadHalfWidth / sceneUnitsPerMeter);
    const influence = Math.exp(-((terrainAnchorDistanceMeters / 90) ** 2));
    const terrainHeight = uncorrectedY + routeCorrection * influence;
    const roadBottomY = (lowestNearbyRouteHeight ?? constraint.y) - 2.1 * sceneUnitsPerMeter;

    if (lowestNearbyRouteHeight !== null) {
      return Math.min(terrainHeight, roadBottomY);
    }

    const transitionDistance = terrainCellDiagonalMeters * 2;
    if (transitionDistance > 0 && distanceMeters < roadClearanceRadius + transitionDistance) {
      const progress = (distanceMeters - roadClearanceRadius) / transitionDistance;
      const smoothProgress = progress * progress * (3 - 2 * progress);
      const transitionHeight = roadBottomY + (terrainHeight - roadBottomY) * smoothProgress;
      return Math.min(terrainHeight, transitionHeight);
    }

    return terrainHeight;
  };
};

export const getTerrainAreaBounds = (geometry: TrackMeshData): TerrainAreaBounds => {
  const route = geometry.routePoints;
  const routeMinX = route.reduce((minimum, point) => Math.min(minimum, point.x), Number.POSITIVE_INFINITY);
  const routeMaxX = route.reduce((maximum, point) => Math.max(maximum, point.x), Number.NEGATIVE_INFINITY);
  const routeMinZ = route.reduce((minimum, point) => Math.min(minimum, point.z), Number.POSITIVE_INFINITY);
  const routeMaxZ = route.reduce((maximum, point) => Math.max(maximum, point.z), Number.NEGATIVE_INFINITY);
  const routeSpanMeters = Math.max(routeMaxX - routeMinX, routeMaxZ - routeMinZ) / geometry.projection.sceneUnitsPerMeter;
  const margin = Math.max(50, Math.min(500, routeSpanMeters * 0.2)) * geometry.projection.sceneUnitsPerMeter;

  return Object.freeze({
    minX: routeMinX - margin,
    maxX: routeMaxX + margin,
    minZ: routeMinZ - margin,
    maxZ: routeMaxZ + margin,
  });
};

export const createTerrainMeshData = (
  geometry: TrackMeshData,
  elevationAt: TerrainElevationSampler,
  requestedGridSize = 65,
): TerrainMeshData => {
  const gridSize = Math.max(9, Math.min(129, Math.round(requestedGridSize)));
  const area = getTerrainAreaBounds(geometry);
  const width = area.maxX - area.minX;
  const depth = area.maxZ - area.minZ;
  const longestSide = Math.max(width, depth);
  const columns = Math.max(9, Math.round((gridSize - 1) * width / longestSide) + 1);
  const rows = Math.max(9, Math.round((gridSize - 1) * depth / longestSide) + 1);
  const stepX = width / (columns - 1);
  const stepZ = depth / (rows - 1);
  const terrainCellDiagonalMeters = Math.hypot(stepX, stepZ) / geometry.projection.sceneUnitsPerMeter;
  const sampleHeight = createTerrainHeightSampler(geometry, elevationAt, terrainCellDiagonalMeters);
  const heights = Array.from({ length: columns * rows }, (_value, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = area.minX + (width * column) / (columns - 1);
    const z = area.minZ + (depth * row) / (rows - 1);
    return sampleHeight(x, z);
  });
  const mesh = createMutableMeshPart();
  const getHeight = (column: number, row: number): number => heights[row * columns + column];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = Math.max(0, column - 1);
      const right = Math.min(columns - 1, column + 1);
      const top = Math.max(0, row - 1);
      const bottom = Math.min(rows - 1, row + 1);
      const deltaX = (getHeight(right, row) - getHeight(left, row)) / ((right - left) * stepX);
      const deltaZ = (getHeight(column, bottom) - getHeight(column, top)) / ((bottom - top) * stepZ);
      const normal = normalize({ x: -deltaX, y: 1, z: -deltaZ });
      const x = area.minX + stepX * column;
      const z = area.minZ + stepZ * row;
      mesh.positions.push(x, getHeight(column, row), z);
      mesh.normals.push(normal.x, normal.y, normal.z);
    }
  }

  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const topLeft = row * columns + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns;
      const bottomRight = bottomLeft + 1;
      mesh.indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
    }
  }

  const bounds = mesh.positions.reduce(
    (result, _value, index) => {
      if (index % 3 === 0) {
        result.minX = Math.min(result.minX, mesh.positions[index]);
        result.maxX = Math.max(result.maxX, mesh.positions[index]);
      } else if (index % 3 === 1) {
        result.minY = Math.min(result.minY, mesh.positions[index]);
        result.maxY = Math.max(result.maxY, mesh.positions[index]);
      } else {
        result.minZ = Math.min(result.minZ, mesh.positions[index]);
        result.maxZ = Math.max(result.maxZ, mesh.positions[index]);
      }
      return result;
    },
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  );

  const sampleHeightAt = (x: number, z: number): number => {
    const column = Math.max(0, Math.min(columns - 1, ((x - area.minX) / width) * (columns - 1)));
    const row = Math.max(0, Math.min(rows - 1, ((z - area.minZ) / depth) * (rows - 1)));
    const left = Math.floor(column);
    const top = Math.floor(row);
    const right = Math.min(columns - 1, left + 1);
    const bottom = Math.min(rows - 1, top + 1);
    const columnRatio = column - left;
    const rowRatio = row - top;
    const north = getHeight(left, top) * (1 - columnRatio) + getHeight(right, top) * columnRatio;
    const south = getHeight(left, bottom) * (1 - columnRatio) + getHeight(right, bottom) * columnRatio;
    return north * (1 - rowRatio) + south * rowRatio;
  };

  return Object.freeze({
    positions: Object.freeze(mesh.positions),
    normals: Object.freeze(mesh.normals),
    indices: Object.freeze(mesh.indices),
    bounds: Object.freeze(bounds),
    columns,
    rows,
    sampleHeightAt,
  });
};
import { getTrackSegmentDistanceMeters, type TrackPoint } from "./gpx";

export type TrackMeshPart = Readonly<{
  positions: readonly number[];
  normals: readonly number[];
  indices: readonly number[];
  uvs?: readonly number[];
  colors?: readonly number[];
}>;

export type TrackBounds = Readonly<{
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}>;

export type TrackProjection = Readonly<{
  centerLatitude: number;
  centerLongitude: number;
  longitudeScale: number;
  sceneUnitsPerMeter: number;
}>;

export type TrackRoutePoint = Point3 & Readonly<{
  pointNumber: number;
  distanceMeters: number;
  gradientPercent: number | null;
  altitudeMeters: number;
}>;

export type TrackMeshData = TrackMeshPart & Readonly<{
  bounds: TrackBounds;
  projection: TrackProjection;
  roadHalfWidth: number;
  routePoints: readonly TrackRoutePoint[];
  topSurface: TrackMeshPart;
}>;

type Point3 = Readonly<{ x: number; y: number; z: number }>;
type MutableTrackMeshPart = { positions: number[]; normals: number[]; indices: number[]; uvs: number[] };

const createMutableMeshPart = (): MutableTrackMeshPart => ({ positions: [], normals: [], indices: [], uvs: [] });

export const getContinuousLongitudes = (points: readonly TrackPoint[]): readonly number[] => {
  const longitudes = new Array<number>(points.length);
  if (points.length > 0) {
    longitudes[0] = points[0].longitude;
  }

  for (let index = 1; index < points.length; index += 1) {
    const longitudeDelta = ((points[index].longitude - points[index - 1].longitude + 540) % 360) - 180;
    longitudes[index] = longitudes[index - 1] + longitudeDelta;
  }

  return Object.freeze(longitudes);
};

const freezeMeshPart = (part: MutableTrackMeshPart): TrackMeshPart => Object.freeze({
  positions: Object.freeze(part.positions),
  normals: Object.freeze(part.normals),
  indices: Object.freeze(part.indices),
  ...(part.uvs.length === 0 ? {} : { uvs: Object.freeze(part.uvs) }),
});

const normalize = (point: Point3): Point3 => {
  const length = Math.hypot(point.x, point.y, point.z);
  return length === 0 ? { x: 0, y: 0, z: 1 } : { x: point.x / length, y: point.y / length, z: point.z / length };
};

const cross = (left: Point3, right: Point3): Point3 => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x,
});

const subtract = (left: Point3, right: Point3): Point3 => ({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
});

const dot = (left: Point3, right: Point3): number => left.x * right.x + left.y * right.y + left.z * right.z;

export const createTrackMeshData = (points: readonly TrackPoint[]): TrackMeshData => {
  if (points.length < 2) {
    throw new Error("At least two track points are required to create route geometry.");
  }

  const meanLatitude = points.reduce((total, point) => total + point.latitude, 0) / points.length;
  const unwrappedLongitudes = getContinuousLongitudes(points);
  const meanLongitude = unwrappedLongitudes.reduce((total, longitude) => total + longitude, 0) / points.length;
  const longitudeScale = Math.cos((meanLatitude * Math.PI) / 180);
  const projected = points.map((point, index): Point3 => ({
    x: (unwrappedLongitudes[index] - meanLongitude) * longitudeScale * 111_320,
    y: point.elevationMeters,
    z: (point.latitude - meanLatitude) * 111_320,
  }));
  const bounds = projected.reduce(
    (result, point) => ({
      minX: Math.min(result.minX, point.x),
      maxX: Math.max(result.maxX, point.x),
      minZ: Math.min(result.minZ, point.z),
      maxZ: Math.max(result.maxZ, point.z),
      minElevation: Math.min(result.minElevation, point.y),
      maxElevation: Math.max(result.maxElevation, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
      minElevation: Number.POSITIVE_INFINITY,
      maxElevation: Number.NEGATIVE_INFINITY,
    },
  );
  const { minX, maxX, minZ, maxZ, minElevation, maxElevation } = bounds;
  const horizontalSpan = Math.max(maxX - minX, maxZ - minZ);
  const elevationSpan = maxElevation - minElevation;
  const scale = 12 / Math.max(horizontalSpan, elevationSpan * 2, 1);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const projection = Object.freeze({
    centerLatitude: meanLatitude + centerZ / 111_320,
    centerLongitude: meanLongitude + centerX / (longitudeScale * 111_320),
    longitudeScale,
    sceneUnitsPerMeter: scale,
  });
  const route = projected.map((point): Point3 => ({
    x: (point.x - centerX) * scale,
    y: 0.12 + (point.y - minElevation) * scale * 2,
    z: (point.z - centerZ) * scale,
  }));
  const routePoints = route.reduce<TrackRoutePoint[]>((result, position, index) => {
    const previous = points[index - 1];
    const point = points[index];
    const next = points[index + 1];
    const segmentDistanceMeters = previous === undefined ? 0 : getTrackSegmentDistanceMeters(previous, point);
    const nextSegmentDistanceMeters = next === undefined ? 0 : getTrackSegmentDistanceMeters(point, next);

    return [...result, Object.freeze({
      ...position,
      pointNumber: index + 1,
      distanceMeters: (result[index - 1]?.distanceMeters ?? 0) + segmentDistanceMeters,
      gradientPercent:
        next === undefined || nextSegmentDistanceMeters === 0
          ? null
          : ((next.elevationMeters - point.elevationMeters) / nextSegmentDistanceMeters) * 100,
      altitudeMeters: point.elevationMeters,
    })];
  }, []);

  const halfWidth = 3 * scale;
  const topSurface = createMutableMeshPart();

  const appendQuad = (
    part: MutableTrackMeshPart,
    vertices: readonly [Point3, Point3, Point3, Point3],
    expectedNormal: Point3,
    textureCoordinates: readonly (readonly [number, number])[],
  ): void => {
    const initialNormal = normalize(cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0])));
    const vertexOrder = dot(initialNormal, expectedNormal) < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const orientedVertices = vertexOrder.map((vertexIndex) => vertices[vertexIndex]);
    const normal = normalize(cross(subtract(orientedVertices[1], orientedVertices[0]), subtract(orientedVertices[2], orientedVertices[0])));
    const firstIndex = part.positions.length / 3;

    orientedVertices.forEach((vertex, index) => {
      part.positions.push(vertex.x, vertex.y, vertex.z);
      part.normals.push(normal.x, normal.y, normal.z);
      part.uvs.push(...textureCoordinates[vertexOrder[index]]);
    });
    part.indices.push(firstIndex, firstIndex + 1, firstIndex + 2, firstIndex, firstIndex + 2, firstIndex + 3);
  };

  for (let index = 0; index < route.length - 1; index += 1) {
    const startPoint = route[index];
    const endPoint = route[index + 1];
    const direction = subtract(endPoint, startPoint);
    const horizontalLength = Math.hypot(direction.x, direction.z);
    const side = horizontalLength === 0
      ? { x: 1, y: 0, z: 0 }
      : { x: -direction.z / horizontalLength, y: 0, z: direction.x / horizontalLength };
    const createSection = (point: Point3): Readonly<{ left: Point3; right: Point3 }> => ({
      left: {
        x: point.x + side.x * halfWidth,
        y: point.y,
        z: point.z + side.z * halfWidth,
      },
      right: {
        x: point.x - side.x * halfWidth,
        y: point.y,
        z: point.z - side.z * halfWidth,
      },
    });

    const start = createSection(startPoint);
    const end = createSection(endPoint);
    const startDistance = routePoints[index].distanceMeters / 2;
    const endDistance = routePoints[index + 1].distanceMeters / 2;
    appendQuad(
      topSurface,
      [start.left, end.left, end.right, start.right],
      { x: 0, y: 1, z: 0 },
      [[startDistance, 0], [endDistance, 0], [endDistance, 3], [startDistance, 3]],
    );
  }

  const meshBounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
  for (let index = 0; index < topSurface.positions.length; index += 3) {
    meshBounds.minX = Math.min(meshBounds.minX, topSurface.positions[index]);
    meshBounds.maxX = Math.max(meshBounds.maxX, topSurface.positions[index]);
    meshBounds.minY = Math.min(meshBounds.minY, topSurface.positions[index + 1]);
    meshBounds.maxY = Math.max(meshBounds.maxY, topSurface.positions[index + 1]);
    meshBounds.minZ = Math.min(meshBounds.minZ, topSurface.positions[index + 2]);
    meshBounds.maxZ = Math.max(meshBounds.maxZ, topSurface.positions[index + 2]);
  }

  const frozenTopSurface = freezeMeshPart(topSurface);

  return Object.freeze({
    ...frozenTopSurface,
    bounds: Object.freeze(meshBounds),
    projection,
    roadHalfWidth: halfWidth,
    routePoints: Object.freeze(routePoints),
    topSurface: frozenTopSurface,
  });
};
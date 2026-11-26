import { getTrackSegmentDistanceMeters, type TrackPoint } from "./gpx";

export type TrackMeshPart = Readonly<{
  positions: readonly number[];
  normals: readonly number[];
  indices: readonly number[];
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
  leftSide: TrackMeshPart;
  rightSide: TrackMeshPart;
}>;

type Point3 = Readonly<{ x: number; y: number; z: number }>;
type MutableTrackMeshPart = { positions: number[]; normals: number[]; indices: number[] };

const createMutableMeshPart = (): MutableTrackMeshPart => ({ positions: [], normals: [], indices: [] });

export const getContinuousLongitudes = (points: readonly TrackPoint[]): readonly number[] => Object.freeze(
  points.reduce((longitudes, point, index) => {
    if (index === 0) {
      return [...longitudes, point.longitude];
    }

    const previousPoint = points[index - 1];
    const longitudeDelta = ((point.longitude - previousPoint.longitude + 540) % 360) - 180;
    return [...longitudes, longitudes[index - 1] + longitudeDelta];
  }, [] as number[]),
);

const freezeMeshPart = (part: MutableTrackMeshPart): TrackMeshPart => Object.freeze({
  positions: Object.freeze(part.positions),
  normals: Object.freeze(part.normals),
  indices: Object.freeze(part.indices),
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

type RoadSection = Readonly<{
  leftTop: Point3;
  rightTop: Point3;
  leftBottom: Point3;
  rightBottom: Point3;
}>;

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

  const halfWidth = 2 * scale;
  const depth = 2 * scale;
  const asphalt = createMutableMeshPart();
  const topSurface = createMutableMeshPart();
  const leftSide = createMutableMeshPart();
  const rightSide = createMutableMeshPart();

  const appendQuad = (
    part: MutableTrackMeshPart,
    vertices: readonly [Point3, Point3, Point3, Point3],
    expectedNormal: Point3,
  ): void => {
    const initialNormal = normalize(cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0])));
    const orientedVertices = dot(initialNormal, expectedNormal) < 0
      ? [vertices[0], vertices[3], vertices[2], vertices[1]] as const
      : vertices;
    const normal = normalize(cross(subtract(orientedVertices[1], orientedVertices[0]), subtract(orientedVertices[2], orientedVertices[0])));
    const firstIndex = part.positions.length / 3;

    orientedVertices.forEach((vertex) => {
      part.positions.push(vertex.x, vertex.y, vertex.z);
      part.normals.push(normal.x, normal.y, normal.z);
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
    const createSection = (point: Point3): RoadSection => {
      const leftTop = {
        x: point.x + side.x * halfWidth,
        y: point.y,
        z: point.z + side.z * halfWidth,
      };
      const rightTop = {
        x: point.x - side.x * halfWidth,
        y: point.y,
        z: point.z - side.z * halfWidth,
      };

      return {
        leftTop,
        rightTop,
        leftBottom: { ...leftTop, y: leftTop.y - depth },
        rightBottom: { ...rightTop, y: rightTop.y - depth },
      };
    };

    const start = createSection(startPoint);
    const end = createSection(endPoint);

    appendQuad(topSurface, [start.leftTop, end.leftTop, end.rightTop, start.rightTop], { x: 0, y: 1, z: 0 });
    appendQuad(asphalt, [start.leftBottom, start.rightBottom, end.rightBottom, end.leftBottom], { x: 0, y: -1, z: 0 });
    appendQuad(leftSide, [start.leftTop, end.leftTop, end.leftBottom, start.leftBottom], side);
    appendQuad(rightSide, [start.rightTop, start.rightBottom, end.rightBottom, end.rightTop], { x: -side.x, y: -side.y, z: -side.z });
    appendQuad(asphalt, [start.leftTop, start.rightTop, start.rightBottom, start.leftBottom], { x: -direction.x, y: -direction.y, z: -direction.z });
    appendQuad(asphalt, [end.leftTop, end.leftBottom, end.rightBottom, end.rightTop], direction);
  }

  const meshBounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
  [asphalt, topSurface, leftSide, rightSide].forEach((part) => {
    for (let index = 0; index < part.positions.length; index += 3) {
      meshBounds.minX = Math.min(meshBounds.minX, part.positions[index]);
      meshBounds.maxX = Math.max(meshBounds.maxX, part.positions[index]);
      meshBounds.minY = Math.min(meshBounds.minY, part.positions[index + 1]);
      meshBounds.maxY = Math.max(meshBounds.maxY, part.positions[index + 1]);
      meshBounds.minZ = Math.min(meshBounds.minZ, part.positions[index + 2]);
      meshBounds.maxZ = Math.max(meshBounds.maxZ, part.positions[index + 2]);
    }
  });

  return Object.freeze({
    ...freezeMeshPart(asphalt),
    bounds: Object.freeze(meshBounds),
    projection,
    roadHalfWidth: halfWidth,
    routePoints: Object.freeze(routePoints),
    topSurface: freezeMeshPart(topSurface),
    leftSide: freezeMeshPart(leftSide),
    rightSide: freezeMeshPart(rightSide),
  });
};
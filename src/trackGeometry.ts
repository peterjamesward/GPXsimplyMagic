import type { TrackPoint } from "./gpx";

export type TrackMeshData = Readonly<{
  positions: readonly number[];
  normals: readonly number[];
  indices: readonly number[];
}>;

type Point3 = Readonly<{ x: number; y: number; z: number }>;

const normalize = (point: Point3): Point3 => {
  const length = Math.hypot(point.x, point.y, point.z);
  return length === 0 ? { x: 0, y: 0, z: 1 } : { x: point.x / length, y: point.y / length, z: point.z / length };
};

const cross = (left: Point3, right: Point3): Point3 => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x,
});

export const createTrackMeshData = (points: readonly TrackPoint[], radialSegments = 8): TrackMeshData => {
  if (points.length < 2) {
    throw new Error("At least two track points are required to create route geometry.");
  }

  if (!Number.isInteger(radialSegments) || radialSegments < 3) {
    throw new Error("A route tube needs at least three radial segments.");
  }

  const meanLatitude = points.reduce((total, point) => total + point.latitude, 0) / points.length;
  const unwrappedLongitudes = points.reduce((longitudes, point, index) => {
    if (index === 0) {
      return [...longitudes, point.longitude];
    }

    const previousPoint = points[index - 1];
    const longitudeDelta = ((point.longitude - previousPoint.longitude + 540) % 360) - 180;
    return [...longitudes, longitudes[index - 1] + longitudeDelta];
  }, [] as number[]);
  const meanLongitude = unwrappedLongitudes.reduce((total, longitude) => total + longitude, 0) / points.length;
  const longitudeScale = Math.cos((meanLatitude * Math.PI) / 180);
  const projected = points.map((point, index): Point3 => ({
    x: (unwrappedLongitudes[index] - meanLongitude) * longitudeScale * 111_320,
    y: point.elevationMeters,
    z: (meanLatitude - point.latitude) * 111_320,
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
  const route = projected.map((point): Point3 => ({
    x: (point.x - centerX) * scale,
    y: 0.12 + (point.y - minElevation) * scale * 2,
    z: (point.z - centerZ) * scale,
  }));

  const radius = 0.055;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  route.forEach((point, index) => {
    const previous = route[Math.max(0, index - 1)];
    const next = route[Math.min(route.length - 1, index + 1)];
    const tangent = normalize({ x: next.x - previous.x, y: next.y - previous.y, z: next.z - previous.z });
    const referenceUp = Math.abs(tangent.y) > 0.95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const side = normalize(cross(referenceUp, tangent));
    const binormal = normalize(cross(tangent, side));

    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const normal = normalize({
        x: side.x * cosine + binormal.x * sine,
        y: side.y * cosine + binormal.y * sine,
        z: side.z * cosine + binormal.z * sine,
      });

      positions.push(point.x + normal.x * radius, point.y + normal.y * radius, point.z + normal.z * radius);
      normals.push(normal.x, normal.y, normal.z);
    }
  });

  for (let pointIndex = 0; pointIndex < route.length - 1; pointIndex += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const nextSegment = (segment + 1) % radialSegments;
      const current = pointIndex * radialSegments + segment;
      const currentNext = pointIndex * radialSegments + nextSegment;
      const next = (pointIndex + 1) * radialSegments + segment;
      const nextNext = (pointIndex + 1) * radialSegments + nextSegment;
      indices.push(current, currentNext, next, currentNext, nextNext, next);
    }
  }

  return Object.freeze({
    positions: Object.freeze(positions),
    normals: Object.freeze(normals),
    indices: Object.freeze(indices),
  });
};
import type { TrackRoutePoint } from "./trackGeometry";

type Point3 = Readonly<{ x: number; y: number; z: number }>;
export type TrackRay = Readonly<{ origin: Point3; direction: Point3 }>;

type RaySegmentDistance = Readonly<{ distanceSquared: number; segmentFraction: number }>;

const dot = (left: Point3, right: Point3): number => left.x * right.x + left.y * right.y + left.z * right.z;

const getRaySegmentDistance = (ray: TrackRay, start: Point3, end: Point3): RaySegmentDistance => {
  const segment = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  const offset = { x: ray.origin.x - start.x, y: ray.origin.y - start.y, z: ray.origin.z - start.z };
  const directionLengthSquared = dot(ray.direction, ray.direction);
  const segmentLengthSquared = dot(segment, segment);
  const directionSegment = dot(ray.direction, segment);
  const directionOffset = dot(ray.direction, offset);
  const segmentOffset = dot(segment, offset);
  const candidates = [0, 1];

  if (segmentLengthSquared > 0) {
    candidates.push(Math.max(0, Math.min(1, segmentOffset / segmentLengthSquared)));
  }

  const denominator = directionLengthSquared * segmentLengthSquared - directionSegment ** 2;
  if (denominator > 1e-12) {
    const rayDistance = (directionSegment * segmentOffset - segmentLengthSquared * directionOffset) / denominator;
    const segmentFraction = (directionLengthSquared * segmentOffset - directionSegment * directionOffset) / denominator;
    if (rayDistance >= 0 && segmentFraction >= 0 && segmentFraction <= 1) {
      candidates.push(segmentFraction);
    }
  }

  return candidates.reduce<RaySegmentDistance>((best, segmentFraction) => {
    const point = {
      x: start.x + segment.x * segmentFraction,
      y: start.y + segment.y * segmentFraction,
      z: start.z + segment.z * segmentFraction,
    };
    const rayDistance = Math.max(0, dot({
      x: point.x - ray.origin.x,
      y: point.y - ray.origin.y,
      z: point.z - ray.origin.z,
    }, ray.direction) / directionLengthSquared);
    const rayPoint = {
      x: ray.origin.x + ray.direction.x * rayDistance,
      y: ray.origin.y + ray.direction.y * rayDistance,
      z: ray.origin.z + ray.direction.z * rayDistance,
    };
    const delta = { x: point.x - rayPoint.x, y: point.y - rayPoint.y, z: point.z - rayPoint.z };
    const distanceSquared = dot(delta, delta);

    return distanceSquared < best.distanceSquared ? { distanceSquared, segmentFraction } : best;
  }, { distanceSquared: Number.POSITIVE_INFINITY, segmentFraction: 0 });
};

export const findTrackPointNearRay = (
  ray: TrackRay,
  points: readonly TrackRoutePoint[],
  maxDistance: number,
): TrackRoutePoint | null => {
  const rayValues = [
    ray.origin.x,
    ray.origin.y,
    ray.origin.z,
    ray.direction.x,
    ray.direction.y,
    ray.direction.z,
  ];
  const directionLengthSquared = dot(ray.direction, ray.direction);
  if (
    points.length < 2 ||
    !rayValues.every(Number.isFinite) ||
    directionLengthSquared === 0 ||
    !Number.isFinite(maxDistance) ||
    maxDistance < 0
  ) {
    return null;
  }

  const nearest = points.slice(1).reduce<Readonly<{ point: TrackRoutePoint | null; distanceSquared: number }>>(
    (best, endPoint, index) => {
      const startPoint = points[index];
      const closest = getRaySegmentDistance(ray, startPoint, endPoint);
      if (closest.distanceSquared >= best.distanceSquared) {
        return best;
      }

      return {
        point: closest.segmentFraction < 0.5 ? startPoint : endPoint,
        distanceSquared: closest.distanceSquared,
      };
    },
    { point: null, distanceSquared: Number.POSITIVE_INFINITY },
  );

  return nearest.distanceSquared <= maxDistance ** 2 ? nearest.point : null;
};
import type { TrackRoutePoint } from "./trackGeometry";

type Point3 = Readonly<{ x: number; y: number; z: number }>;
export type TrackRay = Readonly<{ origin: Point3; direction: Point3 }>;

type RaySegmentDistance = Readonly<{ distanceSquared: number; segmentFraction: number }>;
type RouteSegment = Readonly<{
  index: number;
  start: TrackRoutePoint;
  end: TrackRoutePoint;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
}>;
type SegmentBounds = Readonly<{
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}>;
type SegmentLeaf = Readonly<SegmentBounds & { segments: readonly RouteSegment[] }>;
type SegmentBranch = Readonly<SegmentBounds & { left: SegmentNode; right: SegmentNode }>;
type SegmentNode = SegmentLeaf | SegmentBranch;
type SegmentHit = Readonly<{ point: TrackRoutePoint; distanceSquared: number; segmentIndex: number }>;

const segmentLeafSize = 8;

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

const createRouteSegments = (points: readonly TrackRoutePoint[]): readonly RouteSegment[] => points.slice(1).map((end, index) => {
  const start = points[index];
  return Object.freeze({
    index,
    start,
    end,
    minX: Math.min(start.x, end.x),
    maxX: Math.max(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxY: Math.max(start.y, end.y),
    minZ: Math.min(start.z, end.z),
    maxZ: Math.max(start.z, end.z),
    centerX: (start.x + end.x) / 2,
    centerY: (start.y + end.y) / 2,
    centerZ: (start.z + end.z) / 2,
  });
});

const getSegmentBounds = (segments: readonly RouteSegment[]): SegmentBounds => segments.reduce(
  (bounds, segment) => ({
    minX: Math.min(bounds.minX, segment.minX),
    maxX: Math.max(bounds.maxX, segment.maxX),
    minY: Math.min(bounds.minY, segment.minY),
    maxY: Math.max(bounds.maxY, segment.maxY),
    minZ: Math.min(bounds.minZ, segment.minZ),
    maxZ: Math.max(bounds.maxZ, segment.maxZ),
  }),
  {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  },
);

const buildSegmentTree = (segments: readonly RouteSegment[]): SegmentNode => {
  const bounds = getSegmentBounds(segments);
  if (segments.length <= segmentLeafSize) {
    return Object.freeze({ ...bounds, segments: Object.freeze([...segments]) });
  }

  const extents = [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ];
  const splitAxis = extents.indexOf(Math.max(...extents));
  const coordinate = (segment: RouteSegment): number =>
    splitAxis === 0 ? segment.centerX : splitAxis === 1 ? segment.centerY : segment.centerZ;
  const orderedSegments = [...segments].sort((left, right) => coordinate(left) - coordinate(right) || left.index - right.index);
  const middle = Math.floor(orderedSegments.length / 2);

  return Object.freeze({
    ...bounds,
    left: buildSegmentTree(orderedSegments.slice(0, middle)),
    right: buildSegmentTree(orderedSegments.slice(middle)),
  });
};

const rayIntersectsExpandedBounds = (ray: TrackRay, bounds: SegmentBounds, expansion: number): boolean => {
  let minimumRayParameter = 0;
  let maximumRayParameter = Number.POSITIVE_INFINITY;
  const axes = [
    { origin: ray.origin.x, direction: ray.direction.x, minimum: bounds.minX - expansion, maximum: bounds.maxX + expansion },
    { origin: ray.origin.y, direction: ray.direction.y, minimum: bounds.minY - expansion, maximum: bounds.maxY + expansion },
    { origin: ray.origin.z, direction: ray.direction.z, minimum: bounds.minZ - expansion, maximum: bounds.maxZ + expansion },
  ];

  for (const axis of axes) {
    if (axis.direction === 0) {
      if (axis.origin < axis.minimum || axis.origin > axis.maximum) {
        return false;
      }
      continue;
    }

    const first = (axis.minimum - axis.origin) / axis.direction;
    const second = (axis.maximum - axis.origin) / axis.direction;
    minimumRayParameter = Math.max(minimumRayParameter, Math.min(first, second));
    maximumRayParameter = Math.min(maximumRayParameter, Math.max(first, second));
    if (maximumRayParameter < minimumRayParameter) {
      return false;
    }
  }

  return maximumRayParameter >= 0;
};

const getSegmentHit = (ray: TrackRay, segment: RouteSegment): SegmentHit => {
  const closest = getRaySegmentDistance(ray, segment.start, segment.end);
  return {
    point: closest.segmentFraction < 0.5 ? segment.start : segment.end,
    distanceSquared: closest.distanceSquared,
    segmentIndex: segment.index,
  };
};

const isBetterHit = (candidate: SegmentHit, current: SegmentHit | null): boolean =>
  current === null || candidate.distanceSquared < current.distanceSquared ||
  (candidate.distanceSquared === current.distanceSquared && candidate.segmentIndex < current.segmentIndex);

const isValidRayQuery = (ray: TrackRay, maxDistance: number): boolean => {
  const rayValues = [
    ray.origin.x,
    ray.origin.y,
    ray.origin.z,
    ray.direction.x,
    ray.direction.y,
    ray.direction.z,
  ];
  return rayValues.every(Number.isFinite) && dot(ray.direction, ray.direction) > 0 && Number.isFinite(maxDistance) && maxDistance >= 0;
};

export const findTrackPointNearRay = (
  ray: TrackRay,
  points: readonly TrackRoutePoint[],
  maxDistance: number,
): TrackRoutePoint | null => {
  if (points.length < 2 || !isValidRayQuery(ray, maxDistance)) {
    return null;
  }

  const nearest = createRouteSegments(points).reduce<SegmentHit | null>((best, segment) => {
    const candidate = getSegmentHit(ray, segment);
    return isBetterHit(candidate, best) ? candidate : best;
  }, null);

  return nearest !== null && nearest.distanceSquared <= maxDistance ** 2 ? nearest.point : null;
};

export const createTrackPointRayIndex = (
  points: readonly TrackRoutePoint[],
): ((ray: TrackRay, maxDistance: number) => TrackRoutePoint | null) => {
  const tree = points.length < 2 ? null : buildSegmentTree(createRouteSegments(points));

  return (ray, maxDistance): TrackRoutePoint | null => {
    if (tree === null || !isValidRayQuery(ray, maxDistance)) {
      return null;
    }

    let nearest: SegmentHit | null = null;
    const visit = (node: SegmentNode): void => {
      const currentTolerance = Math.min(maxDistance, nearest === null ? Number.POSITIVE_INFINITY : Math.sqrt(nearest.distanceSquared));
      if (!rayIntersectsExpandedBounds(ray, node, currentTolerance)) {
        return;
      }

      if ("segments" in node) {
        for (const segment of node.segments) {
          const candidate = getSegmentHit(ray, segment);
          if (candidate.distanceSquared <= maxDistance ** 2 && isBetterHit(candidate, nearest)) {
            nearest = candidate;
          }
        }
        return;
      }

      visit(node.left);
      visit(node.right);
    };

    visit(tree);
    return (nearest as SegmentHit | null)?.point ?? null;
  };
};
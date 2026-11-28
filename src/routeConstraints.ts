import type { TrackRoutePoint } from "./trackGeometry";

export type RouteConstraint = Readonly<{ distance: number; x: number; z: number; y: number; elevation: number }>;
export type RouteConstraints = Readonly<{ nearest: RouteConstraint; lowestNearbyRouteHeight: number | null }>;
export type RouteConstraintIndex = ((x: number, z: number, maximumDistance: number) => RouteConstraints) & Readonly<{
  overlapsRoad: (polygon: readonly Readonly<{ x: number; z: number }>[], roadHalfWidth: number) => boolean;
}>;

type RouteSegment = Readonly<{
  index: number;
  start: TrackRoutePoint;
  end: TrackRoutePoint;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
}>;

type RouteBounds = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
type RouteLeaf = Readonly<RouteBounds & { segments: readonly RouteSegment[] }>;
type RouteBranch = Readonly<RouteBounds & { left: RouteNode; right: RouteNode }>;
type RouteNode = RouteLeaf | RouteBranch;

const leafSize = 8;

const getBounds = (segments: readonly RouteSegment[]): RouteBounds => segments.reduce(
  (bounds, segment) => ({
    minX: Math.min(bounds.minX, segment.minX),
    maxX: Math.max(bounds.maxX, segment.maxX),
    minZ: Math.min(bounds.minZ, segment.minZ),
    maxZ: Math.max(bounds.maxZ, segment.maxZ),
  }),
  { minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, minZ: Number.POSITIVE_INFINITY, maxZ: Number.NEGATIVE_INFINITY },
);

const buildRouteTree = (segments: readonly RouteSegment[]): RouteNode => {
  const bounds = getBounds(segments);
  if (segments.length <= leafSize) {
    return Object.freeze({ ...bounds, segments: Object.freeze([...segments]) });
  }

  const splitOnX = bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ;
  const orderedSegments = [...segments].sort((left, right) => {
    const difference = splitOnX ? left.centerX - right.centerX : left.centerZ - right.centerZ;
    return difference || left.index - right.index;
  });
  const middle = Math.floor(orderedSegments.length / 2);

  return Object.freeze({
    ...bounds,
    left: buildRouteTree(orderedSegments.slice(0, middle)),
    right: buildRouteTree(orderedSegments.slice(middle)),
  });
};

const distanceSquaredToBounds = (x: number, z: number, bounds: RouteBounds): number => {
  const dx = x < bounds.minX ? bounds.minX - x : x > bounds.maxX ? x - bounds.maxX : 0;
  const dz = z < bounds.minZ ? bounds.minZ - z : z > bounds.maxZ ? z - bounds.maxZ : 0;
  return dx * dx + dz * dz;
};

const getPolygonBounds = (polygon: readonly Readonly<{ x: number; z: number }>[]): RouteBounds | null => {
  if (polygon.length < 3) return null;
  return polygon.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minZ: Math.min(bounds.minZ, point.z),
    maxZ: Math.max(bounds.maxZ, point.z),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  });
};

const boundsOverlap = (first: RouteBounds, second: RouteBounds): boolean =>
  first.minX <= second.maxX && first.maxX >= second.minX && first.minZ <= second.maxZ && first.maxZ >= second.minZ;

const distanceSquaredToSegment = (
  point: Readonly<{ x: number; z: number }>,
  start: Readonly<{ x: number; z: number }>,
  end: Readonly<{ x: number; z: number }>,
): number => {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const progress = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  return (point.x - (start.x + dx * progress)) ** 2 + (point.z - (start.z + dz * progress)) ** 2;
};

const orientation = (
  first: Readonly<{ x: number; z: number }>,
  second: Readonly<{ x: number; z: number }>,
  third: Readonly<{ x: number; z: number }>,
): number => (second.x - first.x) * (third.z - first.z) - (second.z - first.z) * (third.x - first.x);

const segmentsIntersect = (
  firstStart: Readonly<{ x: number; z: number }>,
  firstEnd: Readonly<{ x: number; z: number }>,
  secondStart: Readonly<{ x: number; z: number }>,
  secondEnd: Readonly<{ x: number; z: number }>,
): boolean => {
  const firstSide = orientation(firstStart, firstEnd, secondStart);
  const secondSide = orientation(firstStart, firstEnd, secondEnd);
  const thirdSide = orientation(secondStart, secondEnd, firstStart);
  const fourthSide = orientation(secondStart, secondEnd, firstEnd);
  const coordinateScale = Math.max(
    1,
    Math.abs(firstStart.x), Math.abs(firstStart.z),
    Math.abs(firstEnd.x), Math.abs(firstEnd.z),
    Math.abs(secondStart.x), Math.abs(secondStart.z),
    Math.abs(secondEnd.x), Math.abs(secondEnd.z),
  );
  const areaTolerance = Number.EPSILON * coordinateScale * coordinateScale * 16;
  const linearTolerance = Number.EPSILON * coordinateScale * 16;
  const within = (value: number, first: number, second: number): boolean =>
    value >= Math.min(first, second) - linearTolerance && value <= Math.max(first, second) + linearTolerance;
  const liesOnSegment = (
    point: Readonly<{ x: number; z: number }>,
    start: Readonly<{ x: number; z: number }>,
    end: Readonly<{ x: number; z: number }>,
    side: number,
  ): boolean => Math.abs(side) <= areaTolerance &&
    within(point.x, start.x, end.x) && within(point.z, start.z, end.z);
  const firstSign = firstSide > areaTolerance ? 1 : firstSide < -areaTolerance ? -1 : 0;
  const secondSign = secondSide > areaTolerance ? 1 : secondSide < -areaTolerance ? -1 : 0;
  const thirdSign = thirdSide > areaTolerance ? 1 : thirdSide < -areaTolerance ? -1 : 0;
  const fourthSign = fourthSide > areaTolerance ? 1 : fourthSide < -areaTolerance ? -1 : 0;

  if (firstSign * secondSign < 0 && thirdSign * fourthSign < 0) return true;
  return (firstSign === 0 && liesOnSegment(secondStart, firstStart, firstEnd, firstSide)) ||
    (secondSign === 0 && liesOnSegment(secondEnd, firstStart, firstEnd, secondSide)) ||
    (thirdSign === 0 && liesOnSegment(firstStart, secondStart, secondEnd, thirdSide)) ||
    (fourthSign === 0 && liesOnSegment(firstEnd, secondStart, secondEnd, fourthSide));
};

const isInsidePolygon = (
  point: Readonly<{ x: number; z: number }>,
  polygon: readonly Readonly<{ x: number; z: number }>[],
): boolean => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const first = polygon[previous];
    const second = polygon[index];
    if (distanceSquaredToSegment(point, first, second) <= 1e-16) return true;
    if ((first.z > point.z) !== (second.z > point.z) &&
      point.x < ((second.x - first.x) * (point.z - first.z)) / (second.z - first.z) + first.x) {
      inside = !inside;
    }
  }
  return inside;
};

const routeSegmentOverlapsPolygon = (
  segment: RouteSegment,
  polygon: readonly Readonly<{ x: number; z: number }>[],
  roadHalfWidthSquared: number,
): boolean => {
  if (isInsidePolygon(segment.start, polygon) || isInsidePolygon(segment.end, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    if (segmentsIntersect(segment.start, segment.end, edgeStart, edgeEnd)) return true;
    if (
      distanceSquaredToSegment(segment.start, edgeStart, edgeEnd) <= roadHalfWidthSquared ||
      distanceSquaredToSegment(segment.end, edgeStart, edgeEnd) <= roadHalfWidthSquared ||
      distanceSquaredToSegment(edgeStart, segment.start, segment.end) <= roadHalfWidthSquared ||
      distanceSquaredToSegment(edgeEnd, segment.start, segment.end) <= roadHalfWidthSquared
    ) {
      return true;
    }
  }
  return false;
};

export const createRouteConstraintIndex = (
  points: readonly TrackRoutePoint[],
): RouteConstraintIndex => {
  if (points.length < 2) {
    throw new Error("At least two route points are required to find route constraints.");
  }

  const segments = points.slice(0, -1).map((start, index): RouteSegment => {
    const end = points[index + 1];
    return Object.freeze({
      index,
      start,
      end,
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
      minZ: Math.min(start.z, end.z),
      maxZ: Math.max(start.z, end.z),
      centerX: (start.x + end.x) / 2,
      centerZ: (start.z + end.z) / 2,
    });
  });
  const tree = buildRouteTree(segments);

  const findConstraints = (x: number, z: number, maximumDistance: number): RouteConstraints => {
    let nearest: RouteConstraint = {
      distance: Number.POSITIVE_INFINITY,
      x: points[0].x,
      z: points[0].z,
      y: points[0].y,
      elevation: points[0].altitudeMeters,
    };
    let nearestIndex = Number.POSITIVE_INFINITY;
    let lowestNearbyRouteHeight = Number.POSITIVE_INFINITY;

    const visit = (node: RouteNode): void => {
      const boundsDistanceSquared = distanceSquaredToBounds(x, z, node);
      if (boundsDistanceSquared > nearest.distance * nearest.distance
        && boundsDistanceSquared > maximumDistance * maximumDistance) {
        return;
      }

      if ("segments" in node) {
        for (const segment of node.segments) {
          const dx = segment.end.x - segment.start.x;
          const dz = segment.end.z - segment.start.z;
          const lengthSquared = dx * dx + dz * dz;
          const ratio = lengthSquared === 0
            ? 0
            : Math.max(0, Math.min(1, ((x - segment.start.x) * dx + (z - segment.start.z) * dz) / lengthSquared));
          const routeX = segment.start.x + dx * ratio;
          const routeZ = segment.start.z + dz * ratio;
          const distance = Math.hypot(x - routeX, z - routeZ);
          const routeHeight = segment.start.y + (segment.end.y - segment.start.y) * ratio;

          if (distance < nearest.distance || (distance === nearest.distance && segment.index < nearestIndex)) {
            nearestIndex = segment.index;
            nearest = {
              distance,
              x: routeX,
              z: routeZ,
              y: routeHeight,
              elevation: segment.start.altitudeMeters + (segment.end.altitudeMeters - segment.start.altitudeMeters) * ratio,
            };
          }

          if (distance <= maximumDistance) {
            lowestNearbyRouteHeight = Math.min(lowestNearbyRouteHeight, routeHeight);
          }
        }
        return;
      }

      const leftDistance = distanceSquaredToBounds(x, z, node.left);
      const rightDistance = distanceSquaredToBounds(x, z, node.right);
      if (leftDistance <= rightDistance) {
        visit(node.left);
        visit(node.right);
      } else {
        visit(node.right);
        visit(node.left);
      }
    };

    visit(tree);
    return {
      nearest,
      lowestNearbyRouteHeight: Number.isFinite(lowestNearbyRouteHeight) ? lowestNearbyRouteHeight : null,
    };
  };

  const overlapsRoad = (
    polygon: readonly Readonly<{ x: number; z: number }>[],
    roadHalfWidth: number,
  ): boolean => {
    const polygonBounds = getPolygonBounds(polygon);
    if (polygonBounds === null) return false;
    const searchBounds = {
      minX: polygonBounds.minX - roadHalfWidth,
      maxX: polygonBounds.maxX + roadHalfWidth,
      minZ: polygonBounds.minZ - roadHalfWidth,
      maxZ: polygonBounds.maxZ + roadHalfWidth,
    };
    const roadHalfWidthSquared = roadHalfWidth * roadHalfWidth;

    const visitOverlaps = (node: RouteNode): boolean => {
      if (!boundsOverlap(node, searchBounds)) return false;
      if ("segments" in node) {
        return node.segments.some((segment) =>
          boundsOverlap(segment, searchBounds) && routeSegmentOverlapsPolygon(segment, polygon, roadHalfWidthSquared));
      }
      return visitOverlaps(node.left) || visitOverlaps(node.right);
    };

    return visitOverlaps(tree);
  };

  return Object.freeze(Object.assign(findConstraints, { overlapsRoad }));
};
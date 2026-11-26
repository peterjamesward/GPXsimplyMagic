import type { TrackRoutePoint } from "./trackGeometry";

export type RouteConstraint = Readonly<{ distance: number; x: number; z: number; y: number; elevation: number }>;
export type RouteConstraints = Readonly<{ nearest: RouteConstraint; lowestNearbyRouteHeight: number | null }>;

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

export const createRouteConstraintIndex = (
  points: readonly TrackRoutePoint[],
): ((x: number, z: number, maximumDistance: number) => RouteConstraints) => {
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

  return (x, z, maximumDistance): RouteConstraints => {
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
};
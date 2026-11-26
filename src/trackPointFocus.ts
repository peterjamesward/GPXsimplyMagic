type ScreenPoint = Readonly<{ x: number; y: number }>;

export const findNearestScreenPointIndex = (
  points: readonly ScreenPoint[],
  target: ScreenPoint,
  maxDistance: number,
): number | null => {
  if (
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y) ||
    !Number.isFinite(maxDistance) ||
    maxDistance < 0
  ) {
    return null;
  }

  const nearest = points.reduce<Readonly<{ index: number | null; distanceSquared: number }>>(
    (best, point, index) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return best;
      }

      const distanceSquared = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
      return distanceSquared < best.distanceSquared ? { index, distanceSquared } : best;
    },
    { index: null, distanceSquared: maxDistance ** 2 },
  );

  return nearest.index;
};
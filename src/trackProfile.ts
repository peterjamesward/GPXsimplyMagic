import type { TrackRoutePoint } from "./trackGeometry";

export type TrackProfileViewState = Readonly<{
  minDistanceMeters: number;
  maxDistanceMeters: number;
  minDistanceLimitMeters: number;
  maxDistanceLimitMeters: number;
  minAltitudeMeters: number;
  maxAltitudeMeters: number;
  minAltitudeLimitMeters: number;
  maxAltitudeLimitMeters: number;
}>;
export type TrackProfilePlotBounds = Readonly<{ left: number; top: number; width: number; height: number }>;
export type TrackProfileScreenPoint = Readonly<{ x: number; y: number }>;

export const getTrackProfileMetersPerPixel = (
  state: TrackProfileViewState,
  plotWidth: number,
): number | null => {
  const distanceRange = state.maxDistanceMeters - state.minDistanceMeters;
  if (!Number.isFinite(plotWidth) || plotWidth <= 0 || !Number.isFinite(distanceRange) || distanceRange <= 0) {
    return null;
  }
  return distanceRange / plotWidth;
};

export const focusTrackProfileView = (
  state: TrackProfileViewState,
  points: readonly TrackRoutePoint[],
  distanceMeters: number,
  metersPerPixel: number,
  plotWidth: number,
): TrackProfileViewState => {
  if (
    points.length === 0 ||
    ![distanceMeters, metersPerPixel, plotWidth].every(Number.isFinite) ||
    metersPerPixel <= 0 ||
    plotWidth <= 0
  ) {
    return state;
  }

  const distanceSpan = metersPerPixel * plotWidth;
  if (!Number.isFinite(distanceSpan)) {
    return state;
  }
  const boundedDistanceSpan = Math.max(0.1, distanceSpan);
  const [minDistanceMeters, maxDistanceMeters] = clampRangeToBounds(
    distanceMeters - boundedDistanceSpan / 2,
    distanceMeters + boundedDistanceSpan / 2,
    state.minDistanceLimitMeters,
    state.maxDistanceLimitMeters,
  );
  const [fittedMinAltitudeMeters, fittedMaxAltitudeMeters] = getVisibleAltitudeRange(
    points,
    minDistanceMeters,
    maxDistanceMeters,
  ) ?? [state.minAltitudeMeters, state.maxAltitudeMeters];
  const [minAltitudeMeters, maxAltitudeMeters] = clampRangeToBounds(
    fittedMinAltitudeMeters,
    fittedMaxAltitudeMeters,
    state.minAltitudeLimitMeters,
    state.maxAltitudeLimitMeters,
  );

  return Object.freeze({ ...state, minDistanceMeters, maxDistanceMeters, minAltitudeMeters, maxAltitudeMeters });
};

export const getTrackProfilePlotBounds = (width: number, height: number): TrackProfilePlotBounds => Object.freeze({
  left: 54,
  top: 12,
  width: Math.max(0, width - 72),
  height: Math.max(0, height - 42),
});

export const getTrackProfileScreenPoint = (
  point: TrackRoutePoint,
  state: TrackProfileViewState,
  plot: TrackProfilePlotBounds,
): TrackProfileScreenPoint => Object.freeze({
  x: plot.left + ((point.distanceMeters - state.minDistanceMeters) / (state.maxDistanceMeters - state.minDistanceMeters)) * plot.width,
  y: plot.top + ((state.maxAltitudeMeters - point.altitudeMeters) / (state.maxAltitudeMeters - state.minAltitudeMeters)) * plot.height,
});

const getExpandedRange = (minimum: number, maximum: number, paddingFraction: number, minimumPadding: number): readonly [number, number] => {
  const padding = Math.max((maximum - minimum) * paddingFraction, minimumPadding);
  return [minimum - padding, maximum + padding];
};

export const createTrackProfileViewState = (points: readonly TrackRoutePoint[]): TrackProfileViewState => {
  if (points.length === 0) {
    throw new Error("At least one route point is required to create an elevation profile.");
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const altitudeRange = points.reduce(
    (range, point) => ({ min: Math.min(range.min, point.altitudeMeters), max: Math.max(range.max, point.altitudeMeters) }),
    { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
  );
  const routeDistanceSpan = lastPoint.distanceMeters - firstPoint.distanceMeters;
  const [minDistanceMeters, maxDistanceMeters] = routeDistanceSpan > 0.1
    ? [firstPoint.distanceMeters, lastPoint.distanceMeters]
    : getExpandedRange(firstPoint.distanceMeters, lastPoint.distanceMeters, 0.025, 5);
  const [minAltitudeMeters, maxAltitudeMeters] = getExpandedRange(altitudeRange.min, altitudeRange.max, 0.12, 5);

  return Object.freeze({
    minDistanceMeters,
    maxDistanceMeters,
    minDistanceLimitMeters: minDistanceMeters,
    maxDistanceLimitMeters: maxDistanceMeters,
    minAltitudeMeters,
    maxAltitudeMeters,
    minAltitudeLimitMeters: minAltitudeMeters,
    maxAltitudeLimitMeters: maxAltitudeMeters,
  });
};

export const getTrackProfilePointAtDistance = (
  points: readonly TrackRoutePoint[],
  distanceMeters: number,
): Readonly<{ point: TrackRoutePoint; index: number }> | null => {
  if (
    points.length === 0 ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters < points[0].distanceMeters ||
    distanceMeters > points[points.length - 1].distanceMeters
  ) {
    return null;
  }

  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].distanceMeters < distanceMeters) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const nextIndex = Math.min(low, points.length - 1);
  const previousIndex = Math.max(0, nextIndex - 1);
  const index = distanceMeters - points[previousIndex].distanceMeters <= points[nextIndex].distanceMeters - distanceMeters
    ? previousIndex
    : nextIndex;
  return Object.freeze({ point: points[index], index });
};

const findNextPointIndexAtDistance = (points: readonly TrackRoutePoint[], distanceMeters: number): number => {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].distanceMeters < distanceMeters) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const getAltitudeAtDistance = (points: readonly TrackRoutePoint[], distanceMeters: number): number => {
  const nextIndex = findNextPointIndexAtDistance(points, distanceMeters);
  if (nextIndex === 0) {
    return points[0].altitudeMeters;
  }
  if (nextIndex >= points.length) {
    return points[points.length - 1].altitudeMeters;
  }

  const previous = points[nextIndex - 1];
  const next = points[nextIndex];
  if (next.distanceMeters === distanceMeters) {
    return next.altitudeMeters;
  }
  const distanceSpan = next.distanceMeters - previous.distanceMeters;
  const fraction = distanceSpan > 0 ? (distanceMeters - previous.distanceMeters) / distanceSpan : 0;
  return previous.altitudeMeters + (next.altitudeMeters - previous.altitudeMeters) * fraction;
};

const getVisibleAltitudeRange = (
  points: readonly TrackRoutePoint[],
  minDistanceMeters: number,
  maxDistanceMeters: number,
): readonly [number, number] | null => {
  if (points.length === 0) {
    return null;
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const visibleMinDistance = Math.max(minDistanceMeters, firstPoint.distanceMeters);
  const visibleMaxDistance = Math.min(maxDistanceMeters, lastPoint.distanceMeters);
  if (visibleMinDistance > visibleMaxDistance) {
    return null;
  }

  const startAltitude = getAltitudeAtDistance(points, visibleMinDistance);
  const endAltitude = getAltitudeAtDistance(points, visibleMaxDistance);
  let minAltitude = Math.min(startAltitude, endAltitude);
  let maxAltitude = Math.max(startAltitude, endAltitude);
  const firstVisibleIndex = findNextPointIndexAtDistance(points, visibleMinDistance);
  for (let index = firstVisibleIndex; index < points.length; index += 1) {
    const point = points[index];
    if (point.distanceMeters > visibleMaxDistance) {
      break;
    }
    minAltitude = Math.min(minAltitude, point.altitudeMeters);
    maxAltitude = Math.max(maxAltitude, point.altitudeMeters);
  }

  return getExpandedRange(minAltitude, maxAltitude, 0.12, 5);
};

export const getTrackProfilePointAtPosition = (
  points: readonly TrackRoutePoint[],
  state: TrackProfileViewState,
  plot: TrackProfilePlotBounds,
  position: TrackProfileScreenPoint,
  tolerancePixels: number,
): Readonly<{ point: TrackRoutePoint; index: number }> | null => {
  if (
    points.length < 2 ||
    plot.width <= 0 ||
    plot.height <= 0 ||
    tolerancePixels < 0 ||
    ![position.x, position.y, tolerancePixels].every(Number.isFinite) ||
    position.x < plot.left ||
    position.x > plot.left + plot.width ||
    position.y < plot.top ||
    position.y > plot.top + plot.height
  ) {
    return null;
  }

  const distanceMeters = state.minDistanceMeters + ((position.x - plot.left) / plot.width) * (state.maxDistanceMeters - state.minDistanceMeters);
  if (distanceMeters < points[0].distanceMeters || distanceMeters > points[points.length - 1].distanceMeters) {
    return null;
  }

  const nextIndex = findNextPointIndexAtDistance(points, distanceMeters);
  const segmentIndex = Math.max(0, Math.min(points.length - 2, nextIndex - 1));
  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  const distanceSpan = end.distanceMeters - start.distanceMeters;
  const segmentFraction = distanceSpan > 0
    ? Math.max(0, Math.min(1, (distanceMeters - start.distanceMeters) / distanceSpan))
    : 0;
  const lineAltitude = start.altitudeMeters + (end.altitudeMeters - start.altitudeMeters) * segmentFraction;
  const lineY = plot.top + ((state.maxAltitudeMeters - lineAltitude) / (state.maxAltitudeMeters - state.minAltitudeMeters)) * plot.height;
  if (Math.abs(position.y - lineY) > tolerancePixels) {
    return null;
  }

  const index = segmentFraction <= 0.5 ? segmentIndex : segmentIndex + 1;
  return Object.freeze({ point: points[index], index });
};

const withRangeScale = (minimum: number, maximum: number, anchor: number, scaleFactor: number, minimumSpan: number): readonly [number, number] => {
  const currentSpan = maximum - minimum;
  const nextSpan = Math.max(minimumSpan, Math.min(1_000_000_000, currentSpan * scaleFactor));
  const anchorFraction = currentSpan > 0 ? (anchor - minimum) / currentSpan : 0.5;
  return [anchor - anchorFraction * nextSpan, anchor + (1 - anchorFraction) * nextSpan];
};

const clampRangeToBounds = (
  minimum: number,
  maximum: number,
  boundsMinimum: number,
  boundsMaximum: number,
): readonly [number, number] => {
  const span = Math.min(maximum - minimum, boundsMaximum - boundsMinimum);
  const clampedMinimum = Math.max(boundsMinimum, Math.min(minimum, boundsMaximum - span));
  return [clampedMinimum, clampedMinimum + span];
};

export const zoomTrackProfileView = (
  state: TrackProfileViewState,
  points: readonly TrackRoutePoint[],
  anchorDistanceFraction: number,
  scaleFactor: number,
): TrackProfileViewState => {
  if (![anchorDistanceFraction, scaleFactor].every(Number.isFinite) || scaleFactor <= 0) {
    return state;
  }

  const distanceFraction = Math.max(0, Math.min(1, anchorDistanceFraction));
  const distanceAnchor = state.minDistanceMeters + distanceFraction * (state.maxDistanceMeters - state.minDistanceMeters);
  const [scaledMinDistanceMeters, scaledMaxDistanceMeters] = withRangeScale(
    state.minDistanceMeters,
    state.maxDistanceMeters,
    distanceAnchor,
    scaleFactor,
    0.1,
  );
  const [minDistanceMeters, maxDistanceMeters] = clampRangeToBounds(
    scaledMinDistanceMeters,
    scaledMaxDistanceMeters,
    state.minDistanceLimitMeters,
    state.maxDistanceLimitMeters,
  );
  const [fittedMinAltitudeMeters, fittedMaxAltitudeMeters] = getVisibleAltitudeRange(
    points,
    minDistanceMeters,
    maxDistanceMeters,
  ) ?? [state.minAltitudeMeters, state.maxAltitudeMeters];
  const [minAltitudeMeters, maxAltitudeMeters] = clampRangeToBounds(
    fittedMinAltitudeMeters,
    fittedMaxAltitudeMeters,
    state.minAltitudeLimitMeters,
    state.maxAltitudeLimitMeters,
  );

  return Object.freeze({ ...state, minDistanceMeters, maxDistanceMeters, minAltitudeMeters, maxAltitudeMeters });
};

export const panTrackProfileView = (
  state: TrackProfileViewState,
  deltaX: number,
  deltaY: number,
  plotWidth: number,
  plotHeight: number,
): TrackProfileViewState => {
  if (![deltaX, deltaY, plotWidth, plotHeight].every(Number.isFinite) || plotWidth <= 0 || plotHeight <= 0) {
    return state;
  }

  const distanceOffset = (-deltaX / plotWidth) * (state.maxDistanceMeters - state.minDistanceMeters);
  const altitudeOffset = (deltaY / plotHeight) * (state.maxAltitudeMeters - state.minAltitudeMeters);
  const [minDistanceMeters, maxDistanceMeters] = clampRangeToBounds(
    state.minDistanceMeters + distanceOffset,
    state.maxDistanceMeters + distanceOffset,
    state.minDistanceLimitMeters,
    state.maxDistanceLimitMeters,
  );
  const [minAltitudeMeters, maxAltitudeMeters] = clampRangeToBounds(
    state.minAltitudeMeters + altitudeOffset,
    state.maxAltitudeMeters + altitudeOffset,
    state.minAltitudeLimitMeters,
    state.maxAltitudeLimitMeters,
  );
  return Object.freeze({
    ...state,
    minDistanceMeters,
    maxDistanceMeters,
    minAltitudeMeters,
    maxAltitudeMeters,
  });
};
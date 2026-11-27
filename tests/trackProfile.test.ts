import { describe, expect, it } from "vitest";
import { createTrackMeshData } from "../src/trackGeometry";
import {
  createTrackProfileViewState,
  getTrackProfilePlotBounds,
  getTrackProfilePointAtDistance,
  getTrackProfilePointAtPosition,
  getTrackProfileScreenPoint,
  panTrackProfileView,
  zoomTrackProfileView,
} from "../src/trackProfile";

const geometry = createTrackMeshData([
  { latitude: 0, longitude: 0, elevationMeters: 100 },
  { latitude: 0, longitude: 0.001, elevationMeters: 110 },
  { latitude: 0, longitude: 0.002, elevationMeters: 105 },
]);

describe("track elevation profile", () => {
  it("creates a padded distance and altitude range for the route", () => {
    const state = createTrackProfileViewState(geometry.routePoints);

    expect(state.minDistanceMeters).toBeLessThan(geometry.routePoints[0].distanceMeters);
    expect(state.maxDistanceMeters).toBeGreaterThan(geometry.routePoints.at(-1)!.distanceMeters);
    expect(state.minAltitudeMeters).toBeLessThan(100);
    expect(state.maxAltitudeMeters).toBeGreaterThan(110);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it("selects a route point when the pointer is near its profile position", () => {
    const state = createTrackProfileViewState(geometry.routePoints);
    const plot = getTrackProfilePlotBounds(800, 220);
    const pointPosition = getTrackProfileScreenPoint(geometry.routePoints[1], state, plot);

    expect(getTrackProfilePointAtPosition(geometry.routePoints, state, plot, pointPosition, 18)?.index).toBe(1);
    expect(getTrackProfilePointAtPosition(
      geometry.routePoints,
      state,
      plot,
      { x: pointPosition.x, y: pointPosition.y + 30 },
      18,
    )).toBeNull();
    expect(getTrackProfilePointAtPosition(
      geometry.routePoints,
      state,
      plot,
      { x: plot.left - 1, y: pointPosition.y },
      18,
    )).toBeNull();
  });

  it("finds the nearest route point by cumulative distance", () => {
    expect(getTrackProfilePointAtDistance(geometry.routePoints, 1)?.index).toBe(0);
    expect(getTrackProfilePointAtDistance(geometry.routePoints, 120)?.index).toBe(1);
    expect(getTrackProfilePointAtDistance(geometry.routePoints, 300)).toBeNull();
  });

  it("zooms around the pointer anchor and pans in both axes", () => {
    const state = createTrackProfileViewState(geometry.routePoints);
    const anchorDistance = state.minDistanceMeters + 0.35 * (state.maxDistanceMeters - state.minDistanceMeters);
    const zoomed = zoomTrackProfileView(state, geometry.routePoints, 0.35, 0.1);
    const zoomedAnchorDistance = zoomed.minDistanceMeters + 0.35 * (zoomed.maxDistanceMeters - zoomed.minDistanceMeters);
    const panned = panTrackProfileView(zoomed, 25, 10, 100, 100);

    expect(zoomed.maxDistanceMeters - zoomed.minDistanceMeters).toBeLessThan(state.maxDistanceMeters - state.minDistanceMeters);
    expect(zoomedAnchorDistance).toBeCloseTo(anchorDistance);
    expect(panned.minDistanceMeters).toBeLessThan(zoomed.minDistanceMeters);
    expect(panned.minAltitudeMeters).toBeGreaterThan(zoomed.minAltitudeMeters);
  });

  it("keeps the visible route elevation range in view when zooming into a high section", () => {
    const highSection = createTrackMeshData([
      { latitude: 0, longitude: 0, elevationMeters: 100 },
      { latitude: 0, longitude: 0.001, elevationMeters: 100 },
      { latitude: 0, longitude: 0.002, elevationMeters: 100 },
      { latitude: 0, longitude: 0.003, elevationMeters: 200 },
    ]).routePoints;
    const state = createTrackProfileViewState(highSection);
    const zoomed = zoomTrackProfileView(state, highSection, 0.95, 0.25);
    const segmentStart = highSection[2];
    const segmentEnd = highSection[3];
    const getSegmentAltitudeAtDistance = (distanceMeters: number): number => (
      segmentStart.altitudeMeters
      + ((segmentEnd.altitudeMeters - segmentStart.altitudeMeters)
        * (distanceMeters - segmentStart.distanceMeters))
      / (segmentEnd.distanceMeters - segmentStart.distanceMeters)
    );
    const visibleStartAltitude = getSegmentAltitudeAtDistance(zoomed.minDistanceMeters);
    const visibleEndAltitude = getSegmentAltitudeAtDistance(zoomed.maxDistanceMeters);

    expect(zoomed.minDistanceMeters).toBeGreaterThan(segmentStart.distanceMeters);
    expect(zoomed.maxDistanceMeters).toBeLessThan(segmentEnd.distanceMeters);
    expect(zoomed.minAltitudeMeters).toBeLessThan(visibleStartAltitude);
    expect(zoomed.maxAltitudeMeters).toBeGreaterThan(visibleEndAltitude);
  });

  it("keeps the full-route distance bounds fixed when zooming back out", () => {
    const state = createTrackProfileViewState(geometry.routePoints);
    const zoomed = zoomTrackProfileView(state, geometry.routePoints, 0.2, 0.25);
    const zoomedOutAtLeft = zoomTrackProfileView(zoomed, geometry.routePoints, 0, 10);
    const zoomedOutAtRight = zoomTrackProfileView(zoomed, geometry.routePoints, 1, 10);

    expect(zoomedOutAtLeft.minDistanceMeters).toBe(state.minDistanceMeters);
    expect(zoomedOutAtLeft.maxDistanceMeters).toBe(state.maxDistanceMeters);
    expect(zoomedOutAtRight.minDistanceMeters).toBe(state.minDistanceMeters);
    expect(zoomedOutAtRight.maxDistanceMeters).toBe(state.maxDistanceMeters);
  });

  it("keeps panning and zooming within the full-route distance bounds", () => {
    const state = createTrackProfileViewState(geometry.routePoints);
    const zoomed = zoomTrackProfileView(state, geometry.routePoints, 0.5, 0.25);
    const span = zoomed.maxDistanceMeters - zoomed.minDistanceMeters;
    const pannedPastStart = panTrackProfileView(zoomed, 100_000, 0, 100, 100);
    const pannedPastEnd = panTrackProfileView(zoomed, -100_000, 0, 100, 100);
    const zoomedAtStart = zoomTrackProfileView(pannedPastStart, geometry.routePoints, 0, 0.1);
    const zoomedAtEnd = zoomTrackProfileView(pannedPastEnd, geometry.routePoints, 1, 0.1);
    const zoomedOutAtStart = zoomTrackProfileView(pannedPastStart, geometry.routePoints, 0.9, 10);
    const zoomedOutAtEnd = zoomTrackProfileView(pannedPastEnd, geometry.routePoints, 0.1, 10);

    expect(pannedPastStart.minDistanceMeters).toBe(state.minDistanceLimitMeters);
    expect(pannedPastStart.maxDistanceMeters).toBeCloseTo(state.minDistanceLimitMeters + span);
    expect(pannedPastEnd.minDistanceMeters).toBeCloseTo(state.maxDistanceLimitMeters - span);
    expect(pannedPastEnd.maxDistanceMeters).toBe(state.maxDistanceLimitMeters);
    expect(zoomedAtStart.minDistanceMeters).toBeGreaterThanOrEqual(state.minDistanceLimitMeters);
    expect(zoomedAtStart.maxDistanceMeters).toBeLessThanOrEqual(state.maxDistanceLimitMeters);
    expect(zoomedAtEnd.minDistanceMeters).toBeGreaterThanOrEqual(state.minDistanceLimitMeters);
    expect(zoomedAtEnd.maxDistanceMeters).toBeLessThanOrEqual(state.maxDistanceLimitMeters);
    expect(zoomedOutAtStart.minDistanceMeters).toBe(state.minDistanceLimitMeters);
    expect(zoomedOutAtStart.maxDistanceMeters).toBe(state.maxDistanceLimitMeters);
    expect(zoomedOutAtEnd.minDistanceMeters).toBe(state.minDistanceLimitMeters);
    expect(zoomedOutAtEnd.maxDistanceMeters).toBe(state.maxDistanceLimitMeters);
  });

  it("keeps vertical panning and zooming within the full-route altitude bounds", () => {
    const state = createTrackProfileViewState(geometry.routePoints);
    const zoomed = zoomTrackProfileView(state, geometry.routePoints, 0.5, 0.25);
    const span = zoomed.maxAltitudeMeters - zoomed.minAltitudeMeters;
    const pannedPastMinimum = panTrackProfileView(zoomed, 0, -100_000, 100, 100);
    const pannedPastMaximum = panTrackProfileView(zoomed, 0, 100_000, 100, 100);
    const zoomedAtMinimum = zoomTrackProfileView(pannedPastMinimum, geometry.routePoints, 0.5, 0.1);
    const zoomedAtMaximum = zoomTrackProfileView(pannedPastMaximum, geometry.routePoints, 0.5, 0.1);

    expect(pannedPastMinimum.minAltitudeMeters).toBe(state.minAltitudeLimitMeters);
    expect(pannedPastMinimum.maxAltitudeMeters).toBeCloseTo(state.minAltitudeLimitMeters + span);
    expect(pannedPastMaximum.minAltitudeMeters).toBeCloseTo(state.maxAltitudeLimitMeters - span);
    expect(pannedPastMaximum.maxAltitudeMeters).toBe(state.maxAltitudeLimitMeters);
    expect(zoomedAtMinimum.minAltitudeMeters).toBeGreaterThanOrEqual(state.minAltitudeLimitMeters);
    expect(zoomedAtMinimum.maxAltitudeMeters).toBeLessThanOrEqual(state.maxAltitudeLimitMeters);
    expect(zoomedAtMaximum.minAltitudeMeters).toBeGreaterThanOrEqual(state.minAltitudeLimitMeters);
    expect(zoomedAtMaximum.maxAltitudeMeters).toBeLessThanOrEqual(state.maxAltitudeLimitMeters);
  });

  it("keeps the full-route altitude bounds fixed when zooming back out after panning", () => {
    const state = createTrackProfileViewState(geometry.routePoints);
    const zoomed = zoomTrackProfileView(state, geometry.routePoints, 0.5, 0.25);
    const panned = panTrackProfileView(zoomed, 0, 40, 100, 100);
    const zoomedOut = zoomTrackProfileView(panned, geometry.routePoints, 0.5, 10);

    expect(zoomedOut.minAltitudeMeters).toBe(state.minAltitudeMeters);
    expect(zoomedOut.maxAltitudeMeters).toBe(state.maxAltitudeMeters);
  });
});
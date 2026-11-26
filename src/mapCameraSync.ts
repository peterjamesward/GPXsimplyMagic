import type { TrackProjection } from "./trackGeometry";

type Point3 = Readonly<{ x: number; y: number; z: number }>;

export type RouteCameraState = Readonly<{
  target: Point3;
  alpha: number;
  beta: number;
  radius: number;
  fov: number;
}>;

export type MapCameraView = Readonly<{
  center: readonly [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}>;

type ViewportSize = Readonly<{ width: number; height: number }>;

const metersPerDegree = 111_320;
const earthCircumferenceMeters = 40_075_016.68557849;
const mercatorTileSize = 512;
const maximumMercatorLatitude = 85.05112878;
const maximumMapZoom = 22;
const maximumMapPitch = 85;

const isValidProjection = (projection: TrackProjection): boolean =>
  Number.isFinite(projection.centerLatitude) &&
  Number.isFinite(projection.centerLongitude) &&
  Number.isFinite(projection.longitudeScale) &&
  projection.longitudeScale > 0 &&
  Number.isFinite(projection.sceneUnitsPerMeter) &&
  projection.sceneUnitsPerMeter > 0;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const normalizeBearing = (bearing: number): number => (bearing % 360 + 360) % 360;

export const getWrappedAngleDifference = (left: number, right: number): number =>
  ((left - right + 540) % 360) - 180;

const getMapLatitude = (latitude: number): number => clamp(latitude, -maximumMercatorLatitude, maximumMercatorLatitude);

const getLongitudeNear = (longitude: number, referenceLongitude: number): number =>
  longitude + 360 * Math.round((referenceLongitude - longitude) / 360);

export const getMapCameraView = (
  camera: RouteCameraState,
  viewport: ViewportSize,
  projection: TrackProjection,
): MapCameraView | null => {
  if (
    !isValidProjection(projection) ||
    viewport.height <= 0 ||
    camera.radius <= 0 ||
    camera.fov <= 0 ||
    camera.fov >= Math.PI ||
    !Number.isFinite(camera.alpha) ||
    !Number.isFinite(camera.beta)
  ) {
    return null;
  }

  const latitude = getMapLatitude(
    projection.centerLatitude + camera.target.z / (projection.sceneUnitsPerMeter * metersPerDegree),
  );
  const longitude = projection.centerLongitude +
    camera.target.x / (projection.sceneUnitsPerMeter * projection.longitudeScale * metersPerDegree);
  const metersPerPixel =
    (2 * camera.radius * Math.tan(camera.fov / 2)) / (viewport.height * projection.sceneUnitsPerMeter);
  const zoom = Math.log2(
    (Math.cos((latitude * Math.PI) / 180) * earthCircumferenceMeters) /
      (mercatorTileSize * metersPerPixel),
  );

  if (!Number.isFinite(longitude) || !Number.isFinite(zoom)) {
    return null;
  }

  return Object.freeze({
    center: Object.freeze([longitude, latitude] as const),
    zoom: clamp(zoom, -2, maximumMapZoom),
    bearing: normalizeBearing((Math.atan2(-Math.cos(camera.alpha), -Math.sin(camera.alpha)) * 180) / Math.PI),
    pitch: clamp((camera.beta * 180) / Math.PI, 0, maximumMapPitch),
  });
};

export const getRouteCameraState = (
  mapView: MapCameraView,
  viewport: ViewportSize,
  projection: TrackProjection,
  fov: number,
  targetY: number,
): RouteCameraState | null => {
  if (
    !isValidProjection(projection) ||
    viewport.height <= 0 ||
    fov <= 0 ||
    fov >= Math.PI
  ) {
    return null;
  }

  const latitude = getMapLatitude(mapView.center[1]);
  const longitude = getLongitudeNear(mapView.center[0], projection.centerLongitude);
  const metersPerPixel =
    (Math.cos((latitude * Math.PI) / 180) * earthCircumferenceMeters) /
    (mercatorTileSize * 2 ** clamp(mapView.zoom, -2, maximumMapZoom));
  const radius =
    (metersPerPixel * projection.sceneUnitsPerMeter * viewport.height) / (2 * Math.tan(fov / 2));
  const beta = (clamp(mapView.pitch, 0, maximumMapPitch) * Math.PI) / 180;

  if (!Number.isFinite(radius) || radius <= 0) {
    return null;
  }

  return Object.freeze({
    target: Object.freeze({
      x: (longitude - projection.centerLongitude) *
        projection.longitudeScale * metersPerDegree * projection.sceneUnitsPerMeter,
      y: targetY,
      z: (latitude - projection.centerLatitude) * metersPerDegree * projection.sceneUnitsPerMeter,
    }),
    alpha: (-mapView.bearing * Math.PI) / 180 - Math.PI / 2,
    beta,
    radius,
    fov,
  });
};
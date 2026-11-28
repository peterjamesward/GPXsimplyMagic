import type { TileCoverage, TerrainView } from "./terrainDem";

export type LidarBounds = Readonly<{ west: number; south: number; east: number; north: number }>;

const maximumPatchSideMeters = 2_000;
const patchCenterSnapMeters = 1_000;
const metersPerDegree = 111_320;

const tileYToLatitude = (tileY: number, zoom: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / 2 ** zoom))) * 180) / Math.PI;

const getCoverageBounds = (coverage: TileCoverage): LidarBounds => {
  const tileCount = 2 ** coverage.zoom;
  return Object.freeze({
    west: (coverage.minX / tileCount) * 360 - 180,
    south: tileYToLatitude(coverage.maxY + 1, coverage.zoom),
    east: ((coverage.maxX + 1) / tileCount) * 360 - 180,
    north: tileYToLatitude(coverage.minY, coverage.zoom),
  });
};

const cropExtentAround = (
  minimum: number,
  maximum: number,
  center: number,
  maximumSpan: number,
): readonly [number, number] => {
  const span = Math.min(maximum - minimum, maximumSpan);
  const start = Math.max(minimum, Math.min(maximum - span, center - span / 2));
  return [start, start + span];
};

export const getLidarPatchBounds = (coverage: TileCoverage, view?: TerrainView): LidarBounds => {
  const coverageBounds = getCoverageBounds(coverage);
  const latitudeSnap = patchCenterSnapMeters / metersPerDegree;
  const rawLatitude = view?.center[1] ?? (coverageBounds.south + coverageBounds.north) / 2;
  const snappedLatitude = Math.round(rawLatitude / latitudeSnap) * latitudeSnap;
  const longitudeMetersPerDegree = metersPerDegree * Math.max(0.01, Math.cos((snappedLatitude * Math.PI) / 180));
  const longitudeSnap = patchCenterSnapMeters / longitudeMetersPerDegree;
  const rawLongitude = view?.center[0] ?? (coverageBounds.west + coverageBounds.east) / 2;
  const snappedLongitude = Math.round(rawLongitude / longitudeSnap) * longitudeSnap;
  const latitudeSpan = maximumPatchSideMeters / metersPerDegree;
  const longitudeSpan = maximumPatchSideMeters / longitudeMetersPerDegree;
  const [west, east] = cropExtentAround(coverageBounds.west, coverageBounds.east, snappedLongitude, longitudeSpan);
  const [south, north] = cropExtentAround(coverageBounds.south, coverageBounds.north, snappedLatitude, latitudeSpan);
  return Object.freeze({ west, south, east, north });
};
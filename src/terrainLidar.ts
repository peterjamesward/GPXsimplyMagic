import type { TileCoverage, TerrainDemData, TerrainView } from "./terrainDem";
import { readRasterElevation } from "./rasterInterpolation";

const wcsEndpoint = "https://environment.data.gov.uk/geoservices/datasets/09ea3b37-df3a-4e8b-ac69-fb0842227b04/wcs";
const coverageId = "09ea3b37-df3a-4e8b-ac69-fb0842227b04__Lidar_Composite_Elevation_DTM_2m";
const geographicCrs = "http://www.opengis.net/def/crs/EPSG/0/4326";
const maximumGridDimension = 256;
const maximumPatchSideMeters = 2_000;
const patchCenterSnapMeters = 1_000;
const metersPerDegree = 111_320;
const lidarCoverageBounds = Object.freeze({ west: -7.104775741839742, south: 49.85060473351981, east: 2.0842821419111135, north: 55.87708724246775 });

export type LidarBounds = Readonly<{ west: number; south: number; east: number; north: number }>;
export type LidarWcsRequest = Readonly<{ url: string; bounds: LidarBounds; width: number; height: number }>;

const tileYToLatitude = (tileY: number, zoom: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / 2 ** zoom))) * 180) / Math.PI;

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

const getLidarBounds = (coverage: TileCoverage, view?: TerrainView): LidarBounds | null => {
  const tileCount = 2 ** coverage.zoom;
  const availableBounds = {
    west: Math.max(lidarCoverageBounds.west, (coverage.minX / tileCount) * 360 - 180),
    south: Math.max(lidarCoverageBounds.south, tileYToLatitude(coverage.maxY + 1, coverage.zoom)),
    east: Math.min(lidarCoverageBounds.east, ((coverage.maxX + 1) / tileCount) * 360 - 180),
    north: Math.min(lidarCoverageBounds.north, tileYToLatitude(coverage.minY, coverage.zoom)),
  };

  if (availableBounds.east <= availableBounds.west || availableBounds.north <= availableBounds.south) {
    return null;
  }

  if (
    view !== undefined &&
    (view.center[0] < lidarCoverageBounds.west ||
      view.center[0] > lidarCoverageBounds.east ||
      view.center[1] < lidarCoverageBounds.south ||
      view.center[1] > lidarCoverageBounds.north)
  ) {
    return null;
  }

  const viewLatitude = view?.center[1] ?? (availableBounds.south + availableBounds.north) / 2;
  const viewLongitude = view?.center[0] ?? (availableBounds.west + availableBounds.east) / 2;
  const latitudeSnap = patchCenterSnapMeters / metersPerDegree;
  const snappedLatitude = Math.round(viewLatitude / latitudeSnap) * latitudeSnap;
  const longitudeSnap = patchCenterSnapMeters / (metersPerDegree * Math.cos((snappedLatitude * Math.PI) / 180));
  const snappedLongitude = Math.round(viewLongitude / longitudeSnap) * longitudeSnap;
  const latitudeSpan = maximumPatchSideMeters / metersPerDegree;
  const southernLatitude = snappedLatitude - latitudeSpan / 2;
  const longitudeSpan = maximumPatchSideMeters / (metersPerDegree * Math.cos((southernLatitude * Math.PI) / 180));
  const [west, east] = cropExtentAround(availableBounds.west, availableBounds.east, snappedLongitude, longitudeSpan);
  const [south, north] = cropExtentAround(availableBounds.south, availableBounds.north, snappedLatitude, latitudeSpan);

  return Object.freeze({ west, south, east, north });
};

const getGridSize = (bounds: LidarBounds): Readonly<{ width: number; height: number }> => {
  const centerLatitude = (bounds.south + bounds.north) / 2;
  const groundWidth = (bounds.east - bounds.west) * metersPerDegree * Math.cos((centerLatitude * Math.PI) / 180);
  const groundHeight = (bounds.north - bounds.south) * metersPerDegree;
  const widthAtSourceResolution = Math.max(2, Math.ceil(groundWidth / 2));
  const heightAtSourceResolution = Math.max(2, Math.ceil(groundHeight / 2));
  const reduction = Math.max(1, widthAtSourceResolution / maximumGridDimension, heightAtSourceResolution / maximumGridDimension);

  return Object.freeze({
    width: Math.max(2, Math.ceil(widthAtSourceResolution / reduction)),
    height: Math.max(2, Math.ceil(heightAtSourceResolution / reduction)),
  });
};

export const createLidarWcsRequest = (coverage: TileCoverage, view?: TerrainView): LidarWcsRequest | null => {
  const bounds = getLidarBounds(coverage, view);
  if (bounds === null) {
    return null;
  }

  const { width, height } = getGridSize(bounds);
  const url = new URL(wcsEndpoint);
  url.searchParams.set("service", "WCS");
  url.searchParams.set("version", "2.0.1");
  url.searchParams.set("request", "GetCoverage");
  url.searchParams.set("coverageId", coverageId);
  url.searchParams.set("subsettingCrs", geographicCrs);
  url.searchParams.set("outputCrs", geographicCrs);
  url.searchParams.append("subset", `Lat(${bounds.south},${bounds.north})`);
  url.searchParams.append("subset", `Long(${bounds.west},${bounds.east})`);
  url.searchParams.append("scaleSize", `i(${width})`);
  url.searchParams.append("scaleSize", `j(${height})`);
  url.searchParams.set("format", "text/plain");

  return Object.freeze({ url: url.toString(), bounds, width, height });
};

const parseNumberTuple = (text: string, expression: RegExp): readonly number[] | null => {
  const match = text.match(expression);
  if (match === null) {
    return null;
  }
  const values = match.slice(1).map(Number);
  return values.every(Number.isFinite) ? Object.freeze(values) : null;
};

export const parseLidarTextGrid = (text: string, zoom: number): TerrainDemData | null => {
  const bounds = parseNumberTuple(
    text,
    /Grid bounds:\s*GeneralBounds\[\(\s*([^,]+),\s*([^)]+)\),\s*\(\s*([^,]+),\s*([^)]+)\)\]/,
  );
  const range = parseNumberTuple(text, /Grid range:\s*GridEnvelope2D\[(\d+)\.\.(\d+),\s*(\d+)\.\.(\d+)\]/);
  const band = text.match(/Band 0:\s*([\s\S]*)$/);
  if (bounds === null || range === null || band === null) {
    return null;
  }

  const [west, south, east, north] = bounds;
  const [minimumColumn, maximumColumn, minimumRow, maximumRow] = range;
  const width = maximumColumn - minimumColumn + 1;
  const height = maximumRow - minimumRow + 1;
  if (
    west >= east ||
    south >= north ||
    width < 1 ||
    height < 1 ||
    width > maximumGridDimension ||
    height > maximumGridDimension
  ) {
    return null;
  }

  const values = band[1].trim().split(/\s+/).map(Number);
  if (values.length !== width * height) {
    return null;
  }
  const elevations = Float32Array.from(values, (elevation) =>
    Number.isFinite(elevation) && Math.abs(elevation) < 1e20 ? elevation : Number.NaN);
  if (!elevations.some(Number.isFinite)) {
    return null;
  }

  return Object.freeze({
    zoom,
    source: "lidar",
    elevationAt: (latitude: number, longitude: number): number | null => {
      if (longitude < west || longitude > east || latitude < south || latitude > north) {
        return null;
      }
      const localX = ((longitude - west) / (east - west)) * width - 0.5;
      const localY = ((north - latitude) / (north - south)) * height - 0.5;
      return readRasterElevation(elevations, width, height, localX, localY);
    },
  });
};
export const loadLidarTerrain = async (
  coverage: TileCoverage,
  view?: TerrainView,
  signal?: AbortSignal,
): Promise<TerrainDemData | null> => {
  const request = createLidarWcsRequest(coverage, view);
  if (request === null) {
    return null;
  }

  try {
    const response = await fetch(request.url, signal === undefined ? undefined : { signal });
    if (!response.ok) {
      return null;
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 5_000_000) {
      return null;
    }
    const text = await response.text();
    if (text.length > 5_000_000) {
      return null;
    }
    return parseLidarTextGrid(text, coverage.zoom);
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return null;
  }
};
import type { TerrainDemData, TileCoverage, TerrainView } from "./terrainDem";
import { getLidarPatchBounds, type LidarBounds } from "./lidarBounds";
import { readRasterElevation } from "./rasterInterpolation";

const exportImageUrl = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
const mercatorEarthRadiusMeters = 6_378_137;
const maximumMercatorLatitude = 85.05112878;
const gridDimension = 256;
const maximumTiffBytes = 5_000_000;
const usgsCoverageRegions: readonly LidarBounds[] = Object.freeze([
  Object.freeze({ west: -125, south: 24, east: -66, north: 50 }),
  Object.freeze({ west: -180, south: 51, east: -129, north: 72 }),
  Object.freeze({ west: -161.5, south: 18.5, east: -154.5, north: 23 }),
  Object.freeze({ west: -68.5, south: 17.5, east: -64.5, north: 19.5 }),
  Object.freeze({ west: 144, south: 13, east: 146, north: 22 }),
  Object.freeze({ west: -171.5, south: -15, east: -168, north: -10 }),
]);

export type Usgs3depBounds = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
export type Usgs3depRequest = Readonly<{ url: string; bounds: Usgs3depBounds; width: number; height: number }>;

const longitudeToMercatorX = (longitude: number): number =>
  (longitude * Math.PI * mercatorEarthRadiusMeters) / 180;

const latitudeToMercatorY = (latitude: number): number => {
  const clampedLatitude = Math.max(-maximumMercatorLatitude, Math.min(maximumMercatorLatitude, latitude));
  const latitudeRadians = (clampedLatitude * Math.PI) / 180;
  return mercatorEarthRadiusMeters * Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2));
};

const projectGeographicBounds = (bounds: LidarBounds): Usgs3depBounds => Object.freeze({
  minX: longitudeToMercatorX(bounds.west),
  minY: latitudeToMercatorY(bounds.south),
  maxX: longitudeToMercatorX(bounds.east),
  maxY: latitudeToMercatorY(bounds.north),
});

export const isUsgs3depCoverage = (bounds: LidarBounds): boolean =>
  usgsCoverageRegions.some((region) =>
    bounds.west <= region.east && bounds.east >= region.west && bounds.south <= region.north && bounds.north >= region.south);

export const createUsgs3depRequest = (bounds: LidarBounds): Usgs3depRequest | null => {
  if (
    ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
    bounds.west >= bounds.east ||
    bounds.south >= bounds.north ||
    bounds.west < -180 ||
    bounds.east > 180 ||
    bounds.south < -maximumMercatorLatitude ||
    bounds.north > maximumMercatorLatitude
  ) {
    return null;
  }
  const projectedBounds = projectGeographicBounds(bounds);
  const url = new URL(exportImageUrl);
  url.searchParams.set("bbox", [projectedBounds.minX, projectedBounds.minY, projectedBounds.maxX, projectedBounds.maxY].join(","));
  url.searchParams.set("bboxSR", "3857");
  url.searchParams.set("imageSR", "3857");
  url.searchParams.set("size", `${gridDimension},${gridDimension}`);
  url.searchParams.set("format", "tiff");
  url.searchParams.set("pixelType", "F32");
  url.searchParams.set("f", "image");
  return Object.freeze({ url: url.toString(), bounds: projectedBounds, width: gridDimension, height: gridDimension });
};

export const createUsgs3depSampler = (
  sourceRaster: Float32Array,
  width: number,
  height: number,
  bounds: Usgs3depBounds,
  noData: number | null,
): ((latitude: number, longitude: number) => number | null) | null => {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    sourceRaster.length !== width * height ||
    ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) ||
    bounds.minX >= bounds.maxX ||
    bounds.minY >= bounds.maxY
  ) {
    return null;
  }
  const raster = new Float32Array(sourceRaster.length);
  let hasElevation = false;
  sourceRaster.forEach((value, index) => {
    if (Number.isFinite(value) && (noData === null || value !== noData) && Math.abs(value) < 100_000) {
      raster[index] = value;
      hasElevation = true;
    } else {
      raster[index] = Number.NaN;
    }
  });
  if (!hasElevation) {
    return null;
  }
  return (latitude: number, longitude: number): number | null => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > maximumMercatorLatitude) {
      return null;
    }
    const x = longitudeToMercatorX(longitude);
    const y = latitudeToMercatorY(latitude);
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
      return null;
    }
    const localX = ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width - 0.5;
    const localY = ((bounds.maxY - y) / (bounds.maxY - bounds.minY)) * height - 0.5;
    return readRasterElevation(raster, width, height, localX, localY);
  };
};

export const loadUsgs3depTerrain = async (
  coverage: TileCoverage,
  view?: TerrainView,
  signal?: AbortSignal,
): Promise<TerrainDemData | null> => {
  const geographicBounds = getLidarPatchBounds(coverage, view);
  if (!isUsgs3depCoverage(geographicBounds)) {
    return null;
  }
  const request = createUsgs3depRequest(geographicBounds);
  if (request === null) {
    return null;
  }
  try {
    const response = await fetch(request.url, signal === undefined ? undefined : { signal });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("image/tiff")) {
      return null;
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maximumTiffBytes) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > maximumTiffBytes) {
      return null;
    }
    const { fromArrayBuffer } = await import("geotiff");
    const tiff = await fromArrayBuffer(buffer, signal);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const imageBounds = image.getBoundingBox();
    const raster = await image.readRasters({ interleave: true, signal });
    if (!(raster instanceof Float32Array) || imageBounds.length < 4) {
      return null;
    }
    const bounds = Object.freeze({ minX: imageBounds[0], minY: imageBounds[1], maxX: imageBounds[2], maxY: imageBounds[3] });
    const elevationAt = createUsgs3depSampler(raster, width, height, bounds, image.getGDALNoData());
    if (elevationAt === null) {
      return null;
    }
    return Object.freeze({ zoom: coverage.zoom, source: "usgs-3dep", elevationAt });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return null;
  }
};
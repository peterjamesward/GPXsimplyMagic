import type { TerrainDemData, TileCoverage, TerrainView } from "./terrainDem";
import {
  getLidarProjection as getProjection,
  lidarBoundsIntersect as projectedBoundsIntersect,
  loadCopcGroundTerrain,
  projectLidarBounds as projectGeographicBounds,
  type ProjectedLidarBounds as ProjectedBounds,
} from "./lidarCopc";
import { getLidarPatchBounds, type LidarBounds as GeographicBounds } from "./lidarBounds";

const catalogUrl = "https://raw.githubusercontent.com/flai-ai/open-lidar-data/main/README.md";
const bucketUrl = "https://open-lidar-data.s3.eu-central-1.amazonaws.com";
const maximumCatalogBytes = 250_000;
const maximumIndexBytes = 12_000_000;
const maximumDatasetCount = 3;
const maximumCopcFileCount = 6;
type OpenLidarDataset = Readonly<{
  countryCode: string;
  countryName: string;
  epsg: number;
  copcPath: string;
  startDate: string;
  endDate: string;
  indexBaseName: string;
}>;
type OpenLidarTile = Readonly<{ fileName: string; bounds: ProjectedBounds }>;
type OpenLidarShapeRecord = Readonly<{ recordIndex: number; bounds: ProjectedBounds }>;
type DbfFilenameLayout = Readonly<{ headerLength: number; recordLength: number; recordCount: number; fileNameOffset: number; fileNameLength: number }>;
type OpenLidarSpatialIndex = Readonly<{ records: readonly OpenLidarShapeRecord[]; dbf: DbfFilenameLayout }>;
const countryBounds: Readonly<Record<string, GeographicBounds>> = Object.freeze({
  BE: { west: 2.4, south: 49.4, east: 6.5, north: 51.6 },
  DK: { west: 7.9, south: 54.4, east: 15.3, north: 57.9 },
  IE: { west: -10.7, south: 51.3, east: -5.3, north: 55.5 },
  EE: { west: 21.7, south: 57.4, east: 28.3, north: 59.7 },
  FI: { west: 19, south: 59.5, east: 31.6, north: 70.1 },
  FR: { west: -5.2, south: 41.3, east: 9.7, north: 51.2 },
  DE: { west: 5.8, south: 47.2, east: 15.1, north: 55.1 },
  LV: { west: 20.8, south: 55.6, east: 28.3, north: 58.1 },
  LU: { west: 5.7, south: 49.4, east: 6.6, north: 50.2 },
  NL: { west: 3.2, south: 50.7, east: 7.3, north: 53.7 },
  PL: { west: 14.1, south: 49, east: 24.2, north: 54.9 },
  SI: { west: 13.3, south: 45.4, east: 16.6, north: 46.9 },
  ES: { west: -9.5, south: 35.8, east: 4.4, north: 43.9 },
  CH: { west: 5.9, south: 45.8, east: 10.5, north: 47.9 },
  UK: { west: -8.7, south: 49.8, east: 1.8, north: 59.7 },
});

let catalogRequest: Promise<readonly OpenLidarDataset[]> | null = null;
const tileIndexRequests = new Map<string, Promise<readonly OpenLidarTile[]>>();
const spatialIndexRequests = new Map<string, Promise<OpenLidarSpatialIndex | null>>();

const intersects = (left: GeographicBounds, right: GeographicBounds): boolean =>
  left.west <= right.east && left.east >= right.west && left.south <= right.north && left.north >= right.south;

const cleanMarkdownCell = (value: string): string => value.replaceAll("\\_", "_").replaceAll("\\(", "(").replaceAll("\\)", ")").trim();

export const parseOpenLidarCatalog = (markdown: string): readonly OpenLidarDataset[] => {
  const datasets = markdown.split(/\r?\n/)
    .filter((line) => line.startsWith("|") && !line.includes(":---"))
    .map((line) => line.split("|").map(cleanMarkdownCell))
    .filter((cells) => cells.length >= 8 && /^\d+$/.test(cells[2]) && cells[3].startsWith("data/"))
    .map((cells): OpenLidarDataset | null => {
      const pathSegments = cells[3].split("/");
      const countryCode = pathSegments[1];
      const datasetDirectory = pathSegments.at(-2);
      const epsg = Number(cells[2]);
      if (
        countryCode === undefined ||
        !Object.hasOwn(countryBounds, countryCode) ||
        !Number.isInteger(epsg) ||
        epsg < 1_000 ||
        epsg > 99_999 ||
        pathSegments.length < 4 ||
        !pathSegments.every((segment) => segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment)) ||
        pathSegments.at(-1) !== "copc" ||
        datasetDirectory === undefined ||
        !/^\d{4}-\d{2}-\d{2}$/.test(cells[5])
      ) {
        return null;
      }

      return Object.freeze({
        countryCode,
        countryName: cells[1].replace(/\s*\([^)]*\)$/, ""),
        epsg,
        copcPath: cells[3],
        startDate: cells[4],
        endDate: cells[5],
        indexBaseName: datasetDirectory,
      });
    })
    .filter((dataset): dataset is OpenLidarDataset => dataset !== null);

  return Object.freeze(datasets);
};

export const getOpenLidarCandidateDatasets = (
  datasets: readonly OpenLidarDataset[],
  bounds: GeographicBounds,
): readonly OpenLidarDataset[] => {
  const candidateCountries = new Set(
    Object.entries(countryBounds)
      .filter(([, country]) => intersects(country, bounds))
      .map(([code]) => code),
  );
  const seenPaths = new Set<string>();
  return Object.freeze(datasets
    .filter((dataset) => candidateCountries.has(dataset.countryCode) && !seenPaths.has(dataset.copcPath) && seenPaths.add(dataset.copcPath))
    .sort((left, right) => right.endDate.localeCompare(left.endDate))
    .slice(0, maximumDatasetCount));
};

const loadLimitedBytes = async (url: string, maximumBytes: number, signal?: AbortSignal): Promise<Uint8Array | null> => {
  const response = await fetch(url, signal === undefined ? undefined : { signal });
  if (!response.ok) {
    return null;
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength <= maximumBytes ? bytes : null;
};

const loadCatalog = async (): Promise<readonly OpenLidarDataset[]> => {
  if (catalogRequest === null) {
    catalogRequest = (async () => {
      const bytes = await loadLimitedBytes(catalogUrl, maximumCatalogBytes);
      if (bytes === null) {
        throw new Error("Open LiDAR Data catalog is unavailable.");
      }
      return parseOpenLidarCatalog(new TextDecoder().decode(bytes));
    })().catch((error: unknown) => {
      catalogRequest = null;
      throw error;
    });
  }
  return catalogRequest;
};

const parseDbfRecords = (buffer: ArrayBufferLike): readonly Readonly<Record<string, string>>[] => {
  if (buffer.byteLength < 33) {
    return Object.freeze([]);
  }
  const view = new DataView(buffer);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  if (headerLength < 33 || recordLength < 2 || headerLength > buffer.byteLength) {
    return Object.freeze([]);
  }

  const decoder = new TextDecoder("utf-8");
  const fields: { name: string; offset: number; length: number }[] = [];
  let fieldOffset = 1;
  for (let descriptor = 32; descriptor + 32 <= headerLength && view.getUint8(descriptor) !== 0x0d; descriptor += 32) {
    const rawName = new Uint8Array(buffer, descriptor, 11);
    const terminator = rawName.indexOf(0);
    const name = decoder.decode(terminator < 0 ? rawName : rawName.subarray(0, terminator)).trim().toLowerCase();
    const length = view.getUint8(descriptor + 16);
    if (name.length > 0 && length > 0) {
      fields.push({ name, offset: fieldOffset, length });
      fieldOffset += length;
    }
  }

  if (fields.length === 0 || fieldOffset > recordLength) {
    return Object.freeze([]);
  }
  const rows: Readonly<Record<string, string>>[] = [];
  const boundedRecordCount = Math.min(recordCount, Math.floor((buffer.byteLength - headerLength) / recordLength));
  for (let row = 0; row < boundedRecordCount; row += 1) {
    const start = headerLength + row * recordLength;
    if (view.getUint8(start) === 0x2a) {
      rows.push(Object.freeze({}));
      continue;
    }
    const record: Record<string, string> = {};
    fields.forEach((field) => {
      const bytes = new Uint8Array(buffer, start + field.offset, field.length);
      record[field.name] = decoder.decode(bytes).replaceAll("\0", "").trim();
    });
    rows.push(Object.freeze(record));
  }
  return Object.freeze(rows);
};

const parseOpenLidarShapeRecords = (shapeBuffer: ArrayBufferLike): readonly OpenLidarShapeRecord[] => {
  if (shapeBuffer.byteLength < 100) {
    return Object.freeze([]);
  }
  const shapeView = new DataView(shapeBuffer);
  if (shapeView.getInt32(0, false) !== 9994 || shapeView.getInt32(28, true) !== 1000) {
    return Object.freeze([]);
  }
  const records: OpenLidarShapeRecord[] = [];
  let recordIndex = 0;
  for (let offset = 100; offset + 8 <= shapeBuffer.byteLength; ) {
    const contentBytes = shapeView.getInt32(offset + 4, false) * 2;
    const recordStart = offset + 8;
    if (contentBytes < 36 || recordStart + contentBytes > shapeBuffer.byteLength) {
      break;
    }
    const shapeType = shapeView.getInt32(recordStart, true);
    if ([5, 15, 25].includes(shapeType)) {
      const bounds = {
        minX: shapeView.getFloat64(recordStart + 4, true),
        minY: shapeView.getFloat64(recordStart + 12, true),
        maxX: shapeView.getFloat64(recordStart + 20, true),
        maxY: shapeView.getFloat64(recordStart + 28, true),
      };
      if (
        Object.values(bounds).every(Number.isFinite) &&
        bounds.minX <= bounds.maxX &&
        bounds.minY <= bounds.maxY
      ) {
        records.push(Object.freeze({ recordIndex, bounds: Object.freeze(bounds) }));
      }
    }
    recordIndex += 1;
    offset = recordStart + contentBytes;
  }
  return Object.freeze(records);
};

export const parseOpenLidarTileIndex = (shapeBuffer: ArrayBufferLike, dbfBuffer: ArrayBufferLike): readonly OpenLidarTile[] => {
  const records = parseDbfRecords(dbfBuffer);
  const fileFields = ["fname", "filename", "file_name", "file", "name"];
  return Object.freeze(parseOpenLidarShapeRecords(shapeBuffer).flatMap(({ recordIndex, bounds }) => {
    const attributes = records[recordIndex];
    const fileName = attributes === undefined
      ? undefined
      : fileFields.map((field) => attributes[field]).find((value) => value !== undefined && value.length > 0);
    return fileName === undefined ? [] : [Object.freeze({ fileName, bounds })];
  }));
};

const parseDbfFilenameLayout = (buffer: ArrayBufferLike): DbfFilenameLayout | null => {
  if (buffer.byteLength < 33) {
    return null;
  }
  const view = new DataView(buffer);
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  if (headerLength < 33 || headerLength > buffer.byteLength || recordLength < 2) {
    return null;
  }
  const decoder = new TextDecoder("utf-8");
  let fieldOffset = 1;
  let fileNameField: Readonly<{ offset: number; length: number }> | null = null;
  for (let descriptor = 32; descriptor + 32 <= headerLength && view.getUint8(descriptor) !== 0x0d; descriptor += 32) {
    const rawName = new Uint8Array(buffer, descriptor, 11);
    const terminator = rawName.indexOf(0);
    const name = decoder.decode(terminator < 0 ? rawName : rawName.subarray(0, terminator)).trim().toLowerCase();
    const length = view.getUint8(descriptor + 16);
    if (["fname", "filename", "file_name", "file", "name"].includes(name) && length > 0) {
      fileNameField = Object.freeze({ offset: fieldOffset, length });
    }
    fieldOffset += length;
  }
  if (fileNameField === null || fieldOffset > recordLength || recordLength > 4_096) {
    return null;
  }
  return Object.freeze({
    headerLength,
    recordLength,
    recordCount,
    fileNameOffset: fileNameField.offset,
    fileNameLength: fileNameField.length,
  });
};

const parseDbfFilename = (buffer: Uint8Array, layout: DbfFilenameLayout): string | null => {
  if (buffer.byteLength !== layout.recordLength || buffer[0] === 0x2a) {
    return null;
  }
  const value = new TextDecoder("utf-8")
    .decode(buffer.subarray(layout.fileNameOffset, layout.fileNameOffset + layout.fileNameLength))
    .replaceAll("\0", "")
    .trim();
  return value.length === 0 ? null : value;
};

const loadByteRange = async (
  url: string,
  start: number,
  end: number,
  signal: AbortSignal | undefined,
  allowShortResponse = false,
): Promise<Uint8Array | null> => {
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end - 1}` },
    signal,
  });
  if (response.status !== 206) {
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return (allowShortResponse ? bytes.byteLength >= 33 && bytes.byteLength <= end - start : bytes.byteLength === end - start)
    ? bytes
    : null;
};

const loadSpatialIndex = async (dataset: OpenLidarDataset, signal?: AbortSignal): Promise<OpenLidarSpatialIndex | null> => {
  const cached = spatialIndexRequests.get(dataset.copcPath);
  if (cached !== undefined) {
    return cached;
  }
  const encodedDatasetPath = dataset.copcPath.split("/").map(encodeURIComponent).join("/");
  const indexPrefix = `${bucketUrl}/${encodedDatasetPath.replace(/\/copc$/, "")}/shp/files_bbox_${encodeURIComponent(dataset.indexBaseName)}`;
  const request = Promise.all([
    loadLimitedBytes(`${indexPrefix}.shp`, maximumIndexBytes, signal),
    loadByteRange(`${indexPrefix}.dbf`, 0, 65_536, signal, true),
  ]).then(([shape, dbfHeader]) => {
    if (shape === null || dbfHeader === null) {
      return null;
    }
    const dbf = parseDbfFilenameLayout(dbfHeader.buffer);
    if (dbf === null) {
      return null;
    }
    return Object.freeze({ records: parseOpenLidarShapeRecords(shape.buffer), dbf });
  }).catch((error: unknown) => {
    spatialIndexRequests.delete(dataset.copcPath);
    if (signal?.aborted) {
      throw error;
    }
    return null;
  });
  spatialIndexRequests.set(dataset.copcPath, request);
  if (spatialIndexRequests.size > 2) {
    const oldestKey = spatialIndexRequests.keys().next().value;
    if (oldestKey !== undefined) {
      spatialIndexRequests.delete(oldestKey);
    }
  }
  return request;
};

export const loadOpenLidarTileIndex = async (
  dataset: OpenLidarDataset,
  queryBounds: ProjectedBounds,
  signal?: AbortSignal,
): Promise<readonly OpenLidarTile[]> => {
  const key = `${dataset.copcPath}:${queryBounds.minX}:${queryBounds.minY}:${queryBounds.maxX}:${queryBounds.maxY}`;
  const cached = tileIndexRequests.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const encodedDatasetPath = dataset.copcPath.split("/").map(encodeURIComponent).join("/");
  const indexPrefix = `${bucketUrl}/${encodedDatasetPath.replace(/\/copc$/, "")}/shp/files_bbox_${encodeURIComponent(dataset.indexBaseName)}`;
  const request = loadSpatialIndex(dataset, signal).then(async (spatialIndex) => {
    if (spatialIndex === null) {
      return Object.freeze([]);
    }
    const { records, dbf: layout } = spatialIndex;
    const centerX = (queryBounds.minX + queryBounds.maxX) / 2;
    const centerY = (queryBounds.minY + queryBounds.maxY) / 2;
    const candidates = records
      .filter(({ recordIndex, bounds }) => recordIndex < layout.recordCount && projectedBoundsIntersect(bounds, queryBounds))
      .sort((left, right) => {
        const distance = (bounds: ProjectedBounds): number =>
          Math.hypot(Math.max(bounds.minX - centerX, 0, centerX - bounds.maxX), Math.max(bounds.minY - centerY, 0, centerY - bounds.maxY));
        return distance(left.bounds) - distance(right.bounds);
      })
      .slice(0, maximumCopcFileCount);
    const dbfUrl = `${indexPrefix}.dbf`;
    const matchingTiles = await Promise.all(candidates.map(async ({ recordIndex, bounds }) => {
      const start = layout.headerLength + recordIndex * layout.recordLength;
      const bytes = await loadByteRange(dbfUrl, start, start + layout.recordLength, signal);
      const fileName = bytes === null ? null : parseDbfFilename(bytes, layout);
      return fileName === null ? null : Object.freeze({ fileName, bounds });
    }));
    return Object.freeze(matchingTiles.filter((tile): tile is OpenLidarTile => tile !== null));
  }).catch((error: unknown) => {
    tileIndexRequests.delete(key);
    if (signal?.aborted) {
      throw error;
    }
    return Object.freeze([]);
  });
  tileIndexRequests.set(key, request);
  if (tileIndexRequests.size > 4) {
    const oldestKey = tileIndexRequests.keys().next().value;
    if (oldestKey !== undefined) {
      tileIndexRequests.delete(oldestKey);
    }
  }
  return request;
};

const getCopcUrl = (dataset: OpenLidarDataset, fileName: string): string | null => {
  const normalized = fileName.replaceAll("\\", "/");
  const leafName = normalized.split("/").at(-1);
  if (leafName === undefined || !/^[\w.\-]+\.copc\.laz$/i.test(leafName)) {
    return null;
  }
  const encodedDatasetPath = dataset.copcPath.split("/").map(encodeURIComponent).join("/");
  return `${bucketUrl}/${encodedDatasetPath}/${encodeURIComponent(leafName)}`;
};

export const loadOpenLidarTerrain = async (
  coverage: TileCoverage,
  view?: TerrainView,
  signal?: AbortSignal,
): Promise<TerrainDemData | null> => {
  const geographicBounds = getLidarPatchBounds(coverage, view);
  try {
    const catalog = await loadCatalog();
    const datasets = getOpenLidarCandidateDatasets(catalog, geographicBounds);
    for (const dataset of datasets) {
      if (signal?.aborted) {
        throw new DOMException("LiDAR request aborted", "AbortError");
      }
      const projection = await getProjection(dataset.epsg);
      if (projection === null) {
        continue;
      }
      const projectedBounds = projectGeographicBounds(geographicBounds, projection);
      if (projectedBounds === null) {
        continue;
      }
      const tileIndex = await loadOpenLidarTileIndex(dataset, projectedBounds, signal);
      const tileUrls = tileIndex
        .filter((tile) => projectedBoundsIntersect(tile.bounds, projectedBounds))
        .map((tile) => getCopcUrl(dataset, tile.fileName))
        .filter((url): url is string => url !== null)
        .slice(0, maximumCopcFileCount);
      if (tileUrls.length === 0) {
        continue;
      }
      const terrain = await loadCopcGroundTerrain(
        tileUrls.map((url) => ({ url, epsg: dataset.epsg })),
        geographicBounds,
        coverage.zoom,
        "open-lidar-data",
        `${dataset.countryName} · ${dataset.indexBaseName}`,
        signal,
      );
      if (terrain !== null) {
        return terrain;
      }
    }
    return null;
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return null;
  }
};
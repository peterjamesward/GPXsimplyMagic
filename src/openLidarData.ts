import type { TerrainDemData, TileCoverage, TerrainView } from "./terrainDem";
import { readSparseRasterElevation } from "./rasterInterpolation";

const catalogUrl = "https://raw.githubusercontent.com/flai-ai/open-lidar-data/main/README.md";
const bucketUrl = "https://open-lidar-data.s3.eu-central-1.amazonaws.com";
const maximumCatalogBytes = 250_000;
const maximumIndexBytes = 12_000_000;
const maximumDatasetCount = 3;
const maximumCopcFileCount = 6;
const maximumCopcChunkBytes = 12_000_000;
const maximumCopcPointsPerChunk = 300_000;
const maximumCopcPointsPerPatch = 600_000;
const maximumCopcBytesPerPatch = 24_000_000;
const maximumSparseInterpolationDistanceCells = 3;
const maximumPatchSideMeters = 2_000;
const patchCenterSnapMeters = 1_000;
const metersPerDegree = 111_320;
const rasterSize = 129;

type GeographicBounds = Readonly<{ west: number; south: number; east: number; north: number }>;
type ProjectedBounds = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
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
type CoordinateProjection = Readonly<{
  forward: (longitude: number, latitude: number) => readonly [number, number];
  inverse: (x: number, y: number) => readonly [number, number];
}>;

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
const projectionRequests = new Map<number, Promise<CoordinateProjection | null>>();

const intersects = (left: GeographicBounds, right: GeographicBounds): boolean =>
  left.west <= right.east && left.east >= right.west && left.south <= right.north && left.north >= right.south;

const coverageToGeographicBounds = (coverage: TileCoverage): GeographicBounds => {
  const tileCount = 2 ** coverage.zoom;
  const latitudeAtTile = (y: number): number =>
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * y / tileCount))) * 180) / Math.PI;
  return Object.freeze({
    west: (coverage.minX / tileCount) * 360 - 180,
    east: ((coverage.maxX + 1) / tileCount) * 360 - 180,
    north: latitudeAtTile(coverage.minY),
    south: latitudeAtTile(coverage.maxY + 1),
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

export const getOpenLidarBounds = (coverage: TileCoverage, view?: TerrainView): GeographicBounds => {
  const coverageBounds = coverageToGeographicBounds(coverage);
  const latitudeSnap = patchCenterSnapMeters / metersPerDegree;
  const rawLatitude = view?.center[1] ?? (coverageBounds.south + coverageBounds.north) / 2;
  const snappedLatitude = Math.round(rawLatitude / latitudeSnap) * latitudeSnap;
  const longitudeSnap = patchCenterSnapMeters / (metersPerDegree * Math.cos((snappedLatitude * Math.PI) / 180));
  const rawLongitude = view?.center[0] ?? (coverageBounds.west + coverageBounds.east) / 2;
  const snappedLongitude = Math.round(rawLongitude / longitudeSnap) * longitudeSnap;
  const latitudeSpan = maximumPatchSideMeters / metersPerDegree;
  const longitudeSpan = maximumPatchSideMeters / (metersPerDegree * Math.cos((snappedLatitude * Math.PI) / 180));
  const [west, east] = cropExtentAround(coverageBounds.west, coverageBounds.east, snappedLongitude, longitudeSpan);
  const [south, north] = cropExtentAround(coverageBounds.south, coverageBounds.north, snappedLatitude, latitudeSpan);
  return Object.freeze({ west, south, east, north });
};

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

const getProjection = async (epsg: number): Promise<CoordinateProjection | null> => {
  const cached = projectionRequests.get(epsg);
  if (cached !== undefined) {
    return cached;
  }
  const request = (async (): Promise<CoordinateProjection | null> => {
    const { default: proj4 } = await import("proj4");
    if (epsg === 4326) {
      return Object.freeze({ forward: (longitude, latitude) => [longitude, latitude], inverse: (x, y) => [x, y] });
    }
    const response = await fetch(`https://epsg.io/${epsg}.proj4`);
    if (!response.ok) {
      return null;
    }
    const definition = (await response.text()).trim();
    if (definition.length === 0 || definition.length > 2_000 || !definition.includes("+proj")) {
      return null;
    }
    const crs = `EPSG:${epsg}`;
    proj4.defs(crs, definition);
    return Object.freeze({
      forward: (longitude, latitude) => {
        const [x, y] = proj4("EPSG:4326", crs, [longitude, latitude]);
        return [x, y];
      },
      inverse: (x, y) => {
        const [longitude, latitude] = proj4(crs, "EPSG:4326", [x, y]);
        return [longitude, latitude];
      },
    });
  })().catch(() => null);
  projectionRequests.set(epsg, request);
  if (projectionRequests.size > 32) {
    const oldestKey = projectionRequests.keys().next().value;
    if (oldestKey !== undefined) {
      projectionRequests.delete(oldestKey);
    }
  }
  return request;
};

const projectGeographicBounds = (bounds: GeographicBounds, projection: CoordinateProjection): ProjectedBounds | null => {
  try {
    const points = [
      projection.forward(bounds.west, bounds.south),
      projection.forward(bounds.west, bounds.north),
      projection.forward(bounds.east, bounds.south),
      projection.forward(bounds.east, bounds.north),
    ];
    const coordinates = points.flat();
    if (!coordinates.every(Number.isFinite)) {
      return null;
    }
    return Object.freeze({
      minX: Math.min(...points.map(([x]) => x)),
      minY: Math.min(...points.map(([, y]) => y)),
      maxX: Math.max(...points.map(([x]) => x)),
      maxY: Math.max(...points.map(([, y]) => y)),
    });
  } catch {
    return null;
  }
};

const projectedBoundsIntersect = (left: ProjectedBounds, right: ProjectedBounds): boolean =>
  left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;

const getCopcUrl = (dataset: OpenLidarDataset, fileName: string): string | null => {
  const normalized = fileName.replaceAll("\\", "/");
  const leafName = normalized.split("/").at(-1);
  if (leafName === undefined || !/^[\w.\-]+\.copc\.laz$/i.test(leafName)) {
    return null;
  }
  const encodedDatasetPath = dataset.copcPath.split("/").map(encodeURIComponent).join("/");
  return `${bucketUrl}/${encodedDatasetPath}/${encodeURIComponent(leafName)}`;
};

const getCopcNodeBounds = (cube: readonly number[], key: string): ProjectedBounds | null => {
  const [depth, x, y] = key.split("-").map(Number);
  if (
    depth === undefined ||
    x === undefined ||
    y === undefined ||
    !Number.isInteger(depth) ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    cube.length < 6
  ) {
    return null;
  }
  const divisions = 2 ** depth;
  return Object.freeze({
    minX: cube[0] + ((cube[3] - cube[0]) * x) / divisions,
    minY: cube[1] + ((cube[4] - cube[1]) * y) / divisions,
    maxX: cube[0] + ((cube[3] - cube[0]) * (x + 1)) / divisions,
    maxY: cube[1] + ((cube[4] - cube[1]) * (y + 1)) / divisions,
  });
};

const loadGroundPointsFromCopc = async (
  fileUrl: string,
  bounds: GeographicBounds,
  projectedBounds: ProjectedBounds,
  projection: CoordinateProjection,
  totals: Float64Array,
  counts: Uint32Array,
  pointBudget: number,
  byteBudget: number,
  signal?: AbortSignal,
): Promise<Readonly<{ pointCount: number; byteCount: number }>> => {
  const { Copc } = await import("copc");
  const getRange = async (begin: number, end: number): Promise<Uint8Array> => {
    if (signal?.aborted) {
      throw new DOMException("LiDAR request aborted", "AbortError");
    }
    const response = await fetch(fileUrl, {
      headers: { Range: `bytes=${begin}-${end - 1}` },
      signal,
    });
    if (response.status !== 206) {
      throw new Error("The COPC host did not honor the bounded byte-range request.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== end - begin) {
      throw new Error("The COPC host returned an invalid byte range.");
    }
    return bytes;
  };

  const copc = await Copc.create(getRange);
  const subtree = await Copc.loadHierarchyPage(getRange, copc.info.rootHierarchyPage);
  const root = subtree.nodes["0-0-0-0"];
  if (copc.header.min[2] > copc.header.max[2]) {
    return Object.freeze({ pointCount: 0, byteCount: 0 });
  }
  const intersectingNodes = Object.entries(subtree.nodes).flatMap(([key, node]) => {
    const nodeBounds = getCopcNodeBounds(copc.info.cube, key);
    return node !== undefined &&
      Number(key.split("-")[0]) === 1 &&
      nodeBounds !== null &&
      projectedBoundsIntersect(nodeBounds, projectedBounds)
      ? [node]
      : [];
  });
  const nodes = intersectingNodes.length > 0
    ? intersectingNodes
    : root === undefined ? [] : [root];
  let pointCount = 0;
  let byteCount = 0;
  for (const node of nodes) {
    if (
      node.pointCount <= 0 ||
      node.pointCount > maximumCopcPointsPerChunk ||
      node.pointDataLength > maximumCopcChunkBytes ||
      pointCount + node.pointCount > pointBudget ||
      byteCount + node.pointDataLength > byteBudget
    ) {
      continue;
    }
    const view = await Copc.loadPointDataView(getRange, copc, node, { include: ["X", "Y", "Z", "Classification"] });
    pointCount += view.pointCount;
    byteCount += node.pointDataLength;
    if (view.dimensions.Classification === undefined) {
      continue;
    }
    const getX = view.getter("X");
    const getY = view.getter("Y");
    const getZ = view.getter("Z");
    const getClassification = view.getter("Classification");
    for (let index = 0; index < view.pointCount; index += 1) {
      if (getClassification(index) !== 2) {
        continue;
      }
      const x = getX(index);
      const y = getY(index);
      if (x < projectedBounds.minX || x > projectedBounds.maxX || y < projectedBounds.minY || y > projectedBounds.maxY) {
        continue;
      }
      try {
        const [longitude, latitude] = projection.inverse(x, y);
        const elevation = getZ(index);
        if (
          !Number.isFinite(longitude) ||
          !Number.isFinite(latitude) ||
          !Number.isFinite(elevation) ||
          longitude < bounds.west ||
          longitude > bounds.east ||
          latitude < bounds.south ||
          latitude > bounds.north
        ) {
          continue;
        }
        const column = Math.min(rasterSize - 1, Math.floor(((longitude - bounds.west) / (bounds.east - bounds.west)) * rasterSize));
        const row = Math.min(rasterSize - 1, Math.floor(((bounds.north - latitude) / (bounds.north - bounds.south)) * rasterSize));
        const rasterIndex = row * rasterSize + column;
        totals[rasterIndex] += elevation;
        counts[rasterIndex] += 1;
      } catch {
        continue;
      }
    }
  }
  return Object.freeze({ pointCount, byteCount });
};

export const loadOpenLidarTerrain = async (
  coverage: TileCoverage,
  view?: TerrainView,
  signal?: AbortSignal,
): Promise<TerrainDemData | null> => {
  const geographicBounds = getOpenLidarBounds(coverage, view);
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

      const totals = new Float64Array(rasterSize * rasterSize);
      const counts = new Uint32Array(rasterSize * rasterSize);
      let remainingPointBudget = maximumCopcPointsPerPatch;
      let remainingByteBudget = maximumCopcBytesPerPatch;
      for (const tileUrl of tileUrls) {
        if (remainingPointBudget <= 0 || remainingByteBudget <= 0) {
          break;
        }
        try {
          const used = await loadGroundPointsFromCopc(
            tileUrl,
            geographicBounds,
            projectedBounds,
            projection,
            totals,
            counts,
            remainingPointBudget,
            remainingByteBudget,
            signal,
          );
          remainingPointBudget -= used.pointCount;
          remainingByteBudget -= used.byteCount;
        } catch (error) {
          if (signal?.aborted) {
            throw error;
          }
        }
      }
      if (counts.every((count) => count === 0)) {
        continue;
      }

      const elevations = new Float32Array(totals.length);
      elevations.fill(Number.NaN);
      counts.forEach((count, index) => {
        if (count > 0) {
          elevations[index] = totals[index] / count;
        }
      });
      return Object.freeze({
        zoom: coverage.zoom,
        source: "open-lidar-data",
        sourceName: `${dataset.countryName} · ${dataset.indexBaseName}`,
        elevationAt: (latitude: number, longitude: number): number | null => {
          if (
            longitude < geographicBounds.west ||
            longitude > geographicBounds.east ||
            latitude < geographicBounds.south ||
            latitude > geographicBounds.north
          ) {
            return null;
          }
          const localX = ((longitude - geographicBounds.west) / (geographicBounds.east - geographicBounds.west)) * (rasterSize - 1);
          const localY = ((geographicBounds.north - latitude) / (geographicBounds.north - geographicBounds.south)) * (rasterSize - 1);
          return readSparseRasterElevation(
            elevations,
            rasterSize,
            rasterSize,
            localX,
            localY,
            maximumSparseInterpolationDistanceCells,
          );
        },
      });
    }
    return null;
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return null;
  }
};
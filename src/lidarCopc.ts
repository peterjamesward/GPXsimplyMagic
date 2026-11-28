import type { TerrainDemData, TerrainElevationSource } from "./terrainDem";
import { readSparseRasterElevation } from "./rasterInterpolation";
import type { LidarBounds } from "./lidarBounds";

export type ProjectedLidarBounds = Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
export type LidarProjection = Readonly<{
  forward: (longitude: number, latitude: number) => readonly [number, number];
  inverse: (x: number, y: number) => readonly [number, number];
}>;
export type LidarCopcAsset = Readonly<{ url: string; epsg: number }>;

const maximumCopcFileCount = 6;
const maximumCopcChunkBytes = 12_000_000;
const maximumCopcPointsPerChunk = 300_000;
const maximumCopcPointsPerPatch = 600_000;
const maximumCopcBytesPerPatch = 24_000_000;
const maximumSparseInterpolationDistanceCells = 3;
const rasterSize = 129;

const projectionRequests = new Map<number, Promise<LidarProjection | null>>();

export const getLidarProjection = async (epsg: number): Promise<LidarProjection | null> => {
  const cached = projectionRequests.get(epsg);
  if (cached !== undefined) {
    return cached;
  }
  const request = (async (): Promise<LidarProjection | null> => {
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

export const projectLidarBounds = (bounds: LidarBounds, projection: LidarProjection): ProjectedLidarBounds | null => {
  try {
    const points = [
      projection.forward(bounds.west, bounds.south),
      projection.forward(bounds.west, bounds.north),
      projection.forward(bounds.east, bounds.south),
      projection.forward(bounds.east, bounds.north),
    ];
    if (!points.flat().every(Number.isFinite)) {
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

export const lidarBoundsIntersect = (left: ProjectedLidarBounds, right: ProjectedLidarBounds): boolean =>
  left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;

const getCopcNodeBounds = (cube: readonly number[], key: string): ProjectedLidarBounds | null => {
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
  bounds: LidarBounds,
  projectedBounds: ProjectedLidarBounds,
  projection: LidarProjection,
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
      lidarBoundsIntersect(nodeBounds, projectedBounds)
      ? [node]
      : [];
  });
  const nodes = intersectingNodes.length > 0 ? intersectingNodes : root === undefined ? [] : [root];
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

export const loadCopcGroundTerrain = async (
  assets: readonly LidarCopcAsset[],
  bounds: LidarBounds,
  zoom: number,
  source: Exclude<TerrainElevationSource, "terrarium">,
  sourceName: string,
  signal?: AbortSignal,
): Promise<TerrainDemData | null> => {
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) {
    return null;
  }
  const totals = new Float64Array(rasterSize * rasterSize);
  const counts = new Uint32Array(rasterSize * rasterSize);
  let remainingPointBudget = maximumCopcPointsPerPatch;
  let remainingByteBudget = maximumCopcBytesPerPatch;
  for (const asset of assets.slice(0, maximumCopcFileCount)) {
    if (signal?.aborted) {
      throw new DOMException("LiDAR request aborted", "AbortError");
    }
    if (remainingPointBudget <= 0 || remainingByteBudget <= 0) {
      break;
    }
    const projection = await getLidarProjection(asset.epsg);
    const projectedBounds = projection === null ? null : projectLidarBounds(bounds, projection);
    if (projection === null || projectedBounds === null) {
      continue;
    }
    try {
      const used = await loadGroundPointsFromCopc(
        asset.url,
        bounds,
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
    return null;
  }

  const elevations = new Float32Array(totals.length);
  elevations.fill(Number.NaN);
  counts.forEach((count, index) => {
    if (count > 0) {
      elevations[index] = totals[index] / count;
    }
  });
  return Object.freeze({
    zoom,
    source,
    sourceName,
    elevationAt: (latitude: number, longitude: number): number | null => {
      if (
        longitude < bounds.west ||
        longitude > bounds.east ||
        latitude < bounds.south ||
        latitude > bounds.north
      ) {
        return null;
      }
      const localX = ((longitude - bounds.west) / (bounds.east - bounds.west)) * (rasterSize - 1);
      const localY = ((bounds.north - latitude) / (bounds.north - bounds.south)) * (rasterSize - 1);
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
};

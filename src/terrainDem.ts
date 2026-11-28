import type { TrackMeshData } from "./trackGeometry";
import { getTerrainAreaBounds, type TerrainElevationSampler } from "./terrainGeometry";
import { readRasterElevation } from "./rasterInterpolation";
import { createLidarWcsRequest, loadLidarTerrain } from "./terrainLidar";

const tileSize = 256;
const terrainTileUrl = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
const maximumTileCount = 64;
const maximumTerrainZoom = 15;
const maximumTerrainElevationLayers = 4;
const maximumLatitude = 85.05112878;

type TileCoordinate = Readonly<{ x: number; y: number }>;
type TileData = Readonly<{ coordinate: TileCoordinate; pixels: Uint8ClampedArray }>;
export type TileCoverage = Readonly<{ zoom: number; minX: number; maxX: number; minY: number; maxY: number }>;
export type TerrainElevationSource = "lidar" | "terrarium";
type TerrainElevationLayer = Readonly<{
  zoom: number;
  source?: TerrainElevationSource;
  elevationAt: TerrainElevationSampler;
}>;
export type TerrainDemData = Readonly<{
  zoom: number;
  source?: TerrainElevationSource;
  elevationAt: TerrainElevationSampler;
  layers?: readonly TerrainElevationLayer[];
}>;
export type TerrainView = Readonly<{
  center: readonly [number, number];
  zoom: number;
  width: number;
  height: number;
  pitch: number;
}>;

export const retainBestTerrainElevation = (
  current: TerrainDemData | null,
  candidate: TerrainDemData,
): TerrainDemData => {
  if (current === null) {
    return candidate;
  }

  const currentLayers = current.layers ?? [current];
  const candidateLayers = (candidate.layers ?? [candidate]).filter((layer) => !currentLayers.includes(layer));
  if (candidateLayers.length === 0) {
    return current;
  }

  const orderedLayers = [...candidateLayers, ...currentLayers]
    .sort((left, right) => Number(right.source === "lidar") - Number(left.source === "lidar") || right.zoom - left.zoom);
  const lidarLayers = orderedLayers.filter((layer) => layer.source === "lidar");
  const terrariumFallback = orderedLayers.find((layer) => layer.source !== "lidar");
  const layers = lidarLayers.length > 0 && terrariumFallback !== undefined
    ? [...lidarLayers.slice(0, maximumTerrainElevationLayers - 1), terrariumFallback]
    : orderedLayers.slice(0, maximumTerrainElevationLayers);
  const frozenLayers = Object.freeze(layers);
  return Object.freeze({
    zoom: Math.max(current.zoom, candidate.zoom),
    layers: frozenLayers,
    elevationAt: (latitude: number, longitude: number): number | null => {
      for (const layer of frozenLayers) {
        const elevation = layer.elevationAt(latitude, longitude);
        if (elevation !== null) {
          return elevation;
        }
      }
      return null;
    },
  });
};

export const getTerrainElevationSources = (terrain: TerrainDemData): readonly TerrainElevationSource[] => {
  const layers = terrain.layers ?? [terrain];
  return Object.freeze(Array.from(new Set(layers.map((layer) => layer.source ?? "terrarium"))));
};

export const getTerrainElevationSourceLabel = (terrain: TerrainDemData): string => {
  const sources = getTerrainElevationSources(terrain);
  if (sources.includes("lidar")) {
    return sources.includes("terrarium") ? "LiDAR · Terrarium fallback" : "Environment Agency LiDAR";
  }
  return sources.includes("terrarium") ? "Terrarium" : "GPX elevations";
};

export const getTerrainDemZoom = (mapZoom: number): number | null => {
  if (!Number.isFinite(mapZoom)) {
    return null;
  }

  return Math.max(0, Math.min(maximumTerrainZoom, Math.floor(mapZoom)));
};

export const decodeTerrariumElevation = (red: number, green: number, blue: number): number =>
  red * 256 + green + blue / 256 - 32768;

const toGeographicPoint = (x: number, z: number, geometry: TrackMeshData): Readonly<{ latitude: number; longitude: number }> => {
  const { projection } = geometry;
  const longitudeScale = Math.sign(projection.longitudeScale || -1) * Math.max(Math.abs(projection.longitudeScale), 0.00001);
  return {
    latitude: projection.centerLatitude + z / (projection.sceneUnitsPerMeter * 111_320),
    longitude: projection.centerLongitude + x / (projection.sceneUnitsPerMeter * longitudeScale * 111_320),
  };
};

const toWorldPixel = (latitude: number, longitude: number, zoom: number): Readonly<{ x: number; y: number }> => {
  const latitudeRadians = (Math.max(-maximumLatitude, Math.min(maximumLatitude, latitude)) * Math.PI) / 180;
  const worldSize = tileSize * 2 ** zoom;
  return {
    x: ((longitude + 180) / 360) * worldSize,
    y: ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * worldSize,
  };
};

export const getTerrainTileCoverage = (
  geometry: TrackMeshData,
  requestedZoom: number,
  view?: TerrainView,
): TileCoverage => {
  const maximumZoom = getTerrainDemZoom(requestedZoom);
  if (maximumZoom === null) {
    throw new Error("A finite terrain zoom level is required.");
  }
  if (
    view !== undefined &&
    (![view.center[0], view.center[1], view.zoom, view.width, view.height, view.pitch].every(Number.isFinite) ||
      view.width <= 0 ||
      view.height <= 0)
  ) {
    throw new Error("Terrain viewport bounds must be finite and non-empty.");
  }

  const bounds = getTerrainAreaBounds(geometry);
  const routeCorners = [
    toGeographicPoint(bounds.minX, bounds.minZ, geometry),
    toGeographicPoint(bounds.minX, bounds.maxZ, geometry),
    toGeographicPoint(bounds.maxX, bounds.minZ, geometry),
    toGeographicPoint(bounds.maxX, bounds.maxZ, geometry),
  ];

  for (let zoom = maximumZoom; zoom >= 0; zoom -= 1) {
    const worldSize = tileSize * 2 ** zoom;
    const viewBounds = view === undefined
      ? null
      : (() => {
          const center = toWorldPixel(view.center[1], view.center[0], zoom);
          const viewportScale = 2 ** (zoom - view.zoom);
          const pitchRadians = (Math.max(0, Math.min(85, view.pitch)) * Math.PI) / 180;
          const pitchScale = 1 / Math.max(0.35, Math.cos(pitchRadians));
          const radius = (Math.hypot(view.width, view.height) / 2) * viewportScale * pitchScale;
          return radius * 2 >= worldSize
            ? Object.freeze({ minX: 0, maxX: 2 ** zoom - 1, minY: 0, maxY: 2 ** zoom - 1 })
            : Object.freeze({
                minX: Math.floor((center.x - radius) / tileSize),
                maxX: Math.floor((center.x + radius) / tileSize),
                minY: Math.max(0, Math.floor((center.y - radius) / tileSize)),
                maxY: Math.min(2 ** zoom - 1, Math.floor((center.y + radius) / tileSize)),
              });
        })();
    const tilePoints = viewBounds === null
      ? routeCorners.map((corner) => {
          const pixel = toWorldPixel(corner.latitude, corner.longitude, zoom);
          return {
            x: Math.floor(pixel.x / tileSize),
            y: Math.max(0, Math.min(2 ** zoom - 1, Math.floor(pixel.y / tileSize))),
          };
        })
      : null;
    const minX = viewBounds?.minX ?? Math.min(...tilePoints!.map((point) => point.x));
    const maxX = viewBounds?.maxX ?? Math.max(...tilePoints!.map((point) => point.x));
    const minY = viewBounds?.minY ?? Math.min(...tilePoints!.map((point) => point.y));
    const maxY = viewBounds?.maxY ?? Math.max(...tilePoints!.map((point) => point.y));

    if ((maxX - minX + 1) * (maxY - minY + 1) <= maximumTileCount) {
      return Object.freeze({ zoom, minX, maxX, minY, maxY });
    }
  }

  throw new Error("This route covers too much area to build a local terrain view.");
};

const loadTilePixels = async (coordinate: TileCoordinate, zoom: number, signal?: AbortSignal): Promise<TileData | null> => {
  const worldTileCount = 2 ** zoom;
  const wrappedX = ((coordinate.x % worldTileCount) + worldTileCount) % worldTileCount;
  const response = await fetch(
    terrainTileUrl.replace("{z}", String(zoom)).replace("{x}", String(wrappedX)).replace("{y}", String(coordinate.y)),
    signal === undefined ? undefined : { signal },
  );
  if (!response.ok) {
    return null;
  }

  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = tileSize;
    canvas.height = tileSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      return null;
    }

    context.drawImage(bitmap, 0, 0, tileSize, tileSize);
    return Object.freeze({ coordinate, pixels: context.getImageData(0, 0, tileSize, tileSize).data });
  } finally {
    bitmap.close();
  }
};

export const loadTerrainDem = async (
  geometry: TrackMeshData,
  requestedZoom = maximumTerrainZoom,
  view?: TerrainView,
  signal?: AbortSignal,
): Promise<TerrainDemData> => {
  const coverage = getTerrainTileCoverage(geometry, requestedZoom, view);
  const coordinates = Array.from(
    { length: (coverage.maxX - coverage.minX + 1) * (coverage.maxY - coverage.minY + 1) },
    (_value, index) => ({
      x: coverage.minX + (index % (coverage.maxX - coverage.minX + 1)),
      y: coverage.minY + Math.floor(index / (coverage.maxX - coverage.minX + 1)),
    }),
  );
  const tiles: (TileData | null)[] = Array.from({ length: coordinates.length }, () => null);
  let nextIndex = 0;
  const loadWorker = async (): Promise<void> => {
    while (nextIndex < coordinates.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        tiles[index] = await loadTilePixels(coordinates[index], coverage.zoom, signal);
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        tiles[index] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, coordinates.length) }, loadWorker));

  if (tiles.every((tile) => tile === null)) {
    throw new Error("No elevation tiles were available for this route.");
  }

  const columns = coverage.maxX - coverage.minX + 1;
  const rows = coverage.maxY - coverage.minY + 1;
  const width = columns * tileSize;
  const height = rows * tileSize;
  const elevations = new Float32Array(width * height);
  elevations.fill(Number.NaN);

  tiles.forEach((tile) => {
    if (tile === null) {
      return;
    }

    const columnOffset = (tile.coordinate.x - coverage.minX) * tileSize;
    const rowOffset = (tile.coordinate.y - coverage.minY) * tileSize;
    for (let row = 0; row < tileSize; row += 1) {
      for (let column = 0; column < tileSize; column += 1) {
        const pixelIndex = (row * tileSize + column) * 4;
        elevations[(rowOffset + row) * width + columnOffset + column] = decodeTerrariumElevation(
          tile.pixels[pixelIndex],
          tile.pixels[pixelIndex + 1],
          tile.pixels[pixelIndex + 2],
        );
      }
    }
  });

  return Object.freeze({
    zoom: coverage.zoom,
    source: "terrarium",
    elevationAt: (latitude: number, longitude: number): number | null => {
      const worldPixel = toWorldPixel(latitude, longitude, coverage.zoom);
      const localX = worldPixel.x - coverage.minX * tileSize;
      const localY = worldPixel.y - coverage.minY * tileSize;
      return readRasterElevation(elevations, width, height, localX, localY);
    },
  });
};

export const createTerrainDemLoader = (
  geometry: TrackMeshData,
  signal?: AbortSignal,
): ((mapZoom: number, view?: TerrainView) => Promise<TerrainDemData>) => {
  const pendingRequests = new Map<string, Promise<TerrainDemData>>();
  const terrariumRequests = new Map<string, Promise<TerrainDemData | null>>();

  return (mapZoom: number, view?: TerrainView): Promise<TerrainDemData> => {
    const zoom = getTerrainDemZoom(mapZoom);
    if (zoom === null) {
      return Promise.reject(new Error("A finite terrain zoom level is required."));
    }

    const coverage = getTerrainTileCoverage(geometry, zoom, view);
    const tileCoverageKey = `${coverage.zoom}:${coverage.minX}:${coverage.maxX}:${coverage.minY}:${coverage.maxY}`;
    const lidarRequest = createLidarWcsRequest(coverage, view);
    const requestKey = `${tileCoverageKey}:${lidarRequest?.url ?? "no-lidar"}`;
    const existingRequest = pendingRequests.get(requestKey);
    if (existingRequest !== undefined) {
      return existingRequest;
    }

    let terrarium = terrariumRequests.get(tileCoverageKey);
    if (terrarium === undefined) {
      terrarium = loadTerrainDem(geometry, zoom, view, signal).catch((error: unknown) => {
        terrariumRequests.delete(tileCoverageKey);
        if (signal?.aborted) {
          throw error;
        }
        return null;
      });
      terrariumRequests.set(tileCoverageKey, terrarium);
      if (terrariumRequests.size > 2) {
        const oldestKey = terrariumRequests.keys().next().value;
        if (oldestKey !== undefined) {
          terrariumRequests.delete(oldestKey);
        }
      }
    } else {
      terrariumRequests.delete(tileCoverageKey);
      terrariumRequests.set(tileCoverageKey, terrarium);
    }

    const request = Promise.all([
      terrarium,
      loadLidarTerrain(coverage, view, signal),
    ]).then(([terrarium, lidar]) => {
      const availableLayers = [terrarium, lidar].filter((layer): layer is TerrainDemData => layer !== null);
      if (availableLayers.length === 0) {
        throw new Error("No elevation data was available for this terrain area.");
      }
      return availableLayers.reduce<TerrainDemData | null>(retainBestTerrainElevation, null)!;
    });
    pendingRequests.set(requestKey, request);
    void request.then(
      () => pendingRequests.delete(requestKey),
      () => pendingRequests.delete(requestKey),
    );
    return request;
  };
};
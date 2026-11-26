import type { TrackMeshData } from "./trackGeometry";
import { getTerrainAreaBounds, type TerrainElevationSampler } from "./terrainGeometry";

const tileSize = 256;
const terrainTileUrl = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
const maximumTileCount = 64;
const maximumLatitude = 85.05112878;

type TileCoordinate = Readonly<{ x: number; y: number }>;
type TileData = Readonly<{ coordinate: TileCoordinate; pixels: Uint8ClampedArray }>;
type TileCoverage = Readonly<{ zoom: number; minX: number; maxX: number; minY: number; maxY: number }>;

export const decodeTerrariumElevation = (red: number, green: number, blue: number): number =>
  red * 256 + green + blue / 256 - 32768;

const toGeographicPoint = (x: number, z: number, geometry: TrackMeshData): Readonly<{ latitude: number; longitude: number }> => {
  const { projection } = geometry;
  const longitudeScale = Math.max(Math.abs(projection.longitudeScale), 0.00001);
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

const getTileCoverage = (geometry: TrackMeshData): TileCoverage => {
  const bounds = getTerrainAreaBounds(geometry);
  const corners = [
    toGeographicPoint(bounds.minX, bounds.minZ, geometry),
    toGeographicPoint(bounds.minX, bounds.maxZ, geometry),
    toGeographicPoint(bounds.maxX, bounds.minZ, geometry),
    toGeographicPoint(bounds.maxX, bounds.maxZ, geometry),
  ];

  for (let zoom = 15; zoom >= 0; zoom -= 1) {
    const tilePoints = corners.map((corner) => {
      const pixel = toWorldPixel(corner.latitude, corner.longitude, zoom);
      return {
        x: Math.floor(pixel.x / tileSize),
        y: Math.max(0, Math.min(2 ** zoom - 1, Math.floor(pixel.y / tileSize))),
      };
    });
    const minX = Math.min(...tilePoints.map((point) => point.x));
    const maxX = Math.max(...tilePoints.map((point) => point.x));
    const minY = Math.min(...tilePoints.map((point) => point.y));
    const maxY = Math.max(...tilePoints.map((point) => point.y));

    if ((maxX - minX + 1) * (maxY - minY + 1) <= maximumTileCount) {
      return Object.freeze({ zoom, minX, maxX, minY, maxY });
    }
  }

  throw new Error("This route covers too much area to build a local terrain view.");
};

const loadTilePixels = async (coordinate: TileCoordinate, zoom: number): Promise<TileData | null> => {
  const worldTileCount = 2 ** zoom;
  const wrappedX = ((coordinate.x % worldTileCount) + worldTileCount) % worldTileCount;
  const response = await fetch(terrainTileUrl.replace("{z}", String(zoom)).replace("{x}", String(wrappedX)).replace("{y}", String(coordinate.y)));
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

const readElevation = (pixels: Float32Array, width: number, height: number, x: number, y: number): number | null => {
  const column = Math.max(0, Math.min(width - 1, x));
  const row = Math.max(0, Math.min(height - 1, y));
  const left = Math.floor(column);
  const top = Math.floor(row);
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const columnRatio = column - left;
  const rowRatio = row - top;
  const values = [
    { value: pixels[top * width + left], weight: (1 - columnRatio) * (1 - rowRatio) },
    { value: pixels[top * width + right], weight: columnRatio * (1 - rowRatio) },
    { value: pixels[bottom * width + left], weight: (1 - columnRatio) * rowRatio },
    { value: pixels[bottom * width + right], weight: columnRatio * rowRatio },
  ].filter((sample) => Number.isFinite(sample.value) && sample.weight > 0);
  const totalWeight = values.reduce((total, sample) => total + sample.weight, 0);

  return totalWeight === 0
    ? null
    : values.reduce((total, sample) => total + sample.value * sample.weight, 0) / totalWeight;
};

export const loadTerrainDem = async (geometry: TrackMeshData): Promise<TerrainElevationSampler> => {
  const coverage = getTileCoverage(geometry);
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
        tiles[index] = await loadTilePixels(coordinates[index], coverage.zoom);
      } catch {
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

  return (latitude: number, longitude: number): number | null => {
    const worldPixel = toWorldPixel(latitude, longitude, coverage.zoom);
    const localX = worldPixel.x - coverage.minX * tileSize;
    const localY = worldPixel.y - coverage.minY * tileSize;
    return readElevation(elevations, width, height, localX, localY);
  };
};
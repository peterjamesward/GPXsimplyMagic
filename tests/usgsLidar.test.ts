import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("geotiff", () => ({
  fromArrayBuffer: vi.fn(),
}));

import { fromArrayBuffer } from "geotiff";
import { getLidarPatchBounds } from "../src/lidarBounds";
import {
  createUsgs3depRequest,
  createUsgs3depSampler,
  isUsgs3depCoverage,
  loadUsgs3depTerrain,
  type Usgs3depBounds,
} from "../src/usgsLidar";
import type { TerrainView, TileCoverage } from "../src/terrainDem";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(fromArrayBuffer).mockReset();
});

const coverageAt = (longitude: number, latitude: number, zoom: number): TileCoverage => {
  const tileCount = 2 ** zoom;
  const latitudeRadians = latitude * Math.PI / 180;
  const x = Math.floor(((longitude + 180) / 360) * tileCount);
  const y = Math.floor(((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * tileCount);
  return Object.freeze({ zoom, minX: x, maxX: x, minY: y, maxY: y });
};

const toGeographicCenter = (bounds: Usgs3depBounds): readonly [number, number] => {
  const radius = 6_378_137;
  const x = (bounds.minX + bounds.maxX) / 2;
  const y = (bounds.minY + bounds.maxY) / 2;
  return [
    (2 * Math.atan(Math.exp(y / radius)) - Math.PI / 2) * 180 / Math.PI,
    (x / radius) * 180 / Math.PI,
  ];
};

describe("USGS 3DEP elevation service", () => {
  it("creates bounded Web Mercator GeoTIFF requests", () => {
    const request = createUsgs3depRequest({ west: -123, south: 44, east: -122, north: 45 });
    const url = new URL(request?.url ?? "https://invalid.local");

    expect(url.origin + url.pathname).toBe(
      "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage",
    );
    expect(url.searchParams.get("bboxSR")).toBe("3857");
    expect(url.searchParams.get("imageSR")).toBe("3857");
    expect(url.searchParams.get("size")).toBe("256,256");
    expect(url.searchParams.get("format")).toBe("tiff");
    expect(url.searchParams.get("pixelType")).toBe("F32");
    expect(url.searchParams.get("f")).toBe("image");
    expect(request?.bounds.minX).toBeLessThan(request?.bounds.maxX ?? 0);
    expect(createUsgs3depRequest({ west: 4, south: 90, east: 5, north: 91 })).toBeNull();
  });

  it("limits USGS service queries to its U.S. coverage regions", () => {
    expect(isUsgs3depCoverage({ west: -123, south: 44, east: -122, north: 45 })).toBe(true);
    expect(isUsgs3depCoverage({ west: -157, south: 20, east: -156, north: 21 })).toBe(true);
    expect(isUsgs3depCoverage({ west: -1, south: 51, east: 0, north: 52 })).toBe(false);
  });

  it("samples elevations in projected coordinates and rejects nodata", () => {
    const bounds: Usgs3depBounds = Object.freeze({ minX: -20, minY: -20, maxX: 20, maxY: 20 });
    const sample = createUsgs3depSampler(new Float32Array([100, 120, 140, 160]), 2, 2, bounds, -999999);

    expect(sample?.(0, 0)).toBeCloseTo(130);
    expect(sample?.(0, 1)).toBeNull();
    expect(createUsgs3depSampler(new Float32Array(4).fill(-999999), 2, 2, bounds, -999999)).toBeNull();
    expect(createUsgs3depSampler(new Float32Array(3), 2, 2, bounds, null)).toBeNull();
  });

  it("loads and decodes the bounded TIFF into the shared elevation sampler", async () => {
    const coverage = coverageAt(-122.8, 44.5, 10);
    const view: TerrainView = Object.freeze({
      center: [-122.8, 44.5] as const,
      zoom: 10,
      width: 800,
      height: 600,
      pitch: 0,
    });
    const requestedBounds = createUsgs3depRequest(getLidarPatchBounds(coverage, view))?.bounds;
    expect(requestedBounds).toBeDefined();
    const image = {
      getWidth: () => 2,
      getHeight: () => 2,
      getBoundingBox: () => [requestedBounds!.minX, requestedBounds!.minY, requestedBounds!.maxX, requestedBounds!.maxY],
      getGDALNoData: () => -999999,
      readRasters: vi.fn(async () => new Float32Array([100, 120, 140, 160])),
    };
    vi.mocked(fromArrayBuffer).mockResolvedValue({
      getImage: vi.fn().mockResolvedValue(image),
    } as unknown as Awaited<ReturnType<typeof fromArrayBuffer>>);
    const fetch = vi.fn().mockResolvedValue(new Response(new ArrayBuffer(16), {
      headers: { "content-type": "image/tiff" },
    }));
    vi.stubGlobal("fetch", fetch);

    const terrain = await loadUsgs3depTerrain(coverage, view);
    const [latitude, longitude] = toGeographicCenter(requestedBounds!);

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/ImageServer/exportImage?");
    expect(fromArrayBuffer).toHaveBeenCalledOnce();
    expect(image.readRasters).toHaveBeenCalledWith({ interleave: true, signal: undefined });
    expect(terrain?.source).toBe("usgs-3dep");
    expect(terrain?.elevationAt(latitude, longitude)).toBeCloseTo(130);
  });

  it("falls back cleanly when the export endpoint returns a non-TIFF response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("service unavailable", {
      headers: { "content-type": "text/plain" },
    })));

    await expect(loadUsgs3depTerrain(coverageAt(-122.8, 44.5, 10))).resolves.toBeNull();
    expect(fromArrayBuffer).not.toHaveBeenCalled();
  });

  it("does not request USGS data for routes outside its known coverage", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(loadUsgs3depTerrain(coverageAt(-0.1, 51.5, 10))).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
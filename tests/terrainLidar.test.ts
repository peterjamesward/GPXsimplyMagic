import { afterEach, describe, expect, it, vi } from "vitest";
import { createLidarWcsRequest, loadLidarTerrain, parseLidarTextGrid } from "../src/terrainLidar";

const londonCoverage = Object.freeze({ zoom: 10, minX: 511, maxX: 512, minY: 343, maxY: 344 });
const sampleGrid = `Grid bounds: GeneralBounds[(-3.0, 51.0), (0.0, 53.0)]
Grid range: GridEnvelope2D[0..2, 0..1]
Contents:
Band 0:
10 20 30
40 50 -3.4028235E38`;

afterEach(() => vi.unstubAllGlobals());

describe("Environment Agency LiDAR WCS", () => {
  it("creates bounded EPSG:4326 requests only where the service covers the viewport", () => {
    const request = createLidarWcsRequest(londonCoverage);

    expect(request).not.toBeNull();
    const url = new URL(request!.url);
    expect(request!.width).toBeLessThanOrEqual(256);
    expect(request!.height).toBeLessThanOrEqual(256);
    expect(url.searchParams.get("coverageId")).toContain("Lidar_Composite_Elevation_DTM_2m");
    expect(url.searchParams.get("subsettingCrs")).toContain("EPSG/0/4326");
    expect(url.searchParams.getAll("subset")).toHaveLength(2);
    expect(url.searchParams.getAll("scaleSize")).toHaveLength(2);
    expect(url.searchParams.get("format")).toBe("text/plain");
    expect(createLidarWcsRequest({ zoom: 8, minX: 40, maxX: 41, minY: 98, maxY: 99 })).toBeNull();
    expect(createLidarWcsRequest(londonCoverage, {
      center: [0, 0],
      zoom: 0,
      width: 800,
      height: 600,
      pitch: 0,
    })).toBeNull();
  });

  it("keeps LiDAR requests local and stable while the camera remains in a nearby patch", () => {
    const view = { center: [-0.15, 51.5] as const, zoom: 10, width: 800, height: 600, pitch: 0 };
    const request = createLidarWcsRequest(londonCoverage, view)!;
    const nearbyView = { ...view, center: [-0.149, 51.5005] as const };
    const movedView = { ...view, center: [-0.13, 51.5] as const };

    expect((request.bounds.east - request.bounds.west) * 111_320 * Math.cos(51.5 * Math.PI / 180)).toBeLessThanOrEqual(2_000);
    expect((request.bounds.north - request.bounds.south) * 111_320).toBeLessThanOrEqual(2_000);
    expect(createLidarWcsRequest(londonCoverage, nearbyView)?.url).toBe(request.url);
    expect(createLidarWcsRequest(londonCoverage, movedView)?.url).not.toBe(request.url);
  });

  it("parses elevations, bilinearly samples the georeferenced raster, and ignores no-data cells", () => {
    const terrain = parseLidarTextGrid(sampleGrid, 15);

    expect(terrain?.source).toBe("lidar");
    expect(terrain?.elevationAt(52.5, -2.5)).toBe(10);
    expect(terrain?.elevationAt(52.5, -0.5)).toBe(30);
    expect(terrain?.elevationAt(51.5, -1.5)).toBe(50);
    expect(terrain?.elevationAt(51.5, -0.5)).toBeNull();
    expect(terrain?.elevationAt(52.5, 1)).toBeNull();
    expect(terrain?.elevationAt(54, -1)).toBeNull();
    expect(terrain?.elevationAt(52.5, -1)).toBe(25);
  });

  it("rejects malformed or entirely uncovered WCS grids", () => {
    expect(parseLidarTextGrid("Service exception", 15)).toBeNull();
    expect(parseLidarTextGrid(sampleGrid.replace("10 20 30\n40 50 -3.4028235E38", "-3.4028235E38 -3.4028235E38 -3.4028235E38\n-3.4028235E38 -3.4028235E38 -3.4028235E38"), 15))
      .toBeNull();
  });

  it("loads valid WCS data and gracefully treats unavailable coverage as absent", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(sampleGrid));
    vi.stubGlobal("fetch", fetch);

    const terrain = await loadLidarTerrain(londonCoverage);

    expect(terrain?.elevationAt(52.5, -2.5)).toBe(10);
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockResolvedValueOnce(new Response("Coverage unavailable", { status: 404 }));
    expect(await loadLidarTerrain(londonCoverage)).toBeNull();
  });
});
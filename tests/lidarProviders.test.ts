import { describe, expect, it, vi } from "vitest";
import { loadFirstAvailableLidarTerrain, type LidarTerrainProvider } from "../src/lidarProviders";
import type { TerrainDemData, TileCoverage } from "../src/terrainDem";

const coverage: TileCoverage = Object.freeze({ zoom: 10, minX: 1, maxX: 1, minY: 1, maxY: 1 });
const terrain: TerrainDemData = Object.freeze({ zoom: 10, source: "usgs-3dep", elevationAt: () => 100 });

describe("LiDAR provider fallback", () => {
  it("tries providers in order until one returns usable terrain", async () => {
    const first = vi.fn().mockRejectedValue(new Error("provider offline"));
    const second = vi.fn().mockResolvedValue(null);
    const third = vi.fn().mockResolvedValue(terrain);
    const providers: readonly LidarTerrainProvider[] = [
      { id: "first", load: first },
      { id: "second", load: second },
      { id: "third", load: third },
    ];

    await expect(loadFirstAvailableLidarTerrain(coverage, undefined, undefined, providers)).resolves.toBe(terrain);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(third).toHaveBeenCalledOnce();
  });

  it("returns null when every catalog has no coverage", async () => {
    const providers: readonly LidarTerrainProvider[] = [
      { id: "first", load: async () => null },
      { id: "second", load: async () => null },
    ];

    await expect(loadFirstAvailableLidarTerrain(coverage, undefined, undefined, providers)).resolves.toBeNull();
  });

  it("does not fall through after cancellation", async () => {
    const controller = new AbortController();
    const first = vi.fn(async () => {
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    });
    const second = vi.fn().mockResolvedValue(terrain);
    const providers: readonly LidarTerrainProvider[] = [
      { id: "first", load: first },
      { id: "second", load: second },
    ];

    await expect(loadFirstAvailableLidarTerrain(coverage, undefined, controller.signal, providers)).rejects.toThrow();
    expect(second).not.toHaveBeenCalled();
  });
});
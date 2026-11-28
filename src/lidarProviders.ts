import type { TerrainDemData, TerrainView, TileCoverage } from "./terrainDem";
import { loadLidarTerrain } from "./terrainLidar";
import { loadOpenLidarTerrain } from "./openLidarData";
import { loadUsgs3depTerrain } from "./usgsLidar";

export type LidarTerrainProvider = Readonly<{
  id: string;
  load: (coverage: TileCoverage, view?: TerrainView, signal?: AbortSignal) => Promise<TerrainDemData | null>;
}>;

export const knownLidarTerrainProviders: readonly LidarTerrainProvider[] = Object.freeze([
  Object.freeze({ id: "environment-agency-wcs", load: loadLidarTerrain }),
  Object.freeze({ id: "open-lidar-data", load: loadOpenLidarTerrain }),
  Object.freeze({ id: "usgs-3dep", load: loadUsgs3depTerrain }),
]);

export const loadFirstAvailableLidarTerrain = async (
  coverage: TileCoverage,
  view: TerrainView | undefined,
  signal: AbortSignal | undefined,
  providers: readonly LidarTerrainProvider[] = knownLidarTerrainProviders,
): Promise<TerrainDemData | null> => {
  for (const provider of providers) {
    if (signal?.aborted) {
      throw new DOMException("LiDAR request aborted", "AbortError");
    }
    try {
      const terrain = await provider.load(coverage, view, signal);
      if (terrain !== null) {
        return terrain;
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
    }
  }
  return null;
};
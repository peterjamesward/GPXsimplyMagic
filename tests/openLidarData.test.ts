import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOpenLidarCandidateDatasets,
  loadOpenLidarTileIndex,
  parseOpenLidarCatalog,
  parseOpenLidarTileIndex,
} from "../src/openLidarData";
import { getLidarPatchBounds } from "../src/lidarBounds";

afterEach(() => vi.unstubAllGlobals());

const createDbf = (fileName: string): ArrayBuffer => {
  const fieldLength = 80;
  const headerLength = 65;
  const recordLength = fieldLength + 1;
  const buffer = new ArrayBuffer(headerLength + recordLength + 1);
  const view = new DataView(buffer);
  view.setUint32(4, 1, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  new Uint8Array(buffer, 32, 5).set(new TextEncoder().encode("fname"));
  view.setUint8(48, fieldLength);
  view.setUint8(64, 0x0d);
  view.setUint8(headerLength, 0x20);
  new Uint8Array(buffer, headerLength + 1, fileName.length).set(new TextEncoder().encode(fileName));
  return buffer;
};

const createShapefile = (bounds: readonly [number, number, number, number]): ArrayBuffer => {
  const buffer = new ArrayBuffer(144);
  const view = new DataView(buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, buffer.byteLength / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 5, true);
  view.setInt32(100, 1, false);
  view.setInt32(104, 18, false);
  view.setInt32(108, 5, true);
  bounds.forEach((value, index) => view.setFloat64(112 + index * 8, value, true));
  return buffer;
};

describe("open-lidar-data catalog and tile index", () => {
  it("keeps viewport terrain patches within two kilometres and snaps nearby camera moves", () => {
    const latitude = 55.68;
    const longitude = 12.57;
    const zoom = 10;
    const tileCount = 2 ** zoom;
    const latitudeRadians = latitude * Math.PI / 180;
    const x = Math.floor(((longitude + 180) / 360) * tileCount);
    const y = Math.floor(((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * tileCount);
    const coverage = { zoom, minX: x, maxX: x, minY: y, maxY: y };
    const view = { center: [longitude, latitude] as const, zoom, width: 800, height: 600, pitch: 0 };
    const bounds = getLidarPatchBounds(coverage, view);
    const nearbyBounds = getLidarPatchBounds(coverage, { ...view, center: [longitude + 0.001, latitude + 0.001] });
    const movedBounds = getLidarPatchBounds(coverage, { ...view, center: [longitude + 0.02, latitude] });

    expect((bounds.east - bounds.west) * 111_320 * Math.cos(latitudeRadians)).toBeLessThanOrEqual(2_000);
    expect((bounds.north - bounds.south) * 111_320).toBeLessThanOrEqual(2_000);
    expect(nearbyBounds).toEqual(bounds);
    expect(movedBounds).not.toEqual(bounds);
  });

  it("parses country datasets and limits candidates to recent regional entries", () => {
    const catalog = [
      "| Country | EPSG | Path | Start | End | Size | License |",
      "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
      "| Denmark | 25832 | data/DK/SDFI/DHM_2021/copc | 2021-01-01 | 2021-12-31 | 10 | source |",
      "| Denmark | 25832 | data/DK/SDFI/DHM_2022/copc | 2022-01-01 | 2022-12-31 | 10 | source |",
      "| Denmark | 25832 | data/DK/SDFI/DHM_2023/copc | 2023-01-01 | 2023-12-31 | 10 | source |",
      "| Denmark | 25832 | data/DK/SDFI/DHM_2024/copc | 2024-01-01 | 2024-12-31 | 10 | source |",
      "| Denmark | 25832 | data/DK/../private/copc | 2024-01-01 | 2024-12-31 | 10 | source |",
      "| Denmark | 999999 | data/DK/SDFI/Invalid/copc | 2024-01-01 | 2024-12-31 | 10 | source |",
      "| United States | 26910 | data/US/NOAA/Topobathy/copc | 2023-01-01 | 2023-12-31 | 10 | source |",
    ].join("\n");
    const datasets = parseOpenLidarCatalog(catalog);
    const candidates = getOpenLidarCandidateDatasets(datasets, { west: 11, south: 55.2, east: 12, north: 56 });

    expect(datasets).toHaveLength(4);
    expect(candidates.map((dataset) => dataset.indexBaseName)).toEqual(["DHM_2024", "DHM_2023", "DHM_2022"]);
    expect(getOpenLidarCandidateDatasets(datasets, { west: -122, south: 37, east: -121, north: 38 })).toEqual([]);
  });

  it("matches shapefile bounding boxes to the aligned DBF COPC filenames", () => {
    const index = parseOpenLidarTileIndex(
      createShapefile([500_000, 6_200_000, 501_000, 6_201_000]),
      createDbf("NU0444ne_P_12498_20220119_20220119.copc.laz"),
    );

    expect(index).toEqual([{
      fileName: "NU0444ne_P_12498_20220119_20220119.copc.laz",
      bounds: { minX: 500_000, minY: 6_200_000, maxX: 501_000, maxY: 6_201_000 },
    }]);
  });

  it("reads only the DBF header and filenames for matching tiles", async () => {
    const dataset = parseOpenLidarCatalog([
      "| Country | EPSG | Path | Start | End | Size | License |",
      "| Denmark | 25832 | data/DK/SDFI/DHM_2024/copc | 2024-01-01 | 2024-12-31 | 10 | source |",
    ].join("\n"))[0];
    const dbf = createDbf("NU0444ne_P_12498_20220119_20220119.copc.laz");
    const shape = createShapefile([500_000, 6_200_000, 501_000, 6_201_000]);
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith(".shp")) {
        return new Response(shape);
      }
      const range = new Headers(init?.headers).get("Range");
      if (range === "bytes=0-65535") {
        return new Response(dbf.slice(0, 65), { status: 206 });
      }
      const matchedRange = range?.match(/^bytes=(\d+)-(\d+)$/);
      if (matchedRange === undefined || matchedRange === null) {
        return new Response(null, { status: 416 });
      }
      const start = Number(matchedRange[1]);
      const end = Number(matchedRange[2]) + 1;
      return new Response(dbf.slice(start, end), { status: 206 });
    });
    vi.stubGlobal("fetch", fetch);

    const tiles = await loadOpenLidarTileIndex(dataset!, {
      minX: 500_000,
      minY: 6_200_000,
      maxX: 501_000,
      maxY: 6_201_000,
    });

    expect(tiles).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.slice(1).map(([, init]) => new Headers(init?.headers).get("Range"))).toEqual([
      "bytes=0-65535",
      "bytes=65-145",
    ]);
    expect(await loadOpenLidarTileIndex(dataset!, {
      minX: 500_100,
      minY: 6_200_100,
      maxX: 500_900,
      maxY: 6_200_900,
    })).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith(".shp"))).toHaveLength(1);
  });

  it("rejects malformed or incomplete shape indexes", () => {
    expect(parseOpenLidarTileIndex(new ArrayBuffer(20), createDbf("tile.copc.laz"))).toEqual([]);
    expect(parseOpenLidarTileIndex(createShapefile([1, 2, 0, 4]), createDbf("tile.copc.laz"))).toEqual([]);
  });
});
import { getTerrainAreaBounds } from "./terrainGeometry";
import type { TrackMeshData } from "./trackGeometry";

export type LandUseCategory = "water" | "farmland" | "woodland" | "grassland" | "residential" | "industrial" | "bare";
export type MapColor = readonly [number, number, number];
export type MapPoint = Readonly<{ x: number; z: number }>;
export type OpenStreetMapArea = Readonly<{
  category: LandUseCategory;
  treesAllowed: boolean;
  points: readonly MapPoint[];
  bounds: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
}>;
export type OpenStreetMapBuilding = Readonly<{
  points: readonly MapPoint[];
  heightMeters: number | null;
  wallColor: MapColor;
  roofColor: MapColor;
}>;
export type OpenStreetMapFeatures = Readonly<{
  areas: readonly OpenStreetMapArea[];
  buildings: readonly OpenStreetMapBuilding[];
}>;
export type GeographicBounds = Readonly<{ south: number; west: number; north: number; east: number }>;

type GeographicPoint = Readonly<{ lat: number; lon: number }>;
type RawMember = Readonly<{ role?: string; geometry?: readonly GeographicPoint[] }>;
type RawElement = Readonly<{
  type: string;
  id: number;
  tags?: Readonly<Record<string, string>>;
  geometry?: readonly GeographicPoint[];
  members?: readonly RawMember[];
}>;
type LandUseStyle = Readonly<{ color: MapColor; priority: number }>;

const overpassEndpoint = "https://overpass.nextgis.com/my-IllGcn5yk6k3nwxLVeFWw1CRGLt6SD54/api/interpreter";
const maximumLatitude = 85.05112878;
const requestTimeoutMilliseconds = 20_000;
const defaultWallColor: MapColor = Object.freeze([0.68, 0.59, 0.44]);
const defaultRoofColor: MapColor = Object.freeze([0.38, 0.18, 0.12]);

const landUseStyles: Readonly<Record<LandUseCategory, LandUseStyle>> = Object.freeze({
  water: { color: Object.freeze([0.2, 0.46, 0.68] as const), priority: 7 },
  woodland: { color: Object.freeze([0.12, 0.32, 0.16] as const), priority: 6 },
  farmland: { color: Object.freeze([0.55, 0.62, 0.3] as const), priority: 5 },
  grassland: { color: Object.freeze([0.33, 0.52, 0.25] as const), priority: 4 },
  residential: { color: Object.freeze([0.58, 0.54, 0.46] as const), priority: 3 },
  industrial: { color: Object.freeze([0.47, 0.47, 0.44] as const), priority: 2 },
  bare: { color: Object.freeze([0.58, 0.52, 0.42] as const), priority: 1 },
});

const knownColors: Readonly<Record<string, string>> = Object.freeze({
  black: "#303030",
  white: "#f2f0e9",
  red: "#a84335",
  green: "#52734d",
  blue: "#486b91",
  brown: "#795548",
  grey: "#85827c",
  gray: "#85827c",
  beige: "#c9b99a",
  yellow: "#d2b64c",
  orange: "#c77d45",
  cream: "#e8ddc0",
});

export const emptyOpenStreetMapFeatures: OpenStreetMapFeatures = Object.freeze({
  areas: Object.freeze([]),
  buildings: Object.freeze([]),
});

const normalizeLongitude = (longitude: number): number => ((longitude + 180) % 360 + 360) % 360 - 180;

export const getOpenStreetMapBounds = (geometry: TrackMeshData): readonly GeographicBounds[] => {
  const area = getTerrainAreaBounds(geometry);
  const { projection } = geometry;
  const longitudeScale = Math.max(Math.abs(projection.longitudeScale), 0.00001);
  const south = Math.max(-maximumLatitude, Math.min(maximumLatitude, projection.centerLatitude + area.minZ / (projection.sceneUnitsPerMeter * 111_320)));
  const north = Math.max(-maximumLatitude, Math.min(maximumLatitude, projection.centerLatitude + area.maxZ / (projection.sceneUnitsPerMeter * 111_320)));
  const west = projection.centerLongitude + area.minX / (projection.sceneUnitsPerMeter * longitudeScale * 111_320);
  const east = projection.centerLongitude + area.maxX / (projection.sceneUnitsPerMeter * longitudeScale * 111_320);

  if (east - west >= 360) {
    return Object.freeze([Object.freeze({ south, west: -180, north, east: 180 })]);
  }

  const westWorld = Math.floor((west + 180) / 360);
  const eastWorld = Math.floor((east + 180) / 360);
  if (westWorld === eastWorld) {
    return Object.freeze([Object.freeze({ south, west: normalizeLongitude(west), north, east: normalizeLongitude(east) })]);
  }

  return Object.freeze([
    Object.freeze({ south, west: normalizeLongitude(west), north, east: 180 }),
    Object.freeze({ south, west: -180, north, east: normalizeLongitude(east) }),
  ]);
};

const formatBounds = ({ south, west, north, east }: GeographicBounds): string =>
  `${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)}`;

export const createOpenStreetMapQuery = (bounds: GeographicBounds): string => {
  const box = formatBounds(bounds);
  return `[out:json][timeout:20][maxsize:100000000];(way["landuse"~"^(residential|farmland|farmyard|orchard|vineyard|forest|grass|meadow|industrial|commercial|retail|construction|quarry|cemetery|recreation_ground|allotments|greenhouse_horticulture|reservoir)$"](${box});relation["landuse"~"^(residential|farmland|farmyard|orchard|vineyard|forest|grass|meadow|industrial|commercial|retail|construction|quarry|cemetery|recreation_ground|allotments|greenhouse_horticulture|reservoir)$"](${box});way["natural"~"^(water|wood|grassland|scrub|heath|wetland|bare_rock|sand)$"](${box});relation["natural"~"^(water|wood|grassland|scrub|heath|wetland|bare_rock|sand)$"](${box});way["leisure"~"^(park|garden|golf_course|recreation_ground)$"](${box});relation["leisure"~"^(park|garden|golf_course|recreation_ground)$"](${box});way["waterway"="riverbank"](${box});relation["waterway"="riverbank"](${box});way["building"]["building"!="no"](${box});relation["building"]["building"!="no"](${box});way["building:part"](${box});relation["building:part"](${box}););out geom;`;
};

const isSamePoint = (left: GeographicPoint, right: GeographicPoint): boolean =>
  Math.abs(left.lat - right.lat) < 1e-8 && Math.abs(left.lon - right.lon) < 1e-8;

const closeRing = (points: readonly GeographicPoint[]): readonly GeographicPoint[] | null => {
  if (points.length < 3) {
    return null;
  }
  const closed = isSamePoint(points[0], points[points.length - 1]) ? [...points] : [...points, points[0]];
  return closed.length >= 4 ? Object.freeze(closed) : null;
};

const stitchOuterRings = (members: readonly RawMember[]): readonly (readonly GeographicPoint[])[] => {
  const segments = members
    .filter((member) => member.role === "outer" && (member.geometry?.length ?? 0) >= 2)
    .map((member) => [...(member.geometry ?? [])]);
  const rings: (readonly GeographicPoint[])[] = [];

  while (segments.length > 0) {
    const chain = segments.shift() ?? [];
    let attempts = segments.length + 1;
    while (chain.length > 0 && !isSamePoint(chain[0], chain[chain.length - 1]) && attempts > 0) {
      const end = chain[chain.length - 1];
      const matchIndex = segments.findIndex((segment) =>
        isSamePoint(end, segment[0]) || isSamePoint(end, segment[segment.length - 1]));
      if (matchIndex === -1) {
        break;
      }
      const [match] = segments.splice(matchIndex, 1);
      const ordered = isSamePoint(end, match[0]) ? match : [...match].reverse();
      chain.push(...ordered.slice(1));
      attempts = segments.length + 1;
    }
    const ring = closeRing(chain);
    if (ring !== null) {
      rings.push(ring);
    }
  }

  return Object.freeze(rings);
};

const getElementRings = (element: RawElement): readonly (readonly GeographicPoint[])[] => {
  if (element.type === "way") {
    const ring = closeRing(element.geometry ?? []);
    return ring === null ? Object.freeze([]) : Object.freeze([ring]);
  }
  return stitchOuterRings(element.members ?? []);
};

const toScenePoint = (point: GeographicPoint, geometry: TrackMeshData): MapPoint => {
  const { projection } = geometry;
  const longitudeDelta = ((point.lon - projection.centerLongitude + 540) % 360) - 180;
  return Object.freeze({
    x: longitudeDelta * projection.longitudeScale * 111_320 * projection.sceneUnitsPerMeter,
    z: (point.lat - projection.centerLatitude) * 111_320 * projection.sceneUnitsPerMeter,
  });
};

const getLandUseCategory = (tags: Readonly<Record<string, string>>): LandUseCategory | null => {
  const landuse = tags.landuse;
  const natural = tags.natural;
  const leisure = tags.leisure;

  if (natural === "water" || natural === "wetland" || tags.waterway === "riverbank" || landuse === "reservoir") {
    return "water";
  }
  if (landuse === "forest" || natural === "wood" || natural === "scrub" || natural === "heath") {
    return "woodland";
  }
  if (["farmland", "farmyard", "orchard", "vineyard", "allotments", "greenhouse_horticulture"].includes(landuse ?? "")) {
    return "farmland";
  }
  if (["grassland", "grass", "meadow"].includes(natural ?? "") || ["grass", "meadow"].includes(landuse ?? "") || ["park", "garden", "golf_course", "recreation_ground"].includes(leisure ?? "")) {
    return "grassland";
  }
  if (landuse === "residential") {
    return "residential";
  }
  if (["industrial", "commercial", "retail", "construction", "quarry", "cemetery"].includes(landuse ?? "")) {
    return "industrial";
  }
  if (["bare_rock", "sand"].includes(natural ?? "")) {
    return "bare";
  }
  return null;
};

const allowsTreeScenery = (tags: Readonly<Record<string, string>>): boolean =>
  ["forest", "orchard"].includes(tags.landuse ?? "") ||
  ["wood", "scrub"].includes(tags.natural ?? "") ||
  ["park", "garden", "cemetery"].includes(tags.leisure ?? "") ||
  tags.landuse === "cemetery";

const getHeightMeters = (tags: Readonly<Record<string, string>>): number | null => {
  const height = tags.height?.trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?$/i);
  if (height !== undefined && height !== null) {
    const amount = Number(height[1]);
    const meters = ["ft", "feet", "'"].includes((height[2] ?? "").toLowerCase()) ? amount * 0.3048 : amount;
    return Number.isFinite(meters) && meters > 0 ? Math.min(70, meters) : null;
  }
  const levels = Number(tags["building:levels"]);
  return Number.isFinite(levels) && levels > 0 ? Math.min(70, levels * 3) : null;
};

const parseColor = (value: string | undefined, fallback: MapColor): MapColor => {
  if (value === undefined) {
    return fallback;
  }
  const normalized = (knownColors[value.trim().toLowerCase()] ?? value.trim()).toLowerCase();
  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex === undefined) {
    return fallback;
  }
  const digits = hex.length === 3 ? [...hex].map((digit) => `${digit}${digit}`).join("") : hex;
  return Object.freeze([
    Number.parseInt(digits.slice(0, 2), 16) / 255,
    Number.parseInt(digits.slice(2, 4), 16) / 255,
    Number.parseInt(digits.slice(4, 6), 16) / 255,
  ]);
};

const createArea = (category: LandUseCategory, treesAllowed: boolean, points: readonly MapPoint[]): OpenStreetMapArea => {
  const bounds = points.reduce((result, point) => ({
    minX: Math.min(result.minX, point.x),
    maxX: Math.max(result.maxX, point.x),
    minZ: Math.min(result.minZ, point.z),
    maxZ: Math.max(result.maxZ, point.z),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  });
  return Object.freeze({ category, treesAllowed, points, bounds: Object.freeze(bounds) });
};

const parseElements = (elements: readonly RawElement[], geometry: TrackMeshData): OpenStreetMapFeatures => {
  const areas: OpenStreetMapArea[] = [];
  const buildings: OpenStreetMapBuilding[] = [];
  const seenElements = new Set<string>();

  elements.forEach((element) => {
    if (element.type !== "way" && element.type !== "relation") {
      return;
    }
    const identity = `${element.type}/${element.id}`;
    if (seenElements.has(identity)) {
      return;
    }
    seenElements.add(identity);
    const tags = element.tags ?? {};
    const category = getLandUseCategory(tags);
    const isBuilding = (tags.building !== undefined && tags.building !== "no") || tags["building:part"] !== undefined;
    const rings = getElementRings(element);
    if (category !== null && !isBuilding) {
      rings.forEach((ring) => {
        areas.push(createArea(category, allowsTreeScenery(tags), Object.freeze(ring.map((point) => toScenePoint(point, geometry)))));
      });
    }
    if (isBuilding) {
      rings.forEach((ring) => {
        buildings.push(Object.freeze({
          points: Object.freeze(ring.map((point) => toScenePoint(point, geometry))),
          heightMeters: getHeightMeters(tags),
          wallColor: parseColor(tags["building:colour"] ?? tags["building:color"] ?? tags["building:facade:colour"] ?? tags["building:facade:color"], defaultWallColor),
          roofColor: parseColor(tags["roof:colour"] ?? tags["roof:color"], defaultRoofColor),
        }));
      });
    }
  });

  return Object.freeze({ areas: Object.freeze(areas), buildings: Object.freeze(buildings) });
};

export const parseOpenStreetMapFeatures = (value: unknown, geometry: TrackMeshData): OpenStreetMapFeatures => {
  if (value === null || typeof value !== "object" || !Array.isArray((value as { elements?: unknown }).elements)) {
    throw new Error("OpenStreetMap returned an invalid feature response.");
  }
  return parseElements((value as { elements: readonly RawElement[] }).elements, geometry);
};

export const loadOpenStreetMapFeatures = async (
  geometry: TrackMeshData,
  signal?: AbortSignal,
): Promise<OpenStreetMapFeatures> => {
  const responses = await Promise.allSettled(getOpenStreetMapBounds(geometry).map(async (bounds) => {
    const requestController = new AbortController();
    const abortRequest = (): void => requestController.abort();
    if (signal?.aborted) {
      abortRequest();
    } else {
      signal?.addEventListener("abort", abortRequest, { once: true });
    }
    const timeout = setTimeout(abortRequest, requestTimeoutMilliseconds);
    const body = new URLSearchParams({ data: createOpenStreetMapQuery(bounds) });
    try {
      const response = await fetch(overpassEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json" },
        body,
        signal: requestController.signal,
      });
      if (!response.ok) {
        throw new Error(`OpenStreetMap feature request failed (${response.status}).`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortRequest);
    }
  }));
  const successfulResponses = responses.filter((response): response is PromiseFulfilledResult<unknown> => response.status === "fulfilled");
  if (successfulResponses.length === 0) {
    const failedResponse = responses.find((response): response is PromiseRejectedResult => response.status === "rejected");
    throw failedResponse?.reason ?? new Error("OpenStreetMap feature requests failed.");
  }
  const elements = successfulResponses.flatMap(({ value: response }) => {
    if (response === null || typeof response !== "object" || !Array.isArray((response as { elements?: unknown }).elements)) {
      throw new Error("OpenStreetMap returned an invalid feature response.");
    }
    return (response as { elements: RawElement[] }).elements;
  });
  return parseElements(elements, geometry);
};

const isPointInPolygon = (x: number, z: number, points: readonly MapPoint[]): boolean => {
  let inside = false;
  for (let index = 0, previousIndex = points.length - 1; index < points.length; previousIndex = index, index += 1) {
    const current = points[index];
    const previous = points[previousIndex];
    const crosses = (current.z > z) !== (previous.z > z) &&
      x < ((previous.x - current.x) * (z - current.z)) / (previous.z - current.z) + current.x;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
};

export const getLandUseCategoryAt = (
  x: number,
  z: number,
  areas: readonly OpenStreetMapArea[],
): LandUseCategory | null => {
  let selectedCategory: LandUseCategory | null = null;
  let selectedPriority = Number.NEGATIVE_INFINITY;
  areas.forEach((area) => {
    const style = landUseStyles[area.category];
    if (
      style.priority > selectedPriority &&
      x >= area.bounds.minX && x <= area.bounds.maxX &&
      z >= area.bounds.minZ && z <= area.bounds.maxZ &&
      isPointInPolygon(x, z, area.points)
    ) {
      selectedCategory = area.category;
      selectedPriority = style.priority;
    }
  });
  return selectedCategory;
};

export const getLandUseColorAt = (
  x: number,
  z: number,
  areas: readonly OpenStreetMapArea[],
): MapColor | null => {
  const category = getLandUseCategoryAt(x, z, areas);
  return category === null ? null : landUseStyles[category].color;
};

export const canPlaceProceduralTreeAt = (x: number, z: number, areas: readonly OpenStreetMapArea[]): boolean => {
  let selectedArea: OpenStreetMapArea | null = null;
  let selectedPriority = Number.NEGATIVE_INFINITY;
  for (const area of areas) {
    const priority = landUseStyles[area.category].priority;
    if (
      priority > selectedPriority &&
      x >= area.bounds.minX && x <= area.bounds.maxX &&
      z >= area.bounds.minZ && z <= area.bounds.maxZ &&
      isPointInPolygon(x, z, area.points)
    ) {
      selectedArea = area;
      selectedPriority = priority;
    }
  }
  return selectedArea === null || selectedArea.treesAllowed;
};

export type LandUseSpatialIndex = Readonly<{
  getCategoryAt: (x: number, z: number) => LandUseCategory | null;
  getColorAt: (x: number, z: number) => MapColor | null;
  canPlaceTreeAt: (x: number, z: number) => boolean;
}>;

type IndexedArea = Readonly<{
  index: number;
  area: OpenStreetMapArea;
  centerX: number;
  centerZ: number;
}>;
type AreaIndexBounds = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number; maximumPriority: number }>;
type AreaIndexLeaf = Readonly<AreaIndexBounds & { areas: readonly IndexedArea[] }>;
type AreaIndexBranch = Readonly<AreaIndexBounds & { left: AreaIndexNode; right: AreaIndexNode }>;
type AreaIndexNode = AreaIndexLeaf | AreaIndexBranch;
type SelectedArea = Readonly<{ area: OpenStreetMapArea; index: number; priority: number }>;

const areaLeafSize = 8;

const getAreaIndexBounds = (areas: readonly IndexedArea[]): AreaIndexBounds => areas.reduce(
  (bounds, { area }) => ({
    minX: Math.min(bounds.minX, area.bounds.minX),
    maxX: Math.max(bounds.maxX, area.bounds.maxX),
    minZ: Math.min(bounds.minZ, area.bounds.minZ),
    maxZ: Math.max(bounds.maxZ, area.bounds.maxZ),
    maximumPriority: Math.max(bounds.maximumPriority, landUseStyles[area.category].priority),
  }),
  {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    maximumPriority: Number.NEGATIVE_INFINITY,
  },
);

const buildAreaIndex = (areas: readonly IndexedArea[]): AreaIndexNode => {
  const bounds = getAreaIndexBounds(areas);
  if (areas.length <= areaLeafSize) {
    return Object.freeze({ ...bounds, areas: Object.freeze([...areas]) });
  }

  const splitOnX = bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ;
  const orderedAreas = [...areas].sort((left, right) => {
    const difference = splitOnX ? left.centerX - right.centerX : left.centerZ - right.centerZ;
    return difference || left.index - right.index;
  });
  const middle = Math.floor(orderedAreas.length / 2);

  return Object.freeze({
    ...bounds,
    left: buildAreaIndex(orderedAreas.slice(0, middle)),
    right: buildAreaIndex(orderedAreas.slice(middle)),
  });
};

const isInsideBounds = (
  x: number,
  z: number,
  bounds: Pick<AreaIndexBounds, "minX" | "maxX" | "minZ" | "maxZ">,
): boolean =>
  x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;

export const createLandUseSpatialIndex = (areas: readonly OpenStreetMapArea[]): LandUseSpatialIndex => {
  const indexedAreas = areas.map((area, index): IndexedArea => Object.freeze({
    index,
    area,
    centerX: (area.bounds.minX + area.bounds.maxX) / 2,
    centerZ: (area.bounds.minZ + area.bounds.maxZ) / 2,
  }));
  const root = indexedAreas.length === 0 ? null : buildAreaIndex(indexedAreas);

  const getSelectedAreaAt = (x: number, z: number): SelectedArea | null => {
    if (root === null || !Number.isFinite(x) || !Number.isFinite(z)) {
      return null;
    }

    let selected: SelectedArea | null = null;
    const visit = (node: AreaIndexNode): void => {
      if (
        !isInsideBounds(x, z, node) ||
        (selected !== null && node.maximumPriority < selected.priority)
      ) {
        return;
      }

      if ("areas" in node) {
        for (const { area, index } of node.areas) {
          const priority = landUseStyles[area.category].priority;
          if (
            priority > (selected?.priority ?? Number.NEGATIVE_INFINITY) ||
            (priority === selected?.priority && index < (selected?.index ?? Number.POSITIVE_INFINITY))
          ) {
            if (isInsideBounds(x, z, area.bounds) && isPointInPolygon(x, z, area.points)) {
              selected = { area, index, priority };
            }
          }
        }
        return;
      }

      const first = node.left.maximumPriority >= node.right.maximumPriority ? node.left : node.right;
      const second = first === node.left ? node.right : node.left;
      visit(first);
      visit(second);
    };

    visit(root);
    return selected;
  };

  return Object.freeze({
    getCategoryAt: (x, z) => getSelectedAreaAt(x, z)?.area.category ?? null,
    getColorAt: (x, z) => {
      const category = getSelectedAreaAt(x, z)?.area.category;
      return category === undefined ? null : landUseStyles[category].color;
    },
    canPlaceTreeAt: (x, z) => getSelectedAreaAt(x, z)?.area.treesAllowed ?? true,
  });
};
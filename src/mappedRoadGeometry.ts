import type { OpenStreetMapRoad } from "./openStreetMap";
import type { TrackMeshPart } from "./trackGeometry";

export type MappedRoadSurface = "paved" | "unpaved";
export type MappedRoadMesh = Readonly<{ surface: MappedRoadSurface; geometry: TrackMeshPart }>;
export type MappedRoadBounds = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;

type Point = Readonly<{ x: number; z: number }>;
type MutableMeshPart = { positions: number[]; normals: number[]; indices: number[] };

const roadWidthsMeters: Readonly<Record<string, number>> = Object.freeze({
  motorway: 9,
  trunk: 8,
  primary: 7.5,
  secondary: 7,
  tertiary: 6,
  unclassified: 5,
  residential: 5,
  living_street: 4.5,
  service: 3.5,
  road: 5,
  track: 3.2,
  cycleway: 2.2,
  path: 1.5,
  footway: 1.5,
  pedestrian: 2.4,
  bridleway: 2,
});

const clipRoadSegment = (
  start: Point,
  end: Point,
  bounds: MappedRoadBounds,
): readonly [Point, Point] | null => {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  let minimum = 0;
  let maximum = 1;
  const edges: readonly (readonly [number, number])[] = [
    [-deltaX, start.x - bounds.minX],
    [deltaX, bounds.maxX - start.x],
    [-deltaZ, start.z - bounds.minZ],
    [deltaZ, bounds.maxZ - start.z],
  ];

  for (const [direction, offset] of edges) {
    if (Math.abs(direction) < 1e-12) {
      if (offset < 0) return null;
      continue;
    }
    const ratio = offset / direction;
    if (direction < 0) minimum = Math.max(minimum, ratio);
    else maximum = Math.min(maximum, ratio);
    if (minimum > maximum) return null;
  }

  return Object.freeze([
    Object.freeze({ x: start.x + deltaX * minimum, z: start.z + deltaZ * minimum }),
    Object.freeze({ x: start.x + deltaX * maximum, z: start.z + deltaZ * maximum }),
  ]);
};

export const createMappedRoadMeshData = (
  roads: readonly OpenStreetMapRoad[],
  bounds: MappedRoadBounds,
  sceneUnitsPerMeter: number,
  heightAt: (x: number, z: number) => number,
): readonly MappedRoadMesh[] => {
  if (
    ![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, sceneUnitsPerMeter].every(Number.isFinite) ||
    bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ || sceneUnitsPerMeter <= 0
  ) {
    throw new Error("Mapped road meshes require finite bounds and a positive scene scale.");
  }

  const parts: Record<MappedRoadSurface, MutableMeshPart> = {
    paved: { positions: [], normals: [], indices: [] },
    unpaved: { positions: [], normals: [], indices: [] },
  };
  roads.forEach((road) => {
    if (
      road.points.length < 2 ||
      road.bounds.maxX < bounds.minX || road.bounds.minX > bounds.maxX ||
      road.bounds.maxZ < bounds.minZ || road.bounds.minZ > bounds.maxZ
    ) {
      return;
    }
    const halfWidth = ((roadWidthsMeters[road.highway] ?? 4) * sceneUnitsPerMeter) / 2;
    const unpaved = /^(unpaved|gravel|fine_gravel|ground|dirt|earth|grass|compacted|mud|sand)$/i.test(road.surface ?? "");
    const part = parts[unpaved ? "unpaved" : "paved"];

    for (let index = 0; index < road.points.length - 1; index += 1) {
      const clipped = clipRoadSegment(road.points[index], road.points[index + 1], bounds);
      if (clipped === null) continue;
      const [start, end] = clipped;
      const directionX = end.x - start.x;
      const directionZ = end.z - start.z;
      const length = Math.hypot(directionX, directionZ);
      if (length <= 1e-9) continue;
      const sideX = -directionZ / length;
      const sideZ = directionX / length;
      const lift = 0.035 * sceneUnitsPerMeter;
      const firstIndex = part.positions.length / 3;
      const vertices = [
        { x: start.x + sideX * halfWidth, z: start.z + sideZ * halfWidth },
        { x: start.x - sideX * halfWidth, z: start.z - sideZ * halfWidth },
        { x: end.x - sideX * halfWidth, z: end.z - sideZ * halfWidth },
        { x: end.x + sideX * halfWidth, z: end.z + sideZ * halfWidth },
      ];
      vertices.forEach((point) => {
        part.positions.push(point.x, heightAt(point.x, point.z) + lift, point.z);
        part.normals.push(0, 1, 0);
      });
      part.indices.push(firstIndex, firstIndex + 2, firstIndex + 1, firstIndex, firstIndex + 3, firstIndex + 2);
    }
  });

  return Object.freeze((Object.keys(parts) as MappedRoadSurface[])
    .filter((surface) => parts[surface].indices.length > 0)
    .map((surface) => Object.freeze({
      surface,
      geometry: Object.freeze({
        positions: Object.freeze(parts[surface].positions),
        normals: Object.freeze(parts[surface].normals),
        indices: Object.freeze(parts[surface].indices),
      }),
    })));
};
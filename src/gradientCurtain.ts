import type { TrackBounds, TrackMeshData, TrackMeshPart } from "./trackGeometry";

export type GradientCurtainMeshData = TrackMeshPart & Readonly<{ bounds: TrackBounds; colors: readonly number[] }>;

type Point3 = Readonly<{ x: number; y: number; z: number }>;
type MutableMeshPart = { positions: number[]; normals: number[]; indices: number[]; colors: number[] };
type ColorStop = Readonly<{ gradient: number; color: readonly [number, number, number] }>;

const colorStops: readonly ColorStop[] = [
  { gradient: -10, color: [0.12, 0.38, 0.92] },
  { gradient: -5, color: [0.12, 0.72, 0.82] },
  { gradient: 0, color: [0.2, 0.72, 0.28] },
  { gradient: 5, color: [0.98, 0.76, 0.12] },
  { gradient: 10, color: [0.9, 0.14, 0.08] },
];

const createMutableMeshPart = (): MutableMeshPart => ({ positions: [], normals: [], indices: [], colors: [] });

export const getGradientCurtainColor = (gradient: number): readonly [number, number, number] => {
  const clampedGradient = Math.max(colorStops[0].gradient, Math.min(colorStops[colorStops.length - 1].gradient, gradient));
  const exactStop = colorStops.find((stop) => stop.gradient === clampedGradient);
  if (exactStop !== undefined) {
    return exactStop.color;
  }

  const upperStopIndex = colorStops.findIndex((stop) => stop.gradient >= clampedGradient);
  const upperStop = colorStops[upperStopIndex];
  const lowerStop = colorStops[Math.max(0, upperStopIndex - 1)];
  const progress = upperStop.gradient === lowerStop.gradient
    ? 0
    : (clampedGradient - lowerStop.gradient) / (upperStop.gradient - lowerStop.gradient);

  return [
    lowerStop.color[0] + (upperStop.color[0] - lowerStop.color[0]) * progress,
    lowerStop.color[1] + (upperStop.color[1] - lowerStop.color[1]) * progress,
    lowerStop.color[2] + (upperStop.color[2] - lowerStop.color[2]) * progress,
  ];
};

const subtract = (left: Point3, right: Point3): Point3 => ({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
});

const normalize = (point: Point3): Point3 => {
  const length = Math.hypot(point.x, point.y, point.z);
  return length === 0 ? { x: 1, y: 0, z: 0 } : { x: point.x / length, y: point.y / length, z: point.z / length };
};

const cross = (left: Point3, right: Point3): Point3 => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x,
});

export const createGradientCurtainMeshData = (geometry: TrackMeshData): GradientCurtainMeshData => {
  const route = geometry.routePoints;
  const roadDepth = 2 * geometry.projection.sceneUnitsPerMeter;
  const routeBounds = route.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y - roadDepth),
    minZ: Math.min(bounds.minZ, point.z),
    maxZ: Math.max(bounds.maxZ, point.z),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  });
  const baselineY = routeBounds.minY - 4 * geometry.projection.sceneUnitsPerMeter;
  const bounds = Object.freeze({ ...routeBounds, minY: baselineY });
  const mesh = createMutableMeshPart();

  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const vertices = [
      { x: start.x, y: start.y - roadDepth, z: start.z },
      { x: end.x, y: end.y - roadDepth, z: end.z },
      { x: end.x, y: baselineY, z: end.z },
      { x: start.x, y: baselineY, z: start.z },
    ] as const;

    if (vertices[0].y <= baselineY && vertices[1].y <= baselineY) {
      continue;
    }

    const segmentDirection = subtract(vertices[1], vertices[0]);
    const normal = normalize(cross(segmentDirection, subtract(vertices[2], vertices[1])));
    const firstIndex = mesh.positions.length / 3;
    const gradientColor = getGradientCurtainColor(start.gradientPercent ?? 0);

    vertices.forEach((vertex) => {
      mesh.positions.push(vertex.x, vertex.y, vertex.z);
      mesh.normals.push(normal.x, normal.y, normal.z);
      mesh.colors.push(gradientColor[0], gradientColor[1], gradientColor[2], 1);
    });
    mesh.indices.push(firstIndex, firstIndex + 1, firstIndex + 2, firstIndex, firstIndex + 2, firstIndex + 3);
  }

  return Object.freeze({
    bounds,
    positions: Object.freeze(mesh.positions),
    normals: Object.freeze(mesh.normals),
    indices: Object.freeze(mesh.indices),
    colors: Object.freeze(mesh.colors),
  });
};
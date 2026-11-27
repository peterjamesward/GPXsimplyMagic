export type RideTreeKind = "pine" | "oak" | "aspen";
export type RideTreeLod = "small" | "medium" | "large";

export const getRideTreeTargetCount = (gridSize: number): number => {
  const originalTarget = gridSize >= 33 ? 62 : gridSize >= 17 ? 34 : 12;
  return Math.round(originalTarget * 0.6 * 0.7);
};

export const getRideTreeKind = (sample: number): RideTreeKind =>
  sample < 0.58 ? "pine" : sample < 0.79 ? "oak" : "aspen";

export const getRideTreeLod = (gridSize: number): RideTreeLod =>
  gridSize >= 33 ? "large" : gridSize >= 17 ? "medium" : "small";
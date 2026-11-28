export const readRasterElevation = (
  pixels: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number | null => {
  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > width - 1 ||
    y > height - 1
  ) {
    return null;
  }

  const left = Math.floor(x);
  const top = Math.floor(y);
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const columnRatio = x - left;
  const rowRatio = y - top;
  const values = [
    { value: pixels[top * width + left], weight: (1 - columnRatio) * (1 - rowRatio) },
    { value: pixels[top * width + right], weight: columnRatio * (1 - rowRatio) },
    { value: pixels[bottom * width + left], weight: (1 - columnRatio) * rowRatio },
    { value: pixels[bottom * width + right], weight: columnRatio * rowRatio },
  ].filter((sample) => Number.isFinite(sample.value) && Math.abs(sample.value) < 1e20 && sample.weight > 0);
  const totalWeight = values.reduce((total, sample) => total + sample.weight, 0);

  return totalWeight === 0
    ? null
    : values.reduce((total, sample) => total + sample.value * sample.weight, 0) / totalWeight;
};

export const readSparseRasterElevation = (
  pixels: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  maximumDistance: number,
): number | null => {
  const interpolated = readRasterElevation(pixels, width, height, x, y);
  if (interpolated !== null) {
    return interpolated;
  }
  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(maximumDistance) ||
    maximumDistance <= 0 ||
    x < 0 ||
    y < 0 ||
    x > width - 1 ||
    y > height - 1
  ) {
    return null;
  }

  const minColumn = Math.max(0, Math.floor(x - maximumDistance));
  const maxColumn = Math.min(width - 1, Math.ceil(x + maximumDistance));
  const minRow = Math.max(0, Math.floor(y - maximumDistance));
  const maxRow = Math.min(height - 1, Math.ceil(y + maximumDistance));
  let weightedElevation = 0;
  let totalWeight = 0;
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const distance = Math.hypot(column - x, row - y);
      if (distance > maximumDistance) {
        continue;
      }
      const elevation = pixels[row * width + column];
      if (!Number.isFinite(elevation) || Math.abs(elevation) >= 1e20) {
        continue;
      }
      if (distance === 0) {
        return elevation;
      }
      const weight = 1 / (distance * distance);
      weightedElevation += elevation * weight;
      totalWeight += weight;
    }
  }
  return totalWeight === 0 ? null : weightedElevation / totalWeight;
};
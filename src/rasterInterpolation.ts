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
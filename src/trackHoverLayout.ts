type Point2 = Readonly<{ x: number; y: number }>;
type Size = Readonly<{ width: number; height: number }>;

export type TrackHoverLayout = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}>;

const defaultPanelSize = { width: 360, height: 136 };
const viewportMargin = 12;
const anchorGap = 18;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

export const getTrackHoverLayout = (
  anchor: Point2,
  viewport: Size,
): TrackHoverLayout | null => {
  if (
    ![anchor.x, anchor.y, viewport.width, viewport.height].every(Number.isFinite) ||
    viewport.width <= viewportMargin * 2 ||
    viewport.height <= viewportMargin * 2
  ) {
    return null;
  }

  const scale = Math.min(
    1,
    (viewport.width - viewportMargin * 2) / defaultPanelSize.width,
    (viewport.height - viewportMargin * 2) / defaultPanelSize.height,
  );
  const width = defaultPanelSize.width * scale;
  const height = defaultPanelSize.height * scale;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const horizontalDirection = anchor.x < viewport.width / 2 ? 1 : -1;
  const verticalDirection = anchor.y < viewport.height / 2 ? 1 : -1;
  const centerX = clamp(
    anchor.x + horizontalDirection * (halfWidth + anchorGap),
    viewportMargin + halfWidth,
    viewport.width - viewportMargin - halfWidth,
  );
  const centerY = clamp(
    anchor.y + verticalDirection * (halfHeight + anchorGap),
    viewportMargin + halfHeight,
    viewport.height - viewportMargin - halfHeight,
  );

  return Object.freeze({
    left: centerX - halfWidth,
    top: centerY - halfHeight,
    width,
    height,
    centerX,
    centerY,
  });
};

export const getTrackHoverTolerance = (
  roadHalfWidth: number,
  cameraDistance: number,
  verticalFov: number,
  viewportHeight: number,
  paddingPixels = 36,
): number => {
  if (
    ![roadHalfWidth, cameraDistance, verticalFov, viewportHeight, paddingPixels].every(Number.isFinite) ||
    roadHalfWidth < 0 ||
    cameraDistance <= 0 ||
    verticalFov <= 0 ||
    verticalFov >= Math.PI ||
    viewportHeight <= 0 ||
    paddingPixels < 0
  ) {
    return Math.max(0, Number.isFinite(roadHalfWidth) ? roadHalfWidth : 0);
  }

  const worldUnitsPerPixel = (2 * cameraDistance * Math.tan(verticalFov / 2)) / viewportHeight;
  return roadHalfWidth + worldUnitsPerPixel * paddingPixels;
};
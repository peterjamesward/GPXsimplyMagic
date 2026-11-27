import { getGradientCurtainColor } from "./gradientCurtain";
import type { TrackRoutePoint } from "./trackGeometry";
import {
  createTrackProfileViewState,
  focusTrackProfileView,
  getTrackProfileMetersPerPixel,
  getTrackProfilePlotBounds,
  getTrackProfilePointAtDistance,
  getTrackProfilePointAtPosition,
  getTrackProfileScreenPoint,
  panTrackProfileView,
  zoomTrackProfileView,
  type TrackProfilePlotBounds,
  type TrackProfileScreenPoint,
  type TrackProfileViewState,
} from "./trackProfile";

type ProfileHover = Readonly<{ point: TrackRoutePoint; position: TrackProfileScreenPoint }>;
type PointerPosition = Readonly<{ x: number; y: number }>;

export const createTrackProfileView = (
  canvas: HTMLCanvasElement,
  onHover: (hover: ProfileHover | null) => void,
  onFocus: (pointIndex: number, metersPerPixel?: number) => void,
): Readonly<{
  setRoute: (points: readonly TrackRoutePoint[]) => void;
  focusOnPoint: (pointIndex: number, metersPerPixel: number) => void;
  setRiderDistance: (distanceMeters: number | null) => void;
  refresh: () => void;
}> => {
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("The elevation profile requires a 2D canvas context.");
  }
  const baseCanvas = canvas.ownerDocument.createElement("canvas");
  const baseContext = baseCanvas.getContext("2d");
  if (baseContext === null) {
    throw new Error("The elevation profile requires an offscreen 2D canvas context.");
  }

  let routePoints: readonly TrackRoutePoint[] = [];
  let viewState: TrackProfileViewState | null = null;
  let hover: ProfileHover | null = null;
  let riderDistanceMeters: number | null = null;
  let dragging = false;
  let lastPointer: PointerPosition | null = null;

  const getCanvasSize = (): Readonly<{ width: number; height: number }> => {
    const bounds = canvas.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  };

  const getPlot = (): TrackProfilePlotBounds => {
    const { width, height } = getCanvasSize();
    return getTrackProfilePlotBounds(width, height);
  };

  const getPointerPosition = (event: PointerEvent | WheelEvent | MouseEvent): PointerPosition => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const drawBase = (): void => {
    const { width, height } = getCanvasSize();
    if (width <= 0 || height <= 0) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;
    const backingWidth = Math.round(width * pixelRatio);
    const backingHeight = Math.round(height * pixelRatio);
    if (baseCanvas.width !== backingWidth || baseCanvas.height !== backingHeight) {
      baseCanvas.width = backingWidth;
      baseCanvas.height = backingHeight;
    }
    baseContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    baseContext.clearRect(0, 0, width, height);
    baseContext.fillStyle = "#202a2a";
    baseContext.fillRect(0, 0, width, height);

    const plot = getTrackProfilePlotBounds(width, height);
    if (plot.width <= 0 || plot.height <= 0) {
      return;
    }

    baseContext.font = "10px 'DM Mono', monospace";
    baseContext.textAlign = "right";
    baseContext.textBaseline = "middle";
    baseContext.fillStyle = "#aab8b2";
    baseContext.strokeStyle = "rgba(218, 231, 224, 0.18)";
    baseContext.lineWidth = 1;

    const altitudeRange = viewState === null ? 0 : viewState.maxAltitudeMeters - viewState.minAltitudeMeters;
    const distanceRange = viewState === null ? 0 : viewState.maxDistanceMeters - viewState.minDistanceMeters;
    for (let tick = 0; tick <= 4; tick += 1) {
      const y = plot.top + (plot.height * tick) / 4;
      baseContext.beginPath();
      baseContext.moveTo(plot.left, y);
      baseContext.lineTo(plot.left + plot.width, y);
      baseContext.stroke();
      if (viewState !== null) {
        const altitude = viewState.maxAltitudeMeters - (altitudeRange * tick) / 4;
        baseContext.fillText(`${Math.round(altitude)} m`, plot.left - 8, y);
      }
    }

    baseContext.textAlign = "center";
    baseContext.textBaseline = "top";
    for (let tick = 0; tick <= 4; tick += 1) {
      const x = plot.left + (plot.width * tick) / 4;
      baseContext.beginPath();
      baseContext.moveTo(x, plot.top);
      baseContext.lineTo(x, plot.top + plot.height);
      baseContext.stroke();
      if (viewState !== null) {
        const distanceKm = (viewState.minDistanceMeters + (distanceRange * tick) / 4) / 1000;
        baseContext.fillText(`${distanceKm.toFixed(1)} km`, x, plot.top + plot.height + 5);
      }
    }

    if (routePoints.length < 2 || viewState === null) {
      baseContext.font = "12px 'DM Sans', sans-serif";
      baseContext.fillStyle = "#d2ddd7";
      baseContext.fillText("Load a GPX route to see its elevation profile", width / 2, height / 2);
      return;
    }
    const currentViewState = viewState;

    baseContext.save();
    baseContext.beginPath();
    baseContext.rect(plot.left, plot.top, plot.width, plot.height);
    baseContext.clip();

    const baseline = plot.top + plot.height;
    routePoints.slice(0, -1).forEach((point, index) => {
      const next = routePoints[index + 1];
      const start = getTrackProfileScreenPoint(point, currentViewState, plot);
      const end = getTrackProfileScreenPoint(next, currentViewState, plot);
      const color = getGradientCurtainColor(point.gradientPercent ?? 0)
        .map((channel) => Math.round(channel * 255));
      baseContext.beginPath();
      baseContext.moveTo(start.x, start.y);
      baseContext.lineTo(end.x, end.y);
      baseContext.lineTo(end.x, baseline);
      baseContext.lineTo(start.x, baseline);
      baseContext.closePath();
      baseContext.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.82)`;
      baseContext.fill();
    });

    baseContext.beginPath();
    routePoints.forEach((point, index) => {
      const position = getTrackProfileScreenPoint(point, currentViewState, plot);
      if (index === 0) {
        baseContext.moveTo(position.x, position.y);
      } else {
        baseContext.lineTo(position.x, position.y);
      }
    });
    baseContext.strokeStyle = "#f4f8f5";
    baseContext.lineWidth = 1.5;
    baseContext.stroke();
    baseContext.restore();
  };

  const drawHover = (): void => {
    const { width, height } = getCanvasSize();
    if (width <= 0 || height <= 0) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;
    const backingWidth = Math.round(width * pixelRatio);
    const backingHeight = Math.round(height * pixelRatio);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(baseCanvas, 0, 0, backingWidth, backingHeight, 0, 0, width, height);

    if (viewState === null) {
      return;
    }
    const plot = getTrackProfilePlotBounds(width, height);
    context.save();
    context.beginPath();
    context.rect(plot.left, plot.top, plot.width, plot.height);
    context.clip();
    if (riderDistanceMeters !== null) {
      const riderPoint = getTrackProfilePointAtDistance(routePoints, riderDistanceMeters);
      const distanceRange = viewState.maxDistanceMeters - viewState.minDistanceMeters;
      if (riderPoint !== null && distanceRange > 0 && riderDistanceMeters >= viewState.minDistanceMeters && riderDistanceMeters <= viewState.maxDistanceMeters) {
        const x = plot.left + ((riderDistanceMeters - viewState.minDistanceMeters) / distanceRange) * plot.width;
        const marker = getTrackProfileScreenPoint(riderPoint.point, viewState, plot);
        context.setLineDash([4, 3]);
        context.strokeStyle = "#76ddbd";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(x, plot.top);
        context.lineTo(x, plot.top + plot.height);
        context.stroke();
        context.setLineDash([]);
        context.beginPath();
        context.arc(x, marker.y, 4, 0, Math.PI * 2);
        context.fillStyle = "#76ddbd";
        context.fill();
        context.strokeStyle = "#10201b";
        context.lineWidth = 1;
        context.stroke();
      }
    }
    if (hover === null) {
      context.restore();
      return;
    }
    context.setLineDash([3, 3]);
    context.strokeStyle = "rgba(255, 255, 255, 0.88)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(hover.position.x, plot.top);
    context.lineTo(hover.position.x, plot.top + plot.height);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(hover.position.x, hover.position.y, 3, 0, Math.PI * 2);
    context.fillStyle = "#fff";
    context.fill();
    context.restore();
  };

  const draw = (): void => {
    drawBase();
    drawHover();
  };

  const updateHover = (position: PointerPosition): void => {
    if (viewState === null) {
      hover = null;
    } else {
      const match = getTrackProfilePointAtPosition(routePoints, viewState, getPlot(), position, 36);
      hover = match === null
        ? null
        : { point: match.point, position: getTrackProfileScreenPoint(match.point, viewState, getPlot()) };
    }
    onHover(hover);
    drawHover();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || routePoints.length < 2) {
      return;
    }
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    dragging = true;
    lastPointer = getPointerPosition(event);
    canvas.classList.add("is-panning");
  };

  const onPointerMove = (event: PointerEvent): void => {
    const position = getPointerPosition(event);
    if (dragging && lastPointer !== null && viewState !== null) {
      const deltaX = position.x - lastPointer.x;
      const deltaY = position.y - lastPointer.y;
      const plot = getPlot();
      viewState = panTrackProfileView(viewState, deltaX, deltaY, plot.width, plot.height);
      lastPointer = position;
      drawBase();
    }
    updateHover(position);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    lastPointer = null;
    canvas.classList.remove("is-panning");
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  const onWheel = (event: WheelEvent): void => {
    if (viewState === null) {
      return;
    }
    const position = getPointerPosition(event);
    const plot = getPlot();
    if (plot.width <= 0 || plot.height <= 0) {
      return;
    }
    event.preventDefault();
    const horizontalFraction = Math.max(0, Math.min(1, (position.x - plot.left) / plot.width));
    const scaleFactor = Math.max(0.1, Math.min(10, Math.exp(event.deltaY * 0.001)));
    viewState = zoomTrackProfileView(viewState, routePoints, horizontalFraction, scaleFactor);
    drawBase();
    updateHover(position);
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if (viewState === null) {
      return;
    }
    const position = getPointerPosition(event);
    const match = getTrackProfilePointAtPosition(routePoints, viewState, getPlot(), position, 18);
    if (match !== null) {
      event.preventDefault();
      const metersPerPixel = getTrackProfileMetersPerPixel(viewState, getPlot().width);
      onFocus(match.index, metersPerPixel ?? undefined);
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", () => {
    if (!dragging) {
      hover = null;
      onHover(null);
      drawHover();
    }
  });
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDoubleClick);
  draw();

  return Object.freeze({
    setRoute: (points: readonly TrackRoutePoint[]): void => {
      routePoints = points;
      viewState = points.length === 0 ? null : createTrackProfileViewState(points);
      hover = null;
      riderDistanceMeters = null;
      onHover(null);
      draw();
    },
    focusOnPoint: (pointIndex: number, metersPerPixel: number): void => {
      const point = routePoints[pointIndex];
      if (viewState === null || point === undefined) {
        return;
      }
      viewState = focusTrackProfileView(
        viewState,
        routePoints,
        point.distanceMeters,
        metersPerPixel,
        getPlot().width,
      );
      hover = null;
      onHover(null);
      draw();
    },
    setRiderDistance: (distanceMeters: number | null): void => {
      riderDistanceMeters = distanceMeters;
      drawHover();
    },
    refresh: draw,
  });
};
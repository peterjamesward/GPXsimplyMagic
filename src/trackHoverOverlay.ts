import {
  addToScene,
  createLineMaterial,
  createLineSystem,
  getCameraPosition,
  getEffectiveAspectRatio,
  getViewMatrix,
  getViewProjectionMatrix,
  projectWorldToScreen,
  setMeshVisible,
  updateLineSystem,
} from "@babylonjs/lite";
import type { ArcRotateCamera, EngineContext, SceneContext } from "@babylonjs/lite";
import { getCameraViewDirection, getPointerRay } from "./cameraControls";
import { createTrackPointRayIndex } from "./trackHover";
import type { TrackMeshData, TrackRoutePoint } from "./trackGeometry";
import { createTrackHoverCard } from "./trackHoverCard";
import { getTrackHoverLayout, getTrackHoverTolerance } from "./trackHoverLayout";

export const createTrackHoverOverlay = (
  engine: EngineContext,
  scene: SceneContext,
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
): Readonly<{
  setRoute: (geometry: TrackMeshData | null) => void;
  updatePointer: (clientX: number, clientY: number) => void;
  refresh: () => void;
  hide: () => void;
}> => {
  const overlayHost = canvas.parentElement;
  if (overlayHost === null) {
    throw new Error("The track hover overlay requires the viewer canvas to be attached to a parent element.");
  }
  const card = createTrackHoverCard(overlayHost);

  const leader = createLineSystem(engine, {
    name: "track-hover-leader",
    lines: [[{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]],
    material: createLineMaterial({
      color: { r: 1, g: 1, b: 1, a: 1 },
      depthWrite: false,
      depthCompare: "always",
    }),
  });
  leader.pickable = false;
  leader.renderOnTop = true;
  addToScene(scene, leader);
  setMeshVisible(leader, false);

  let route: TrackMeshData | null = null;
  let findPointNearRay = createTrackPointRayIndex([]);
  let lastPointNumber: number | null = null;
  let activePoint: TrackRoutePoint | null = null;
  let visible = false;

  const hide = (): void => {
    activePoint = null;
    card.hide();
    if (visible) {
      setMeshVisible(leader, false);
      visible = false;
    }
  };

  const setRoute = (geometry: TrackMeshData | null): void => {
    route = geometry;
    findPointNearRay = createTrackPointRayIndex(geometry?.routePoints ?? []);
    lastPointNumber = null;
    hide();
  };

  const positionOverlay = (): void => {
    if (activePoint === null) {
      return;
    }

    const forward = getCameraViewDirection(camera);
    const bounds = canvas.getBoundingClientRect();
    const hostBounds = overlayHost.getBoundingClientRect();
    if (forward === null || bounds.width <= 0 || bounds.height <= 0) {
      hide();
      return;
    }

    const projection = projectWorldToScreen(
      activePoint,
      getViewMatrix(camera),
      getViewProjectionMatrix(camera, getEffectiveAspectRatio(camera, bounds.width, bounds.height)),
      {
        viewport: { x: 0, y: 0, width: bounds.width, height: bounds.height },
        backingWidth: bounds.width,
        backingHeight: bounds.height,
        cssWidth: bounds.width,
        cssHeight: bounds.height,
      },
    );
    if (projection.behindCamera || !Number.isFinite(projection.cssX) || !Number.isFinite(projection.cssY)) {
      hide();
      return;
    }

    const layout = getTrackHoverLayout(
      { x: projection.cssX, y: projection.cssY },
      { width: bounds.width, height: bounds.height },
    );
    if (layout === null) {
      hide();
      return;
    }

    const cameraPosition = getCameraPosition(camera);
    const depth =
      (activePoint.x - cameraPosition.x) * forward.x +
      (activePoint.y - cameraPosition.y) * forward.y +
      (activePoint.z - cameraPosition.z) * forward.z;
    if (depth <= 0 || !Number.isFinite(depth)) {
      hide();
      return;
    }

    const worldUnitsPerPixel = (2 * depth * Math.tan(camera.fov / 2)) / bounds.height;
    if (!Number.isFinite(worldUnitsPerPixel) || worldUnitsPerPixel <= 0) {
      hide();
      return;
    }

    const panelRay = getPointerRay(
      camera,
      canvas,
      bounds.left + layout.centerX,
      bounds.top + layout.centerY,
    );
    if (panelRay === null) {
      hide();
      return;
    }
    const rayDirection = {
      x: panelRay.direction[0],
      y: panelRay.direction[1],
      z: panelRay.direction[2],
    };
    const rayOrigin = {
      x: panelRay.origin[0],
      y: panelRay.origin[1],
      z: panelRay.origin[2],
    };
    const rayForward = rayDirection.x * forward.x + rayDirection.y * forward.y + rayDirection.z * forward.z;
    if (Math.abs(rayForward) < 1e-8) {
      hide();
      return;
    }
    const rayDistance =
      ((activePoint.x - rayOrigin.x) * forward.x +
        (activePoint.y - rayOrigin.y) * forward.y +
        (activePoint.z - rayOrigin.z) * forward.z) / rayForward;
    if (rayDistance <= 0) {
      hide();
      return;
    }

    const cameraPlaneCenter = {
      x: rayOrigin.x + rayDirection.x * rayDistance,
      y: rayOrigin.y + rayDirection.y * rayDistance,
      z: rayOrigin.z + rayDirection.z * rayDistance,
    };
    const horizontalRight = { x: forward.z, y: 0, z: -forward.x };
    const rightLength = Math.hypot(horizontalRight.x, horizontalRight.z);
    const right = rightLength < 1e-8
      ? { x: 1, y: 0, z: 0 }
      : { x: horizontalRight.x / rightLength, y: 0, z: horizontalRight.z / rightLength };
    const up = {
      x: forward.y * right.z - forward.z * right.y,
      y: forward.z * right.x - forward.x * right.z,
      z: forward.x * right.y - forward.y * right.x,
    };

    const anchorDeltaX = projection.cssX - layout.centerX;
    const anchorDeltaY = projection.cssY - layout.centerY;
    const edgeFraction = Math.min(
      1,
      Math.abs(anchorDeltaX) < 1e-8 ? Number.POSITIVE_INFINITY : layout.width / 2 / Math.abs(anchorDeltaX),
      Math.abs(anchorDeltaY) < 1e-8 ? Number.POSITIVE_INFINITY : layout.height / 2 / Math.abs(anchorDeltaY),
    );
    const leaderEnd = {
      x: cameraPlaneCenter.x + right.x * anchorDeltaX * edgeFraction * worldUnitsPerPixel - up.x * anchorDeltaY * edgeFraction * worldUnitsPerPixel,
      y: cameraPlaneCenter.y + right.y * anchorDeltaX * edgeFraction * worldUnitsPerPixel - up.y * anchorDeltaY * edgeFraction * worldUnitsPerPixel,
      z: cameraPlaneCenter.z + right.z * anchorDeltaX * edgeFraction * worldUnitsPerPixel - up.z * anchorDeltaY * edgeFraction * worldUnitsPerPixel,
    };
    updateLineSystem(engine, leader, { lines: [[activePoint, leaderEnd]] });
    card.setLayout(layout, { x: bounds.left - hostBounds.left, y: bounds.top - hostBounds.top });
    card.show();
    if (!visible) {
      setMeshVisible(leader, true);
      visible = true;
    }
  };

  const updatePointer = (clientX: number, clientY: number): void => {
    if (route === null) {
      hide();
      return;
    }

    const bounds = canvas.getBoundingClientRect();
    const pickingRay = getPointerRay(camera, canvas, clientX, clientY);
    const ray = pickingRay === null
      ? null
      : {
          origin: { x: pickingRay.origin[0], y: pickingRay.origin[1], z: pickingRay.origin[2] },
          direction: { x: pickingRay.direction[0], y: pickingRay.direction[1], z: pickingRay.direction[2] },
        };
    const tolerance = getTrackHoverTolerance(route.roadHalfWidth, camera.radius, camera.fov, bounds.height);
    const point = ray === null ? null : findPointNearRay(ray, tolerance);
    if (point === null) {
      hide();
      return;
    }

    activePoint = point;
    if (lastPointNumber !== point.pointNumber) {
      card.setPoint(point);
      lastPointNumber = point.pointNumber;
    }
    positionOverlay();
  };

  return Object.freeze({ setRoute, updatePointer, refresh: positionOverlay, hide });
};
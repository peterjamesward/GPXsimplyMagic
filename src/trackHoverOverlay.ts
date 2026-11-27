import * as THREE from "three";
import { getCameraPosition, getCameraViewDirection, type RouteCamera } from "./cameraControls";
import { createTrackPointRayIndex } from "./trackHover";
import type { TrackMeshData, TrackRoutePoint } from "./trackGeometry";
import type { RouteRenderer } from "./routeRenderer";
import { createTrackHoverCard } from "./trackHoverCard";
import { getTrackHoverLayout, getTrackHoverTolerance } from "./trackHoverLayout";

export const createTrackHoverOverlay = (
  renderer: Pick<RouteRenderer, "addOverlay" | "getPointerRay">,
  camera: RouteCamera,
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
  const leaderPositions = new Float32Array(6);
  const leaderGeometry = new THREE.BufferGeometry();
  const leaderAttribute = new THREE.BufferAttribute(leaderPositions, 3);
  leaderAttribute.setUsage(THREE.DynamicDrawUsage);
  leaderGeometry.setAttribute("position", leaderAttribute);
  const leader = new THREE.Line(
    leaderGeometry,
    new THREE.LineBasicMaterial({ color: "#ffffff", depthTest: false, depthWrite: false }),
  );
  leader.name = "track-hover-leader";
  leader.renderOrder = 10_000;
  leader.frustumCulled = false;
  leader.visible = false;
  renderer.addOverlay(leader);

  let route: TrackMeshData | null = null;
  let findPointNearRay = createTrackPointRayIndex([]);
  let lastPointNumber: number | null = null;
  let activePoint: TrackRoutePoint | null = null;

  const hide = (): void => {
    activePoint = null;
    card.hide();
    leader.visible = false;
  };

  const setRoute = (geometry: TrackMeshData | null): void => {
    route = geometry;
    findPointNearRay = createTrackPointRayIndex(geometry?.routePoints ?? []);
    lastPointNumber = null;
    hide();
  };

  const positionOverlay = (): void => {
    if (activePoint === null) return;
    const forward = getCameraViewDirection(camera);
    const bounds = canvas.getBoundingClientRect();
    const hostBounds = overlayHost.getBoundingClientRect();
    if (forward === null || bounds.width <= 0 || bounds.height <= 0) {
      hide();
      return;
    }

    const cameraPoint = new THREE.Vector3(activePoint.x, activePoint.y, activePoint.z);
    const projected = cameraPoint.clone().project(camera.renderCamera);
    const screenX = ((projected.x + 1) / 2) * bounds.width;
    const screenY = ((1 - projected.y) / 2) * bounds.height;
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
      hide();
      return;
    }
    const layout = getTrackHoverLayout(
      { x: screenX, y: screenY },
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

    const panelRay = renderer.getPointerRay(
      bounds.left + layout.centerX,
      bounds.top + layout.centerY,
    );
    if (panelRay === null) {
      hide();
      return;
    }
    const rayDirection = panelRay.direction;
    const rayOrigin = panelRay.origin;
    const rayForward = rayDirection.x * forward.x + rayDirection.y * forward.y + rayDirection.z * forward.z;
    if (Math.abs(rayForward) < 1e-8) {
      hide();
      return;
    }
    const rayDistance = (
      (activePoint.x - rayOrigin.x) * forward.x +
      (activePoint.y - rayOrigin.y) * forward.y +
      (activePoint.z - rayOrigin.z) * forward.z
    ) / rayForward;
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

    const anchorDeltaX = screenX - layout.centerX;
    const anchorDeltaY = screenY - layout.centerY;
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
    leaderPositions.set([activePoint.x, activePoint.y, activePoint.z, leaderEnd.x, leaderEnd.y, leaderEnd.z]);
    leaderAttribute.needsUpdate = true;
    leaderGeometry.computeBoundingSphere();
    card.setLayout(layout, { x: bounds.left - hostBounds.left, y: bounds.top - hostBounds.top });
    card.show();
    leader.visible = true;
  };

  const updatePointer = (clientX: number, clientY: number): void => {
    if (route === null) {
      hide();
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const ray = renderer.getPointerRay(clientX, clientY);
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

  return Object.freeze({
    setRoute,
    updatePointer,
    refresh: positionOverlay,
    hide,
  });
};
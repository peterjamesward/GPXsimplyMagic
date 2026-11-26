import {
  attachControl,
  createArcRotateCamera,
  createPickingRay,
  getCameraPosition,
  getEffectiveAspectRatio,
  getViewProjectionMatrix,
  pickWithRayPrecise,
} from "@babylonjs/lite";
import type { ArcRotateCamera, SceneContext } from "@babylonjs/lite";
import type { TrackBounds } from "./trackGeometry";

type Point3 = Readonly<{ x: number; y: number; z: number }>;

export const createRouteCamera = (): ArcRotateCamera =>
  createArcRotateCamera(-Math.PI / 2, 1.08, 18, { x: 0, y: 0, z: 0 });

export const isPrimaryDragPan = (event: Pick<PointerEvent, "button" | "ctrlKey">): boolean =>
  event.button === 0 && !event.ctrlKey;

export const isControlClickOrbit = (event: Pick<PointerEvent, "button" | "ctrlKey">): boolean =>
  event.button === 0 && event.ctrlKey;

export const getPointerZoomAnchor = (
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): Point3 | null => {
  const normal = getCameraViewDirection(camera);
  if (normal === null) {
    return null;
  }

  return getPointerPlaneIntersection(camera, canvas, clientX, clientY, camera.target, normal);
};

const getPointerRay = (
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
) => {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) {
    return null;
  }

  return createPickingRay(
    clientX - bounds.left,
    clientY - bounds.top,
    getViewProjectionMatrix(camera, getEffectiveAspectRatio(camera, bounds.width, bounds.height)),
    bounds.width,
    bounds.height,
  );
};

export const getCameraViewDirection = (camera: ArcRotateCamera): Point3 | null => {
  const cameraPosition = getCameraPosition(camera);
  const forward = {
    x: camera.target.x - cameraPosition.x,
    y: camera.target.y - cameraPosition.y,
    z: camera.target.z - cameraPosition.z,
  };
  const forwardLength = Math.hypot(forward.x, forward.y, forward.z);
  return forwardLength === 0
    ? null
    : { x: forward.x / forwardLength, y: forward.y / forwardLength, z: forward.z / forwardLength };
};

export const fitCameraToBounds = (
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  bounds: TrackBounds,
): boolean => {
  const { width, height } = canvas.getBoundingClientRect();
  if (width <= 0 || height <= 0) {
    return false;
  }

  const coordinates = [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, bounds.minZ, bounds.maxZ];
  if (!coordinates.every(Number.isFinite)) {
    return false;
  }

  const verticalHalfFov = camera.fov / 2;
  const aspectRatio = getEffectiveAspectRatio(camera, width, height);
  if (verticalHalfFov <= 0 || verticalHalfFov >= Math.PI / 2 || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return false;
  }

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const boundingRadius = Math.hypot(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  ) / 2;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspectRatio);
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  const radius = Math.max(0.01, (boundingRadius / Math.sin(limitingHalfFov)) * 1.15);
  if (!Number.isFinite(radius)) {
    return false;
  }

  camera.target.x = centerX;
  camera.target.y = centerY;
  camera.target.z = centerZ;
  camera.radius = radius;
  camera.inertialAlphaOffset = 0;
  camera.inertialBetaOffset = 0;
  camera.inertialRadiusOffset = 0;
  camera.inertialPanningX = 0;
  camera.inertialPanningY = 0;
  return true;
};

export const getPointerPlaneIntersection = (
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  planePoint: Point3,
  planeNormal: Point3,
): Point3 | null => {
  const ray = getPointerRay(camera, canvas, clientX, clientY);
  if (ray === null) {
    return null;
  }

  const denominator = ray.direction[0] * planeNormal.x + ray.direction[1] * planeNormal.y + ray.direction[2] * planeNormal.z;
  if (Math.abs(denominator) < 1e-8) {
    return null;
  }

  const distance = (
    (planePoint.x - ray.origin[0]) * planeNormal.x +
    (planePoint.y - ray.origin[1]) * planeNormal.y +
    (planePoint.z - ray.origin[2]) * planeNormal.z
  ) / denominator;
  if (!Number.isFinite(distance) || distance < 0) {
    return null;
  }

  return {
    x: ray.origin[0] + ray.direction[0] * distance,
    y: ray.origin[1] + ray.direction[1] * distance,
    z: ray.origin[2] + ray.direction[2] * distance,
  };
};

export const getPointerPanAnchor = (
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  scene: SceneContext,
  clientX: number,
  clientY: number,
): Readonly<{ point: Point3; normal: Point3 }> | null => {
  const normal = getCameraViewDirection(camera);
  const ray = getPointerRay(camera, canvas, clientX, clientY);
  if (normal === null || ray === null) {
    return null;
  }

  const pick = pickWithRayPrecise(scene, ray, {
    predicate: (mesh) => mesh.name.startsWith("gpx-road"),
  });
  if (pick.hit && pick.pickedPoint !== null) {
    return {
      point: { x: pick.pickedPoint[0], y: pick.pickedPoint[1], z: pick.pickedPoint[2] },
      normal,
    };
  }

  const point = getPointerPlaneIntersection(camera, canvas, clientX, clientY, camera.target, normal);
  return point === null ? null : { point, normal };
};

export const panCameraToPointerAnchor = (
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  anchor: Readonly<{ point: Point3; normal: Point3 }>,
): boolean => {
  const pointerPoint = getPointerPlaneIntersection(
    camera,
    canvas,
    clientX,
    clientY,
    anchor.point,
    anchor.normal,
  );
  if (pointerPoint === null) {
    return false;
  }

  camera.target.x += anchor.point.x - pointerPoint.x;
  camera.target.y += anchor.point.y - pointerPoint.y;
  camera.target.z += anchor.point.z - pointerPoint.z;
  camera.inertialPanningX = 0;
  camera.inertialPanningY = 0;
  return true;
};

export const getViewportCenterOrbitTarget = (
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  scene: SceneContext,
): Point3 => {
  const bounds = canvas.getBoundingClientRect();
  const ray = getPointerRay(camera, canvas, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  if (ray === null) {
    return { x: camera.target.x, y: camera.target.y, z: camera.target.z };
  }

  const pick = pickWithRayPrecise(scene, ray, {
    predicate: (mesh) => mesh.name.startsWith("gpx-road"),
  });
  if (pick.hit && pick.pickedPoint !== null) {
    return { x: pick.pickedPoint[0], y: pick.pickedPoint[1], z: pick.pickedPoint[2] };
  }

  return { x: camera.target.x, y: camera.target.y, z: camera.target.z };
};

export const setOrbitTargetPreservingView = (camera: ArcRotateCamera, target: Point3): void => {
  const cameraPosition = getCameraPosition(camera);
  camera.target.x = target.x;
  camera.target.y = target.y;
  camera.target.z = target.z;
  camera.radius = Math.hypot(
    cameraPosition.x - target.x,
    cameraPosition.y - target.y,
    cameraPosition.z - target.z,
  );
};

export const zoomCameraAtPointer = (
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  deltaY: number,
): void => {
  const anchorBefore = getPointerZoomAnchor(camera, canvas, clientX, clientY);
  const nextRadius = Math.max(0.01, camera.radius * (1 + deltaY / (camera.wheelPrecision * 1_000)));
  if (nextRadius === camera.radius) {
    return;
  }

  camera.radius = nextRadius;
  const anchorAfter = getPointerZoomAnchor(camera, canvas, clientX, clientY);
  if (anchorBefore !== null && anchorAfter !== null) {
    camera.target.x += anchorBefore.x - anchorAfter.x;
    camera.target.y += anchorBefore.y - anchorAfter.y;
    camera.target.z += anchorBefore.z - anchorAfter.z;
  }
};

export const attachRouteCameraControls = (
  camera: ArcRotateCamera,
  canvas: HTMLCanvasElement,
  scene: SceneContext,
): (() => void) => {
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    zoomCameraAtPointer(camera, canvas, event.clientX, event.clientY, event.deltaY);
  };
  canvas.addEventListener("wheel", onWheel, { capture: true, passive: false });

  const detachCameraControls = attachControl(camera, canvas, scene, {
    shouldHandlePointerDown: (event) =>
      event.pointerType === "touch" || (event.button !== 0 && event.button !== 2) || isControlClickOrbit(event),
  });

  let activePointerId: number | null = null;
  let panAnchor: Readonly<{ point: Point3; normal: Point3 }> | null = null;
  let lastX = 0;
  let lastY = 0;
  const onContextMenu = (event: MouseEvent): void => event.preventDefault();
  const onPointerDown = (event: PointerEvent): void => {
    if (isControlClickOrbit(event)) {
      const orbitTarget = getViewportCenterOrbitTarget(camera, canvas, scene);
      setOrbitTargetPreservingView(camera, orbitTarget);
      camera.inertialPanningX = 0;
      camera.inertialPanningY = 0;
      return;
    }
    if ((!isPrimaryDragPan(event) && event.button !== 2) || event.pointerType === "touch") {
      return;
    }

    event.preventDefault();
    activePointerId = event.pointerId;
    panAnchor = getPointerPanAnchor(camera, canvas, scene, event.clientX, event.clientY);
    lastX = event.clientX;
    lastY = event.clientY;
    camera.inertialPanningX = 0;
    camera.inertialPanningY = 0;
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    if (
      panAnchor !== null &&
      panCameraToPointerAnchor(camera, canvas, event.clientX, event.clientY, panAnchor)
    ) {
      lastX = event.clientX;
      lastY = event.clientY;
      return;
    }

    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    camera.inertialPanningX -= deltaX / camera.panningSensibility;
    camera.inertialPanningY += deltaY / camera.panningSensibility;
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === activePointerId) {
      activePointerId = null;
      panAnchor = null;
      camera.inertialPanningX = 0;
      camera.inertialPanningY = 0;
    }
  };

  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  return (): void => {
    canvas.removeEventListener("wheel", onWheel, true);
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    detachCameraControls();
  };
};
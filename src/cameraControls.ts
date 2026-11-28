import * as THREE from "three";
import type { TrackBounds } from "./trackGeometry";

export type Point3 = Readonly<{ x: number; y: number; z: number }>;
export type TrackRay = Readonly<{ origin: Point3; direction: Point3 }>;

export type RouteCamera = {
  readonly renderCamera: THREE.PerspectiveCamera;
  readonly target: THREE.Vector3;
  alpha: number;
  beta: number;
  radius: number;
  readonly fov: number;
  inertialAlphaOffset: number;
  inertialBetaOffset: number;
  inertialRadiusOffset: number;
  inertialPanningX: number;
  inertialPanningY: number;
};

export type RoutePointPicker = (ray: TrackRay) => Point3 | null;

const minimumCameraRadius = 0.01;
const maximumCameraRadius = 1_000_000;
const minimumCameraNearPlane = 0.0001;
const minimumCameraFarPlane = 1_000;

export const createRouteCamera = (): RouteCamera => ({
  renderCamera: new THREE.PerspectiveCamera(45, 1, minimumCameraNearPlane, minimumCameraFarPlane),
  target: new THREE.Vector3(0, 0, 0),
  alpha: -Math.PI / 2,
  beta: 1.08,
  radius: 18,
  fov: Math.PI / 4,
  inertialAlphaOffset: 0,
  inertialBetaOffset: 0,
  inertialRadiusOffset: 0,
  inertialPanningX: 0,
  inertialPanningY: 0,
});

export const updateRouteCamera = (camera: RouteCamera, width?: number, height?: number): void => {
  if (width !== undefined && height !== undefined && width > 0 && height > 0) {
    camera.renderCamera.aspect = width / height;
  }
  camera.renderCamera.near = Math.max(minimumCameraNearPlane, camera.radius * 0.02);
  camera.renderCamera.far = Math.max(minimumCameraFarPlane, camera.radius * 8);
  camera.renderCamera.fov = (camera.fov * 180) / Math.PI;
  camera.renderCamera.position.set(
    camera.target.x + camera.radius * Math.sin(camera.beta) * Math.cos(camera.alpha),
    camera.target.y + camera.radius * Math.cos(camera.beta),
    camera.target.z + camera.radius * Math.sin(camera.beta) * Math.sin(camera.alpha),
  );
  camera.renderCamera.up.set(0, 1, 0);
  camera.renderCamera.lookAt(camera.target);
  camera.renderCamera.updateProjectionMatrix();
  camera.renderCamera.updateMatrixWorld(true);
};

const getPointerCoordinates = (
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): Readonly<{ x: number; y: number; width: number; height: number }> | null => {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }
  return {
    x: clientX - bounds.left,
    y: clientY - bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
};

export const getPointerRay = (
  camera: RouteCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): TrackRay | null => {
  const coordinates = getPointerCoordinates(canvas, clientX, clientY);
  if (coordinates === null) {
    return null;
  }
  updateRouteCamera(camera, coordinates.width, coordinates.height);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(
    (coordinates.x / coordinates.width) * 2 - 1,
    1 - (coordinates.y / coordinates.height) * 2,
  ), camera.renderCamera);
  return Object.freeze({
    origin: Object.freeze({ x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z }),
    direction: Object.freeze({ x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z }),
  });
};

export const getCameraPosition = (camera: RouteCamera): Point3 => {
  updateRouteCamera(camera);
  return Object.freeze({
    x: camera.renderCamera.position.x,
    y: camera.renderCamera.position.y,
    z: camera.renderCamera.position.z,
  });
};

export const getCameraViewDirection = (camera: RouteCamera): Point3 | null => {
  updateRouteCamera(camera);
  const forward = new THREE.Vector3().subVectors(camera.target, camera.renderCamera.position);
  if (forward.lengthSq() === 0) {
    return null;
  }
  forward.normalize();
  return Object.freeze({ x: forward.x, y: forward.y, z: forward.z });
};

export const centerCameraOnTrackPoint = (camera: RouteCamera, point: Point3): void => {
  camera.target.set(point.x, point.y, point.z);
  camera.inertialAlphaOffset = 0;
  camera.inertialBetaOffset = 0;
  camera.inertialRadiusOffset = 0;
  camera.inertialPanningX = 0;
  camera.inertialPanningY = 0;
};

export const isPrimaryDragPan = (event: Pick<PointerEvent, "button" | "ctrlKey">): boolean =>
  event.button === 0 && !event.ctrlKey;

export const isControlClickOrbit = (event: Pick<PointerEvent, "button" | "ctrlKey">): boolean =>
  event.button === 0 && event.ctrlKey;

export const getPointerPlaneIntersection = (
  camera: RouteCamera,
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
  const denominator = ray.direction.x * planeNormal.x + ray.direction.y * planeNormal.y + ray.direction.z * planeNormal.z;
  if (Math.abs(denominator) < 1e-8) {
    return null;
  }
  const distance = (
    (planePoint.x - ray.origin.x) * planeNormal.x +
    (planePoint.y - ray.origin.y) * planeNormal.y +
    (planePoint.z - ray.origin.z) * planeNormal.z
  ) / denominator;
  if (!Number.isFinite(distance) || distance < 0) {
    return null;
  }
  return Object.freeze({
    x: ray.origin.x + ray.direction.x * distance,
    y: ray.origin.y + ray.direction.y * distance,
    z: ray.origin.z + ray.direction.z * distance,
  });
};

export const getPointerZoomAnchor = (
  camera: RouteCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): Point3 | null => {
  const normal = getCameraViewDirection(camera);
  return normal === null ? null : getPointerPlaneIntersection(camera, canvas, clientX, clientY, camera.target, normal);
};

export const getPointerPanAnchor = (
  camera: RouteCamera,
  canvas: HTMLCanvasElement,
  pickRoad: RoutePointPicker,
  clientX: number,
  clientY: number,
): Readonly<{ point: Point3; normal: Point3 }> | null => {
  const normal = getCameraViewDirection(camera);
  const ray = getPointerRay(camera, canvas, clientX, clientY);
  if (normal === null || ray === null) {
    return null;
  }
  const roadPoint = pickRoad(ray);
  if (roadPoint !== null) {
    return Object.freeze({ point: roadPoint, normal });
  }
  const point = getPointerPlaneIntersection(camera, canvas, clientX, clientY, camera.target, normal);
  return point === null ? null : Object.freeze({ point, normal });
};

export const panCameraToPointerAnchor = (
  camera: RouteCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  anchor: Readonly<{ point: Point3; normal: Point3 }>,
): boolean => {
  const pointerPoint = getPointerPlaneIntersection(camera, canvas, clientX, clientY, anchor.point, anchor.normal);
  if (pointerPoint === null) {
    return false;
  }
  camera.target.add(new THREE.Vector3(
    anchor.point.x - pointerPoint.x,
    anchor.point.y - pointerPoint.y,
    anchor.point.z - pointerPoint.z,
  ));
  camera.inertialPanningX = 0;
  camera.inertialPanningY = 0;
  return true;
};

export const getViewportCenterOrbitTarget = (
  camera: RouteCamera,
  canvas: HTMLCanvasElement,
  pickRoad: RoutePointPicker,
): Point3 => {
  const bounds = canvas.getBoundingClientRect();
  const ray = getPointerRay(camera, canvas, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  return ray === null ? camera.target : pickRoad(ray) ?? camera.target;
};

export const setOrbitTargetPreservingView = (camera: RouteCamera, target: Point3): void => {
  const position = getCameraPosition(camera);
  const offset = new THREE.Vector3(position.x - target.x, position.y - target.y, position.z - target.z);
  camera.target.set(target.x, target.y, target.z);
  camera.radius = Math.max(minimumCameraRadius, offset.length());
  camera.alpha = Math.atan2(offset.z, offset.x);
  camera.beta = Math.acos(Math.max(-1, Math.min(1, offset.y / camera.radius)));
};

export const fitCameraToBounds = (
  camera: RouteCamera,
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
  const aspectRatio = width / height;
  if (verticalHalfFov <= 0 || verticalHalfFov >= Math.PI / 2 || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return false;
  }
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const boundingRadius = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspectRatio);
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  const radius = Math.max(minimumCameraRadius, (boundingRadius / Math.sin(limitingHalfFov)) * 1.15);
  if (!Number.isFinite(radius)) {
    return false;
  }
  camera.target.set(centerX, centerY, centerZ);
  camera.radius = radius;
  camera.inertialAlphaOffset = 0;
  camera.inertialBetaOffset = 0;
  camera.inertialRadiusOffset = 0;
  camera.inertialPanningX = 0;
  camera.inertialPanningY = 0;
  updateRouteCamera(camera, width, height);
  return true;
};

export const zoomCameraAtPointer = (
  camera: RouteCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  deltaY: number,
): void => {
  const anchorBefore = getPointerZoomAnchor(camera, canvas, clientX, clientY);
  const zoomFactor = Math.max(0.05, 1 + deltaY / 3_000);
  camera.radius = Math.max(minimumCameraRadius, Math.min(maximumCameraRadius, camera.radius * zoomFactor));
  const anchorAfter = getPointerZoomAnchor(camera, canvas, clientX, clientY);
  if (anchorBefore !== null && anchorAfter !== null) {
    camera.target.add(new THREE.Vector3(
      anchorBefore.x - anchorAfter.x,
      anchorBefore.y - anchorAfter.y,
      anchorBefore.z - anchorAfter.z,
    ));
  }
};

export const orbitCameraWithPointerDelta = (
  camera: RouteCamera,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
): void => {
  const scale = 2 * Math.PI / Math.max(1, Math.min(width, height));
  camera.alpha += deltaX * scale;
  camera.beta = Math.max(0.02, Math.min(Math.PI - 0.02, camera.beta - deltaY * scale));
};

export const attachRouteCameraControls = (
  camera: RouteCamera,
  canvas: HTMLCanvasElement,
  pickRoad: RoutePointPicker,
): (() => void) => {
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    zoomCameraAtPointer(camera, canvas, event.clientX, event.clientY, event.deltaY);
  };
  let activePointerId: number | null = null;
  let interaction: "pan" | "orbit" | null = null;
  let panAnchor: Readonly<{ point: Point3; normal: Point3 }> | null = null;
  let lastX = 0;
  let lastY = 0;
  const onContextMenu = (event: MouseEvent): void => event.preventDefault();
  const onPointerDown = (event: PointerEvent): void => {
    if (isControlClickOrbit(event)) {
      event.preventDefault();
      setOrbitTargetPreservingView(camera, getViewportCenterOrbitTarget(camera, canvas, pickRoad));
      camera.inertialPanningX = 0;
      camera.inertialPanningY = 0;
      interaction = "orbit";
    } else if (isPrimaryDragPan(event) || event.button === 2 || event.pointerType === "touch") {
      event.preventDefault();
      interaction = "pan";
      panAnchor = getPointerPanAnchor(camera, canvas, pickRoad, event.clientX, event.clientY);
    } else {
      return;
    }
    activePointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId || interaction === null) {
      return;
    }
    if (interaction === "orbit") {
      const { width, height } = canvas.getBoundingClientRect();
      orbitCameraWithPointerDelta(camera, event.clientX - lastX, event.clientY - lastY, width, height);
    } else if (panAnchor === null || !panCameraToPointerAnchor(camera, canvas, event.clientX, event.clientY, panAnchor)) {
      const bounds = canvas.getBoundingClientRect();
      const worldUnitsPerPixel = (2 * camera.radius * Math.tan(camera.fov / 2)) / Math.max(1, bounds.height);
      const forward = getCameraViewDirection(camera);
      if (forward !== null) {
        const forwardVector = new THREE.Vector3(forward.x, forward.y, forward.z);
        const right = new THREE.Vector3(0, 1, 0).cross(forwardVector).normalize();
        const up = forwardVector.clone().cross(right).normalize();
        camera.target.addScaledVector(right, -(event.clientX - lastX) * worldUnitsPerPixel);
        camera.target.addScaledVector(up, (event.clientY - lastY) * worldUnitsPerPixel);
      }
    }
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === activePointerId) {
      activePointerId = null;
      interaction = null;
      panAnchor = null;
      camera.inertialPanningX = 0;
      camera.inertialPanningY = 0;
    }
  };
  canvas.addEventListener("wheel", onWheel, { capture: true, passive: false });
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
  };
};
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  centerCameraOnTrackPoint,
  createRouteCamera,
  fitCameraToBounds,
  getCameraPosition,
  getCameraViewDirection,
  getPointerPanAnchor,
  getPointerPlaneIntersection,
  getPointerZoomAnchor,
  getViewportCenterOrbitTarget,
  isControlClickOrbit,
  isPrimaryDragPan,
  orbitCameraWithPointerDelta,
  panCameraToPointerAnchor,
  setOrbitTargetPreservingView,
  updateRouteCamera,
  zoomCameraAtPointer,
} from "../src/cameraControls";
import { createTrackMeshData } from "../src/trackGeometry";

const createCanvas = (left = 100, top = 50, width = 800, height = 600): HTMLCanvasElement => ({
  getBoundingClientRect: () => ({ left, top, width, height }),
} as HTMLCanvasElement);

describe("route camera controls", () => {
  it("keeps the depth range tight enough to distinguish the road from terrain", () => {
    const camera = createRouteCamera();
    camera.radius = 20;

    updateRouteCamera(camera);

    expect(camera.renderCamera.near).toBeGreaterThanOrEqual(0.2);
    expect(camera.renderCamera.far).toBeLessThanOrEqual(1_000);
    expect(camera.renderCamera.far / camera.renderCamera.near).toBeLessThan(10_000);
  });

  it("centers on a track point and clears pending camera motion", () => {
    const camera = createRouteCamera();
    camera.inertialAlphaOffset = 1;
    camera.inertialBetaOffset = 1;
    camera.inertialRadiusOffset = 1;
    camera.inertialPanningX = 1;
    camera.inertialPanningY = 1;

    centerCameraOnTrackPoint(camera, { x: 3, y: 4, z: 5 });

    expect(camera.target.x).toBe(3);
    expect(camera.target.y).toBe(4);
    expect(camera.target.z).toBe(5);
    expect(camera.inertialAlphaOffset).toBe(0);
    expect(camera.inertialBetaOffset).toBe(0);
    expect(camera.inertialRadiusOffset).toBe(0);
    expect(camera.inertialPanningX).toBe(0);
    expect(camera.inertialPanningY).toBe(0);
  });

  it("renders east to the right and north toward the top of the route view", () => {
    const camera = createRouteCamera();
    updateRouteCamera(camera);
    const eastbound = createTrackMeshData([
      { latitude: 0, longitude: -0.001, elevationMeters: 0 },
      { latitude: 0, longitude: 0.001, elevationMeters: 0 },
    ]);
    const northbound = createTrackMeshData([
      { latitude: -0.001, longitude: 0, elevationMeters: 0 },
      { latitude: 0.001, longitude: 0, elevationMeters: 0 },
    ]);
    const project = (point: Readonly<{ x: number; y: number; z: number }>): THREE.Vector3 =>
      new THREE.Vector3(point.x, point.y, point.z).project(camera.renderCamera);
    const westOnScreen = project(eastbound.routePoints[0]);
    const eastOnScreen = project(eastbound.routePoints[1]);
    const southOnScreen = project(northbound.routePoints[0]);
    const northOnScreen = project(northbound.routePoints[1]);

    expect(eastOnScreen.x).toBeGreaterThan(westOnScreen.x);
    expect(northOnScreen.y).toBeGreaterThan(southOnScreen.y);
  });

  it("keeps the mouse position anchored during zoom", () => {
    const camera = createRouteCamera();
    const canvas = createCanvas();
    const cursor = { x: 650, y: 180 };
    const anchorBefore = getPointerZoomAnchor(camera, canvas, cursor.x, cursor.y);

    expect(anchorBefore).not.toBeNull();
    zoomCameraAtPointer(camera, canvas, cursor.x, cursor.y, -360);

    const anchorAfter = getPointerZoomAnchor(camera, canvas, cursor.x, cursor.y);
    expect(anchorAfter).not.toBeNull();
    expect(anchorAfter?.x).toBeCloseTo(anchorBefore?.x ?? 0, 6);
    expect(anchorAfter?.y).toBeCloseTo(anchorBefore?.y ?? 0, 6);
    expect(anchorAfter?.z).toBeCloseTo(anchorBefore?.z ?? 0, 6);
  });

  it("matches the intended orbit direction on both axes", () => {
    const camera = createRouteCamera();
    const alphaBefore = camera.alpha;
    const betaBefore = camera.beta;

    orbitCameraWithPointerDelta(camera, 20, 20, 800, 600);

    expect(camera.alpha).toBeGreaterThan(alphaBefore);
    expect(camera.beta).toBeLessThan(betaBefore);
  });

  it("centers and fits route bounds with viewport padding", () => {
    const camera = createRouteCamera();
    const canvas = createCanvas(0, 0, 800, 600);
    camera.inertialRadiusOffset = 2;
    camera.inertialPanningX = 1;

    expect(fitCameraToBounds(camera, canvas, {
      minX: -10,
      maxX: 10,
      minY: -2,
      maxY: 2,
      minZ: -1,
      maxZ: 1,
    })).toBe(true);

    expect(camera.target.x).toBeCloseTo(0);
    expect(camera.target.y).toBeCloseTo(0);
    expect(camera.target.z).toBeCloseTo(0);
    expect(camera.radius).toBeGreaterThan(Math.hypot(10, 2, 1));
    expect(camera.inertialRadiusOffset).toBe(0);
    expect(camera.inertialPanningX).toBe(0);
  });

  it("fits to the viewport aspect ratio and refits a new route", () => {
    const camera = createRouteCamera();
    const landscapeCanvas = createCanvas(0, 0, 800, 600);
    const portraitCanvas = createCanvas(0, 0, 300, 600);
    const bounds = { minX: -10, maxX: 10, minY: -2, maxY: 2, minZ: -1, maxZ: 1 };

    fitCameraToBounds(camera, landscapeCanvas, bounds);
    const landscapeRadius = camera.radius;
    fitCameraToBounds(camera, portraitCanvas, bounds);
    const portraitRadius = camera.radius;
    fitCameraToBounds(camera, landscapeCanvas, {
      minX: 18,
      maxX: 22,
      minY: 6,
      maxY: 8,
      minZ: -4,
      maxZ: 4,
    });

    expect(portraitRadius).toBeGreaterThan(landscapeRadius);
    expect(camera.target.x).toBeCloseTo(20);
    expect(camera.target.y).toBeCloseTo(7);
    expect(camera.target.z).toBeCloseTo(0);
    expect(camera.radius).toBeLessThan(landscapeRadius);
  });

  it("keeps the grabbed point beneath the pointer while panning", () => {
    const camera = createRouteCamera();
    const canvas = createCanvas();
    const normal = getCameraViewDirection(camera);
    expect(normal).not.toBeNull();
    const anchorPoint = getPointerPlaneIntersection(
      camera,
      canvas,
      650,
      180,
      camera.target,
      normal ?? { x: 0, y: 0, z: 1 },
    );

    expect(anchorPoint).not.toBeNull();
    const anchor = { point: anchorPoint ?? { x: 0, y: 0, z: 0 }, normal: normal ?? { x: 0, y: 0, z: 1 } };
    expect(panCameraToPointerAnchor(camera, canvas, 320, 420, anchor)).toBe(true);

    const pointUnderPointer = getPointerPlaneIntersection(camera, canvas, 320, 420, anchor.point, anchor.normal);
    expect(pointUnderPointer?.x).toBeCloseTo(anchor.point.x, 5);
    expect(pointUnderPointer?.y).toBeCloseTo(anchor.point.y, 5);
    expect(pointUnderPointer?.z).toBeCloseTo(anchor.point.z, 5);
  });

  it("uses the road point beneath the pointer as the pan anchor", () => {
    const camera = createRouteCamera();
    const canvas = createCanvas();
    const pickRoad = () => ({ x: 3, y: 4, z: 5 });

    expect(getPointerPanAnchor(camera, canvas, pickRoad, 500, 300)?.point).toEqual({ x: 3, y: 4, z: 5 });
  });

  it("pans on a plain primary drag and orbits on a Control-primary drag", () => {
    expect(isPrimaryDragPan({ button: 0, ctrlKey: false })).toBe(true);
    expect(isPrimaryDragPan({ button: 0, ctrlKey: true })).toBe(false);
    expect(isControlClickOrbit({ button: 0, ctrlKey: true })).toBe(true);
    expect(isControlClickOrbit({ button: 0, ctrlKey: false })).toBe(false);
    expect(isControlClickOrbit({ button: 2, ctrlKey: true })).toBe(false);
  });

  it("uses the road point at the viewport center as the orbit target", () => {
    const camera = createRouteCamera();
    const canvas = createCanvas();
    const pickRoad = () => ({ x: 3, y: 4, z: 5 });

    expect(getViewportCenterOrbitTarget(camera, canvas, pickRoad)).toEqual({ x: 3, y: 4, z: 5 });
  });

  it("preserves camera position when setting a new orbit target", () => {
    const camera = createRouteCamera();
    const cameraPositionBefore = getCameraPosition(camera);
    const target = {
      x: (cameraPositionBefore.x + camera.target.x) / 2,
      y: (cameraPositionBefore.y + camera.target.y) / 2,
      z: (cameraPositionBefore.z + camera.target.z) / 2,
    };

    setOrbitTargetPreservingView(camera, target);

    const cameraPositionAfter = getCameraPosition(camera);
    expect(camera.target.x).toBe(target.x);
    expect(camera.target.y).toBe(target.y);
    expect(camera.target.z).toBe(target.z);
    expect(cameraPositionAfter.x).toBeCloseTo(cameraPositionBefore.x, 6);
    expect(cameraPositionAfter.y).toBeCloseTo(cameraPositionBefore.y, 6);
    expect(cameraPositionAfter.z).toBeCloseTo(cameraPositionBefore.z, 6);
  });
});
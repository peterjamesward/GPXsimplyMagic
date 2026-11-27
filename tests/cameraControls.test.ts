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
  panCameraToPointerAnchor,
  setOrbitTargetPreservingView,
  zoomCameraAtPointer,
} from "../src/cameraControls";

const createCanvas = (left = 100, top = 50, width = 800, height = 600): HTMLCanvasElement => ({
  getBoundingClientRect: () => ({ left, top, width, height }),
} as HTMLCanvasElement);

describe("route camera controls", () => {
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

  it("starts north-up with east on the right", () => {
    const camera = createRouteCamera();
    const cameraPosition = getCameraPosition(camera);
    const forward = getCameraViewDirection(camera);
    expect(forward).not.toBeNull();

    const right = { x: forward?.z ?? 0, y: 0, z: -(forward?.x ?? 0) };
    const screenUp = {
      x: (forward?.y ?? 0) * right.z - (forward?.z ?? 0) * right.y,
      y: (forward?.z ?? 0) * right.x - (forward?.x ?? 0) * right.z,
      z: (forward?.x ?? 0) * right.y - (forward?.y ?? 0) * right.x,
    };

    expect(cameraPosition.z).toBeLessThan(camera.target.z);
    expect(right.x).toBeGreaterThan(0);
    expect(screenUp.z).toBeGreaterThan(0);
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
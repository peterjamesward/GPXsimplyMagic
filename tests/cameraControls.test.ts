// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createArcRotateCamera, getCameraPosition, pickWithRayPrecise } from "@babylonjs/lite";
import {
  getCameraViewDirection,
  getPointerZoomAnchor,
  getPointerPanAnchor,
  getPointerPlaneIntersection,
  getViewportCenterOrbitTarget,
  createRouteCamera,
  fitCameraToBounds,
  isControlClickOrbit,
  isPrimaryDragPan,
  panCameraToPointerAnchor,
  setOrbitTargetPreservingView,
  zoomCameraAtPointer,
} from "../src/cameraControls";

vi.mock("@babylonjs/lite", async (importOriginal) => {
  const lite = await importOriginal<typeof import("@babylonjs/lite")>();
  return {
    ...lite,
    pickWithRayPrecise: vi.fn(() => ({
      hit: true,
      distance: 18,
      pickedPoint: [3, 4, 5],
      pickedNormal: null,
      pickedNormalWorld: null,
      pickedFaceNormal: null,
      pickedFaceNormalWorld: null,
      pickedMesh: null,
      faceId: -1,
      bu: 0,
      bv: 0,
      subMeshId: -1,
      thinInstanceIndex: -1,
      ray: null,
    })),
  };
});

describe("route camera controls", () => {
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
    const camera = createArcRotateCamera(-Math.PI / 2, 1.08, 18, { x: 0, y: 0, z: 0 });
    const canvas = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
    } as HTMLCanvasElement;
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

  it("centers and zooms out to fit track bounds with viewport padding", () => {
    const camera = createArcRotateCamera(-Math.PI / 2, 1.08, 18, { x: 0, y: 0, z: 0 });
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLCanvasElement;
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

  it("uses the viewport aspect ratio and refits when a different track is loaded", () => {
    const camera = createArcRotateCamera(-Math.PI / 2, 1.08, 18, { x: 0, y: 0, z: 0 });
    const landscapeCanvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLCanvasElement;
    const portraitCanvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 600 }),
    } as HTMLCanvasElement;
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

  it("keeps the point grabbed at drag start beneath the moving pointer", () => {
    const camera = createArcRotateCamera(-Math.PI / 2, 1.08, 18, { x: 0, y: 0, z: 0 });
    const canvas = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
    } as HTMLCanvasElement;
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

    const pointUnderPointer = getPointerPlaneIntersection(
      camera,
      canvas,
      320,
      420,
      anchor.point,
      anchor.normal,
    );
    expect(pointUnderPointer?.x).toBeCloseTo(anchor.point.x, 5);
    expect(pointUnderPointer?.y).toBeCloseTo(anchor.point.y, 5);
    expect(pointUnderPointer?.z).toBeCloseTo(anchor.point.z, 5);
  });

  it("uses the road point beneath the pointer as the pan anchor", () => {
    const camera = createArcRotateCamera(-Math.PI / 2, 1.08, 18, { x: 0, y: 0, z: 0 });
    const canvas = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
    } as HTMLCanvasElement;
    const scene = { meshes: [] } as never;

    expect(getPointerPanAnchor(camera, canvas, scene, 500, 300)?.point).toEqual({ x: 3, y: 4, z: 5 });

    const options = vi.mocked(pickWithRayPrecise).mock.calls.at(-1)?.[2];
    expect(options?.predicate?.({ name: "gpx-road-surface" } as never, -1)).toBe(true);
    expect(options?.predicate?.({ name: "unrelated-mesh" } as never, -1)).toBe(false);
  });

  it("pans on a plain primary drag and orbits on a Control-primary drag", () => {
    expect(isPrimaryDragPan({ button: 0, ctrlKey: false })).toBe(true);
    expect(isPrimaryDragPan({ button: 0, ctrlKey: true })).toBe(false);
    expect(isControlClickOrbit({ button: 0, ctrlKey: true })).toBe(true);
    expect(isControlClickOrbit({ button: 0, ctrlKey: false })).toBe(false);
    expect(isControlClickOrbit({ button: 2, ctrlKey: true })).toBe(false);
  });

  it("uses the road point at the viewport center as the orbit target", () => {
    const camera = createArcRotateCamera(-Math.PI / 2, 1.08, 18, { x: 0, y: 0, z: 0 });
    const canvas = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
    } as HTMLCanvasElement;
    const scene = { meshes: [] } as never;

    expect(getViewportCenterOrbitTarget(camera, canvas, scene)).toEqual({ x: 3, y: 4, z: 5 });

    const options = vi.mocked(pickWithRayPrecise).mock.calls.at(-1)?.[2];
    expect(options?.predicate?.({ name: "gpx-road-surface" } as never, -1)).toBe(true);
    expect(options?.predicate?.({ name: "unrelated-mesh" } as never, -1)).toBe(false);
  });

  it("keeps the camera position unchanged when setting a new orbit target", () => {
    const camera = createArcRotateCamera(-Math.PI / 2, 1.08, 18, { x: 0, y: 0, z: 0 });
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
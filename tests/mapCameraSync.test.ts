import { describe, expect, it } from "vitest";
import {
  getMapCameraView,
  getRouteCameraMetersPerPixel,
  getRouteCameraRadiusForMetersPerPixel,
  getRouteCameraState,
  getWrappedAngleDifference,
} from "../src/mapCameraSync";
import type { TrackProjection } from "../src/trackGeometry";

const projection: TrackProjection = {
  centerLatitude: 45,
  centerLongitude: 180,
  longitudeScale: -Math.cos((45 * Math.PI) / 180),
  sceneUnitsPerMeter: 0.002,
};

describe("camera synchronization", () => {
  it("translates the route camera into a matching geographic map view", () => {
    const routeCamera = {
      target: { x: 2, y: 4, z: -3 },
      alpha: -Math.PI / 2,
      beta: 1.1,
      radius: 80,
      fov: Math.PI / 4,
    };

    const mapView = getMapCameraView(routeCamera, { width: 600, height: 600 }, projection);

    expect(mapView).not.toBeNull();
    expect(mapView?.center[0]).toBeLessThan(180);
    expect(mapView?.center[1]).toBeLessThan(45);
    expect(mapView?.bearing).toBeCloseTo(0);
    expect(mapView?.pitch).toBeCloseTo((1.1 * 180) / Math.PI);
  });

  it("round-trips the camera center, zoom, bearing, and pitch", () => {
    const routeCamera = {
      target: { x: 2, y: 4, z: -3 },
      alpha: -Math.PI / 2,
      beta: 1.1,
      radius: 80,
      fov: Math.PI / 4,
    };
    const viewport = { width: 600, height: 600 };
    const mapView = getMapCameraView(routeCamera, viewport, projection);

    expect(mapView).not.toBeNull();
    const synchronized = getRouteCameraState(mapView!, viewport, projection, routeCamera.fov, routeCamera.target.y);

    expect(synchronized?.target.x).toBeCloseTo(routeCamera.target.x, 6);
    expect(synchronized?.target.y).toBe(routeCamera.target.y);
    expect(synchronized?.target.z).toBeCloseTo(routeCamera.target.z, 6);
    expect(synchronized?.alpha).toBeCloseTo(routeCamera.alpha, 6);
    expect(synchronized?.beta).toBeCloseTo(routeCamera.beta, 6);
    expect(synchronized?.radius).toBeCloseTo(routeCamera.radius, 6);
  });

  it("converts a requested ground meters-per-pixel scale into a comparable route-camera radius", () => {
    const metersPerPixel = 20;
    const latitude = 45;
    const viewport = { width: 800, height: 400 };
    const fov = Math.PI / 4;
    const radius = getRouteCameraRadiusForMetersPerPixel(metersPerPixel, latitude, viewport, projection, fov);

    expect(radius).not.toBeNull();
    expect(radius).toBeCloseTo(
      (metersPerPixel * projection.sceneUnitsPerMeter * viewport.height) / (2 * Math.tan(fov / 2)),
    );
    const mapView = getMapCameraView(
      { target: { x: 0, y: 0, z: 0 }, alpha: -Math.PI / 2, beta: Math.PI / 2, radius: radius!, fov },
      viewport,
      projection,
    );
    const mapMetersPerPixel =
      (Math.cos((latitude * Math.PI) / 180) * 40_075_016.68557849) / (512 * 2 ** mapView!.zoom);
    expect(mapMetersPerPixel).toBeCloseTo(metersPerPixel, 6);
  });

  it("reads the current route-camera scale for reciprocal profile focus", () => {
    const metersPerPixel = 20;
    const viewport = { width: 800, height: 400 };
    const fov = Math.PI / 4;
    const radius = getRouteCameraRadiusForMetersPerPixel(metersPerPixel, 45, viewport, projection, fov);
    const camera = {
      target: { x: 0, y: 0, z: 0 },
      alpha: -Math.PI / 2,
      beta: Math.PI / 2,
      radius: radius!,
      fov,
    };

    expect(getRouteCameraMetersPerPixel(camera, viewport, projection)).toBeCloseTo(metersPerPixel, 6);
    expect(getRouteCameraMetersPerPixel(camera, { width: 800, height: 0 }, projection)).toBeNull();
  });

  it("rejects invalid profile scales and clamps to the map zoom range", () => {
    expect(getRouteCameraRadiusForMetersPerPixel(0, 45, { width: 800, height: 400 }, projection, Math.PI / 4)).toBeNull();
    expect(getRouteCameraRadiusForMetersPerPixel(20, 45, { width: 800, height: 0 }, projection, Math.PI / 4)).toBeNull();
    const radius = getRouteCameraRadiusForMetersPerPixel(1e-12, 45, { width: 800, height: 400 }, projection, Math.PI / 4);
    expect(radius).not.toBeNull();
    const mapView = getMapCameraView(
      { target: { x: 0, y: 0, z: 0 }, alpha: -Math.PI / 2, beta: Math.PI / 2, radius: radius!, fov: Math.PI / 4 },
      { width: 800, height: 400 },
      projection,
    );
    expect(mapView?.zoom).toBe(22);
  });

  it("maps the wrapped date-line longitude to its nearby scene position", () => {
    const mapCamera = getRouteCameraState(
      { center: [-179.9, 45], zoom: 12, bearing: 0, pitch: 45 },
      { width: 600, height: 600 },
      projection,
      Math.PI / 4,
      4,
    );

    expect(mapCamera?.target.x).toBeCloseTo(-0.1 * Math.abs(projection.longitudeScale) * 111_320 * projection.sceneUnitsPerMeter, 6);
    expect(mapCamera?.target.y).toBe(4);
  });

  it("compares equivalent wrapped map bearings without a false camera change", () => {
    expect(getWrappedAngleDifference(-90, 270)).toBe(0);
    expect(getWrappedAngleDifference(5, 355)).toBeCloseTo(10);
  });

  it("rejects camera conversion when the viewport is not measurable", () => {
    expect(getMapCameraView(
      { target: { x: 0, y: 0, z: 0 }, alpha: 0, beta: 1, radius: 1, fov: 1 },
      { width: 0, height: 0 },
      projection,
    )).toBeNull();
  });
});
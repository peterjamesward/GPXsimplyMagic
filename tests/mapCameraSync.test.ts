import { describe, expect, it } from "vitest";
import { getMapCameraView, getRouteCameraState, getWrappedAngleDifference } from "../src/mapCameraSync";
import type { TrackProjection } from "../src/trackGeometry";

const projection: TrackProjection = {
  centerLatitude: 45,
  centerLongitude: 180,
  longitudeScale: Math.cos((45 * Math.PI) / 180),
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
    expect(mapView?.center[0]).toBeGreaterThan(180);
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

  it("maps the wrapped date-line longitude to its nearby scene position", () => {
    const mapCamera = getRouteCameraState(
      { center: [-179.9, 45], zoom: 12, bearing: 0, pitch: 45 },
      { width: 600, height: 600 },
      projection,
      Math.PI / 4,
      4,
    );

    expect(mapCamera?.target.x).toBeCloseTo(0.1 * projection.longitudeScale * 111_320 * projection.sceneUnitsPerMeter, 6);
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
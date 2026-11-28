import { describe, expect, it } from "vitest";
import { createAppModel, createAppRuntime, updateApp } from "../src/app";
import { viewApp } from "../src/appView";
import type { Track } from "../src/gpx";

const track: Track = Object.freeze({
  name: "Test route",
  points: Object.freeze([
    Object.freeze({ latitude: 51, longitude: 0, elevationMeters: 10 }),
    Object.freeze({ latitude: 51, longitude: 0.001, elevationMeters: 15 }),
  ]),
});

const file = Object.assign(new Blob(["<gpx />"]), { name: "route.gpx" }) as File;

const loadTrack = (model = createAppModel()) => {
  const requested = updateApp(model, { type: "OpenTrackRequested", file });
  const requestId = requested.model.trackRequestId;
  return updateApp(requested.model, { type: "TrackParsed", requestId, track });
};

describe("Elm-style application state", () => {
  it("keeps route loading and rendering as explicit, latest-request effects", () => {
    const first = updateApp(createAppModel(), { type: "OpenTrackRequested", file });
    const second = updateApp(first.model, { type: "OpenTrackRequested", file });
    const stale = updateApp(second.model, { type: "TrackParsed", requestId: 1, track });
    expect(stale.model).toBe(second.model);

    const loaded = updateApp(second.model, { type: "TrackParsed", requestId: 2, track });
    expect(loaded.model.track).toBe(track);
    expect(loaded.model.isLoadingTrack).toBe(false);
    expect(loaded.model.totalDistanceMeters).toBeGreaterThan(50);
    expect(loaded.effects[0]).toMatchObject({ type: "RenderTrack", track, requestId: 2 });
  });

  it("pauses on every first activation, including after speed changes and resume", () => {
    let model = loadTrack().model;
    model = updateApp(model, { type: "SelectView", view: "ride" }).model;
    model = updateApp(model, { type: "RideActionActivated" }).model;
    expect(model.playback.isPlaying).toBe(true);

    model = updateApp(model, { type: "RideSpeedChanged", speedKilometersPerHour: 45 }).model;
    model = updateApp(model, { type: "RideActionActivated" }).model;
    expect(model.playback.isPlaying).toBe(false);
    const pausedDistance = model.playback.distanceMeters;
    expect(updateApp(model, { type: "RideFrameElapsed", elapsedSeconds: 1 }).model).toBe(model);

    model = updateApp(model, { type: "RideActionActivated" }).model;
    expect(model.playback.isPlaying).toBe(true);
    model = updateApp(model, { type: "RideActionActivated" }).model;
    expect(model.playback.isPlaying).toBe(false);
    expect(model.playback.distanceMeters).toBe(pausedDistance);
  });

  it("routes each Ride button click through one app dispatch", () => {
    const runtime = createAppRuntime(loadTrack().model, () => {}, () => {});
    const button = new EventTarget();
    const speedControl = new EventTarget();
    let selectedSpeed = 45;
    button.addEventListener("click", () => runtime.dispatch({ type: "RideActionActivated" }));
    speedControl.addEventListener("change", () => runtime.dispatch({
      type: "RideSpeedChanged",
      speedKilometersPerHour: selectedSpeed,
    }));

    button.dispatchEvent(new Event("click"));
    speedControl.dispatchEvent(new Event("change"));
    button.dispatchEvent(new Event("click"));
    expect(runtime.getModel().playback.isPlaying).toBe(false);
    expect(runtime.getModel().playback.speedKilometersPerHour).toBe(45);

    button.dispatchEvent(new Event("click"));
    button.dispatchEvent(new Event("click"));
    expect(runtime.getModel().playback.isPlaying).toBe(false);
  });

  it("derives all visible control values from the same model", () => {
    let model = loadTrack().model;
    model = updateApp(model, { type: "SelectView", view: "ride" }).model;
    model = updateApp(model, { type: "RideSpeedChanged", speedKilometersPerHour: 35 }).model;
    model = updateApp(model, { type: "RideActionActivated" }).model;
    const view = viewApp(model);

    expect(view.activeView).toBe("ride");
    expect(view.rideControlsHidden).toBe(false);
    expect(view.ride.isDisabled).toBe(false);
    expect(view.ride.buttonLabel).toBe("Pause ride");
    expect(view.ride.speedKilometersPerHour).toBe(35);
    expect(view.ride.isPressed).toBe(true);
  });

  it("renders and runs each message transition through one application loop", () => {
    const renderedViews: string[] = [];
    const effects: string[] = [];
    const runtime = createAppRuntime(
      createAppModel(),
      (model) => renderedViews.push(viewApp(model).activeView),
      (effect) => effects.push(effect.type),
    );
    const button = new EventTarget();
    button.addEventListener("click", () => runtime.dispatch({ type: "SelectView", view: "map" }));

    button.dispatchEvent(new Event("click"));

    expect(runtime.getModel().activeView).toBe("map");
    expect(renderedViews).toEqual(["route", "map"]);
    expect(effects).toEqual(["ActivateView", "UpdateTerrainForZoom"]);
  });
});
// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { renderRideControls } from "../src/appDom";
import { createAppModel, createAppRuntime } from "../src/app";
import { viewApp } from "../src/appView";
import type { Track } from "../src/gpx";

const track: Track = Object.freeze({
  name: "Test route",
  points: Object.freeze([
    Object.freeze({ latitude: 51, longitude: 0, elevationMeters: 10 }),
    Object.freeze({ latitude: 51, longitude: 0.001, elevationMeters: 15 }),
  ]),
});

const createElements = () => {
  document.body.innerHTML = `
    <button id="play"></button>
    <input id="progress" type="range" />
    <select id="speed"><option value="25">25 km/h</option><option value="45">45 km/h</option></select>
    <output id="readout"></output>
  `;
  return {
    playButton: document.querySelector<HTMLButtonElement>("#play")!,
    progress: document.querySelector<HTMLInputElement>("#progress")!,
    speed: document.querySelector<HTMLSelectElement>("#speed")!,
    readout: document.querySelector<HTMLOutputElement>("#readout")!,
  };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("Ride control DOM rendering", () => {
  it("does not replace the Pause button label during unchanged playback frames", () => {
    const controls = createElements();
    const runtime = createAppRuntime(
      {
        ...createAppModel(),
        activeView: "ride",
        track,
        totalDistanceMeters: 1000,
      },
      (model) => renderRideControls(controls, viewApp(model).ride),
      () => {},
    );
    controls.playButton.addEventListener("click", () => runtime.dispatch({ type: "RideActionActivated" }));

    controls.playButton.click();
    expect(controls.playButton.textContent).toBe("Pause ride");
    const pauseLabelNode = controls.playButton.firstChild;
    runtime.dispatch({ type: "RideFrameElapsed", elapsedSeconds: 1 / 60 });
    runtime.dispatch({ type: "RideFrameElapsed", elapsedSeconds: 1 / 60 });
    expect(controls.playButton.firstChild).toBe(pauseLabelNode);

    controls.playButton.click();
    expect(runtime.getModel().playback.isPlaying).toBe(false);
    expect(controls.playButton.textContent).toBe("Resume ride");
  });

  it("updates the button label when playback state changes", () => {
    const controls = createElements();
    const runtime = createAppRuntime(
      {
        ...createAppModel(),
        activeView: "ride",
        track,
        totalDistanceMeters: 1000,
      },
      (model) => renderRideControls(controls, viewApp(model).ride),
      () => {},
    );
    controls.playButton.addEventListener("click", () => runtime.dispatch({ type: "RideActionActivated" }));

    controls.playButton.click();
    runtime.dispatch({ type: "RideFrameElapsed", elapsedSeconds: 1 });
    controls.playButton.click();
    controls.playButton.click();
    controls.playButton.click();

    expect(runtime.getModel().playback.isPlaying).toBe(false);
    expect(controls.playButton.textContent).toBe("Resume ride");
    expect(controls.playButton.getAttribute("aria-pressed")).toBe("false");
  });
});
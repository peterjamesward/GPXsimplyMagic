import { describe, expect, it } from "vitest";
import {
  advanceRidePlayback,
  createRidePlaybackState,
  getRidePlaybackPresentation,
  seekRidePlayback,
  setRidePlaybackDistance,
  setRidePlaybackPlaying,
  setRidePlaybackSpeed,
} from "../src/ridePlayback";

describe("Ride playback state", () => {
  it("keeps the Ride action and status aligned with start, pause, and resume state", () => {
    const totalDistanceMeters = 1_000;
    let playback = createRidePlaybackState();
    expect(getRidePlaybackPresentation(playback, totalDistanceMeters, true)).toEqual({
      buttonLabel: "Start ride",
      statusLabel: "Ready",
      isPressed: false,
    });

    playback = setRidePlaybackPlaying(playback, true, totalDistanceMeters);
    expect(getRidePlaybackPresentation(playback, totalDistanceMeters, true)).toEqual({
      buttonLabel: "Pause ride",
      statusLabel: "Playing",
      isPressed: true,
    });

    playback = setRidePlaybackSpeed(playback, 18);
    playback = advanceRidePlayback(playback, 2, totalDistanceMeters);
    playback = setRidePlaybackPlaying(playback, false, totalDistanceMeters);
    expect(getRidePlaybackPresentation(playback, totalDistanceMeters, true)).toEqual({
      buttonLabel: "Resume ride",
      statusLabel: "Paused",
      isPressed: false,
    });
    expect(advanceRidePlayback(playback, 5, totalDistanceMeters)).toBe(playback);

    playback = setRidePlaybackPlaying(playback, true, totalDistanceMeters);
    expect(getRidePlaybackPresentation(playback, totalDistanceMeters, true).buttonLabel).toBe("Pause ride");
    expect(playback.distanceMeters).toBeCloseTo(10);
  });

  it("reports when a ride is complete and can be replayed", () => {
    const totalDistanceMeters = 100;
    const playback = advanceRidePlayback(
      setRidePlaybackPlaying(setRidePlaybackSpeed(createRidePlaybackState(), 36), true, totalDistanceMeters),
      10,
      totalDistanceMeters,
    );

    expect(getRidePlaybackPresentation(playback, totalDistanceMeters, true)).toEqual({
      buttonLabel: "Ride again",
      statusLabel: "Finished",
      isPressed: false,
    });
    expect(getRidePlaybackPresentation(createRidePlaybackState(), totalDistanceMeters, false)).toEqual({
      buttonLabel: "Start ride",
      statusLabel: "Load a route to ride",
      isPressed: false,
    });
  });

  it("pauses after the speed changes during playback", () => {
    const totalDistanceMeters = 1_000;
    let playback = setRidePlaybackPlaying(createRidePlaybackState(), true, totalDistanceMeters);
    playback = advanceRidePlayback(playback, 3.6, totalDistanceMeters);
    playback = setRidePlaybackSpeed(playback, 45);
    playback = advanceRidePlayback(playback, 1, totalDistanceMeters);
    expect(playback).toEqual({ distanceMeters: 37.5, isPlaying: true, speedKilometersPerHour: 45 });

    playback = setRidePlaybackPlaying(playback, false, totalDistanceMeters);
    expect(advanceRidePlayback(playback, 5, totalDistanceMeters)).toBe(playback);
  });

  it("remains paused after resuming from a slider seek and pausing again", () => {
    const totalDistanceMeters = 1_000;
    let playback = createRidePlaybackState();
    playback = setRidePlaybackSpeed(playback, 36);
    playback = setRidePlaybackPlaying(playback, true, totalDistanceMeters);
    playback = advanceRidePlayback(playback, 1, totalDistanceMeters);
    expect(playback).toEqual({ distanceMeters: 10, isPlaying: true, speedKilometersPerHour: 36 });

    playback = setRidePlaybackPlaying(playback, false, totalDistanceMeters);
    expect(advanceRidePlayback(playback, 5, totalDistanceMeters)).toBe(playback);

    playback = seekRidePlayback(playback, 250, totalDistanceMeters);
    expect(playback).toEqual({ distanceMeters: 250, isPlaying: false, speedKilometersPerHour: 36 });
    playback = setRidePlaybackPlaying(playback, true, totalDistanceMeters);
    playback = setRidePlaybackSpeed(playback, 18);
    playback = advanceRidePlayback(playback, 2, totalDistanceMeters);
    expect(playback).toEqual({ distanceMeters: 260, isPlaying: true, speedKilometersPerHour: 18 });

    playback = setRidePlaybackPlaying(playback, false, totalDistanceMeters);
    expect(advanceRidePlayback(playback, 5, totalDistanceMeters)).toBe(playback);
  });

  it("preserves playback when focus moves the rider and restarts at the route end", () => {
    let playback = setRidePlaybackPlaying(setRidePlaybackSpeed(createRidePlaybackState(), 36), true, 100);
    playback = setRidePlaybackDistance(playback, 30, 100);
    expect(playback).toEqual({ distanceMeters: 30, isPlaying: true, speedKilometersPerHour: 36 });

    playback = advanceRidePlayback(playback, 10, 100);
    expect(playback).toEqual({ distanceMeters: 100, isPlaying: false, speedKilometersPerHour: 36 });
    expect(setRidePlaybackPlaying(playback, true, 100)).toEqual({
      distanceMeters: 0,
      isPlaying: true,
      speedKilometersPerHour: 36,
    });
  });
});
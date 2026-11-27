import { describe, expect, it } from "vitest";
import {
  advanceRidePlayback,
  createRidePlaybackState,
  seekRidePlayback,
  setRidePlaybackDistance,
  setRidePlaybackPlaying,
} from "../src/ridePlayback";

describe("Ride playback state", () => {
  it("remains paused after resuming from a slider seek and pausing again", () => {
    const totalDistanceMeters = 1_000;
    let playback = createRidePlaybackState();
    playback = setRidePlaybackPlaying(playback, true, totalDistanceMeters);
    playback = advanceRidePlayback(playback, 1, 36, totalDistanceMeters);
    expect(playback).toEqual({ distanceMeters: 10, isPlaying: true });

    playback = setRidePlaybackPlaying(playback, false, totalDistanceMeters);
    expect(advanceRidePlayback(playback, 5, 36, totalDistanceMeters)).toBe(playback);

    playback = seekRidePlayback(playback, 250, totalDistanceMeters);
    expect(playback).toEqual({ distanceMeters: 250, isPlaying: false });
    playback = setRidePlaybackPlaying(playback, true, totalDistanceMeters);
    playback = advanceRidePlayback(playback, 2, 18, totalDistanceMeters);
    expect(playback).toEqual({ distanceMeters: 260, isPlaying: true });

    playback = setRidePlaybackPlaying(playback, false, totalDistanceMeters);
    expect(advanceRidePlayback(playback, 5, 36, totalDistanceMeters)).toBe(playback);
  });

  it("preserves playback when focus moves the rider and restarts at the route end", () => {
    let playback = setRidePlaybackPlaying(createRidePlaybackState(), true, 100);
    playback = setRidePlaybackDistance(playback, 30, 100);
    expect(playback).toEqual({ distanceMeters: 30, isPlaying: true });

    playback = advanceRidePlayback(playback, 10, 36, 100);
    expect(playback).toEqual({ distanceMeters: 100, isPlaying: false });
    expect(setRidePlaybackPlaying(playback, true, 100)).toEqual({ distanceMeters: 0, isPlaying: true });
  });
});
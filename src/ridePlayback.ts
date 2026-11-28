export type RidePlaybackState = Readonly<{
  distanceMeters: number;
  isPlaying: boolean;
  speedKilometersPerHour: number;
}>;

export type RidePlaybackPresentation = Readonly<{
  buttonLabel: string;
  statusLabel: string;
  isPressed: boolean;
}>;

const validateTotalDistance = (totalDistanceMeters: number): void => {
  if (!Number.isFinite(totalDistanceMeters) || totalDistanceMeters < 0) {
    throw new Error("Ride route distance must be finite and non-negative.");
  }
};

export const createRidePlaybackState = (): RidePlaybackState =>
  Object.freeze({ distanceMeters: 0, isPlaying: false, speedKilometersPerHour: 25 });

export const getRidePlaybackPresentation = (
  state: RidePlaybackState,
  totalDistanceMeters: number,
  hasRoute: boolean,
): RidePlaybackPresentation => {
  validateTotalDistance(totalDistanceMeters);
  if (!hasRoute) {
    return Object.freeze({ buttonLabel: "Start ride", statusLabel: "Load a route to ride", isPressed: false });
  }
  if (state.isPlaying) {
    return Object.freeze({ buttonLabel: "Pause ride", statusLabel: "Playing", isPressed: true });
  }
  if (totalDistanceMeters > 0 && state.distanceMeters >= totalDistanceMeters) {
    return Object.freeze({ buttonLabel: "Ride again", statusLabel: "Finished", isPressed: false });
  }
  if (state.distanceMeters > 0) {
    return Object.freeze({ buttonLabel: "Resume ride", statusLabel: "Paused", isPressed: false });
  }
  return Object.freeze({ buttonLabel: "Start ride", statusLabel: "Ready", isPressed: false });
};

export const setRidePlaybackPlaying = (
  state: RidePlaybackState,
  isPlaying: boolean,
  totalDistanceMeters: number,
): RidePlaybackState => {
  validateTotalDistance(totalDistanceMeters);
  return Object.freeze({
    ...state,
    distanceMeters: isPlaying && state.distanceMeters >= totalDistanceMeters ? 0 : state.distanceMeters,
    isPlaying,
  });
};

export const setRidePlaybackSpeed = (
  state: RidePlaybackState,
  speedKilometersPerHour: number,
): RidePlaybackState => {
  if (!Number.isFinite(speedKilometersPerHour) || speedKilometersPerHour < 0) {
    throw new Error("Ride playback speed must be finite and non-negative.");
  }
  return Object.freeze({ ...state, speedKilometersPerHour });
};

export const setRidePlaybackDistance = (
  state: RidePlaybackState,
  distanceMeters: number,
  totalDistanceMeters: number,
): RidePlaybackState => {
  validateTotalDistance(totalDistanceMeters);
  if (!Number.isFinite(distanceMeters)) {
    throw new Error("Ride distance must be finite.");
  }
  return Object.freeze({
    ...state,
    distanceMeters: Math.max(0, Math.min(totalDistanceMeters, distanceMeters)),
  });
};

export const seekRidePlayback = (
  state: RidePlaybackState,
  distanceMeters: number,
  totalDistanceMeters: number,
): RidePlaybackState => Object.freeze({
  ...setRidePlaybackDistance(state, distanceMeters, totalDistanceMeters),
  isPlaying: false,
});

export const advanceRidePlayback = (
  state: RidePlaybackState,
  elapsedSeconds: number,
  totalDistanceMeters: number,
): RidePlaybackState => {
  validateTotalDistance(totalDistanceMeters);
  if (!Number.isFinite(elapsedSeconds) || !Number.isFinite(state.speedKilometersPerHour)) {
    throw new Error("Ride playback timing and speed must be finite.");
  }
  if (!state.isPlaying) {
    return state;
  }
  const distanceMeters = Math.min(
    totalDistanceMeters,
    state.distanceMeters + Math.max(0, elapsedSeconds) * Math.max(0, state.speedKilometersPerHour) / 3.6,
  );
  return Object.freeze({
    ...state,
    distanceMeters,
    isPlaying: distanceMeters < totalDistanceMeters,
  });
};
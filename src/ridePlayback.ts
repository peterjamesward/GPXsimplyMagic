export type RidePlaybackState = Readonly<{
  distanceMeters: number;
  isPlaying: boolean;
}>;

const validateTotalDistance = (totalDistanceMeters: number): void => {
  if (!Number.isFinite(totalDistanceMeters) || totalDistanceMeters < 0) {
    throw new Error("Ride route distance must be finite and non-negative.");
  }
};

export const createRidePlaybackState = (): RidePlaybackState =>
  Object.freeze({ distanceMeters: 0, isPlaying: false });

export const setRidePlaybackPlaying = (
  state: RidePlaybackState,
  isPlaying: boolean,
  totalDistanceMeters: number,
): RidePlaybackState => {
  validateTotalDistance(totalDistanceMeters);
  return Object.freeze({
    distanceMeters: isPlaying && state.distanceMeters >= totalDistanceMeters ? 0 : state.distanceMeters,
    isPlaying,
  });
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
    distanceMeters: Math.max(0, Math.min(totalDistanceMeters, distanceMeters)),
    isPlaying: state.isPlaying,
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
  speedKilometersPerHour: number,
  totalDistanceMeters: number,
): RidePlaybackState => {
  validateTotalDistance(totalDistanceMeters);
  if (![elapsedSeconds, speedKilometersPerHour].every(Number.isFinite)) {
    throw new Error("Ride playback timing and speed must be finite.");
  }
  if (!state.isPlaying) {
    return state;
  }
  const distanceMeters = Math.min(
    totalDistanceMeters,
    state.distanceMeters + Math.max(0, elapsedSeconds) * Math.max(0, speedKilometersPerHour) / 3.6,
  );
  return Object.freeze({
    distanceMeters,
    isPlaying: distanceMeters < totalDistanceMeters,
  });
};
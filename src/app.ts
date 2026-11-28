import { getTrackSummary, type Track } from "./gpx";
import {
  advanceRidePlayback,
  createRidePlaybackState,
  seekRidePlayback,
  setRidePlaybackDistance,
  setRidePlaybackPlaying,
  setRidePlaybackSpeed,
  type RidePlaybackState,
} from "./ridePlayback";

export type ViewMode = "route" | "map" | "ride";

export type AppStatus = Readonly<{
  message: string;
  isError: boolean;
}>;

export type AppModel = Readonly<{
  activeView: ViewMode;
  track: Track | null;
  totalDistanceMeters: number;
  isLoadingTrack: boolean;
  trackRequestId: number;
  terrainVisible: boolean;
  isDraggingFile: boolean;
  playback: RidePlaybackState;
  status: AppStatus;
  viewerError: string | null;
}>;

export type AppMessage =
  | Readonly<{ type: "OpenTrackRequested"; file: File }>
  | Readonly<{ type: "TrackParsed"; requestId: number; track: Track }>
  | Readonly<{ type: "TrackReadFailed"; requestId: number; message: string }>
  | Readonly<{ type: "TrackRenderFailed"; requestId: number; message: string }>
  | Readonly<{ type: "SelectView"; view: ViewMode }>
  | Readonly<{ type: "SetTerrainVisibility"; visible: boolean }>
  | Readonly<{ type: "RideActionActivated" }>
  | Readonly<{ type: "RideSpeedChanged"; speedKilometersPerHour: number }>
  | Readonly<{ type: "RideSeekChanged"; progress: number }>
  | Readonly<{ type: "RideDistanceFocused"; distanceMeters: number }>
  | Readonly<{ type: "RideFrameElapsed"; elapsedSeconds: number }>
  | Readonly<{ type: "SetStatus"; message: string; isError?: boolean }>
  | Readonly<{ type: "ViewerFailed"; message: string }>
  | Readonly<{ type: "FileDragChanged"; isDragging: boolean }>;

export type AppEffect =
  | Readonly<{ type: "ReadTrackFile"; file: File; requestId: number }>
  | Readonly<{ type: "RenderTrack"; track: Track; requestId: number }>
  | Readonly<{ type: "ActivateView"; view: ViewMode }>
  | Readonly<{ type: "SetTerrainVisibility"; visible: boolean }>
  | Readonly<{ type: "SetRidePaused"; paused: boolean }>
  | Readonly<{ type: "SetRideDistance"; distanceMeters: number }>
  | Readonly<{ type: "UpdateTerrainForZoom" }>
  | Readonly<{ type: "ResetRideFrameClock" }>;

export type AppUpdate = Readonly<{
  model: AppModel;
  effects: readonly AppEffect[];
}>;

export const createAppModel = (terrainVisible = true): AppModel => Object.freeze({
  activeView: "route",
  track: null,
  totalDistanceMeters: 0,
  isLoadingTrack: false,
  trackRequestId: 0,
  terrainVisible,
  isDraggingFile: false,
  playback: createRidePlaybackState(),
  status: Object.freeze({ message: "Ready when you are — open a GPX route.", isError: false }),
  viewerError: null,
});

const unchanged = (model: AppModel): AppUpdate => Object.freeze({ model, effects: Object.freeze([]) });

const updated = (model: AppModel, effects: readonly AppEffect[] = []): AppUpdate => Object.freeze({
  model: Object.freeze(model),
  effects: Object.freeze(effects),
});

const status = (message: string, isError = false): AppStatus => Object.freeze({ message, isError });

export const updateApp = (model: AppModel, message: AppMessage): AppUpdate => {
  switch (message.type) {
    case "OpenTrackRequested": {
      const requestId = model.trackRequestId + 1;
      return updated({
        ...model,
        trackRequestId: requestId,
        isLoadingTrack: true,
        status: status(`Reading ${message.file.name}…`),
      }, [{ type: "ReadTrackFile", file: message.file, requestId }]);
    }
    case "TrackParsed": {
      if (message.requestId !== model.trackRequestId) {
        return unchanged(model);
      }
      const totalDistanceMeters = getTrackSummary(message.track.points).distanceKm * 1000;
      const playback = setRidePlaybackSpeed(createRidePlaybackState(), model.playback.speedKilometersPerHour);
      return updated({
        ...model,
        track: message.track,
        totalDistanceMeters,
        isLoadingTrack: false,
        playback,
        status: status("Route loaded. Showing GPX-conformed terrain while elevation and map features load…"),
      }, [
        { type: "RenderTrack", track: message.track, requestId: message.requestId },
        { type: "ResetRideFrameClock" },
        { type: "SetRidePaused", paused: true },
        { type: "SetRideDistance", distanceMeters: 0 },
      ]);
    }
    case "TrackReadFailed":
      if (message.requestId !== model.trackRequestId) {
        return unchanged(model);
      }
      return updated({
        ...model,
        isLoadingTrack: false,
        status: status(message.message, true),
      });
    case "TrackRenderFailed":
      if (message.requestId !== model.trackRequestId) {
        return unchanged(model);
      }
      return updated({
        ...model,
        status: status(message.message, true),
        viewerError: message.message,
      });
    case "SelectView":
      if (message.view === model.activeView) {
        return unchanged(model);
      }
      return updated({ ...model, activeView: message.view }, [
        { type: "ActivateView", view: message.view },
        { type: "UpdateTerrainForZoom" },
      ]);
    case "SetTerrainVisibility":
      if (message.visible === model.terrainVisible) {
        return unchanged(model);
      }
      return updated({ ...model, terrainVisible: message.visible }, [
        { type: "SetTerrainVisibility", visible: message.visible },
      ]);
    case "RideActionActivated": {
      if (model.track === null) {
        return unchanged(model);
      }
      const playback = setRidePlaybackPlaying(
        model.playback,
        !model.playback.isPlaying,
        model.totalDistanceMeters,
      );
      const effects: AppEffect[] = [
        { type: "ResetRideFrameClock" },
        { type: "SetRidePaused", paused: !playback.isPlaying },
      ];
      if (playback.distanceMeters !== model.playback.distanceMeters) {
        effects.push({ type: "SetRideDistance", distanceMeters: playback.distanceMeters });
      }
      return updated({ ...model, playback }, effects);
    }
    case "RideSpeedChanged": {
      const playback = setRidePlaybackSpeed(model.playback, message.speedKilometersPerHour);
      return playback.speedKilometersPerHour === model.playback.speedKilometersPerHour
        ? unchanged(model)
        : updated({ ...model, playback }, [{ type: "ResetRideFrameClock" }]);
    }
    case "RideSeekChanged": {
      if (model.track === null) {
        return unchanged(model);
      }
      const distanceMeters = (Math.max(0, Math.min(1000, message.progress)) / 1000) * model.totalDistanceMeters;
      const playback = seekRidePlayback(model.playback, distanceMeters, model.totalDistanceMeters);
      const effects: AppEffect[] = [
        { type: "ResetRideFrameClock" },
        { type: "SetRidePaused", paused: true },
        { type: "SetRideDistance", distanceMeters: playback.distanceMeters },
      ];
      return updated({ ...model, playback }, effects);
    }
    case "RideDistanceFocused": {
      if (model.track === null) {
        return unchanged(model);
      }
      const playback = setRidePlaybackDistance(model.playback, message.distanceMeters, model.totalDistanceMeters);
      return playback.distanceMeters === model.playback.distanceMeters
        ? unchanged(model)
        : updated({ ...model, playback }, [{ type: "SetRideDistance", distanceMeters: playback.distanceMeters }]);
    }
    case "RideFrameElapsed": {
      if (model.activeView !== "ride" || !model.playback.isPlaying || model.track === null) {
        return unchanged(model);
      }
      const playback = advanceRidePlayback(model.playback, message.elapsedSeconds, model.totalDistanceMeters);
      if (playback === model.playback) {
        return unchanged(model);
      }
      const effects: AppEffect[] = [{ type: "SetRideDistance", distanceMeters: playback.distanceMeters }];
      if (!playback.isPlaying) {
        effects.push({ type: "SetRidePaused", paused: true });
      }
      return updated({ ...model, playback }, effects);
    }
    case "SetStatus":
      return updated({ ...model, status: status(message.message, message.isError ?? false) });
    case "ViewerFailed":
      return updated({
        ...model,
        viewerError: message.message,
        status: status("3D rendering is unavailable in this browser.", true),
      });
    case "FileDragChanged":
      return message.isDragging === model.isDraggingFile
        ? unchanged(model)
        : updated({ ...model, isDraggingFile: message.isDragging });
  }
};

export type AppRuntime = Readonly<{
  dispatch: (message: AppMessage) => void;
  getModel: () => AppModel;
}>;

export const createAppRuntime = (
  initialModel: AppModel,
  render: (model: AppModel) => void,
  runEffect: (effect: AppEffect, dispatch: (message: AppMessage) => void) => void,
): AppRuntime => {
  let model = initialModel;
  const dispatch = (message: AppMessage): void => {
    const result = updateApp(model, message);
    if (result.model === model && result.effects.length === 0) {
      return;
    }
    model = result.model;
    render(model);
    result.effects.forEach((effect) => runEffect(effect, dispatch));
  };
  render(model);
  return Object.freeze({ dispatch, getModel: () => model });
};
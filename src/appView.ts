import { getRidePlaybackPresentation } from "./ridePlayback";
import type { AppModel, ViewMode } from "./app";

export type AppView = Readonly<{
  activeView: ViewMode;
  tabs: readonly Readonly<{ view: ViewMode; selected: boolean; tabIndex: 0 | -1 }>[];
  routePanelHidden: boolean;
  mapPanelHidden: boolean;
  rideControlsHidden: boolean;
  terrainControlHidden: boolean;
  routeTitle: string;
  emptyStateHidden: boolean;
  isDraggingFile: boolean;
  terrainVisible: boolean;
  ride: Readonly<{
    isDisabled: boolean;
    buttonLabel: string;
    isPressed: boolean;
    progress: number;
    speedKilometersPerHour: number;
    readout: string;
  }>;
  statusMessage: string;
  statusIsError: boolean;
  viewerError: string | null;
}>;

const views: readonly ViewMode[] = ["route", "map", "ride"];

export const viewApp = (model: AppModel): AppView => {
  const playback = getRidePlaybackPresentation(
    model.playback,
    model.totalDistanceMeters,
    model.track !== null,
  );
  const distance = model.playback.distanceMeters;
  const isRouteLoaded = model.track !== null;
  const progress = model.totalDistanceMeters > 0
    ? Math.round((distance / model.totalDistanceMeters) * 1000)
    : 0;
  const readout = model.totalDistanceMeters > 0
    ? `${playback.statusLabel} · ${(distance / 1000).toFixed(2)} / ${(model.totalDistanceMeters / 1000).toFixed(2)} km · ${model.playback.speedKilometersPerHour} km/h`
    : playback.statusLabel;

  return Object.freeze({
    activeView: model.activeView,
    tabs: Object.freeze(views.map((view) => Object.freeze({
      view,
      selected: view === model.activeView,
      tabIndex: view === model.activeView ? 0 : -1,
    }))),
    routePanelHidden: model.activeView === "map",
    mapPanelHidden: model.activeView !== "map",
    rideControlsHidden: model.activeView !== "ride",
    terrainControlHidden: model.activeView !== "route",
    routeTitle: model.track?.name ?? "No route loaded",
    emptyStateHidden: isRouteLoaded,
    isDraggingFile: model.isDraggingFile,
    terrainVisible: model.terrainVisible,
    ride: Object.freeze({
      isDisabled: !isRouteLoaded,
      buttonLabel: playback.buttonLabel,
      isPressed: playback.isPressed,
      progress,
      speedKilometersPerHour: model.playback.speedKilometersPerHour,
      readout,
    }),
    statusMessage: model.status.message,
    statusIsError: model.status.isError,
    viewerError: model.viewerError,
  });
};
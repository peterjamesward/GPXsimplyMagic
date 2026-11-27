import {
  getMapCameraView,
  getRouteCameraMetersPerPixel,
  getRouteCameraRadiusForMetersPerPixel,
  getRouteCameraState,
  getWrappedAngleDifference,
} from "./mapCameraSync";
import type { RouteCamera } from "./cameraControls";
import {
  attachRouteCameraControls,
  centerCameraOnTrackPoint,
  fitCameraToBounds,
} from "./cameraControls";
import { parseGpx, type Track } from "./gpx";
import {
  createTrackMeshData,
  getContinuousLongitudes,
  type TrackMeshData,
  type TrackProjection,
} from "./trackGeometry";
import {
  createLandUseSpatialIndex,
  emptyOpenStreetMapFeatures,
  loadOpenStreetMapFeatures,
  type OpenStreetMapFeatures,
} from "./openStreetMap";
import { createTrackPointRayIndex } from "./trackHover";
import { createTrackHoverOverlay } from "./trackHoverOverlay";
import { getTrackHoverLayout, getTrackHoverTolerance } from "./trackHoverLayout";
import { createTrackHoverCard } from "./trackHoverCard";
import { findNearestScreenPointIndex } from "./trackPointFocus";
import { createGradientCurtainMeshData } from "./gradientCurtain";
import { createTrackProfileView } from "./trackProfileView";
import {
  createTerrainDemLoader,
  getTerrainTileCoverage,
  retainBestTerrainElevation,
  type TerrainDemData,
  type TerrainView,
} from "./terrainDem";
import { createTerrainMeshData, type TerrainElevationSampler } from "./terrainGeometry";
import { createTerrainScenery } from "./terrainScenery";
import { createRideRoadMarkings, getRideCameraPose, getRideViewportSize } from "./riderScene";
import type { RideSceneRenderer } from "./rideRenderer";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const canvas = document.querySelector<HTMLCanvasElement>("#route-canvas");
const fileInput = document.querySelector<HTMLInputElement>("#gpx-file");
const viewer = document.querySelector<HTMLElement>("#viewer");
const showRouteViewButton = document.querySelector<HTMLButtonElement>("#show-route-view");
const showMapViewButton = document.querySelector<HTMLButtonElement>("#show-map-view");
const showRideViewButton = document.querySelector<HTMLButtonElement>("#show-ride-view");
const rideCanvas = document.querySelector<HTMLCanvasElement>("#ride-canvas");
const terrainControl = document.querySelector<HTMLElement>("#terrain-control");
const terrainVisibilityToggle = document.querySelector<HTMLInputElement>("#show-terrain");
const rideControls = document.querySelector<HTMLElement>("#ride-controls");
const ridePlayButton = document.querySelector<HTMLButtonElement>("#ride-play");
const rideProgress = document.querySelector<HTMLInputElement>("#ride-progress");
const rideSpeed = document.querySelector<HTMLSelectElement>("#ride-speed");
const rideReadout = document.querySelector<HTMLOutputElement>("#ride-readout");
const rideCockpit = document.querySelector<SVGElement>("#ride-cockpit");
const routeViewPanel = document.querySelector<HTMLElement>("#route-view-panel");
const terrainViewPanel = document.querySelector<HTMLElement>("#terrain-view-panel");
const mapContainer = document.querySelector<HTMLElement>("#map-canvas");
const profileCanvas = document.querySelector<HTMLCanvasElement>("#profile-canvas");
const mapError = document.querySelector<HTMLElement>("#map-error");
const emptyState = document.querySelector<HTMLElement>("#empty-state");
const statusMessage = document.querySelector<HTMLElement>("#status-message");
const engineError = document.querySelector<HTMLElement>("#engine-error");
const viewerRouteTitle = document.querySelector<HTMLElement>("#viewer-route-title");

if (
  canvas === null ||
  fileInput === null ||
  viewer === null ||
  showRouteViewButton === null ||
  showMapViewButton === null ||
  showRideViewButton === null ||
  rideCanvas === null ||
  terrainControl === null ||
  terrainVisibilityToggle === null ||
  rideControls === null ||
  ridePlayButton === null ||
  rideProgress === null ||
  rideSpeed === null ||
  rideReadout === null ||
  rideCockpit === null ||
  routeViewPanel === null ||
  terrainViewPanel === null ||
  mapContainer === null ||
  profileCanvas === null ||
  mapError === null ||
  emptyState === null ||
  statusMessage === null ||
  engineError === null ||
  viewerRouteTitle === null
) {
  throw new Error("The route viewer page is missing required elements.");
}

type ViewerMode = "route" | "map" | "ride";
let activeView: ViewerMode = "route";
let activateSceneView = (_view: ViewerMode): void => {};
const viewTabs = [showRouteViewButton, showMapViewButton, showRideViewButton] as const;

const showView = (view: ViewerMode): void => {
  activeView = view;
  const isMapActive = view === "map";
  const isRideActive = view === "ride";
  viewTabs.forEach((tab) => {
    const isSelected = tab === (isMapActive ? showMapViewButton : isRideActive ? showRideViewButton : showRouteViewButton);
    tab.setAttribute("aria-selected", String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
  });
  routeViewPanel.setAttribute("aria-hidden", String(isMapActive));
  routeViewPanel.setAttribute("aria-labelledby", isRideActive ? "show-ride-view" : "show-route-view");
  routeViewPanel.setAttribute("aria-label", isRideActive ? "First-person bicycle ride view" : "Three.js 3D route view");
  terrainViewPanel.setAttribute("aria-hidden", String(!isMapActive));
  routeViewPanel.inert = isMapActive;
  terrainViewPanel.inert = !isMapActive;
  routeViewPanel.classList.toggle("is-riding", isRideActive);
  terrainControl.hidden = view !== "route";
  rideControls.hidden = !isRideActive;
  rideCockpit.toggleAttribute("hidden", !isRideActive);
  activateSceneView(view);
};

showRouteViewButton.addEventListener("click", () => showView("route"));
showMapViewButton.addEventListener("click", () => showView("map"));
showRideViewButton.addEventListener("click", () => showView("ride"));

viewTabs.forEach((tab, index) => {
  tab.addEventListener("keydown", (event: KeyboardEvent) => {
    const nextIndex = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? (index + 1) % viewTabs.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? (index + viewTabs.length - 1) % viewTabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? viewTabs.length - 1
            : null;
    if (nextIndex !== null) {
      event.preventDefault();
      viewTabs[nextIndex].focus();
      showView((["route", "map", "ride"] as const)[nextIndex]);
    }
  });
});

const setStatus = (message: string, isError = false): void => {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
};

const initializeViewer = async (): Promise<void> => {
  try {
    const [routeRenderer, { createTerrainMap }] = await Promise.all([
      import("./routeRenderer").then(({ createRouteRenderer: createRenderer }) => createRenderer(canvas)),
      import("./maplibreTerrain"),
    ]);
    const camera: RouteCamera = routeRenderer.camera;
    const terrainMap = createTerrainMap(mapContainer, mapError);
    let trackProjection: TrackProjection | null = null;
    let activeGeometry: TrackMeshData | null = null;
    let activeTrackPoints: Track["points"] = [];
    let activeTrackLongitudes: readonly number[] = [];
    let activeTrackPointRayIndex = createTrackPointRayIndex([]);
    let syncingMapFromRoute = false;
    let updateTerrainForZoom = (): void => {};
    let profileView: ReturnType<typeof createTrackProfileView> | null = null;
    let rideDistanceMeters = 0;
    let rideIsPlaying = false;
    let rideRenderer: RideSceneRenderer | null = null;
    let rideRendererLoad: Promise<void> | null = null;
    let updateRideCamera = (): void => {};
    let setRideDistance = (_distanceMeters: number): void => {};
    let clearSceneHover = (): void => {};

    const focusTrackPoint = (index: number, metersPerPixel?: number): void => {
      const point = activeGeometry?.routePoints[index];
      if (point !== undefined) {
        if (activeView === "ride") {
          setRideDistance(point.distanceMeters);
          return;
        }
        const viewport = canvas.getBoundingClientRect();
        const currentMetersPerPixel = trackProjection === null
          ? null
          : getRouteCameraMetersPerPixel(
              camera,
              { width: viewport.width, height: viewport.height },
              trackProjection,
            );
        const focusMetersPerPixel = metersPerPixel ?? currentMetersPerPixel;
        centerCameraOnTrackPoint(camera, point);
        if (metersPerPixel !== undefined && trackProjection !== null) {
          const radius = getRouteCameraRadiusForMetersPerPixel(
            metersPerPixel,
            activeTrackPoints[index].latitude,
            { width: viewport.width, height: viewport.height },
            trackProjection,
            camera.fov,
          );
          if (radius !== null) {
            camera.radius = radius;
          }
        }
        if (focusMetersPerPixel !== null) {
          profileView?.focusOnPoint(index, focusMetersPerPixel);
        }
      }
    };

    terrainMap.map.on("dblclick", (event) => {
      if (activeTrackPoints.length === 0) {
        return;
      }

      const centerLongitude = terrainMap.map.getCenter().lng;
      const screenPoints = activeTrackPoints.map((point, index) => {
        const continuousLongitude = activeTrackLongitudes[index];
        const longitude = continuousLongitude + 360 * Math.round((centerLongitude - continuousLongitude) / 360);
        const screenPoint = terrainMap.map.project([longitude, point.latitude]);
        return { x: screenPoint.x, y: screenPoint.y };
      });
      const pointIndex = findNearestScreenPointIndex(
        screenPoints,
        { x: event.point.x, y: event.point.y },
        18,
      );
      if (pointIndex !== null) {
        event.preventDefault();
        focusTrackPoint(pointIndex);
      }
    });

    const syncRouteFromMap = (): void => {
      if (activeView === "ride" || trackProjection === null || syncingMapFromRoute) {
        return;
      }

      const { width, height } = canvas.getBoundingClientRect();
      const center = terrainMap.map.getCenter();
      const routeCamera = getRouteCameraState(
        {
          center: [center.lng, center.lat],
          zoom: terrainMap.map.getZoom(),
          bearing: terrainMap.map.getBearing(),
          pitch: terrainMap.map.getPitch(),
        },
        { width, height },
        trackProjection,
        camera.fov,
        camera.target.y,
      );
      if (routeCamera === null) {
        return;
      }

      camera.target.x = routeCamera.target.x;
      camera.target.z = routeCamera.target.z;
      camera.alpha = routeCamera.alpha;
      camera.beta = routeCamera.beta;
      camera.radius = routeCamera.radius;
      camera.inertialAlphaOffset = 0;
      camera.inertialBetaOffset = 0;
      camera.inertialRadiusOffset = 0;
      camera.inertialPanningX = 0;
      camera.inertialPanningY = 0;
    };
    terrainMap.map.on("move", syncRouteFromMap);

    const syncMapFromRoute = (): void => {
      if (activeView !== "ride" && trackProjection !== null && terrainMap.map.isStyleLoaded()) {
        const { width, height } = canvas.getBoundingClientRect();
        const mapView = getMapCameraView(camera, { width, height }, trackProjection);
        if (mapView !== null) {
          const center = terrainMap.map.getCenter();
          const longitudeDelta = ((center.lng - mapView.center[0] + 540) % 360) - 180;
          const cameraChanged =
            Math.abs(longitudeDelta) > 1e-8 ||
            Math.abs(center.lat - mapView.center[1]) > 1e-8 ||
            Math.abs(terrainMap.map.getZoom() - mapView.zoom) > 1e-6 ||
            Math.abs(getWrappedAngleDifference(terrainMap.map.getBearing(), mapView.bearing)) > 1e-4 ||
            Math.abs(terrainMap.map.getPitch() - mapView.pitch) > 1e-4;

          if (cameraChanged) {
            syncingMapFromRoute = true;
            try {
              terrainMap.map.jumpTo({ ...mapView, center: [mapView.center[0], mapView.center[1]] });
            } finally {
              syncingMapFromRoute = false;
            }
          }
        }
      }

      if (activeView !== "ride") {
        updateTerrainForZoom();
      }
      requestAnimationFrame(syncMapFromRoute);
    };
    requestAnimationFrame(syncMapFromRoute);

    const mapResizeObserver = new ResizeObserver(() => terrainMap.map.resize());
    mapResizeObserver.observe(mapContainer);

    activateSceneView = (view): void => {
      const isRideActive = view === "ride";
      rideCanvas.hidden = !isRideActive;
      routeRenderer.setActive(view === "route");
      if (isRideActive && rideRenderer === null && rideRendererLoad === null) {
        rideRendererLoad = import("./rideRenderer").then(({ createRideRenderer }) => {
          rideRenderer = createRideRenderer(rideCanvas);
          if (activeGeometry !== null) {
            rideRenderer.setRoute(activeGeometry);
            rideRenderer.setEnvironment(bestTerrainDem, activeTerrainFeatures);
            updateRideCamera();
          }
          rideRenderer.setActive(activeView === "ride");
        }).catch((error: unknown) => {
          engineError.hidden = false;
          engineError.textContent = error instanceof Error
            ? `The Ride renderer could not start: ${error.message}`
            : "The Ride renderer could not start.";
          rideRendererLoad = null;
        });
      } else {
        rideRenderer?.setActive(isRideActive);
      }
      clearSceneHover();
      if (view === "ride") {
        updateRideCamera();
      }
      updateTerrainForZoom();
    };
    activateSceneView(activeView);
    attachRouteCameraControls(camera, canvas, routeRenderer.pickRoad);
    const hoverOverlay = createTrackHoverOverlay(routeRenderer, camera, canvas);
    const profileHoverCard = createTrackHoverCard(viewer);
    clearSceneHover = (): void => {
      hoverOverlay.hide();
      profileHoverCard.hide();
    };
    profileView = createTrackProfileView(profileCanvas, (hover) => {
      if (hover === null) {
        profileHoverCard.hide();
        return;
      }
      if (activeView === "ride") {
        profileHoverCard.hide();
        return;
      }

      hoverOverlay.hide();
      const profileBounds = profileCanvas.getBoundingClientRect();
      const viewerBounds = viewer.getBoundingClientRect();
      const layout = getTrackHoverLayout(
        {
          x: profileBounds.left - viewerBounds.left + hover.position.x,
          y: profileBounds.top - viewerBounds.top + hover.position.y,
        },
        { width: viewerBounds.width, height: viewerBounds.height },
      );
      if (layout === null) {
        profileHoverCard.hide();
        return;
      }

      profileHoverCard.setPoint(hover.point);
      profileHoverCard.setLayout(layout, { x: 0, y: 0 });
      profileHoverCard.show();
    }, focusTrackPoint);
    const updateRideReadout = (): void => {
      const totalDistance = activeGeometry?.routePoints.at(-1)?.distanceMeters ?? 0;
      rideProgress.value = String(totalDistance > 0 ? Math.round((rideDistanceMeters / totalDistance) * 1000) : 0);
      rideReadout.textContent = totalDistance > 0
        ? `${(rideDistanceMeters / 1000).toFixed(2)} / ${(totalDistance / 1000).toFixed(2)} km · ${rideSpeed.value} km/h`
        : "Load a route to ride";
      profileView?.setRiderDistance(totalDistance > 0 ? rideDistanceMeters : null);
    };
    updateRideCamera = (): void => {
      if (activeGeometry === null) {
        return;
      }
      const pose = getRideCameraPose(
        activeGeometry.routePoints,
        rideDistanceMeters,
        activeGeometry.projection.sceneUnitsPerMeter,
      );
      rideRenderer?.setCameraPose(pose);
    };
    setRideDistance = (distanceMeters): void => {
      const totalDistance = activeGeometry?.routePoints.at(-1)?.distanceMeters;
      if (totalDistance === undefined) {
        return;
      }
      rideDistanceMeters = Math.max(0, Math.min(totalDistance, distanceMeters));
      updateRideCamera();
      updateRideReadout();
    };
    ridePlayButton.addEventListener("click", () => {
      const totalDistance = activeGeometry?.routePoints.at(-1)?.distanceMeters;
      if (totalDistance === undefined) {
        return;
      }
      if (rideIsPlaying) {
        rideIsPlaying = false;
      } else {
        if (rideDistanceMeters >= totalDistance) {
          setRideDistance(0);
        }
        rideIsPlaying = true;
      }
      ridePlayButton.textContent = rideIsPlaying ? "Pause ride" : rideDistanceMeters >= totalDistance ? "Ride again" : "Resume ride";
    });
    rideProgress.addEventListener("input", () => {
      rideIsPlaying = false;
      const totalDistance = activeGeometry?.routePoints.at(-1)?.distanceMeters ?? 0;
      setRideDistance((Number(rideProgress.value) / 1000) * totalDistance);
      ridePlayButton.textContent = rideDistanceMeters >= totalDistance ? "Ride again" : "Resume ride";
    });
    rideSpeed.addEventListener("change", updateRideReadout);
    const profileResizeObserver = new ResizeObserver(() => profileView.refresh());
    profileResizeObserver.observe(profileCanvas.parentElement ?? profileCanvas);
    canvas.addEventListener("dblclick", (event: MouseEvent) => {
      if (activeGeometry === null) {
        return;
      }

      const pickingRay = routeRenderer.getPointerRay(event.clientX, event.clientY);
      const bounds = canvas.getBoundingClientRect();
      const tolerance = getTrackHoverTolerance(
        activeGeometry.roadHalfWidth,
        camera.radius,
        camera.fov,
        bounds.height,
      );
      const point = pickingRay === null ? null : activeTrackPointRayIndex(pickingRay, tolerance);
      if (point !== null) {
        event.preventDefault();
        focusTrackPoint(point.pointNumber - 1);
      }
    });
    canvas.addEventListener("pointermove", (event: PointerEvent) => {
      profileHoverCard.hide();
      hoverOverlay.updatePointer(event.clientX, event.clientY);
    });
    canvas.addEventListener("pointerleave", hoverOverlay.hide);
    let lastRideFrameTime: number | null = null;
    let lastRideHudTime = 0;
    const advanceRide = (now: number): void => {
      const elapsedSeconds = lastRideFrameTime === null ? 0 : Math.min(0.1, Math.max(0, now - lastRideFrameTime) / 1000);
      lastRideFrameTime = now;
      if (activeView === "ride" && rideIsPlaying && activeGeometry !== null) {
        const totalDistance = activeGeometry.routePoints.at(-1)?.distanceMeters ?? 0;
        rideDistanceMeters = Math.min(totalDistance, rideDistanceMeters + elapsedSeconds * (Number(rideSpeed.value) / 3.6));
        if (rideDistanceMeters >= totalDistance) {
          rideIsPlaying = false;
        }
        updateRideCamera();
        if (now - lastRideHudTime >= 100 || !rideIsPlaying) {
          updateRideReadout();
          lastRideHudTime = now;
          ridePlayButton.textContent = rideIsPlaying ? "Pause ride" : rideDistanceMeters >= totalDistance ? "Ride again" : "Resume ride";
        }
        updateTerrainForZoom();
      }
      requestAnimationFrame(advanceRide);
    };
    requestAnimationFrame(advanceRide);
    const refreshHoverOverlay = (): void => {
      hoverOverlay.refresh();
      requestAnimationFrame(refreshHoverOverlay);
    };
    requestAnimationFrame(refreshHoverOverlay);

    let terrainVisible = terrainVisibilityToggle.checked;
    let terrainRequestId = 0;
    let terrainRequestController: AbortController | null = null;
    let activeTerrainLoader: ((mapZoom: number, view?: TerrainView) => Promise<TerrainDemData>) | null = null;
    let bestTerrainDem: TerrainDemData | null = null;
    let activeTerrainFeatures: OpenStreetMapFeatures = emptyOpenStreetMapFeatures;
    const requestedTerrainCoverageKeys = new Set<string>();
    let scheduledTerrainCoverageKey: string | null = null;
    let terrainZoomTimer: number | null = null;
    let terrainLoadInProgress = false;
    terrainVisibilityToggle.addEventListener("change", () => {
      terrainVisible = terrainVisibilityToggle.checked;
      routeRenderer.setTerrainVisible(terrainVisible);
    });

    const renderTrack = (track: Track): void => {
      terrainRequestController?.abort();
      if (terrainZoomTimer !== null) {
        window.clearTimeout(terrainZoomTimer);
        terrainZoomTimer = null;
      }
      scheduledTerrainCoverageKey = null;
      requestedTerrainCoverageKeys.clear();
      terrainLoadInProgress = false;
      terrainRequestId += 1;
      const requestId = terrainRequestId;
      const requestController = new AbortController();
      terrainRequestController = requestController;
      const geometry = createTrackMeshData(track.points);
      trackProjection = geometry.projection;
      activeGeometry = geometry;
      rideRenderer?.setRoute(geometry);
      activeTrackPoints = track.points;
      activeTrackLongitudes = getContinuousLongitudes(track.points);
      activeTrackPointRayIndex = createTrackPointRayIndex(geometry.routePoints);
      profileView.setRoute(geometry.routePoints);
      rideDistanceMeters = 0;
      rideIsPlaying = false;
      rideProgress.disabled = false;
      ridePlayButton.disabled = false;
      rideSpeed.disabled = false;
      ridePlayButton.textContent = "Start ride";
      setRideDistance(0);
      terrainMap.setRoute(track.points);
      const gradientCurtain = createGradientCurtainMeshData(geometry);
      const cameraBounds = Object.freeze({
        ...geometry.bounds,
        minY: Math.min(geometry.bounds.minY, gradientCurtain.bounds.minY),
      });
      const roadMarkings = createRideRoadMarkings(
        geometry.routePoints,
        geometry.roadHalfWidth,
        geometry.projection.sceneUnitsPerMeter,
      );
      routeRenderer.setRoute(geometry, gradientCurtain, roadMarkings);
      routeRenderer.setTerrainVisible(terrainVisible);
      hoverOverlay.setRoute(geometry);
      fitCameraToBounds(camera, canvas, cameraBounds);
      const captureCamera = () => ({
        alpha: camera.alpha,
        beta: camera.beta,
        radius: camera.radius,
        targetX: camera.target.x,
        targetY: camera.target.y,
        targetZ: camera.target.z,
      });
      let fittedCamera = captureCamera();
      const currentTerrainView = (): TerrainView | null => {
        const viewport = getRideViewportSize(
          activeView,
          canvas.getBoundingClientRect(),
          rideCanvas.getBoundingClientRect(),
        );
        if (trackProjection === null || viewport === null) {
          return null;
        }
        const { width, height } = viewport;
        if (activeView === "ride") {
          const sceneUnitsPerMeter = trackProjection.sceneUnitsPerMeter;
          const pose = getRideCameraPose(geometry.routePoints, rideDistanceMeters, sceneUnitsPerMeter);
          const latitude = trackProjection.centerLatitude + pose.position.z / (111_320 * sceneUnitsPerMeter);
          const longitude = trackProjection.centerLongitude + pose.position.x / (
            111_320 * sceneUnitsPerMeter * Math.max(1e-8, Math.abs(trackProjection.longitudeScale))
          );
          return { center: [longitude, latitude], zoom: 15, width, height, pitch: 0 };
        }
        const view = getMapCameraView(camera, { width, height }, trackProjection);
        return view === null ? null : { center: view.center, zoom: view.zoom, width, height, pitch: view.pitch };
      };
      const renderLandscape = (
        elevationData: TerrainDemData | null,
        features: OpenStreetMapFeatures,
        gridSize: number,
        fitCamera: boolean,
      ): void => {
        const landUseIndex = createLandUseSpatialIndex(features.areas);
        const terrainColorAt = features.areas.length === 0
          ? undefined
          : (x: number, z: number) => landUseIndex.getColorAt(x, z) ?? [0.3, 0.4, 0.24] as const;
        const noElevation: TerrainElevationSampler = () => null;
        const terrain = createTerrainMeshData(geometry, elevationData?.elevationAt ?? noElevation, gridSize, terrainColorAt);
        const scenery = createTerrainScenery(terrain, geometry, undefined, features, landUseIndex);
        routeRenderer.setLandscape(terrain, scenery);
        routeRenderer.setTerrainVisible(terrainVisible);
        rideRenderer?.setEnvironment(elevationData, features);

        const cameraUnchanged =
          Math.abs(camera.alpha - fittedCamera.alpha) < 1e-6 &&
          Math.abs(camera.beta - fittedCamera.beta) < 1e-6 &&
          Math.abs(camera.radius - fittedCamera.radius) < 1e-6 &&
          Math.abs(camera.target.x - fittedCamera.targetX) < 1e-6 &&
          Math.abs(camera.target.y - fittedCamera.targetY) < 1e-6 &&
          Math.abs(camera.target.z - fittedCamera.targetZ) < 1e-6;
        if (fitCamera && cameraUnchanged) {
          fitCameraToBounds(camera, canvas, {
            ...terrain.bounds,
            minY: Math.min(terrain.bounds.minY, gradientCurtain.bounds.minY),
          });
          fittedCamera = captureCamera();
        }
      };

      activeTerrainFeatures = emptyOpenStreetMapFeatures;
      bestTerrainDem = null;
      activeTerrainLoader = createTerrainDemLoader(geometry, requestController.signal);
      renderLandscape(null, activeTerrainFeatures, 65, true);
      const initialMapZoom = currentTerrainView()?.zoom ?? 8;
      const getGridSizeAtZoom = (mapZoom: number): number =>
        Math.max(17, Math.min(129, Math.round(65 * 2 ** (mapZoom - initialMapZoom))));

      updateTerrainForZoom = (): void => {
        const view = currentTerrainView();
        if (view === null || activeTerrainLoader === null) {
          return;
        }

        const coverage = getTerrainTileCoverage(geometry, view.zoom, view);
        const coverageKey = `${coverage.zoom}:${coverage.minX}:${coverage.maxX}:${coverage.minY}:${coverage.maxY}`;
        if (requestedTerrainCoverageKeys.has(coverageKey)) {
          return;
        }
        if (scheduledTerrainCoverageKey === coverageKey) {
          return;
        }
        if (terrainZoomTimer !== null) {
          window.clearTimeout(terrainZoomTimer);
        }
        scheduledTerrainCoverageKey = coverageKey;
        terrainZoomTimer = window.setTimeout(() => {
          terrainZoomTimer = null;
          scheduledTerrainCoverageKey = null;
          const currentView = currentTerrainView();
          const loader = activeTerrainLoader;
          if (currentView === null || loader === null || requestId !== terrainRequestId) {
            return;
          }

          const requestedCoverage = getTerrainTileCoverage(geometry, currentView.zoom, currentView);
          const requestedCoverageKey = `${requestedCoverage.zoom}:${requestedCoverage.minX}:${requestedCoverage.maxX}:${requestedCoverage.minY}:${requestedCoverage.maxY}`;
          if (requestedTerrainCoverageKeys.has(requestedCoverageKey)) {
            return;
          }
          if (terrainLoadInProgress) {
            return;
          }
          requestedTerrainCoverageKeys.add(requestedCoverageKey);
          if (requestedTerrainCoverageKeys.size > 256) {
            const oldestKey = requestedTerrainCoverageKeys.values().next().value;
            if (oldestKey !== undefined) {
              requestedTerrainCoverageKeys.delete(oldestKey);
            }
          }
          terrainLoadInProgress = true;
          void loader(currentView.zoom, currentView).then((terrainDem) => {
            if (requestId !== terrainRequestId) {
              return;
            }

            bestTerrainDem = retainBestTerrainElevation(bestTerrainDem, terrainDem);
            renderLandscape(
              bestTerrainDem,
              activeTerrainFeatures,
              getGridSizeAtZoom(currentTerrainView()?.zoom ?? terrainDem.zoom),
              true,
            );
            setStatus(`Terrain updated with elevation tiles at zoom ${terrainDem.zoom}.`);
          }).catch(() => {
            if (requestId === terrainRequestId && bestTerrainDem === null) {
              setStatus("Elevation tiles are unavailable; showing GPX-conformed terrain.");
            }
          }).finally(() => {
            if (requestId === terrainRequestId) {
              terrainLoadInProgress = false;
              updateTerrainForZoom();
            }
          });
        }, 180);
      };

      void loadOpenStreetMapFeatures(geometry, requestController.signal).then((features) => {
        if (requestId !== terrainRequestId) {
          return;
        }
        activeTerrainFeatures = features;
        renderLandscape(
          bestTerrainDem,
          features,
          getGridSizeAtZoom(currentTerrainView()?.zoom ?? initialMapZoom),
          true,
        );
      }).catch(() => {});
      updateTerrainForZoom();

      viewerRouteTitle.textContent = track.name;
      emptyState.hidden = true;
      setStatus("Route loaded. Showing GPX-conformed terrain while elevation and map features load…");
    };

    const openFile = async (file: File): Promise<void> => {
      setStatus(`Reading ${file.name}…`);

      try {
        renderTrack(parseGpx(await file.text()));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to read this GPX file.", true);
      }
    };

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file !== undefined) {
        void openFile(file);
      }
      fileInput.value = "";
    });

    viewer.addEventListener("dragover", (event: DragEvent) => {
      event.preventDefault();
      viewer.classList.add("is-dragging");
    });
    viewer.addEventListener("dragleave", (event: DragEvent) => {
      if (!viewer.contains(event.relatedTarget as Node | null)) {
        viewer.classList.remove("is-dragging");
      }
    });
    viewer.addEventListener("drop", (event: DragEvent) => {
      event.preventDefault();
      viewer.classList.remove("is-dragging");
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) {
        void openFile(file);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WebGL could not start.";
    engineError.hidden = false;
    engineError.textContent = `The 3D viewer could not start. Use a WebGL-enabled browser, then reload. (${message})`;
    setStatus("3D rendering is unavailable in this browser.", true);
  }
};

void initializeViewer();
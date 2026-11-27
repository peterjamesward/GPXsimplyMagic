import {
  addToScene,
  createEngine,
  createHemisphericLight,
  createMeshFromData,
  createSceneContext,
  createStandardMaterial,
  enableStandardVertexColors,
  removeFromScene,
  registerScene,
  setMeshVisible,
  startEngine,
} from "@babylonjs/lite";
import type { Mesh } from "@babylonjs/lite";
import {
  getMapCameraView,
  getRouteCameraMetersPerPixel,
  getRouteCameraRadiusForMetersPerPixel,
  getRouteCameraState,
  getWrappedAngleDifference,
} from "./mapCameraSync";
import {
  attachRouteCameraControls,
  centerCameraOnTrackPoint,
  createRouteCamera,
  fitCameraToBounds,
  getPointerRay,
} from "./cameraControls";
import { parseGpx, type Track } from "./gpx";
import {
  createTrackMeshData,
  getContinuousLongitudes,
  type TrackMeshData,
  type TrackMeshPart,
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
import { createGradientCurtainMeshData, type GradientCurtainMeshData } from "./gradientCurtain";
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
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const canvas = document.querySelector<HTMLCanvasElement>("#route-canvas");
const fileInput = document.querySelector<HTMLInputElement>("#gpx-file");
const viewer = document.querySelector<HTMLElement>("#viewer");
const showRouteViewButton = document.querySelector<HTMLButtonElement>("#show-route-view");
const showMapViewButton = document.querySelector<HTMLButtonElement>("#show-map-view");
const terrainControl = document.querySelector<HTMLElement>("#terrain-control");
const terrainVisibilityToggle = document.querySelector<HTMLInputElement>("#show-terrain");
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
  terrainControl === null ||
  terrainVisibilityToggle === null ||
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

const showView = (activeView: "route" | "map"): void => {
  const isRouteActive = activeView === "route";
  showRouteViewButton.setAttribute("aria-selected", String(isRouteActive));
  showMapViewButton.setAttribute("aria-selected", String(!isRouteActive));
  showRouteViewButton.tabIndex = isRouteActive ? 0 : -1;
  showMapViewButton.tabIndex = isRouteActive ? -1 : 0;
  routeViewPanel.setAttribute("aria-hidden", String(!isRouteActive));
  terrainViewPanel.setAttribute("aria-hidden", String(isRouteActive));
  routeViewPanel.inert = !isRouteActive;
  terrainViewPanel.inert = isRouteActive;
  terrainControl.hidden = !isRouteActive;
};

showRouteViewButton.addEventListener("click", () => showView("route"));
showMapViewButton.addEventListener("click", () => showView("map"));

const viewTabs = [showRouteViewButton, showMapViewButton] as const;
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
      showView(nextIndex === 0 ? "route" : "map");
    }
  });
});

const setStatus = (message: string, isError = false): void => {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
};

const createRoadMesh = (
  engine: Awaited<ReturnType<typeof createEngine>>,
  name: string,
  geometry: TrackMeshPart,
  diffuseColor: [number, number, number],
  emissiveColor: [number, number, number],
): Mesh => {
  const mesh = createMeshFromData(
    engine,
    name,
    new Float32Array(geometry.positions),
    new Float32Array(geometry.normals),
    new Uint32Array(geometry.indices),
  );
  const material = createStandardMaterial();
  material.backFaceCulling = false;
  material.diffuseColor = diffuseColor;
  material.emissiveColor = emissiveColor;
  material.specularColor = [0.12, 0.12, 0.12];
  material.specularPower = 24;
  mesh.material = material;
  return mesh;
};

const createGradientCurtainMesh = (
  engine: Awaited<ReturnType<typeof createEngine>>,
  geometry: GradientCurtainMeshData,
): Mesh => {
  const mesh = createMeshFromData(
    engine,
    "route-gradient-curtain",
    new Float32Array(geometry.positions),
    new Float32Array(geometry.normals),
    new Uint32Array(geometry.indices),
    undefined,
    undefined,
    undefined,
    new Float32Array(geometry.colors),
  );
  const material = createStandardMaterial();
  material.backFaceCulling = false;
  material.disableLighting = true;
  material.diffuseColor = [1, 1, 1];
  material.emissiveColor = [1, 1, 1];
  material.alpha = 0.82;
  mesh.material = material;
  return mesh;
};

const createLandscapeMesh = (
  engine: Awaited<ReturnType<typeof createEngine>>,
  name: string,
  geometry: TrackMeshPart,
  diffuseColor: [number, number, number],
  emissiveColor: [number, number, number],
): Mesh => {
  const mesh = createMeshFromData(
    engine,
    name,
    new Float32Array(geometry.positions),
    new Float32Array(geometry.normals),
    new Uint32Array(geometry.indices),
    undefined,
    undefined,
    undefined,
    geometry.colors === undefined ? undefined : new Float32Array(geometry.colors),
  );
  const material = createStandardMaterial();
  material.backFaceCulling = false;
  material.disableLighting = geometry.colors !== undefined;
  material.diffuseColor = geometry.colors === undefined ? diffuseColor : [1, 1, 1];
  material.emissiveColor = geometry.colors === undefined ? emissiveColor : [1, 1, 1];
  material.specularColor = [0.08, 0.08, 0.08];
  material.specularPower = 12;
  mesh.material = material;
  return mesh;
};

const initializeViewer = async (): Promise<void> => {
  try {
    const [engine, { createTerrainMap }] = await Promise.all([
      createEngine(canvas),
      import("./maplibreTerrain"),
    ]);
    enableStandardVertexColors();
    const scene = createSceneContext(engine);
    const camera = createRouteCamera();
    const terrainMap = createTerrainMap(mapContainer, mapError);
    let trackProjection: TrackProjection | null = null;
    let activeGeometry: TrackMeshData | null = null;
    let activeTrackPoints: Track["points"] = [];
    let activeTrackLongitudes: readonly number[] = [];
    let activeTrackPointRayIndex = createTrackPointRayIndex([]);
    let syncingMapFromRoute = false;
    let updateTerrainForZoom = (): void => {};
    let profileView: ReturnType<typeof createTrackProfileView> | null = null;

    const focusTrackPoint = (index: number, metersPerPixel?: number): void => {
      const point = activeGeometry?.routePoints[index];
      if (point !== undefined) {
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
      if (trackProjection === null || syncingMapFromRoute) {
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
      if (trackProjection !== null && terrainMap.map.isStyleLoaded()) {
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

      updateTerrainForZoom();
      requestAnimationFrame(syncMapFromRoute);
    };
    requestAnimationFrame(syncMapFromRoute);

    const mapResizeObserver = new ResizeObserver(() => terrainMap.map.resize());
    mapResizeObserver.observe(mapContainer);

    scene.clearColor = { r: 0.52, g: 0.57, b: 0.56, a: 1 };
    scene.camera = camera;
    attachRouteCameraControls(camera, canvas, scene);
    addToScene(scene, createHemisphericLight([0, 1, 0], 1));
    const hoverOverlay = createTrackHoverOverlay(engine, scene, camera, canvas);
    const profileHoverCard = createTrackHoverCard(viewer);
    profileView = createTrackProfileView(profileCanvas, (hover) => {
      if (hover === null) {
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
    const profileResizeObserver = new ResizeObserver(() => profileView.refresh());
    profileResizeObserver.observe(profileCanvas.parentElement ?? profileCanvas);
    canvas.addEventListener("dblclick", (event: MouseEvent) => {
      if (activeGeometry === null) {
        return;
      }

      const pickingRay = getPointerRay(camera, canvas, event.clientX, event.clientY);
      const bounds = canvas.getBoundingClientRect();
      const ray = pickingRay === null
        ? null
        : {
            origin: { x: pickingRay.origin[0], y: pickingRay.origin[1], z: pickingRay.origin[2] },
            direction: { x: pickingRay.direction[0], y: pickingRay.direction[1], z: pickingRay.direction[2] },
          };
      const tolerance = getTrackHoverTolerance(
        activeGeometry.roadHalfWidth,
        camera.radius,
        camera.fov,
        bounds.height,
      );
      const point = ray === null ? null : activeTrackPointRayIndex(ray, tolerance);
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
    await registerScene(scene);
    await startEngine(engine);
    const refreshHoverOverlay = (): void => {
      hoverOverlay.refresh();
      requestAnimationFrame(refreshHoverOverlay);
    };
    requestAnimationFrame(refreshHoverOverlay);

    let activeMeshes: readonly Mesh[] = [];
    let activeLandscapeMeshes: readonly Mesh[] = [];
    let activeGradientCurtainMeshes: readonly Mesh[] = [];
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
      activeLandscapeMeshes.forEach((mesh) => setMeshVisible(mesh, terrainVisible));
      activeGradientCurtainMeshes.forEach((mesh) => setMeshVisible(mesh, !terrainVisible));
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
      activeTrackPoints = track.points;
      activeTrackLongitudes = getContinuousLongitudes(track.points);
      activeTrackPointRayIndex = createTrackPointRayIndex(geometry.routePoints);
      profileView.setRoute(geometry.routePoints);
      terrainMap.setRoute(track.points);
      const gradientCurtain = createGradientCurtainMeshData(geometry);
      const cameraBounds = Object.freeze({
        ...geometry.bounds,
        minY: Math.min(geometry.bounds.minY, gradientCurtain.bounds.minY),
      });
      const gradientCurtainMeshes = gradientCurtain.indices.length === 0
        ? []
        : [createGradientCurtainMesh(engine, gradientCurtain)];
      const meshes: Mesh[] = [
        createRoadMesh(engine, "gpx-road", geometry, [0.17, 0.18, 0.19], [0.035, 0.037, 0.04]),
        createRoadMesh(engine, "gpx-road-left", geometry.leftSide, [0.08, 0.68, 0.16], [0.015, 0.1, 0.025]),
        createRoadMesh(engine, "gpx-road-right", geometry.rightSide, [0.78, 0.08, 0.06], [0.12, 0.015, 0.012]),
        createRoadMesh(engine, "gpx-road-surface", geometry.topSurface, [0.17, 0.18, 0.19], [0.035, 0.037, 0.04]),
        ...gradientCurtainMeshes,
      ];

      activeMeshes.forEach((mesh) => removeFromScene(scene, mesh));
      activeLandscapeMeshes = [];
      meshes.forEach((mesh) => addToScene(scene, mesh));
      gradientCurtainMeshes.forEach((mesh) => setMeshVisible(mesh, !terrainVisible));
      activeMeshes = meshes;
      activeGradientCurtainMeshes = gradientCurtainMeshes;
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
        const { width, height } = canvas.getBoundingClientRect();
        if (trackProjection === null) {
          return null;
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
        const landscapeMeshes = [
          createLandscapeMesh(engine, "route-terrain-ground", terrain, [0.3, 0.4, 0.24], [0.035, 0.05, 0.025]),
          ...(scenery.foliage.positions.length === 0
            ? []
            : [createLandscapeMesh(engine, "route-terrain-foliage", scenery.foliage, [0.08, 0.27, 0.1], [0.01, 0.04, 0.015])]),
          ...(scenery.trunks.positions.length === 0
            ? []
            : [createLandscapeMesh(engine, "route-terrain-trunks", scenery.trunks, [0.28, 0.16, 0.09], [0.025, 0.012, 0.006])]),
          ...(scenery.buildingWalls.positions.length === 0
            ? []
            : [createLandscapeMesh(engine, "route-terrain-buildings", scenery.buildingWalls, [0.68, 0.59, 0.44], [0.06, 0.045, 0.026])]),
          ...(scenery.buildingRoofs.positions.length === 0
            ? []
            : [createLandscapeMesh(engine, "route-terrain-roofs", scenery.buildingRoofs, [0.38, 0.18, 0.12], [0.045, 0.014, 0.009])]),
        ];
        landscapeMeshes.forEach((mesh) => {
          addToScene(scene, mesh);
          setMeshVisible(mesh, terrainVisible);
        });
        const previousLandscapeMeshes = activeLandscapeMeshes;
        previousLandscapeMeshes.forEach((mesh) => removeFromScene(scene, mesh));
        activeLandscapeMeshes = landscapeMeshes;
        activeMeshes = [
          ...activeMeshes.filter((mesh) => !previousLandscapeMeshes.includes(mesh)),
          ...landscapeMeshes,
        ];

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
    const message = error instanceof Error ? error.message : "WebGPU could not start.";
    engineError.hidden = false;
    engineError.textContent = `The 3D viewer could not start. Use a WebGPU-enabled browser, then reload. (${message})`;
    setStatus("3D rendering is unavailable in this browser.", true);
  }
};

void initializeViewer();
import {
  addToScene,
  createEngine,
  createHemisphericLight,
  createMeshFromData,
  createSceneContext,
  createStandardMaterial,
  removeFromScene,
  registerScene,
  startEngine,
} from "@babylonjs/lite";
import type { Mesh } from "@babylonjs/lite";
import { getMapCameraView, getRouteCameraState, getWrappedAngleDifference } from "./mapCameraSync";
import {
  attachRouteCameraControls,
  centerCameraOnTrackPoint,
  createRouteCamera,
  fitCameraToBounds,
  getPointerRay,
} from "./cameraControls";
import { getTrackSummary, parseGpx, type Track } from "./gpx";
import {
  createTrackMeshData,
  getContinuousLongitudes,
  type TrackMeshData,
  type TrackMeshPart,
  type TrackProjection,
} from "./trackGeometry";
import { findTrackPointNearRay } from "./trackHover";
import { createTrackHoverOverlay } from "./trackHoverOverlay";
import { getTrackHoverTolerance } from "./trackHoverLayout";
import { findNearestScreenPointIndex } from "./trackPointFocus";
import { loadTerrainDem } from "./terrainDem";
import { createTerrainMeshData } from "./terrainGeometry";
import { createTerrainScenery } from "./terrainScenery";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const canvas = document.querySelector<HTMLCanvasElement>("#route-canvas");
const fileInput = document.querySelector<HTMLInputElement>("#gpx-file");
const viewer = document.querySelector<HTMLElement>("#viewer");
const showRouteViewButton = document.querySelector<HTMLButtonElement>("#show-route-view");
const showMapViewButton = document.querySelector<HTMLButtonElement>("#show-map-view");
const routeViewPanel = document.querySelector<HTMLElement>("#route-view-panel");
const terrainViewPanel = document.querySelector<HTMLElement>("#terrain-view-panel");
const mapContainer = document.querySelector<HTMLElement>("#map-canvas");
const mapError = document.querySelector<HTMLElement>("#map-error");
const emptyState = document.querySelector<HTMLElement>("#empty-state");
const statusMessage = document.querySelector<HTMLElement>("#status-message");
const engineError = document.querySelector<HTMLElement>("#engine-error");
const routeName = document.querySelector<HTMLElement>("#route-name");
const routeFilename = document.querySelector<HTMLElement>("#route-filename");
const viewerRouteTitle = document.querySelector<HTMLElement>("#viewer-route-title");
const pointCount = document.querySelector<HTMLElement>("#point-count");
const distance = document.querySelector<HTMLElement>("#distance");
const elevationGain = document.querySelector<HTMLElement>("#elevation-gain");
const routeIndicator = document.querySelector<HTMLElement>("#route-indicator");

if (
  canvas === null ||
  fileInput === null ||
  viewer === null ||
  showRouteViewButton === null ||
  showMapViewButton === null ||
  routeViewPanel === null ||
  terrainViewPanel === null ||
  mapContainer === null ||
  mapError === null ||
  emptyState === null ||
  statusMessage === null ||
  engineError === null ||
  routeName === null ||
  routeFilename === null ||
  viewerRouteTitle === null ||
  pointCount === null ||
  distance === null ||
  elevationGain === null ||
  routeIndicator === null
) {
  throw new Error("The route viewer page is missing required elements.");
}

const showView = (activeView: "route" | "map"): void => {
  const isRouteActive = activeView === "route";
  showRouteViewButton.setAttribute("aria-pressed", String(isRouteActive));
  showMapViewButton.setAttribute("aria-pressed", String(!isRouteActive));
  routeViewPanel.setAttribute("aria-hidden", String(!isRouteActive));
  terrainViewPanel.setAttribute("aria-hidden", String(isRouteActive));
  routeViewPanel.inert = !isRouteActive;
  terrainViewPanel.inert = isRouteActive;
};

showRouteViewButton.addEventListener("click", () => showView("route"));
showMapViewButton.addEventListener("click", () => showView("map"));

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
  );
  const material = createStandardMaterial();
  material.backFaceCulling = false;
  material.diffuseColor = diffuseColor;
  material.emissiveColor = emissiveColor;
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
    const scene = createSceneContext(engine);
    const camera = createRouteCamera();
    const terrainMap = createTerrainMap(mapContainer, mapError);
    let trackProjection: TrackProjection | null = null;
    let activeGeometry: TrackMeshData | null = null;
    let activeTrackPoints: Track["points"] = [];
    let syncingMapFromRoute = false;

    const focusTrackPoint = (index: number): void => {
      const point = activeGeometry?.routePoints[index];
      if (point !== undefined) {
        centerCameraOnTrackPoint(camera, point);
      }
    };

    terrainMap.map.on("dblclick", (event) => {
      if (activeTrackPoints.length === 0) {
        return;
      }

      const centerLongitude = terrainMap.map.getCenter().lng;
      const longitudes = getContinuousLongitudes(activeTrackPoints);
      const screenPoints = activeTrackPoints.map((point, index) => {
        const longitude = longitudes[index] + 360 * Math.round((centerLongitude - longitudes[index]) / 360);
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
      const point = ray === null ? null : findTrackPointNearRay(ray, activeGeometry.routePoints, tolerance);
      if (point !== null) {
        event.preventDefault();
        focusTrackPoint(point.pointNumber - 1);
      }
    });
    canvas.addEventListener("pointermove", (event: PointerEvent) => {
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
    let terrainRequestId = 0;

    const renderTrack = (track: Track, fileName: string): void => {
      terrainRequestId += 1;
      const requestId = terrainRequestId;
      const geometry = createTrackMeshData(track.points);
      trackProjection = geometry.projection;
      activeGeometry = geometry;
      activeTrackPoints = track.points;
      terrainMap.setRoute(track.points);
      const meshes = [
        createRoadMesh(engine, "gpx-road", geometry, [0.17, 0.18, 0.19], [0.035, 0.037, 0.04]),
        createRoadMesh(engine, "gpx-road-left", geometry.leftSide, [0.08, 0.68, 0.16], [0.015, 0.1, 0.025]),
        createRoadMesh(engine, "gpx-road-right", geometry.rightSide, [0.78, 0.08, 0.06], [0.12, 0.015, 0.012]),
        createRoadMesh(engine, "gpx-road-surface", geometry.topSurface, [0.17, 0.18, 0.19], [0.035, 0.037, 0.04]),
      ];

      activeMeshes.forEach((mesh) => removeFromScene(scene, mesh));
      meshes.forEach((mesh) => addToScene(scene, mesh));
      activeMeshes = meshes;
      hoverOverlay.setRoute(geometry);
      fitCameraToBounds(camera, canvas, geometry.bounds);
      const fittedCamera = {
        alpha: camera.alpha,
        beta: camera.beta,
        radius: camera.radius,
        targetX: camera.target.x,
        targetY: camera.target.y,
        targetZ: camera.target.z,
      };

      void (async () => {
        let elevationAvailable = true;
        let elevationAt: (latitude: number, longitude: number) => number | null;
        try {
          elevationAt = await loadTerrainDem(geometry);
        } catch {
          elevationAvailable = false;
          elevationAt = () => null;
        }

        if (requestId !== terrainRequestId) {
          return;
        }

        const terrain = createTerrainMeshData(geometry, elevationAt);
        const scenery = createTerrainScenery(terrain, geometry);
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
        landscapeMeshes.forEach((mesh) => addToScene(scene, mesh));
        activeMeshes = [...activeMeshes, ...landscapeMeshes];

        const cameraUnchanged =
          Math.abs(camera.alpha - fittedCamera.alpha) < 1e-6 &&
          Math.abs(camera.beta - fittedCamera.beta) < 1e-6 &&
          Math.abs(camera.radius - fittedCamera.radius) < 1e-6 &&
          Math.abs(camera.target.x - fittedCamera.targetX) < 1e-6 &&
          Math.abs(camera.target.y - fittedCamera.targetY) < 1e-6 &&
          Math.abs(camera.target.z - fittedCamera.targetZ) < 1e-6;
        if (cameraUnchanged) {
          fitCameraToBounds(camera, canvas, terrain.bounds);
        }

        setStatus(elevationAvailable
          ? "Route loaded with map-tile terrain, trees, and buildings. Drag to pan, Control-drag to orbit, or scroll to zoom."
          : "Route loaded with GPX-conformed terrain, trees, and buildings; map elevation tiles were unavailable. Drag to pan, Control-drag to orbit, or scroll to zoom.");
      })();

      const summary = getTrackSummary(track.points);
      routeName.textContent = track.name;
      routeFilename.textContent = fileName;
      viewerRouteTitle.textContent = track.name.toUpperCase();
      pointCount.textContent = track.points.length.toLocaleString();
      distance.textContent = `${summary.distanceKm.toFixed(1)} km`;
      elevationGain.textContent = `${Math.round(summary.elevationGainMeters).toLocaleString()} m`;
      routeIndicator.classList.add("is-loaded");
      routeIndicator.setAttribute("aria-label", "Route loaded");
      emptyState.hidden = true;
      setStatus("Route loaded. Fetching terrain and scenery…");
    };

    const openFile = async (file: File): Promise<void> => {
      setStatus(`Reading ${file.name}…`);

      try {
        renderTrack(parseGpx(await file.text()), file.name);
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
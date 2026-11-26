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
import { attachRouteCameraControls, createRouteCamera, fitCameraToBounds } from "./cameraControls";
import { getTrackSummary, parseGpx, type Track } from "./gpx";
import { createTrackMeshData, type TrackMeshPart } from "./trackGeometry";
import "./styles.css";

const canvas = document.querySelector<HTMLCanvasElement>("#route-canvas");
const fileInput = document.querySelector<HTMLInputElement>("#gpx-file");
const viewer = document.querySelector<HTMLElement>("#viewer");
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

const initializeViewer = async (): Promise<void> => {
  try {
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    const camera = createRouteCamera();

    scene.clearColor = { r: 0.52, g: 0.57, b: 0.56, a: 1 };
    scene.camera = camera;
    attachRouteCameraControls(camera, canvas, scene);
    addToScene(scene, createHemisphericLight([0, 1, 0], 1));
    await registerScene(scene);
    await startEngine(engine);

    let activeMeshes: readonly Mesh[] = [];

    const renderTrack = (track: Track, fileName: string): void => {
      const geometry = createTrackMeshData(track.points);
      const meshes = [
        createRoadMesh(engine, "gpx-road", geometry, [0.17, 0.18, 0.19], [0.035, 0.037, 0.04]),
        createRoadMesh(engine, "gpx-road-left", geometry.leftSide, [0.08, 0.68, 0.16], [0.015, 0.1, 0.025]),
        createRoadMesh(engine, "gpx-road-right", geometry.rightSide, [0.78, 0.08, 0.06], [0.12, 0.015, 0.012]),
        createRoadMesh(engine, "gpx-road-surface", geometry.topSurface, [0.17, 0.18, 0.19], [0.035, 0.037, 0.04]),
      ];

      activeMeshes.forEach((mesh) => removeFromScene(scene, mesh));
      meshes.forEach((mesh) => addToScene(scene, mesh));
      activeMeshes = meshes;
      fitCameraToBounds(camera, canvas, geometry.bounds);

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
      setStatus("Route loaded. Drag the track or background to pan, Control-drag to orbit around the road at the center, or scroll to zoom.");
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
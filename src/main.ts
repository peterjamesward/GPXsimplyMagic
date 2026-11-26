import {
  addToScene,
  attachControl,
  createArcRotateCamera,
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
import { getTrackSummary, parseGpx, type Track } from "./gpx";
import { createTrackMeshData } from "./trackGeometry";
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

const initializeViewer = async (): Promise<void> => {
  try {
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    const camera = createArcRotateCamera(-Math.PI / 2, 1.08, 18, { x: 0, y: 0, z: 0 });

    scene.camera = camera;
    attachControl(camera, canvas, scene);
    addToScene(scene, createHemisphericLight([0, 1, 0], 1));
    await registerScene(scene);
    await startEngine(engine);

    let activeMesh: Mesh | undefined;

    const renderTrack = (track: Track, fileName: string): void => {
      const geometry = createTrackMeshData(track.points);
      const mesh = createMeshFromData(
        engine,
        "gpx-route",
        new Float32Array(geometry.positions),
        new Float32Array(geometry.normals),
        new Uint32Array(geometry.indices),
      );
      const material = createStandardMaterial();
      material.diffuseColor = [0.17, 0.82, 0.69];
      material.emissiveColor = [0.025, 0.14, 0.105];
      material.specularColor = [0.22, 0.34, 0.31];
      material.specularPower = 48;
      mesh.material = material;

      if (activeMesh !== undefined) {
        removeFromScene(scene, activeMesh);
      }

      addToScene(scene, mesh);
      activeMesh = mesh;

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
      setStatus("Route loaded. Drag to orbit, right-drag to pan, or scroll to zoom.");
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
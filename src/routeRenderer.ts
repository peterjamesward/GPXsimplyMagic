import * as THREE from "three";
import type { TerrainSceneryData } from "./terrainScenery";
import type { TerrainMeshData } from "./terrainGeometry";
import type { TrackMeshData, TrackMeshPart } from "./trackGeometry";
import { createRouteCamera, getPointerRay as createRoutePointerRay, updateRouteCamera, type RouteCamera, type TrackRay } from "./cameraControls";
import type { GradientCurtainMeshData } from "./gradientCurtain";
import { createStylizedGrassMesh, createStylizedTreeGroup, loadStylizedVegetationAssets, updateStylizedVegetationWind, type StylizedVegetationAssets } from "./stylizedVegetation";

export type RouteRenderer = Readonly<{
  camera: RouteCamera;
  setRoute: (geometry: TrackMeshData, curtain: GradientCurtainMeshData, roadMarkings: TrackMeshPart) => void;
  setLandscape: (terrain: TerrainMeshData, scenery: TerrainSceneryData) => void;
  setTerrainVisible: (visible: boolean) => void;
  setActive: (active: boolean) => void;
  getPointerRay: (clientX: number, clientY: number) => TrackRay | null;
  pickRoad: (ray: TrackRay) => Readonly<{ x: number; y: number; z: number }> | null;
  addOverlay: (object: THREE.Object3D) => void;
  dispose: () => void;
}>;

const createGeometry = (part: TrackMeshPart): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(part.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(part.normals, 3));
  geometry.setIndex(part.indices as number[]);
  if (part.colors !== undefined) {
    const vertexCount = part.positions.length / 3;
    const colors = new Float32Array(vertexCount * 3);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      colors[vertex * 3] = part.colors[vertex * 4] ?? 1;
      colors[vertex * 3 + 1] = part.colors[vertex * 4 + 1] ?? 1;
      colors[vertex * 3 + 2] = part.colors[vertex * 4 + 2] ?? 1;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  geometry.computeBoundingSphere();
  return geometry;
};

const createMesh = (
  part: TrackMeshPart,
  name: string,
  color: THREE.ColorRepresentation,
  options: Readonly<{
    vertexColors?: boolean;
    emissive?: THREE.ColorRepresentation;
    opacity?: number;
    transparent?: boolean;
    depthWrite?: boolean;
    roughness?: number;
  }> = {},
): THREE.Mesh => {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: options.emissive ?? "#000000",
    roughness: options.roughness ?? 0.9,
    side: THREE.DoubleSide,
    vertexColors: options.vertexColors ?? part.colors !== undefined,
    opacity: options.opacity ?? 1,
    transparent: options.transparent ?? false,
    depthWrite: options.depthWrite ?? true,
  });
  const mesh = new THREE.Mesh(createGeometry(part), material);
  mesh.name = name;
  mesh.frustumCulled = true;
  return mesh;
};

const disposeGroup = (group: THREE.Group | null): void => {
  if (group === null) return;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    }
  });
};

const disposeMaterial = (material: THREE.Material | readonly THREE.Material[]): void => {
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else (material as THREE.Material).dispose();
};

export const createRouteRenderer = (canvas: HTMLCanvasElement): RouteRenderer => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#91bfd0");
  scene.fog = new THREE.Fog("#91bfd0", 70, 260);
  scene.add(new THREE.HemisphereLight("#e8f4f4", "#627258", 1.45));
  const sun = new THREE.DirectionalLight("#fff1d2", 1.8);
  sun.position.set(-25, 45, -30);
  scene.add(sun);

  const camera = createRouteCamera();

  let routeGroup: THREE.Group | null = null;
  let landscapeGroup: THREE.Group | null = null;
  let curtainMesh: THREE.Mesh | null = null;
  let animationFrame: number | null = null;
  let active = true;
  let disposed = false;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let stylizedAssets: StylizedVegetationAssets | null = null;
  let terrainVisible = true;
  let currentLandscape: Readonly<{ terrain: TerrainMeshData; scenery: TerrainSceneryData }> | null = null;

  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    if (bounds.width !== viewportWidth || bounds.height !== viewportHeight) {
      renderer.setSize(bounds.width, bounds.height, false);
      viewportWidth = bounds.width;
      viewportHeight = bounds.height;
    }
    updateRouteCamera(camera, bounds.width, bounds.height);
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement ?? canvas);

  const draw = (): void => {
    animationFrame = null;
    if (!active || disposed) return;
    resize();
    if (landscapeGroup !== null) updateStylizedVegetationWind(landscapeGroup, performance.now() / 1000);
    renderer.render(scene, camera.renderCamera);
    animationFrame = window.requestAnimationFrame(draw);
  };

  const start = (): void => {
    if (animationFrame === null && active && !disposed) {
      resize();
      animationFrame = window.requestAnimationFrame(draw);
    }
  };
  start();

  void loadStylizedVegetationAssets().then((assets) => {
    if (disposed) {
      assets.dispose();
      return;
    }
    stylizedAssets = assets;
    if (currentLandscape !== null) setLandscape(currentLandscape.terrain, currentLandscape.scenery);
  }).catch((error: unknown) => {
    console.warn("Unable to load stylized vegetation; using procedural scenery instead.", error);
  });

  const setRoute = (geometry: TrackMeshData, curtain: GradientCurtainMeshData, roadMarkings: TrackMeshPart): void => {
    if (routeGroup !== null) scene.remove(routeGroup);
    disposeGroup(routeGroup);
    routeGroup = new THREE.Group();
    routeGroup.name = "gpx-route";
    routeGroup.add(createMesh(geometry, "gpx-road", "#292d30", { emissive: "#090a0b", roughness: 0.98 }));
    routeGroup.add(createMesh(geometry.leftSide, "gpx-road-left", "#15ad37", { emissive: "#04250b" }));
    routeGroup.add(createMesh(geometry.rightSide, "gpx-road-right", "#c81410", { emissive: "#300302" }));
    routeGroup.add(createMesh(geometry.topSurface, "gpx-road-surface", "#292d30", { emissive: "#090a0b", roughness: 0.98 }));
    if (roadMarkings.indices.length > 0) {
      routeGroup.add(createMesh(roadMarkings, "gpx-road-markings", "#ffffff", { emissive: "#f4f1dc", roughness: 0.7 }));
    }
    scene.add(routeGroup);

    if (curtainMesh !== null) {
      scene.remove(curtainMesh);
      curtainMesh.geometry.dispose();
      disposeMaterial(curtainMesh.material);
    }
    curtainMesh = curtain.indices.length === 0
      ? null
      : createMesh(curtain, "route-gradient-curtain", "#ffffff", {
          vertexColors: true,
          opacity: 0.82,
          transparent: true,
          depthWrite: false,
          roughness: 1,
        });
    if (curtainMesh !== null) {
      curtainMesh.renderOrder = 2;
      scene.add(curtainMesh);
    }
  };

  const setLandscape = (terrain: TerrainMeshData, scenery: TerrainSceneryData): void => {
    currentLandscape = Object.freeze({ terrain, scenery });
    if (landscapeGroup !== null) scene.remove(landscapeGroup);
    disposeGroup(landscapeGroup);
    landscapeGroup = new THREE.Group();
    landscapeGroup.name = "route-landscape";
    landscapeGroup.add(createMesh(terrain, "route-terrain-ground", "#71845a", {
      vertexColors: terrain.colors !== undefined,
      emissive: "#10170b",
      roughness: 1,
    }));
    if (stylizedAssets !== null) {
      const grass = createStylizedGrassMesh(stylizedAssets, scenery.grassPlacements);
      if (grass !== null) landscapeGroup.add(grass);
      landscapeGroup.add(createStylizedTreeGroup(stylizedAssets, scenery.treePlacements));
    } else {
      if (scenery.foliage.positions.length > 0) {
        landscapeGroup.add(createMesh(scenery.foliage, "route-terrain-foliage", "#348046", { emissive: "#07180b", roughness: 1 }));
      }
      if (scenery.trunks.positions.length > 0) {
        landscapeGroup.add(createMesh(scenery.trunks, "route-terrain-trunks", "#80543a", { emissive: "#170d08", roughness: 1 }));
      }
    }
    if (scenery.buildingWalls.positions.length > 0) {
      landscapeGroup.add(createMesh(scenery.buildingWalls, "route-terrain-buildings", "#ad9878", { emissive: "#21190f", roughness: 0.88 }));
    }
    if (scenery.buildingRoofs.positions.length > 0) {
      landscapeGroup.add(createMesh(scenery.buildingRoofs, "route-terrain-roofs", "#8e4436", { emissive: "#200907", roughness: 0.88 }));
    }
    scene.add(landscapeGroup);
    landscapeGroup.visible = terrainVisible;
  };

  const getPointerRay = (clientX: number, clientY: number): TrackRay | null =>
    createRoutePointerRay(camera, canvas, clientX, clientY);

  const pickRoad = (ray: TrackRay): Readonly<{ x: number; y: number; z: number }> | null => {
    if (routeGroup === null) return null;
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z),
      new THREE.Vector3(ray.direction.x, ray.direction.y, ray.direction.z).normalize(),
    );
    const intersections = raycaster.intersectObjects(routeGroup.children, false);
    const point = intersections[0]?.point;
    return point === undefined ? null : Object.freeze({ x: point.x, y: point.y, z: point.z });
  };

  return Object.freeze({
    camera,
    setRoute,
    setLandscape,
    setTerrainVisible: (visible: boolean): void => {
      terrainVisible = visible;
      if (landscapeGroup !== null) landscapeGroup.visible = visible;
      if (curtainMesh !== null) curtainMesh.visible = !visible;
    },
    setActive: (isActive: boolean): void => {
      active = isActive;
      if (active) start();
      else if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    },
    getPointerRay,
    pickRoad,
    addOverlay: (object: THREE.Object3D): void => {
      scene.add(object);
    },
    removeOverlay: (object: THREE.Object3D): void => {
      scene.remove(object);
    },
    dispose: (): void => {
      disposed = true;
      active = false;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      if (routeGroup !== null) scene.remove(routeGroup);
      if (landscapeGroup !== null) scene.remove(landscapeGroup);
      if (curtainMesh !== null) scene.remove(curtainMesh);
      disposeGroup(routeGroup);
      disposeGroup(landscapeGroup);
      if (curtainMesh !== null) {
        curtainMesh.geometry.dispose();
        disposeMaterial(curtainMesh.material);
      }
      stylizedAssets?.dispose();
      renderer.dispose();
    },
  });
};
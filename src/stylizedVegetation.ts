import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { StylizedGrassPlacement, StylizedTreePlacement } from "./vegetationPlacement";

const grassAssetPath = "/stylized-scene/grass-blades-up.glb";
const leafAssetPath = "/stylized-scene/tree-leaves-mesh.glb";
const trunkAssetPath = "/stylized-scene/tree-tronk-transformed.glb";
const leafMaskPath = "/stylized-scene/leaves-alpha-map.png";
const dracoDecoderPath = "/stylized-scene/draco/";
const trunkModelScale = 12;
const leafBushes = [
  { x: -0.47, y: 7.59, z: 0.48, yaw: 0, scale: 0.85 },
  { x: -3.87, y: 6.79, z: -4.47, yaw: 1.3, scale: 0.76 },
  { x: -2.08, y: 10.5, z: 0.18, yaw: 2.5, scale: 0.9 },
] as const;
const grassColors = ["#6e9a43", "#8aac4b", "#b1bd57", "#4d7f3b", "#87a84a"];

export type StylizedVegetationAssets = Readonly<{
  grassGeometry: THREE.BufferGeometry;
  grassMaterial: THREE.MeshStandardMaterial;
  grassBaseY: number;
  trunkGeometry: THREE.BufferGeometry;
  trunkMaterial: THREE.Material;
  leafGeometry: THREE.BufferGeometry;
  leafMaterial: THREE.MeshStandardMaterial;
  treeBaseY: number;
  treeHeight: number;
  dispose: () => void;
}>;

export type StylizedGltfLoader = Readonly<{
  gltfLoader: GLTFLoader;
  dracoLoader: DRACOLoader;
}>;

export const createStylizedGltfLoader = (): StylizedGltfLoader => {
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(dracoDecoderPath);
  gltfLoader.setDRACOLoader(dracoLoader);
  return Object.freeze({ gltfLoader, dracoLoader });
};

const firstMesh = (root: THREE.Object3D): THREE.Mesh => {
  let mesh: THREE.Mesh | null = null;
  root.traverse((object) => {
    if (mesh === null && (object as THREE.Mesh).isMesh) mesh = object as THREE.Mesh;
  });
  if (mesh === null) throw new Error("Stylized vegetation asset contains no mesh.");
  return mesh;
};

const getSingleMaterial = (material: THREE.Material | THREE.Material[]): THREE.Material =>
  Array.isArray(material) ? material[0] : material;

const getMeshBounds = (geometry: THREE.BufferGeometry): THREE.Box3 => {
  geometry.computeBoundingBox();
  return geometry.boundingBox?.clone() ?? new THREE.Box3();
};

const addWind = (
  material: THREE.MeshStandardMaterial,
  baseY: number,
  height: number,
  amplitude: number,
  key: string,
): void => {
  const windTime = { value: 0 };
  material.userData.stylizedWindTime = windTime;
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.stylizedWindTime = windTime;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\nuniform float stylizedWindTime;",
    ).replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
       float stylizedHeight = clamp((position.y - ${baseY.toFixed(5)}) / ${height.toFixed(5)}, 0.0, 1.0);
       float stylizedPhase = stylizedWindTime * 1.2 + instanceMatrix[3].x * 0.17 + instanceMatrix[3].z * 0.13;
       transformed.x += sin(stylizedPhase + stylizedHeight * 0.8) * ${amplitude.toFixed(5)} * stylizedHeight;
       transformed.z += cos(stylizedPhase * 0.71 + stylizedHeight) * ${ (amplitude * 0.34).toFixed(5)} * stylizedHeight;
       #endif`,
    );
  };
  material.customProgramCacheKey = () => `stylized-vegetation-wind-${key}`;
};

const disposeScene = (root: THREE.Object3D, textures: Set<THREE.Texture>): void => {
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
      material.dispose();
    });
  });
};

export const loadStylizedVegetationAssets = async (): Promise<StylizedVegetationAssets> => {
  const { gltfLoader, dracoLoader } = createStylizedGltfLoader();
  const textureLoader = new THREE.TextureLoader();
  const [grassGltf, leavesGltf, trunkGltf, leafMask] = await Promise.all([
    gltfLoader.loadAsync(grassAssetPath),
    gltfLoader.loadAsync(leafAssetPath),
    gltfLoader.loadAsync(trunkAssetPath),
    textureLoader.loadAsync(leafMaskPath),
  ]);

  const grassGeometry = firstMesh(grassGltf.scene).geometry.clone();
  const grassBounds = getMeshBounds(grassGeometry);
  const leafGeometry = firstMesh(leavesGltf.scene).geometry.clone();
  const leafBounds = getMeshBounds(leafGeometry);
  const trunkScene = trunkGltf.scene.clone(true);
  trunkScene.scale.setScalar(trunkModelScale);
  trunkScene.updateMatrixWorld(true);
  const sourceTrunkMesh = firstMesh(trunkScene);
  const trunkGeometry = sourceTrunkMesh.geometry.clone().applyMatrix4(sourceTrunkMesh.matrixWorld);
  const trunkBounds = getMeshBounds(trunkGeometry);
  const trunkMaterial = getSingleMaterial(sourceTrunkMesh.material).clone();
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: "#4a6b27",
    alphaMap: leafMask,
    alphaTest: 0.1,
    roughness: 0.82,
    side: THREE.DoubleSide,
  });
  leafMask.colorSpace = THREE.NoColorSpace;
  leafMask.flipY = false;
  leafMask.needsUpdate = true;
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.86,
    side: THREE.DoubleSide,
  });
  const canopyBaseY = Math.min(...leafBushes.map((bush) => bush.y + bush.scale * leafBounds.min.y));
  const canopyTopY = Math.max(...leafBushes.map((bush) => bush.y + bush.scale * leafBounds.max.y));
  const treeBaseY = Math.min(trunkBounds.min.y, canopyBaseY);
  const treeTopY = Math.max(trunkBounds.max.y, canopyTopY);
  const treeHeight = Math.max(0.001, treeTopY - treeBaseY);
  addWind(grassMaterial, grassBounds.min.y, grassBounds.max.y - grassBounds.min.y, 0.16, "grass");
  addWind(leafMaterial, leafBounds.min.y, leafBounds.max.y - leafBounds.min.y, 0.28, "leaves");

  return Object.freeze({
    grassGeometry,
    grassMaterial,
    grassBaseY: grassBounds.min.y,
    trunkGeometry,
    trunkMaterial,
    leafGeometry,
    leafMaterial,
    treeBaseY,
    treeHeight,
    dispose: (): void => {
      const textures = new Set<THREE.Texture>([leafMask]);
      disposeScene(grassGltf.scene, textures);
      disposeScene(leavesGltf.scene, textures);
      disposeScene(trunkGltf.scene, textures);
      disposeScene(trunkScene, textures);
      grassGeometry.dispose();
      leafGeometry.dispose();
      trunkGeometry.dispose();
      grassMaterial.dispose();
      leafMaterial.dispose();
      trunkMaterial.dispose();
      textures.forEach((texture) => texture.dispose());
      dracoLoader.dispose();
    },
  });
};

export const createStylizedGrassMesh = (
  assets: StylizedVegetationAssets,
  placements: readonly StylizedGrassPlacement[],
): THREE.InstancedMesh | null => {
  if (placements.length === 0) return null;
  const mesh = new THREE.InstancedMesh(assets.grassGeometry.clone(), assets.grassMaterial.clone(), placements.length);
  mesh.name = "stylized-grass";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  const transform = new THREE.Object3D();
  const tint = new THREE.Color();
  placements.forEach((placement, index) => {
    transform.position.set(placement.x, placement.y - assets.grassBaseY * placement.scale, placement.z);
    transform.rotation.set(0, placement.rotation, 0);
    transform.scale.setScalar(placement.scale);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    tint.set(grassColors[placement.colorIndex % grassColors.length]);
    mesh.setColorAt(index, tint);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  return mesh;
};

export const createStylizedTreeGroup = (
  assets: StylizedVegetationAssets,
  placements: readonly StylizedTreePlacement[],
): THREE.Group => {
  const group = new THREE.Group();
  group.name = "stylized-trees";
  if (placements.length === 0) return group;

  const scaleFor = (tree: StylizedTreePlacement): number => tree.height / assets.treeHeight;
  const rootTransform = new THREE.Object3D();
  const trunks = new THREE.InstancedMesh(assets.trunkGeometry.clone(), assets.trunkMaterial.clone(), placements.length);
  trunks.name = "stylized-tree-trunks";
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  placements.forEach((tree, index) => {
    const scale = scaleFor(tree);
    rootTransform.position.set(tree.x, tree.y - assets.treeBaseY * scale, tree.z);
    rootTransform.rotation.set(0, tree.rotation, 0);
    rootTransform.scale.setScalar(scale);
    rootTransform.updateMatrix();
    trunks.setMatrixAt(index, rootTransform.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  group.add(trunks);

  const leaves = new THREE.InstancedMesh(
    assets.leafGeometry.clone(),
    assets.leafMaterial.clone(),
    placements.length * leafBushes.length,
  );
  leaves.name = "stylized-tree-canopies";
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  const bushTransform = new THREE.Object3D();
  const composed = new THREE.Matrix4();
  let leafIndex = 0;
  placements.forEach((tree) => {
    const scale = scaleFor(tree);
    rootTransform.position.set(tree.x, tree.y - assets.treeBaseY * scale, tree.z);
    rootTransform.rotation.set(0, tree.rotation, 0);
    rootTransform.scale.setScalar(scale);
    rootTransform.updateMatrix();
    leafBushes.forEach((bush) => {
      bushTransform.position.set(bush.x, bush.y, bush.z);
      bushTransform.rotation.set(0, bush.yaw, 0);
      bushTransform.scale.setScalar(bush.scale);
      bushTransform.updateMatrix();
      composed.copy(rootTransform.matrix).multiply(bushTransform.matrix);
      leaves.setMatrixAt(leafIndex, composed);
      leafIndex += 1;
    });
  });
  leaves.instanceMatrix.needsUpdate = true;
  group.add(leaves);
  return group;
};

export const updateStylizedVegetationWind = (root: THREE.Object3D, timeSeconds: number): void => {
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh && !(object as THREE.InstancedMesh).isInstancedMesh) return;
    const mesh = object as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      const windTime = material.userData.stylizedWindTime as { value: number } | undefined;
      if (windTime !== undefined) windTime.value = timeSeconds;
    });
  });
};
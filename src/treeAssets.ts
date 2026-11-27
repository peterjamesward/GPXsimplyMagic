import * as THREE from "three";
import { Tree } from "@dgreenheck/ez-tree";
import type { RideTreeKind, RideTreeLod } from "./rideFoliage";

export type TreePlacement = Readonly<{
  x: number;
  y: number;
  z: number;
  height: number;
  kind: RideTreeKind;
  rotation: number;
}>;

export type RideTreePrototype = Readonly<{
  branchGeometry: THREE.BufferGeometry;
  branchMaterial: THREE.Material | THREE.Material[];
  leafGeometry: THREE.BufferGeometry;
  leafMaterial: THREE.Material | THREE.Material[];
  height: number;
  bottom: number;
}>;

export type RideTreePrototypes = Readonly<Record<RideTreeKind, RideTreePrototype>>;

const createRideTreePrototype = (preset: string): RideTreePrototype => {
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(tree);
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error(`EZ Tree preset "${preset}" has invalid geometry bounds.`);
  }
  return Object.freeze({
    branchGeometry: tree.branchesMesh.geometry,
    branchMaterial: tree.branchesMesh.material,
    leafGeometry: tree.leavesMesh.geometry,
    leafMaterial: tree.leavesMesh.material,
    height,
    bottom: bounds.min.y,
  });
};

export const createRideTreePrototypes = (lod: RideTreeLod): RideTreePrototypes => {
  const presetSize = lod[0].toUpperCase() + lod.slice(1);
  return Object.freeze({
    pine: createRideTreePrototype(`Pine ${presetSize}`),
    oak: createRideTreePrototype(`Oak ${presetSize}`),
    aspen: createRideTreePrototype(`Aspen ${presetSize}`),
  });
};

export const createRideTreeInstances = (
  placements: readonly TreePlacement[],
  prototypes: RideTreePrototypes,
): readonly THREE.InstancedMesh[] => {
  const temporary = new THREE.Object3D();
  const instances: THREE.InstancedMesh[] = [];
  (Object.keys(prototypes) as RideTreeKind[]).forEach((kind) => {
    const trees = placements.filter((tree) => tree.kind === kind);
    if (trees.length === 0) return;
    const prototype = prototypes[kind];
    const instancedParts = [
      new THREE.InstancedMesh(prototype.branchGeometry, prototype.branchMaterial, trees.length),
      new THREE.InstancedMesh(prototype.leafGeometry, prototype.leafMaterial, trees.length),
    ];
    instancedParts.forEach((part, partIndex) => {
      trees.forEach((tree, index) => {
        const treeScale = tree.height / prototype.height;
        temporary.position.set(tree.x, tree.y - prototype.bottom * treeScale, tree.z);
        temporary.rotation.set(0, tree.rotation, 0);
        temporary.scale.setScalar(treeScale);
        temporary.updateMatrix();
        part.setMatrixAt(index, temporary.matrix);
      });
      part.name = `${kind}-${partIndex === 0 ? "branches" : "leaves"}`;
      part.instanceMatrix.needsUpdate = true;
      part.computeBoundingSphere();
      part.castShadow = true;
      part.receiveShadow = true;
      instances.push(part);
    });
  });
  return Object.freeze(instances);
};

export const getRideTreePrototypeResources = (
  prototypes: RideTreePrototypes,
): Readonly<{ geometries: readonly THREE.BufferGeometry[]; materials: readonly THREE.Material[] }> => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  (Object.keys(prototypes) as RideTreeKind[]).forEach((kind) => {
    const prototype = prototypes[kind];
    geometries.add(prototype.branchGeometry);
    geometries.add(prototype.leafGeometry);
    [prototype.branchMaterial, prototype.leafMaterial].forEach((material) => {
      if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
      else materials.add(material);
    });
  });
  return Object.freeze({
    geometries: Object.freeze([...geometries]),
    materials: Object.freeze([...materials]),
  });
};
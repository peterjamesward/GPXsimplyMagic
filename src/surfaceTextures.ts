import * as THREE from "three";
import type { LandUseCategory } from "./openStreetMap";

export const surfaceTexturePaths = Object.freeze({
  grassColor: "/surface-textures/leafy_grass_diff_2k.webp",
  grassNormal: "/surface-textures/leafy_grass_nor_gl_1k.jpg",
  rockColor: "/surface-textures/rock_face_03_diff_1k.webp",
  gravelColor: "/surface-textures/gravel_ground_01_diff_1k.webp",
});

export const roadSurfaceColor = "#414445";

export type SurfaceTextureName = keyof typeof surfaceTexturePaths;
export type GroundTextureProfile = Readonly<{
  detailTexture: "grassColor" | "gravelColor" | "rockColor" | null;
  useGrassNormal: boolean;
  blendRockOnSlope: boolean;
}>;

const normalTextureNames: ReadonlySet<SurfaceTextureName> = new Set(["grassNormal"]);

export const getGroundTextureProfile = (category: LandUseCategory | null): GroundTextureProfile => {
  if (category === "water") {
    return Object.freeze({ detailTexture: null, useGrassNormal: false, blendRockOnSlope: false });
  }
  if (category === "residential" || category === "industrial") {
    return Object.freeze({ detailTexture: "gravelColor", useGrassNormal: false, blendRockOnSlope: false });
  }
  if (category === "bare") {
    return Object.freeze({ detailTexture: "rockColor", useGrassNormal: false, blendRockOnSlope: false });
  }
  return Object.freeze({ detailTexture: "grassColor", useGrassNormal: true, blendRockOnSlope: true });
};

export const loadSurfaceTexture = (name: SurfaceTextureName, maxAnisotropy: number): THREE.Texture => {
  const texture = new THREE.TextureLoader().load(surfaceTexturePaths[name]);
  texture.colorSpace = normalTextureNames.has(name) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.max(1, Math.min(8, Math.floor(maxAnisotropy)));
  return texture;
};
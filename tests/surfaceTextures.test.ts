import { describe, expect, it } from "vitest";
import { getGroundTextureProfile, surfaceTexturePaths } from "../src/surfaceTextures";

describe("surface texture profiles", () => {
  it("uses grass and slope-sensitive rock detail for natural land cover", () => {
    for (const category of [null, "grassland", "woodland", "farmland"] as const) {
      expect(getGroundTextureProfile(category)).toEqual({
        detailTexture: "grassColor",
        useGrassNormal: true,
        blendRockOnSlope: true,
      });
    }
  });

  it("keeps mapped water styling and assigns gravel and rock to developed and bare land", () => {
    expect(getGroundTextureProfile("water")).toEqual({
      detailTexture: null,
      useGrassNormal: false,
      blendRockOnSlope: false,
    });
    expect(getGroundTextureProfile("residential").detailTexture).toBe("gravelColor");
    expect(getGroundTextureProfile("industrial").detailTexture).toBe("gravelColor");
    expect(getGroundTextureProfile("bare").detailTexture).toBe("rockColor");
  });

  it("points to local surface maps for the road and ground materials", () => {
    expect(Object.values(surfaceTexturePaths)).toHaveLength(6);
    expect(Object.values(surfaceTexturePaths).every((path) => path.startsWith("/surface-textures/"))).toBe(true);
    expect(surfaceTexturePaths.asphaltNormal.endsWith(".jpg")).toBe(true);
    expect(surfaceTexturePaths.grassNormal.endsWith(".jpg")).toBe(true);
    expect(surfaceTexturePaths.asphaltColor.endsWith(".webp")).toBe(true);
    expect(surfaceTexturePaths.grassColor.endsWith(".webp")).toBe(true);
  });
});
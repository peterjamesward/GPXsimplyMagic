import { describe, expect, it } from "vitest";
import { terrainSourceOptions } from "../src/terrainSource";

describe("terrain source options", () => {
  it("uses public Terrarium elevation tiles with matching source metadata", () => {
    expect(terrainSourceOptions).toMatchObject({
      type: "raster-dem",
      tiles: ["https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 15,
      encoding: "terrarium",
    });
  });
});
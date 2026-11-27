import { describe, expect, it } from "vitest";
import { createStylizedGltfLoader } from "../src/stylizedVegetation";

describe("stylized vegetation GLTF loader", () => {
  it("configures the local Draco decoder for compressed models", () => {
    const { gltfLoader, dracoLoader } = createStylizedGltfLoader();
    const configuredLoader = gltfLoader as unknown as { dracoLoader: typeof dracoLoader };
    const decoderPaths = (dracoLoader as unknown as {
      decoderPaths: Readonly<{ js: string; wasm: string; dep_js: string | null }>;
    }).decoderPaths;

    try {
      expect(configuredLoader.dracoLoader).toBe(dracoLoader);
      expect(decoderPaths.js).toBe("/stylized-scene/draco/draco_wasm_wrapper.js");
      expect(decoderPaths.wasm).toBe("/stylized-scene/draco/draco_decoder.wasm");
    } finally {
      dracoLoader.dispose();
    }
  });
});
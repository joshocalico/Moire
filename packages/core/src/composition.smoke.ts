import assert from "node:assert/strict";
import {
  orderedCompositionLayers,
  validateCompositionScene,
  type CompositionScene,
} from "./composition.js";
import {
  resolveEglPresentPreference,
  resolveOutputRenderPreference,
} from "./output-renderer.js";

const pixel = new Uint8Array([0, 0, 0, 255]);
const source = { pixels: pixel, width: 1, height: 1, stride: 4 };
const scene: CompositionScene = {
  width: 100,
  height: 80,
  clearColor: 0xff101820,
  layers: [
    {
      id: "glass",
      z: 10,
      source,
      destination: { x: 10, y: 10, width: 60, height: 40 },
      cornerRadius: [12, 12, 6, 6],
      transform: {
        matrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          4, 2, 0, 1,
        ],
      },
      effects: [
        { kind: "backdrop-blur", radius: 18, saturation: 1.15 },
        {
          kind: "drop-shadow",
          offsetX: 0,
          offsetY: 8,
          blurRadius: 24,
          color: 0x66000000,
        },
        {
          kind: "extension",
          namespace: "org.moire.compiz",
          name: "wobbly-window",
          parameters: { tension: 0.72, velocity: [0.4, -0.1] },
          inputs: ["source"],
          padding: 24,
        },
      ],
    },
    {
      id: "wallpaper",
      z: 0,
      source,
      destination: { x: 0, y: 0, width: 100, height: 80 },
    },
  ],
};

validateCompositionScene(scene);
assert.deepEqual(
  orderedCompositionLayers(scene).map((layer) => layer.id),
  ["wallpaper", "glass"],
  "composition z ordering changed",
);
assert.equal(resolveOutputRenderPreference(undefined), "auto");
assert.equal(resolveOutputRenderPreference("EGL"), "egl");
assert.throws(() => resolveOutputRenderPreference("canvas"), /Invalid MOIRE_RENDERER/);
assert.equal(resolveEglPresentPreference(undefined), "readback");
assert.equal(resolveEglPresentPreference("DIRECT"), "direct");
assert.throws(
  () => resolveEglPresentPreference("pageflip"),
  /Invalid MOIRE_EGL_PRESENT/,
);
assert.throws(
  () => validateCompositionScene({ ...scene, layers: [...scene.layers, scene.layers[0]!] }),
  /duplicated/,
);
console.log("[core/composition-smoke] ok");

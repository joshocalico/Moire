import assert from "node:assert/strict";
import { classifyEglExecution, hasOpaqueEglScene } from "./egl-capability";
import type { EglCompositionLayer, EglCompositionScene, EglOutputInfo } from "./egl-output";
const info = (glRenderer: string): EglOutputInfo => ({
  eglVendor: "Mesa",
  eglVersion: "1.5",
  eglExtensions: "EGL_EXT_image_dma_buf_import",
  glVendor: "fixture",
  glRenderer,
  glVersion: "OpenGL ES 3.2",
});
for (const name of ["llvmpipe (LLVM 19)", "ANGLE (SwiftShader Device)", "softpipe"])
  assert.equal(classifyEglExecution(info(name)), "software");
for (const name of ["virgl (Apple M1 Max)", "ANGLE (virtio-gpu)", "SVGA3D"])
  assert.equal(classifyEglExecution(info(name)), "virtual");
for (const name of ["Apple M1 Max", "ANGLE (Apple M1 Max)", "AMD Radeon", "Intel Iris", ""])
  assert.equal(
    classifyEglExecution(info(name)),
    "unknown",
    "no vendor, ANGLE or initialization heuristic may assert hardware",
  );
const solid: EglCompositionLayer = {
  id: "background",
  pixels: new Uint8Array([9, 20, 35, 255]),
  sourceWidth: 1,
  sourceHeight: 1,
  sourceStride: 4,
  destination: { x: 0, y: 0, width: 120, height: 80 },
};
const scene: EglCompositionScene = { width: 120, height: 80, clearColor: 0, layers: [solid] };
const masked: EglCompositionLayer = {
  ...solid,
  contentShape: { bounds: solid.destination, radii: [12, 12, 12, 12], outside: "discard" },
};
assert.equal(
  hasOpaqueEglScene({ ...scene, layers: [masked] }),
  false,
  "masked background corners cannot certify an XRGB target",
);
assert.equal(
  hasOpaqueEglScene({ ...scene, clearColor: 0xff101018, layers: [masked] }),
  true,
  "actual opaque clear remains a valid certificate under source-over masking",
);
assert.equal(hasOpaqueEglScene(scene), true);
assert.equal(hasOpaqueEglScene({ ...scene, layers: [], clearColor: 0xff000000 }), true);
assert.equal(hasOpaqueEglScene({ ...scene, layers: [] }), false);
for (const partial of [
  { opacity: 0.999 },
  { destination: { ...solid.destination, width: Number.POSITIVE_INFINITY } },
  { clip: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 80 } },
  { pixels: new Uint8Array([9, 20, 35, 254]) },
  { destination: { ...solid.destination, x: 1 } },
  { destination: { ...solid.destination, width: 119 } },
  { clip: { x: 0, y: 1, width: 120, height: 79 } },
  { cornerRadius: 1 },
  { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1] },
  { sourceRect: { x: 0, y: 0, width: 1, height: 1 } },
  { colorMatrix: Array.from({ length: 20 }, () => 0) },
  { opacity: Number.NaN },
  { backdropBlur: { radius: 8 } },
  { sourceStride: 8 },
] satisfies Partial<EglCompositionLayer>[]) {
  assert.equal(hasOpaqueEglScene({ ...scene, layers: [{ ...solid, ...partial }] }), false);
}
// A translucent source-over draw cannot punch a hole in an established opaque destination.
assert.equal(
  hasOpaqueEglScene({
    ...scene,
    layers: [
      solid,
      { ...solid, id: "overlay", opacity: 0.2, pixels: new Uint8Array([1, 2, 3, 19]) },
    ],
  }),
  true,
);
assert.equal(
  hasOpaqueEglScene({
    ...scene,
    clearColor: 0xff000000,
    layers: [{ ...solid, colorMatrix: Array.from({ length: 20 }, () => 0) }],
  }),
  false,
);
assert.equal(
  hasOpaqueEglScene({ ...scene, layers: Array.from({ length: 4097 }, () => solid) }),
  false,
);
console.log(
  "EGL actual-context negative classification and bounded draw-derived opaque certificate PASS; no positive hardware rule",
);

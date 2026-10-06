/** Exercise the real renderer adapter and ownership token without native GPU calls. */
import assert from "node:assert/strict";
import {
  EglResidentImage,
  type EglCompositionScene,
  type EglDmabufSnapshotInput,
} from "@moire/sys";
import {
  EglCompositorOutputRenderer,
  createCompositorOutputRenderer,
  type OutputRenderTarget,
} from "./output-renderer";
import type { CompositionScene, OwnedPixelSurface } from "./composition";
import type { DmabufBuffer } from "./dmabuf-map";

type Scaler = ConstructorParameters<typeof EglCompositorOutputRenderer>[0];

class FixtureScaler implements Scaler {
  readonly execution = "unknown";
  readonly info = {
    eglVendor: "fixture",
    eglVersion: "fixture",
    eglExtensions: "",
    glVendor: "fixture",
    glRenderer: "fixture",
    glVersion: "fixture",
  };
  readonly producer = new Map<number, Uint8Array>();
  readonly images: EglResidentImage[] = [];
  readonly imports: EglDmabufSnapshotInput[] = [];
  readonly compositions: EglCompositionScene[] = [];
  readonly releases = new Map<EglResidentImage, number>();
  readbacks = 0;
  stops = 0;
  failImport = false;
  private stopped = false;
  private flat: Uint8Array | null = null;

  snapshotDmabuf(input: EglDmabufSnapshotInput): EglResidentImage {
    assert.equal(this.stopped, false);
    if (this.failImport) throw new Error("fixture import failure");
    const producer = this.producer.get(input.plane.fd);
    assert.ok(producer, "fixture producer must exist at the synchronous snapshot boundary");
    this.imports.push(input);
    const copied = producer.slice();
    const image = new EglResidentImage(
      this,
      input.width,
      input.height,
      () => {
        this.readbacks++;
        return copied.slice();
      },
      () => {
        this.releases.set(image, (this.releases.get(image) ?? 0) + 1);
      },
    );
    this.images.push(image);
    return image;
  }

  beginComposition(scene: EglCompositionScene): ReturnType<Scaler["beginComposition"]> {
    assert.equal(this.stopped, false);
    for (const layer of scene.layers) {
      if (layer.pixels instanceof EglResidentImage) {
        assert.equal(layer.pixels.owner, this);
        assert.equal(layer.pixels.isDestroyed, false);
      }
    }
    this.compositions.push(scene);
    return null;
  }

  beginFrame(pixels: Uint8Array): void {
    assert.equal(this.stopped, false);
    this.flat = pixels;
  }

  renderOutput(output: Parameters<Scaler["renderOutput"]>[0]): void {
    assert.ok(this.flat);
    output.target.set(this.flat);
  }

  renderOutputDirect(): ReturnType<Scaler["renderOutputDirect"]> {
    throw new Error("fixture has no DRM scanout");
  }

  destroy(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stops++;
    for (const image of this.images) image.destroy();
  }
}

const scaler = new FixtureScaler();
const renderer = new EglCompositorOutputRenderer(scaler, "readback");
const original = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
const producer = original.slice();
scaler.producer.set(41, producer);
const buffer: DmabufBuffer = {
  kind: "dmabuf",
  width: 2,
  height: 2,
  format: 0x34325258,
  flags: 0,
  planes: [{ fd: 41, offset: 8, stride: 16, modifierHi: 0x80000000, modifierLo: 0xabcdef01 }],
};

assert.equal(renderer.snapshotDmabuf({ ...buffer, flags: 1 }), null);
assert.equal(renderer.snapshotDmabuf({ ...buffer, planes: [] }), null);
assert.equal(
  renderer.snapshotDmabuf({ ...buffer, planes: [...buffer.planes, buffer.planes[0]!] }),
  null,
);
assert.equal(scaler.imports.length, 0, "unsupported layouts must not reach native import");

const source = renderer.snapshotDmabuf(buffer);
assert.ok(source);
assert.equal(source.storage, "gpu");
assert.equal(source.stride, 8, "owned snapshots expose tight stride, not producer stride");
assert.equal(scaler.imports[0]!.plane.modifier, 0x80000000abcdef01n);
assert.equal(scaler.imports[0]!.plane.offset, 8);
assert.equal(scaler.imports[0]!.plane.stride, 16);

function scene(content: OwnedPixelSurface): CompositionScene {
  return {
    width: 2,
    height: 2,
    clearColor: 0xff000000,
    layers: [
      { id: "client", z: 1, source: content, destination: { x: 0, y: 0, width: 2, height: 2 } },
    ],
  };
}

source.revision = 1;
renderer.beginComposition(scene(source));
renderer.beginComposition(scene(source));
assert.equal(
  scaler.readbacks,
  0,
  "native retained composition must not access the lazy pixels getter",
);
assert.equal(scaler.compositions[0]!.layers[0]!.pixels, scaler.images[0]);
assert.equal(scaler.compositions[1]!.layers[0]!.pixels, scaler.images[0]);
assert.equal(scaler.compositions[1]!.layers[0]!.revision, 1);

// The fake synchronous snapshot copies at the producer boundary. Reusing and
// releasing this logical producer must not change the adapter's owned contents.
producer.fill(0);
scaler.producer.delete(41);
assert.equal(scaler.readbacks, 0);

const flat = createCompositorOutputRenderer(-1, "software");
const target: OutputRenderTarget = {
  geometry: { id: "fixture", x: 0, y: 0, width: 2, height: 2 },
  physicalWidth: 2,
  physicalHeight: 2,
  pitch: 8,
  pixels: new Uint8Array(16),
};
flat.beginFrame(source);
flat.renderOutput(target);
flat.renderOutput(target);
assert.deepEqual(target.pixels, original, "actual flat fallback must use the owned snapshot");
assert.equal(scaler.readbacks, 1, "repeated flat output must not repeat GPU readback");
assert.deepEqual(source.pixels, original);
assert.equal(source.pixels, source.pixels, "fallback readback must return its cached array");
assert.equal(scaler.readbacks, 1);
flat.destroy();

scaler.producer.set(42, new Uint8Array(original.length).fill(127));
const replacement = renderer.snapshotDmabuf({
  ...buffer,
  planes: [{ ...buffer.planes[0]!, fd: 42 }],
});
assert.ok(replacement);
replacement.revision = 2;
source.destroy();
source.destroy();
assert.equal(scaler.releases.get(scaler.images[0]!), 1, "replaced contents release exactly once");
assert.equal(
  scaler.images[1]!.isDestroyed,
  false,
  "releasing prior contents must not release replacement",
);
renderer.beginComposition(scene(replacement));
assert.equal(scaler.compositions.at(-1)!.layers[0]!.pixels, scaler.images[1]);
assert.equal(scaler.readbacks, 1, "replacement native composition still must not read back");
assert.throws(() => scaler.images[0]!.readbackPixels(), /destroyed/);

renderer.destroy();
renderer.destroy();
replacement.destroy();
assert.equal(scaler.stops, 1, "native backend stop must be idempotent");
assert.equal(scaler.releases.get(scaler.images[0]!), 1);
assert.equal(
  scaler.releases.get(scaler.images[1]!),
  1,
  "renderer stop releases live contents once",
);
assert.throws(() => scaler.images[1]!.readbackPixels(), /destroyed/);
console.log(
  "[resident-source] native-token mapping, lazy cached fallback, producer reuse, replacement and idempotent cleanup passed (injected scaler; no GPU protocol claim)",
);

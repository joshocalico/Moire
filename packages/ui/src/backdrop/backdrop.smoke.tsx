import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { PNG } from "pngjs";
import {
  collectHits,
  createShellRoot,
  renderShell,
  RetainedSceneRenderer,
  RetainedSoftwareRenderer,
} from "@moire/react-host";
import { Window } from "#ui/window";
import { getMotionActivity, tickMotionFrame } from "#ui/motion";
import { HeadlessPlatform } from "@moire/ui/testing";
import { Pressable } from "#ui/widgets/pressable";
import { Backdrop, type BackdropProps } from "./backdrop";
import { createSilkBackdrop, type SilkVariant } from "./silk";

const output = process.env.MOIRE_BACKDROP_PROOF_DIR;
const directory = output ?? fs.mkdtempSync(path.join(os.tmpdir(), "moire-backdrop-"));
fs.mkdirSync(directory, { recursive: true });
function writePng(name: string, pixels: Uint8Array, width: number, height: number): void {
  const png = new PNG({ width, height });
  for (let index = 0; index < pixels.length; index += 4) {
    png.data[index] = pixels[index + 2]!;
    png.data[index + 1] = pixels[index + 1]!;
    png.data[index + 2] = pixels[index]!;
    png.data[index + 3] = pixels[index + 3]!;
  }
  fs.writeFileSync(path.join(directory, name), PNG.sync.write(png));
}

const costs: unknown[] = [];
try {
  for (const variant of ["fold-e", "greeter"] satisfies SilkVariant[]) {
    const started = performance.now();
    const source = createSilkBackdrop({ variant });
    costs.push({ variant, rasterMs: performance.now() - started, ...source.metrics });
    const backend = new HeadlessPlatform();
    await backend.connect();
    const window = new Window({
      title: "Backdrop proof",
      width: 1280,
      height: 800,
      decorated: false,
    });
    window.setContent((size) => <Backdrop {...size} source={source} />);
    window.mount(backend);
    await Promise.resolve();
    window.tick();
    const native = backend.getWindows()[0]!;
    assert.ok(native.lastFrame);
    writePng(`${variant}-1280x800.png`, native.lastFrame, 1280, 800);
    const idleFrames = native.presentedFrames;
    for (let tick = 0; tick < 100; tick++) window.tick();
    assert.equal(
      native.presentedFrames,
      idleFrames,
      "static backdrop must not request recurring frames",
    );
    assert.equal(getMotionActivity().active, false);
    for (const [width, height] of [
      [640, 800],
      [480, 320],
      [1920, 1200],
    ]) {
      native.setSize(width!, height!);
      window.tick();
      assert.ok(native.lastFrame);
      writePng(`${variant}-${width}x${height}.png`, native.lastFrame, width!, height!);
      for (let index = 3; index < native.lastFrame.length; index += 4)
        assert.equal(native.lastFrame[index], 255);
      if (variant === "greeter") {
        let maximum = 0;
        for (let y = Math.floor(height! * 0.25); y < height! * 0.7; y++) {
          for (let x = 0; x < width! * 0.25; x++) {
            const offset = (y * width! + x) * 4;
            maximum = Math.max(
              maximum,
              native.lastFrame[offset]!,
              native.lastFrame[offset + 1]!,
              native.lastFrame[offset + 2]!,
            );
          }
        }
        assert.ok(maximum <= 24, "greeter controls retain a quiet dark region after every resize");
      }
    }
    assert.equal(
      source.image.rgba.byteLength,
      1280 * 800 * 4,
      "resize never replaces or grows source",
    );
    let invoked = 0;
    window.setContent((size) => (
      <>
        <Pressable
          x={20}
          y={20}
          width={120}
          height={40}
          focusId="under-backdrop"
          onPress={() => invoked++}
        />
        <Backdrop {...size} source={source} />
      </>
    ));
    window.tick();
    native.injectPointer({ type: "down", x: 40, y: 30, button: "left", timeMs: 1 });
    native.injectPointer({ type: "up", x: 40, y: 30, button: "left", timeMs: 2 });
    assert.equal(invoked, 1, "backdrop above real controls never captures pointer input");
    window.destroy();
    backend.disconnect();
  }

  const source = createSilkBackdrop({ variant: "fold-e" });
  const original = source.image.rgba.slice();
  const root = createShellRoot();
  const renderer = new RetainedSceneRenderer();
  const cpu = new RetainedSoftwareRenderer();
  const size = { width: 1280, height: 800 };
  let props: BackdropProps = {
    ...size,
    source,
    motion: { kind: "ambient", active: true, rendering: "hardware-retained" },
  };
  const render = () => {
    renderShell(root, <Backdrop {...props} />);
    assert.equal(collectHits(root.container).length, 0);
    return renderer.render(root.container, size);
  };
  props = { ...props, motion: { kind: "static" } };
  const canonicalPixels = new RetainedSoftwareRenderer().render(render()).pixels.slice();
  props = { ...props, motion: { kind: "ambient", active: true, rendering: "hardware-retained" } };
  let scene = render();
  assert.equal(getMotionActivity().active, true);
  const image = scene.layers.find((layer) => layer.sourceWidth === source.image.width)!;
  assert.ok(image);
  const initial = { ...image.destination };
  for (let tick = 0; tick < 300; tick++) {
    const motion = tickMotionFrame(0.1);
    assert.equal(motion.requiresReconcile, false);
    scene = renderer.renderPresentation(root.container, size)!;
    const current = scene.layers.find((layer) => layer.id === image.id)!;
    assert.equal(current.pixels, image.pixels);
    assert.equal(current.revision, image.revision);
  }
  assert.notDeepEqual(scene.layers.find((layer) => layer.id === image.id)!.destination, initial);
  writePng("fold-e-ambient-30s.png", cpu.render(scene).pixels, size.width, size.height);
  props = { ...props, motion: { kind: "ambient", active: false, rendering: "hardware-retained" } };
  const paused = render();
  assert.equal(getMotionActivity().active, false);
  for (let tick = 0; tick < 1000; tick++)
    assert.equal(tickMotionFrame(0.1).presentationChanged, false);
  assert.deepEqual(
    renderer.renderPresentation(root.container, size)!.layers[1]!.destination,
    paused.layers[1]!.destination,
  );
  props = { ...props, motion: { kind: "ambient", active: true, rendering: "hardware-retained" } };
  assert.deepEqual(
    render().layers[1]!.destination,
    paused.layers[1]!.destination,
    "resume preserves phase without jumping",
  );
  for (const rendering of ["software", "unknown"] satisfies Array<"software" | "unknown">) {
    props = { ...props, motion: { kind: "ambient", active: true, rendering } };
    const fallback = render();
    assert.equal(getMotionActivity().active, false);
    assert.deepEqual(
      new RetainedSoftwareRenderer().render(fallback).pixels,
      canonicalPixels,
      "fallback retains exact canonical artwork",
    );
  }
  props = {
    ...props,
    reducedMotion: true,
    motion: { kind: "ambient", active: true, rendering: "hardware-retained" },
  };
  const reduced = render();
  assert.equal(getMotionActivity().active, false);
  assert.deepEqual(
    new RetainedSoftwareRenderer().render(reduced).pixels,
    canonicalPixels,
    "reduced motion retains exact canonical artwork",
  );
  assert.deepEqual(
    source.image.rgba,
    original,
    "300 presentation updates never mutate published pixels",
  );
  props = { ...props, reducedMotion: false };
  render();
  assert.equal(getMotionActivity().active, true);
  renderShell(root, null);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(getMotionActivity().active, false);
  fs.writeFileSync(path.join(directory, "costs.json"), JSON.stringify(costs, null, 2) + "\n");
  console.log(JSON.stringify({ directory, costs }));
  console.log(
    "backdrop real Window resize/input/idle, immutable retained presentation, pause/resume and fallback smoke passed",
  );
} finally {
  if (!output) fs.rmSync(directory, { recursive: true, force: true });
}

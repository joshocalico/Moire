/** Actual Window/raster gate and independent full-scene oracle; no GPU claim. */
import assert from "node:assert/strict";
import React from "react";
import { RetainedSoftwareRenderer, type RetainedSceneFrame } from "@moire/react-host";
import type { UiFrameEvent, PlatformWindowOpts } from "#ui/platform";
import { HeadlessPlatform, type HeadlessWindow } from "./platforms/headless";
import { Window, Surface, Label } from "./index";
let blocked = false;
let scene: RetainedSceneFrame | undefined;
let frame: ((event: UiFrameEvent) => void) | undefined;
let native: HeadlessWindow | undefined;
class GatedPlatform extends HeadlessPlatform {
  override createWindow(options: PlatformWindowOpts) {
    const handle = super.createWindow(options);
    native = this.getWindows().at(-1);
    const subscribe = handle.onFrame.bind(handle);
    handle.onFrame = (callback) => {
      frame = callback;
      subscribe(callback);
    };
    handle.presentScene = (next) => {
      scene = next;
      return blocked;
    };
    return handle;
  }
}
const platform = new GatedPlatform();
const window = new Window({
  title: "Skipped-raster proof",
  width: 320,
  height: 120,
  decorated: false,
});
let text = "Waiting for authentication";
window.setContent(() => (
  <Surface width={320} height={120}>
    <Label x={10} y={20} text={text} />
  </Surface>
));
try {
  window.mount(platform);
  await Promise.resolve();
  window.tick();
  assert.ok(native?.lastFrame);
  const before = new Uint8Array(native.lastFrame);
  blocked = true;
  text = "Enter the requested secret";
  window.requestRedraw();
  window.tick();
  assert.ok(scene && frame);
  const expected = new RetainedSoftwareRenderer().render({ ...scene, damage: undefined }).pixels;
  assert.notDeepEqual(
    expected,
    before,
    "The independent full-scene oracle must contain the new prompt",
  );
  assert.deepEqual(native.lastFrame, before, "The gate skipped presentation");
  blocked = false;
  frame({
    type: "compositor-frame",
    commitId: 1,
    timestampMs: 1,
    receivedAtMs: 1,
    retrySuggested: true,
  });
  window.tick();
  assert.deepEqual(
    native.lastFrame,
    expected,
    "Retry must rasterize the prompt instead of reusing old CPU pixels",
  );
  console.log(
    JSON.stringify({
      suite: "Window skipped-raster recovery",
      independentFullSceneOracle: true,
      physicalPresentation: false,
      actualExitCode: 0,
    }),
  );
} finally {
  window.destroy();
  platform.disconnect();
}

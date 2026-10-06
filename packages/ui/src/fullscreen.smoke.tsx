import assert from "node:assert/strict";
import React from "react";
import { Window, Label, installUiFonts } from "./index";
import { HeadlessPlatform } from "./platforms/headless";

await installUiFonts();
const backend = new HeadlessPlatform();
await backend.connect();
const window = new Window({
  title: "Session welcome",
  width: 1280,
  height: 800,
  decorated: false,
  fullscreen: true,
});
window.setContent(({ width, height }) => (
  <Label text={`${width}×${height}`} x={0} y={0} width={width} height={height} />
));
window.mount(backend);
await Promise.resolve();
window.tick();
assert.equal(window.isFullscreen(), true, "initial fullscreen reaches the serving backend");
const native = backend.getWindows()[0]!;
native.emitConfigure(1024, 768);
window.tick();
assert.equal(window.getWidth(), 1024, "configured output width replaces preferred width");
assert.equal(window.getHeight(), 768, "configured output height replaces preferred height");
window.setFullscreen(false);
assert.equal(window.isFullscreen(), false);
assert.equal(window.getWidth(), 1024, "toggle retains the latest configured allocation");
assert.equal(window.getHeight(), 768);
window.setFullscreen(true);
assert.equal(window.isFullscreen(), true);
assert.equal(window.isMaximized(), false, "fullscreen does not synthesize maximization");
window.destroy();
window.setFullscreen(false);
assert.equal(native.isFullscreen(), true, "destroyed native windows ignore later requests");
backend.disconnect();
for (const initial of [true, false]) {
  const pendingBackend = new HeadlessPlatform();
  await pendingBackend.connect();
  const pendingWindow = new Window({ title: "Pending fullscreen", fullscreen: initial });
  pendingWindow.setFullscreen(!initial);
  pendingWindow.mount(pendingBackend);
  await Promise.resolve();
  assert.equal(pendingWindow.isFullscreen(), !initial, "latest pre-mount request wins");
  pendingWindow.destroy();
  pendingBackend.disconnect();
}
console.log(
  "[fullscreen] initial request, configured output geometry, restore and teardown passed",
);

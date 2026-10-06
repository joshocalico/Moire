import assert from "node:assert/strict";
import React from "react";
import { collectHits, createShellRoot, renderShell } from "@moire/react-host";
import { Button, Window, WindowFrame, installUiFonts, setUiScaleFactor } from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";

await installUiFonts();
for (const scale of [1, 1.5]) {
  setUiScaleFactor(scale);
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({
    title: "Files",
    width: 640,
    height: 400,
    decorated: false,
  });
  let tabClicks = 0;
  let bodyClicks = 0;
  let closed = 0;
  let allowClose = false;
  window.onClose(() => closed++);
  window.setCloseGuard(() => allowClose);
  const content = (
    <WindowFrame
      width={640}
      height={400}
      title="Files"
      actions={window}
      tabs={(size) => (
        <Button
          width={Math.min(size.width, 120)}
          height={size.height}
          label="Documents"
          focusId="folder-tab"
          onPress={() => tabClicks++}
        />
      )}
    >
      {(size) => (
        <Button
          width={Math.min(size.width, 150)}
          height={Math.min(size.height, 40)}
          label="Open folder"
          focusId="folder-body"
          onPress={() => bodyClicks++}
        />
      )}
    </WindowFrame>
  );
  window.setContent(content);
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0];
  assert.ok(native);
  const root = createShellRoot();
  renderShell(root, content);
  const hits = collectHits(root.container);
  const click = (id: string) => {
    const hit = hits.find((item) => item.focusId === id);
    assert.ok(hit, `${id} must be reachable`);
    assert.ok(hit.x >= 0 && hit.y >= 0 && hit.x + hit.width <= 640 && hit.y + hit.height <= 400);
    const event = {
      x: hit.x + hit.width / 2,
      y: hit.y + hit.height / 2,
      button: "left" as const,
      timeMs: performance.now(),
    };
    native.injectPointer({ ...event, type: "down" });
    native.injectPointer({ ...event, type: "up" });
    window.tick();
  };
  click("folder-tab");
  click("folder-body");
  assert.equal(tabClicks, 1);
  assert.equal(bodyClicks, 1);
  assert.equal(native.moveRequests, 0, "tab and body interactions never start a window drag");
  native.injectPointer({
    type: "down",
    x: 10,
    y: 10,
    button: "left",
    timeMs: 1,
  });
  native.injectPointer({ type: "up", x: 10, y: 10, button: "left", timeMs: 2 });
  assert.equal(native.moveRequests, 1, "identity background starts a native move");
  click("window:maximize");
  assert.equal(window.isMaximized(), true);
  click("window:maximize");
  assert.equal(window.isMaximized(), false, "second action restores confirmed native state");
  click("window:minimize");
  assert.equal(native.minimizeRequests, 1);
  click("window:close");
  assert.equal(window.isClosed(), false, "client close honours unsaved-work guard");
  native.requestClose();
  assert.equal(window.isClosed(), false, "server close uses the same guard");
  allowClose = true;
  click("window:close");
  assert.equal(window.isClosed(), true);
  assert.equal(closed, 1);
  window.requestClose();
  native.requestClose();
  assert.equal(closed, 1, "closed windows never dispatch duplicate quit events");
  window.destroy();
  backend.disconnect();
  renderShell(root, null);
}
setUiScaleFactor(1);
console.log(
  "[window-frame] actual tab/body dispatch, native move/maximize/restore/minimize, guarded client/server close at 1x/1.5x passed",
);

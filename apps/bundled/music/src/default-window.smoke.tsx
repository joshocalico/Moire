/** Default launch fits the first 1280×800 desktop, including its taskbar. */
import assert from "node:assert/strict";
import path from "node:path";
import React, { type ReactNode } from "react";
import { collectHits, createShellRoot, renderShell, type SceneNode } from "@moire/react-host";
import { withFixture } from "@moire/app-tools/testing";
import { setUiScaleFactor } from "@moire/ui";
import { MusicApp, MUSIC_WINDOW_OPTIONS } from "./main";
import { MusicLibraryStore } from "./library";
import { musicHarness } from "./testing";

const nodes = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(nodes)];
await withFixture(async (directory) => {
  setUiScaleFactor(1);
  const { width, height } = MUSIC_WINDOW_OPTIONS;
  assert.ok(width <= 1280 && height <= 800 - 56, "default window overlaps the desktop taskbar");
  assert.equal(MUSIC_WINDOW_OPTIONS.decorated, false);
  const store = new MusicLibraryStore(path.join(directory, "library"));
  let content: ReactNode = null;
  const app = await musicHarness(
    (size, window) => {
      content = <MusicApp {...size} windowActions={window} store={store} />;
      return content;
    },
    width,
    height,
  );
  const root = createShellRoot();
  try {
    await app.settle();
    renderShell(root, content);
    const hits = collectHits(root.container);
    for (const id of ["window:minimize", "window:maximize", "window:close", "playback:queue"]) {
      const hit = hits.find((item) => item.focusId === id);
      assert.ok(hit?.focusable, `${id} is inaccessible at the default launch size`);
      assert.ok(
        hit.x >= 0 && hit.y >= 0 && hit.x + hit.width <= width && hit.y + hit.height <= height,
        `${id} is outside the default frame`,
      );
      if (id === "playback:queue") {
        assert.ok(hit.y > height - 112, "playback controls are not in the visible footer");
        app.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
        await app.settle();
      }
    }
    assert.ok(nodes(root.container).some((node) => node.text === "Import your music"));
    assert.equal(app.native.lastFrame?.length, width * height * 4);
    await app.capture(
      path.join(
        process.env.MOIRE_MUSIC_CAPTURE_DIR ?? "/tmp/moire-music-v0-captures",
        "music-default-1020x700.png",
      ),
    );
    const maximize = hits.find((hit) => hit.focusId === "window:maximize")!;
    app.click(maximize.x + maximize.width / 2, maximize.y + maximize.height / 2);
    assert.equal(app.window.isMaximized(), true, "default-size header misses native maximize");
    app.click(maximize.x + maximize.width / 2, maximize.y + maximize.height / 2);
    assert.equal(app.window.isMaximized(), false);
    app.click(12, 12);
    assert.equal(app.native.moveRequests, 1, "default-size identity header misses native move");
  } finally {
    app.destroy();
    renderShell(root, null);
  }
});
console.log(
  "Music default 1020×700 actual Window header/footer and native actions fit the 1280×800 desktop work area",
);

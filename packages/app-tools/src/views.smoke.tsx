/* eslint-disable import/no-relative-parent-imports -- Integration tests use actual app trees. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { createShellRoot, renderShell, collectHits, type SceneNode } from "@moire/react-host";
import { installUiFonts, setUiScaleFactor } from "@moire/ui";
import { ImageViewerApp } from "../../../apps/bundled/image-viewer/src/main";
import { DocumentViewerApp } from "../../../apps/bundled/document-viewer/src/main";
import { ArchiveManagerApp } from "../../../apps/bundled/archive-manager/src/main";
import { FontViewerApp } from "../../../apps/bundled/font-viewer/src/main";
import { MusicApp } from "../../../apps/bundled/music/src/main";
import { VideoPlayerApp } from "../../../apps/bundled/video-player/src/main";
import { SoundRecorderApp } from "../../../apps/bundled/sound-recorder/src/main";
import { runTool } from "./index";
import { withFixture } from "./testing";
await installUiFonts();
await withFixture(async (directory) => {
  const apps = [
    ImageViewerApp,
    DocumentViewerApp,
    ArchiveManagerApp,
    FontViewerApp,
    MusicApp,
    VideoPlayerApp,
    SoundRecorderApp,
  ];
  for (const scale of [1, 1.5]) {
    setUiScaleFactor(scale);
    for (const App of apps)
      for (const [baseWidth, baseHeight] of [
        [640, 480],
        [1020, 700],
      ]) {
        const width = Math.round(baseWidth * scale),
          height = Math.round(baseHeight * scale);
        const root = createShellRoot();
        try {
          renderShell(root, <App width={width} height={height} />);
          for (const hit of collectHits(root.container).filter((hit) => hit.focusable)) {
            assert.ok(
              hit.x >= 0 &&
                hit.y >= 0 &&
                hit.x + hit.width <= width + 1 &&
                hit.y + hit.height <= height + 1,
              `${App.name} control outside ${width}x${height}: ${JSON.stringify({ x: hit.x, y: hit.y, width: hit.width, height: hit.height, id: hit.focusId })}`,
            );
          }
        } finally {
          renderShell(root, null);
        }
      }
  }
  setUiScaleFactor(1);
  const source = path.join(directory, "actual-image.png");
  await runTool("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=yellow:s=64x32",
    "-frames:v",
    "1",
    "-update",
    "1",
    source,
  ]);
  const root = createShellRoot();
  const tree = <ImageViewerApp width={860} height={620} initialPath={source} />;
  const refresh = () => renderShell(root, tree);
  const findImage = (node: SceneNode): SceneNode | null =>
    node.kind === "image"
      ? node
      : (node.children.map(findImage).find((value) => value !== null) ?? null);
  const wait = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 200 && !condition(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      refresh();
    }
    assert.ok(condition(), "real image workflow did not render");
  };
  const press = (label: string) => {
    const find = (node: SceneNode, x = 0, y = 0): { x: number; y: number } | null => {
      x += node.x;
      y += node.y;
      if (node.kind === "text" && node.text === label) return { x, y };
      for (const child of node.children) {
        const result = find(child, x, y);
        if (result) return result;
      }
      return null;
    };
    const position = find(root.container);
    assert.ok(position, `Missing control ${label}`);
    const hit = collectHits(root.container).find(
      (hit) =>
        hit.focusable &&
        hit.onPress &&
        position.x >= hit.x &&
        position.x < hit.x + hit.width &&
        position.y >= hit.y &&
        position.y < hit.y + hit.height,
    );
    assert.ok(hit?.onPress);
    hit.onPress({ x: hit.x + 2, y: hit.y + 2, localX: 2, localY: 2 });
    refresh();
  };
  try {
    refresh();
    await wait(() => findImage(root.container)?.imageWidth === 64);
    press("Rotate right");
    await wait(() => findImage(root.container)?.imageWidth === 32);
    assert.equal(findImage(root.container)?.imageHeight, 64);
    press("100%");
    assert.equal(findImage(root.container)?.width, 32);
    assert.equal(findImage(root.container)?.height, 64);
    press("+");
    assert.ok((findImage(root.container)?.width ?? 0) > 32);
    press("Fit");
    assert.ok((findImage(root.container)?.width ?? 0) > 32);
    assert.ok((await fs.stat(source)).size > 0);
  } finally {
    renderShell(root, null);
  }
  console.log(
    "[app-tools/views] seven native app layouts at small/wide sizes and 1x/1.5x scale and actual image load/rotate/100%/zoom/fit interactions passed",
  );
});

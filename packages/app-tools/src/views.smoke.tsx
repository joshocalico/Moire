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
  // The viewed bitmap is the largest image node; title bar and tool icons are small rasters too.
  const findImage = (node: SceneNode): SceneNode | null => {
    const images: SceneNode[] = [];
    const walk = (current: SceneNode) => {
      if (current.kind === "image") images.push(current);
      current.children.forEach(walk);
    };
    walk(node);
    return images.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
  };
  const wait = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 200 && !condition(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      refresh();
    }
    assert.ok(condition(), "real image workflow did not render");
  };
  const press = (focusId: string) => {
    const hit = collectHits(root.container).find(
      (hit) => hit.focusable && hit.onPress && hit.focusId === focusId,
    );
    assert.ok(hit?.onPress, `Missing control ${focusId}`);
    hit.onPress({ x: hit.x + 2, y: hit.y + 2, localX: 2, localY: 2 });
    refresh();
  };
  try {
    refresh();
    await wait(() => findImage(root.container)?.imageWidth === 64);
    press("image:rotate-right");
    await wait(() => findImage(root.container)?.imageWidth === 32);
    assert.equal(findImage(root.container)?.imageHeight, 64);
    press("image:actual");
    assert.equal(findImage(root.container)?.width, 32);
    assert.equal(findImage(root.container)?.height, 64);
    press("image:zoom-in");
    const zoomed = findImage(root.container)?.width ?? 0;
    assert.ok(zoomed > 32);
    press("image:fit");
    // Fit never upscales past 100%, so a small image returns to its natural size.
    assert.ok((findImage(root.container)?.width ?? 0) < zoomed);
    assert.equal(findImage(root.container)?.height, 64);
    assert.ok((await fs.stat(source)).size > 0);
  } finally {
    renderShell(root, null);
  }
  console.log(
    "[app-tools/views] seven native app layouts at small/wide sizes and 1x/1.5x scale and actual image load/rotate/100%/zoom/fit interactions passed",
  );
});

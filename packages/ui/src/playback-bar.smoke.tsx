/** Playback chrome uses real keyboard controls and fits wide/compact framebuffer bounds. */
import assert from "node:assert/strict";
import React from "react";
import {
  createShellRoot,
  renderShell,
  collectHits,
  SoftwareRenderer,
  type SceneNode,
} from "@moire/react-host";
import { THEME_FAMILIES } from "@moire/theme";
import { PlaybackBar, playbackBarHeight, formatPlaybackTime } from "./widgets/playback-bar";
import {
  Window,
  installUiFonts,
  setUiScaleFactor,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";
const nodes = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(nodes)];
await installUiFonts();
let cases = 0,
  pauses = 0,
  nexts = 0,
  seeks = 0,
  volumes = 0;
const renderer = new SoftwareRenderer();
for (const family of THEME_FAMILIES)
  for (const colorScheme of ["dark", "light"] as const)
    for (const scale of [1, 1.5])
      for (const logicalWidth of [400, 640, 1020, 1280]) {
        setUiScaleFactor(scale);
        const width = logicalWidth * scale,
          height = playbackBarHeight(width);
        const theme = createPersonalizedWidgetTheme(
          discoverPersonalization("linux", {
            themeFamily: family,
            colorScheme,
            reducedMotion: true,
          }),
        );
        const root = createShellRoot();
        const content = (
          <WidgetThemeProvider theme={theme}>
            <PlaybackBar
              width={width}
              title="Soft geometry"
              subtitle="Lumen"
              ready
              paused
              position={138}
              duration={384}
              volume={60}
              onTogglePause={() => pauses++}
              onNext={() => nexts++}
              onPrevious={() => {}}
              onStop={() => {}}
              onQueue={() => {}}
              onSeek={() => seeks++}
              onVolume={() => volumes++}
            />
          </WidgetThemeProvider>
        );
        renderShell(root, content);
        const hits = collectHits(root.container).filter((hit) => hit.focusable);
        for (const hit of hits)
          assert.ok(
            hit.x >= 0 &&
              hit.y >= 0 &&
              hit.x + hit.width <= width + 1 &&
              hit.y + hit.height <= height + 1,
            `PlaybackBar ${family}/${colorScheme}/${scale}/${logicalWidth} overflow: ${hit.focusId}`,
          );
        for (const label of ["Previous track", "Play", "Next track", "Stop playback", "Queue"])
          assert.ok(
            nodes(root.container).some((node) => node.text === label),
            `Clipped ${label} at width ${width}`,
          );
        const frame = renderer.render(root.container, { width, height });
        assert.ok(frame.pixels.some((value) => value !== 0));
        const nextHit = hits.find((hit) => hit.focusId === "playback:next")!;
        const middleY = Math.floor(nextHit.y + nextHit.height / 2);
        const at = (x: number) =>
          frame.pixels.slice(
            (middleY * width + Math.floor(x)) * 4,
            (middleY * width + Math.floor(x)) * 4 + 3,
          );
        assert.notDeepEqual(
          at(nextHit.x + nextHit.width / 2),
          at(nextHit.x + 1),
          "next triangle vanished because its subpixel scanlines were dropped",
        );
        const backend = new HeadlessPlatform();
        await backend.connect();
        const window = new Window({ title: "Player", width, height });
        window.setContent(() => content);
        window.mount(backend);
        await Promise.resolve();
        window.tick();
        const native = backend.getWindows()[0]!;
        const press = (id: string) => {
          const hit = hits.find((hit) => hit.focusId === id)!;
          assert.ok(hit);
          const x = hit.x + hit.width / 2,
            y = hit.y + hit.height / 2;
          native.injectPointer({ type: "down", button: "left", x, y, timeMs: 1 });
          native.injectPointer({ type: "up", button: "left", x, y, timeMs: 2 });
          window.tick();
        };
        assert.ok(
          hits.find((hit) => hit.focusId === "playback:pause")!.width >
            hits.find((hit) => hit.focusId === "playback:next")!.width,
          "primary play target is not larger than secondary transport",
        );
        const before = pauses;
        press("playback:pause");
        assert.equal(pauses, before + 1);
        native.injectKey({
          type: "down",
          code: 57,
          key: " ",
          modifiers: { ctrl: false, shift: false, alt: false, meta: false },
          timeMs: 0,
        });
        window.tick();
        assert.equal(pauses, before + 2);
        press("playback:next");
        assert.ok(nexts > 0);
        const sliders = hits.filter((hit) => hit.focusId?.startsWith("slider:"));
        assert.equal(sliders.length, 2);
        for (const hit of sliders) {
          const x = hit.x + hit.width / 2,
            y = hit.y + hit.height / 2;
          native.injectPointer({ type: "down", button: "left", x, y, timeMs: 3 });
          native.injectPointer({ type: "up", button: "left", x, y, timeMs: 4 });
          window.tick();
        }
        assert.ok(seeks > 0 && volumes > 0);
        window.destroy();
        backend.disconnect();
        renderShell(root, null);
        cases++;
      }
setUiScaleFactor(1);
assert.equal(formatPlaybackTime(3661), "1:01:01");
assert.equal(formatPlaybackTime(NaN), "0:00");
console.log(
  `PlaybackBar: ${cases} real theme/scale/wide/compact frames and pointer/keyboard transport+seek+volume cases passed`,
);

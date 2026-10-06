/** Actual public Window painting, keyboard navigation and header action layout. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { PNG } from "pngjs";
import { applyThemeFamily, getTheme, THEME_FAMILIES } from "@moire/theme";
import { collectHits, createShellRoot, renderShell, type HitRegion } from "@moire/react-host";
import {
  Button,
  FocusScope,
  Surface,
  Tabs,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type PlatformWindow,
} from "./index";
import { HeadlessPlatform } from "./testing";
import { tickAllMotions } from "./motion";
import { contrastRatio } from "#ui/theme-family-color";
import { resolveStatefulStyle } from "#ui/widget-theme";

await installUiFonts();
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
let cases = 0;
try {
  for (const family of THEME_FAMILIES)
    for (const colorScheme of ["dark", "light"] as const)
      for (const scale of [1, 1.5])
        for (const retained of [false, true]) {
          setUiScaleFactor(scale);
          const theme = createPersonalizedWidgetTheme(
            discoverPersonalization("linux", {
              themeFamily: family,
              colorScheme,
              accent: applyThemeFamily(getTheme(), family, colorScheme === "dark").tokens.accent,
              fontScale: 1,
              contrast: "normal",
              reducedTransparency: false,
              reducedMotion: true,
            }),
          );
          const pal = theme.foundations.palette;
          const recipe = theme.recipes.tabs.medium;
          let active = 0;
          let disabled = false;
          let overflow = false;
          const changes: number[] = [];
          const closes: number[] = [];
          let adds = 0;
          const wideWidth = 760 * scale;
          let width = wideWidth;
          const height = 260 * scale;
          const y = 60 * scale;
          const tabHeight = recipe.metrics.height * scale;
          const tabs = [
            { id: "one", label: "Documents", closable: true },
            { id: "disabled", label: "Unavailable", disabled: true, closable: true },
            { id: "three", label: "Pictures", closable: true },
          ];
          const view = () => (
            <WidgetThemeProvider theme={theme}>
              <Surface width={width} height={height} fill={pal.panel}>
                <FocusScope width={width} height={height} trap>
                  <Button
                    x={8}
                    y={8}
                    width={110}
                    label="Anchor"
                    focusId="anchor"
                    onPress={() => {}}
                  />
                  <Tabs
                    x={0}
                    y={y}
                    width={overflow ? 300 * scale : width}
                    height={tabHeight}
                    tabs={
                      overflow
                        ? [...tabs, { id: "four", label: "Downloads", closable: true }]
                        : tabs
                    }
                    active={active}
                    disabled={disabled}
                    variant="titlebar"
                    onChange={(index) => {
                      changes.push(index);
                      active = index;
                      window.requestRedraw();
                    }}
                    onClose={(index) => closes.push(index)}
                    onAdd={() => adds++}
                  />
                  <Tabs
                    x={0}
                    y={150 * scale}
                    width={width}
                    height={tabHeight}
                    tabs={tabs}
                    active={active}
                    disabled={disabled}
                    onChange={(index) => {
                      changes.push(index);
                      active = index;
                      window.requestRedraw();
                    }}
                  />
                </FocusScope>
              </Surface>
            </WidgetThemeProvider>
          );
          const scene = createShellRoot();
          const hits = () => {
            renderShell(scene, view());
            return collectHits(scene.container);
          };
          const backend = new HeadlessPlatform();
          await backend.connect();
          const window = new Window({ title: "Header tabs", width, height, decorated: false });
          window.setContent(view);
          window.mount(backend);
          await Promise.resolve();
          const native = backend.getWindows()[0];
          assert.ok(native);
          if (retained) {
            const platform: PlatformWindow = native;
            platform.presentScene = () => false;
          }
          const settle = () => {
            for (let index = 0; index < 3; index++) {
              tickAllMotions(1);
              window.requestRedraw();
              window.tick();
            }
          };
          const frame = () => {
            assert.ok(native.lastFrame);
            return native.lastFrame.slice();
          };
          const key = (code: number, value: string, shift = false, repeat = false) => {
            for (const type of ["down", "up"] as const)
              native.injectKey({
                type: type === "down" && repeat ? "repeat" : type,
                code,
                key: value,
                modifiers: { ...modifiers, shift },
                timeMs: 1,
              });
            window.tick();
            window.tick();
          };
          const point = (hit: HitRegion) => ({
            x: hit.x + hit.width / 2,
            y: hit.y + hit.height / 2,
          });
          const click = (hit: HitRegion) => {
            native.injectPointer({ type: "down", button: "left", ...point(hit), timeMs: 1 });
            native.injectPointer({ type: "up", button: "left", ...point(hit), timeMs: 2 });
            settle();
          };
          const tabHit = (id: string, standard = false) => {
            const hit = hits().find(
              (candidate) =>
                candidate.focusId?.endsWith(`:${id}`) &&
                (standard ? candidate.y >= 150 * scale : candidate.y === y),
            );
            assert.ok(hit);
            return hit;
          };
          const pixel = (bytes: Uint8Array, x: number, row: number) => {
            const offset = (Math.floor(row) * width + Math.floor(x)) * 4;
            return (
              ((bytes[offset + 3]! << 24) |
                (bytes[offset + 2]! << 16) |
                (bytes[offset + 1]! << 8) |
                bytes[offset]!) >>>
              0
            );
          };
          const interior = (bytes: Uint8Array, hit: HitRegion) =>
            pixel(bytes, hit.x + hit.width / 2, hit.y + hit.height - 6 * scale);
          const crop = (bytes: Uint8Array, hit: HitRegion) => {
            const result: number[] = [];
            for (let row = Math.ceil(hit.y); row < Math.floor(hit.y + hit.height); row++)
              for (let x = Math.ceil(hit.x); x < Math.floor(hit.x + hit.width); x++)
                result.push(pixel(bytes, x, row));
            return result;
          };
          const capture = (name: string) => {
            const dir = process.env.MOIRE_TABS_CAPTURE_DIR;
            if (!dir || retained || family !== "moire") return;
            fs.mkdirSync(dir, { recursive: true });
            const bytes = frame();
            const png = new PNG({ width, height });
            for (let offset = 0; offset < bytes.length; offset += 4) {
              png.data[offset] = bytes[offset + 2]!;
              png.data[offset + 1] = bytes[offset + 1]!;
              png.data[offset + 2] = bytes[offset]!;
              png.data[offset + 3] = bytes[offset + 3]!;
            }
            fs.writeFileSync(
              path.join(dir, `${colorScheme}-${scale}-${name}.png`),
              PNG.sync.write(png),
            );
          };
          try {
            settle();
            const first = tabHit("one");
            const third = tabHit("three");
            const initial = frame();
            capture("rest");
            assert.ok(!hits().some((hit) => hit.focusId?.endsWith(":disabled") && hit.focusable));
            if (family === "moire") {
              assert.ok(recipe.titlebar);
              const selected = resolveStatefulStyle(recipe.titlebar.tab, "selected");
              assert.equal(
                interior(initial, first),
                selected.fill,
                "actual selected paint honors header recipe",
              );
              assert.equal(interior(initial, third), recipe.titlebar.tab.base.fill);
              assert.notEqual(selected.fill, recipe.titlebar.tab.base.fill);
              assert.ok(
                contrastRatio(
                  selected.fill,
                  resolveStatefulStyle(recipe.titlebar.label, "selected").color,
                ) >= 4.5,
              );
              assert.ok(
                contrastRatio(recipe.titlebar.tab.base.fill, recipe.titlebar.label.base.color) >=
                  4.5,
              );
            } else
              assert.equal(
                recipe.titlebar,
                undefined,
                "other families retain their header recipe fallback",
              );
            key(15, "Tab");
            const focused = frame();
            assert.notDeepEqual(
              crop(focused, first),
              crop(initial, first),
              "keyboard focus has visible pixels independent of selection",
            );
            assert.equal(
              interior(focused, first),
              interior(initial, first),
              "focus does not repaint selected fill",
            );
            capture("focus");
            key(106, "ArrowRight");
            assert.equal(active, 2, "Right skips disabled tab");
            key(102, "Home");
            assert.equal(active, 0);
            key(107, "End");
            assert.equal(active, 2);
            key(105, "ArrowLeft");
            assert.equal(active, 0);
            const count = changes.length;
            key(106, "ArrowRight", false, true);
            assert.equal(changes.length, count, "repeat does not activate repeatedly");
            key(28, "Enter");
            key(57, " ");
            assert.deepEqual(changes.slice(-2), [0, 0]);
            // Focus leaving a tab must remove its recipe focus stroke as well.
            key(15, "Tab", true);
            native.injectPointer({ type: "move", x: width - 4, y: height - 4, timeMs: 3 });
            settle();
            assert.deepEqual(
              crop(frame(), first),
              crop(initial, first),
              "blur restores the header's resting paint",
            );
            capture("blur");
            const close = hits().find(
              (hit) =>
                hit.focusId?.startsWith("icon-button:") &&
                hit.y === y &&
                hit.x > first.x &&
                hit.x + hit.width <= first.x + first.width,
            );
            assert.ok(close);
            const beforeClose = changes.length;
            key(15, "Tab");
            key(15, "Tab");
            key(28, "Enter");
            key(57, " ");
            assert.deepEqual(closes, [0, 0], "close action supports Enter and Space");
            click(close);
            assert.deepEqual(closes, [0, 0, 0]);
            assert.equal(changes.length, beforeClose, "close does not also select tab underneath");
            const add = hits()
              .filter((hit) => hit.focusId?.startsWith("icon-button:") && hit.y === y)
              .at(-1);
            assert.ok(add);
            key(15, "Tab");
            key(15, "Tab");
            key(15, "Tab");
            key(28, "Enter");
            key(57, " ");
            assert.equal(adds, 2, "add action supports Enter and Space");
            click(add);
            assert.equal(adds, 3);
            native.injectPointer({ type: "move", ...point(third), timeMs: 3 });
            settle();
            if (family === "moire") {
              assert.ok(recipe.titlebar);
              assert.equal(
                interior(frame(), third),
                resolveStatefulStyle(recipe.titlebar.tab, "hover").fill,
              );
            }
            click(third);
            assert.equal(active, 2);
            if (family === "moire") {
              assert.ok(recipe.titlebar?.selectedInteraction);
              assert.equal(interior(frame(), third), recipe.titlebar.selectedInteraction.hoverFill);
              capture("selected-hover");
              native.injectPointer({ type: "down", button: "left", ...point(third), timeMs: 4 });
              settle();
              assert.equal(
                interior(frame(), third),
                recipe.titlebar.selectedInteraction.pressedFill,
              );
              capture("selected-pressed");
              native.injectPointer({ type: "up", button: "left", ...point(third), timeMs: 5 });
              settle();
            }
            overflow = true;
            active = 0;
            width = 360 * scale;
            native.emitConfigure(width, height);
            window.requestRedraw();
            settle();
            const narrowHits = hits().filter(
              (hit) => hit.focusId?.startsWith("icon-button:") && hit.y === y,
            );
            // First enabled trailing action before add is the forward arrow.
            const forward = narrowHits.at(-2);
            assert.ok(forward);
            click(forward);
            assert.equal(active, 2, "overflow skips unavailable offscreen tab");
            const previous = hits().find(
              (hit) => hit.focusId?.startsWith("icon-button:") && hit.y === y && hit.x === 0,
            );
            assert.ok(previous);
            click(previous);
            assert.equal(active, 0, "previous overflow action reveals prior enabled tab");
            click(forward);
            assert.equal(active, 2);
            capture("compact");
            for (const hit of hits().filter((hit) => hit.y === y && hit.focusable)) {
              assert.ok(hit.pointerClip);
              assert.ok(
                hit.x >= hit.pointerClip.x &&
                  hit.x + hit.width <= hit.pointerClip.x + hit.pointerClip.width + 0.01,
              );
            }
            disabled = true;
            window.requestRedraw();
            settle();
            const beforeDisabled = { change: changes.length, close: closes.length, add: adds };
            click(forward);
            key(15, "Tab");
            key(28, "Enter");
            assert.deepEqual(
              { change: changes.length, close: closes.length, add: adds },
              beforeDisabled,
            );
            assert.ok(!hits().some((hit) => hit.y === y && hit.focusable));
            capture("disabled");
            disabled = false;
            overflow = false;
            width = wideWidth;
            native.emitConfigure(width, height);
            window.requestRedraw();
            settle();
            click(tabHit("one", true));
            key(106, "ArrowRight");
            assert.equal(active, 2, "standard tab navigation remains intact");
            cases++;
          } finally {
            window.destroy();
            backend.disconnect();
            renderShell(scene, null);
          }
        }
} finally {
  setUiScaleFactor(1);
}
console.log(
  `PASS ${cases} real Window header/standard tab cases across five families, schemes, scales and CPU paths`,
);

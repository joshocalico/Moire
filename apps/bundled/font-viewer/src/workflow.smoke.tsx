/** Device-free public Window workflow with real selected-font subprocess rasterization. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import React from "react";
import {
  Window,
  installUiFonts,
  setUiScaleFactor,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { windowControl, withFixture } from "@moire/app-tools/testing";
import { privatePreviewsSettled, runTool } from "@moire/app-tools";
import { FontViewerApp } from "./main";

await installUiFonts();
await withFixture(async (directory) => {
  const font = path.join(directory, "Selected face.ttf");
  await fs.copyFile(
    fileURLToPath(
      new URL("../../../../packages/ui/fonts/IBMPlexSans-Regular.ttf", import.meta.url),
    ),
    font,
  );
  for (const [scale, dark] of [
    [1, true],
    [1.5, false],
  ] as const) {
    setUiScaleFactor(scale);
    const width = 640,
      height = 600,
      backend = new HeadlessPlatform();
    await backend.connect();
    const window = new Window({ title: "Font pages", width, height });
    window.setTheme(
      createPersonalizedWidgetTheme({
        ...discoverPersonalization("headless", { themeFamily: "moire" }),
        colorScheme: dark ? "dark" : "light",
        fontScale: scale,
      }),
    );
    window.setContent((size) => <FontViewerApp {...size} initialPath={font} />);
    let scheduled = false;
    const stop = window.onInvalidated(() => {
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (!window.isClosed()) window.tick();
        });
      }
    });
    window.mount(backend);
    window.tick();
    const native = backend.getWindows()[0];
    assert.ok(native);
    const previewHash = () => {
      if (!native.lastFrame) return "";
      const width = window.getWidth(),
        height = window.getHeight(),
        hash = createHash("sha256");
      for (let y = Math.floor(240 * scale); y < height - 35 * scale; y++)
        hash.update(native.lastFrame.subarray(y * width * 4, (y + 1) * width * 4));
      return hash.digest("hex");
    };
    const loaded = () => {
      if (!native.lastFrame) return false;
      const width = window.getWidth(),
        height = window.getHeight();
      let white = 0;
      for (let y = Math.floor(240 * scale); y < height - 35 * scale; y++)
        for (let x = 12; x < width - 12; x++) {
          const i = (y * width + x) * 4;
          if (
            (native.lastFrame[i] ?? 0) > 250 &&
            (native.lastFrame[i + 1] ?? 0) > 250 &&
            (native.lastFrame[i + 2] ?? 0) > 250
          )
            white++;
        }
      return white > 10000;
    };
    const wait = async (condition: () => boolean, label: string) => {
      const end = performance.now() + 6000;
      while (performance.now() < end) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Font workflow timed out: ${label}`);
    };
    const click = (match: { focusId: string } | { text: string }) => {
      window.tick();
      const { x, y } = windowControl(window, match);
      native.injectPointer({ type: "down", button: "left", x, y, timeMs: 1 });
      native.injectPointer({ type: "up", button: "left", x, y, timeMs: 2 });
    };
    const key = (code: number, key: string, text?: string, ctrl = false) => {
      const modifiers = { ctrl, shift: false, alt: false, meta: false };
      native.injectKey({ type: "down", code, key, text, modifiers, timeMs: 1 });
      native.injectKey({ type: "up", code, key, modifiers, timeMs: 2 });
    };
    const capture = async (name: string) => {
      const output = process.env.MOIRE_FONT_CAPTURE_DIR;
      if (!output || !native.lastFrame) return;
      await fs.mkdir(output, { recursive: true });
      const raw = path.join(directory, "capture.bgra"),
        png = path.join(output, `${name}-${dark ? "dark" : "light"}-scale${scale}.png`);
      await fs.writeFile(raw, native.lastFrame);
      await runTool("ffmpeg", [
        "-v",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgra",
        "-s",
        `${window.getWidth()}x${window.getHeight()}`,
        "-i",
        raw,
        "-frames:v",
        "1",
        "-update",
        "1",
        "-y",
        png,
      ]);
      await fs.rm(raw);
    };
    try {
      // The specimen opens first; the paged sample preview lives in the Type tester.
      click({ text: "Type tester" });
      await wait(loaded, "initial selected font");
      click({ focusId: "font:sample" });
      key(30, "a", undefined, true);
      key(
        30,
        "Text",
        Array.from({ length: 12 }, (_, index) => `Line ${index}: Wide glyphs WWW gjÅΩ`).join("\n"),
      );
      click({ focusId: "font:preview" });
      await new Promise((resolve) => setTimeout(resolve, 40));
      await wait(loaded, "edited long sample");
      const first = previewHash();
      await capture("first-page");
      click({ focusId: "font-page-next" });
      await wait(() => loaded() && previewHash() !== first, "Next shows a distinct raster page");
      const second = previewHash();
      key(57, " ");
      await wait(() => loaded() && previewHash() !== second, "focused Next keyboard activation");
      click({ focusId: "font-page-previous" });
      await wait(() => loaded() && previewHash() === second, "Previous restores exact page pixels");
      await capture("second-page");
      native.setSize(480, 680);
      await wait(
        () => native.lastFrame?.length === 480 * 680 * 4 && loaded(),
        "resize rerenders page with bounded selected-font wrapping",
      );
      assert.ok(native.lastFrame?.length === 480 * 680 * 4);
      // Close during a real asynchronous render must abort/dispose its private resources.
      click({ focusId: "font:larger" });
    } finally {
      stop();
      window.destroy();
      backend.disconnect();
    }
    // The close aborted a render mid-flight; wait for it and the disposals, not a deadline.
    await privatePreviewsSettled();
    assert.deepEqual(
      await fs.readdir(path.join(directory, "tmp")),
      [],
      "late preview resolution/close leaves no private font copy or raster",
    );
  }
  setUiScaleFactor(1);
  console.log(
    "[font-viewer/window] selected font/sample editing/Preview/Next/Space/Previous/resize/close at1x dark and1.5x light passed; headless CPU pixels only",
  );
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { PNG } from "pngjs";
import { collectHits, createShellRoot, renderShell, type HitRegion } from "@moire/react-host";
import {
  Button,
  Column,
  Label,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type ImageData,
  type PlatformWindowOpts,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { ScreenshotApp, ScreenshotDialog, type ScreenshotProps } from "./main";
import { documentImage, emptyDocument, isDirty } from "./document";
import { readPNG, savePNG } from "./backend";
import { scratchHome } from "./testing";
import { windowControl } from "@moire/app-tools/testing";

const sandbox = scratchHome();
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-screenshot-lifecycle-"));
const source: ImageData = {
  width: 32,
  height: 24,
  rgba: new Uint8Array(32 * 24 * 4),
};
for (let offset = 0; offset < source.rgba.length; offset += 4)
  source.rgba.set([51, 102, 153, 255], offset);
const replacement: ImageData = {
  width: 20,
  height: 10,
  rgba: new Uint8Array(20 * 10 * 4).fill(255),
};
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
class RetainedCpuPlatform extends HeadlessPlatform {
  override createWindow(opts: PlatformWindowOpts) {
    return Object.assign(super.createWindow(opts), {
      presentScene: () => false,
    });
  }
}
let cases = 0;
async function harness(
  options: {
    width?: number;
    height?: number;
    scale?: number;
    family?: "moire" | "cupertino" | "redmond" | "gnomish" | "plasmid";
    scheme?: "dark" | "light";
    retained?: boolean;
    app?: Partial<ScreenshotProps>;
  } = {},
) {
  const width = options.width ?? 980,
    height = options.height ?? 720,
    scale = options.scale ?? 1;
  setUiScaleFactor(scale);
  const theme = createPersonalizedWidgetTheme(
    discoverPersonalization("linux", {
      themeFamily: options.family ?? "moire",
      colorScheme: options.scheme ?? "dark",
      reducedMotion: true,
      accent: "#b794f4",
    }),
  );
  const backend = options.retained ? new RetainedCpuPlatform() : new HeadlessPlatform();
  const window = new Window({ title: "Screenshot lifecycle", width, height });
  const latest = { current: emptyDocument() };
  let closes = 0;
  const output = path.join(fixture, `output-${cases++}.png`);
  const app = { initialImage: source, initialOutput: output, ...options.app };
  const wrapped = (node: React.ReactNode) => (
    <WidgetThemeProvider theme={theme}>{node}</WidgetThemeProvider>
  );
  await backend.connect();
  window.onClose(() => {
    closes++;
  });
  window.setContent((size) =>
    wrapped(
      <ScreenshotApp
        {...size}
        {...app}
        window={window}
        onDocumentChange={(document) => {
          latest.current = document;
        }}
      />,
    ),
  );
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0];
  assert.ok(native);
  // The live header bar draws window controls; a stand-in window gives this independent render
  // the same layout without touching the live window's close guard.
  const layoutWindow = {
    beginMove() {},
    requestClose() {},
    setMaximized() {},
    isMaximized: () => false,
    minimize() {},
    setCloseGuard() {},
  } as unknown as Window;
  const scene = createShellRoot();
  renderShell(
    scene,
    wrapped(
      <ScreenshotApp
        width={width}
        height={height}
        window={layoutWindow}
        initialImage={source}
        initialOutput={output}
      />,
    ),
  );
  const controls = collectHits(scene.container);
  renderShell(scene, null);
  const key = (code: number, key: string, ctrl = false, shift = false, text?: string) => {
    const mods = { ...modifiers, ctrl, shift };
    native.injectKey({
      type: "down",
      code,
      key,
      modifiers: mods,
      text,
      timeMs: 1,
    });
    native.injectKey({ type: "up", code, key, modifiers: mods, timeMs: 2 });
    window.tick();
  };
  const text = (value: string) => {
    key(30, "a", true);
    key(0, value, false, false, value);
  };
  const click = (x: number, y: number) => {
    native.injectPointer({ type: "down", x, y, button: "left", timeMs: 1 });
    native.injectPointer({ type: "up", x, y, button: "left", timeMs: 2 });
    window.tick();
  };
  const control = (id: string) => {
    const hit = controls.find((hit) => hit.focusId === id);
    assert.ok(hit, `missing independent rendered control ${id}`);
    return hit;
  };
  const press = (id: string) => {
    const hit = control(id);
    click(hit.x + hit.width / 2, hit.y + hit.height / 2);
  };
  const mode = (id: string) => {
    const hit = controls.find(
      (candidate) => candidate.focusId?.startsWith("tabs:") && candidate.focusId.endsWith(`:${id}`),
    );
    assert.ok(hit);
    click(hit.x + hit.width / 2, hit.y + hit.height / 2);
  };
  const promptPress = (
    id: "save" | "discard" | "cancel" | "apply" | "replace",
    kind: "unsaved" | "other" = "unsaved",
  ) => {
    const root = createShellRoot();
    const noop = () => {};
    renderShell(
      root,
      wrapped(
        <ScreenshotDialog
          width={width}
          height={height}
          title="Prompt"
          onDismiss={noop}
          footer={
            <Column gap={6 * scale}>
              {kind === "unsaved" ? (
                <>
                  <Button label="Save" variant="primary" focusId="test-save" onPress={noop} />
                  <Button label="Discard" focusId="test-discard" onPress={noop} />
                  <Button label="Cancel" focusId="test-cancel" onPress={noop} />
                </>
              ) : (
                <>
                  <Button
                    label={id === "replace" ? "Replace" : "Open"}
                    focusId={`test-${id === "replace" ? "replace" : "apply"}`}
                    onPress={noop}
                  />
                  <Button label="Cancel" focusId="test-cancel" onPress={noop} />
                </>
              )}
            </Column>
          }
        >
          <Label text="Prompt body" />
        </ScreenshotDialog>,
      ),
    );
    const hit = collectHits(root.container).find((hit) => hit.focusId === `test-${id}`);
    assert.ok(hit?.onPress, `prompt ${id} must have actual allocated action`);
    assert.ok(hit.y >= 0 && hit.y + hit.height <= height, "prompt footer is inside viewport");
    renderShell(root, null);
    click(hit.x + hit.width / 2, hit.y + hit.height / 2);
  };
  const settle = async () => {
    for (let frame = 0; frame < 4; frame++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      window.tick();
    }
  };
  const wait = async (predicate: () => boolean) => {
    for (let frame = 0; frame < 100; frame++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      window.tick();
      if (predicate()) return;
    }
    assert.fail("Screenshot operation did not settle");
  };
  const cropDrag = () => {
    const bounds = control("screenshot-canvas");
    native.injectPointer({
      type: "down",
      x: bounds.x + bounds.width * 0.25,
      y: bounds.y + bounds.height * 0.25,
      button: "left",
      timeMs: 1,
    });
    native.injectPointer({
      type: "move",
      x: bounds.x + bounds.width * 0.75,
      y: bounds.y + bounds.height * 0.75,
      button: "left",
      timeMs: 2,
    });
    native.injectPointer({
      type: "up",
      x: bounds.x + bounds.width * 0.75,
      y: bounds.y + bounds.height * 0.75,
      button: "left",
      timeMs: 3,
    });
    window.tick();
  };
  /** Click a control in the live window, found by focusId or its label. */
  const pressLive = (match: { focusId: string } | { text: string }) => {
    const point = windowControl(window, match);
    click(point.x, point.y);
  };
  /** New Screenshot with no delay: the dialog's Delay "None", then Take Screenshot. */
  const captureNow = async () => {
    press("screenshot-capture");
    await settle();
    pressLive({ text: "None" });
    pressLive({ focusId: "screenshot-take" });
  };
  /** Open through the shared chooser: Ctrl+O, edit the location, type the file, Enter. */
  const open = async (file: string) => {
    key(24, "o", true);
    await settle();
    pressLive({ text: "Edit" });
    text(file);
    key(28, "Enter");
    await settle();
  };
  const destroy = () => {
    window.destroy();
    backend.disconnect();
  };
  return {
    width,
    height,
    scale,
    backend,
    window,
    native,
    latest,
    output,
    controls,
    control,
    press,
    mode,
    key,
    text,
    click,
    promptPress,
    settle,
    wait,
    cropDrag,
    captureNow,
    open,
    destroy,
    closes: () => closes,
  };
}
async function captureFrame(frame: Uint8Array, width: number, height: number, file: string) {
  const png = new PNG({ width, height });
  for (let offset = 0; offset < frame.length; offset += 4) {
    png.data[offset] = frame[offset + 2] ?? 0;
    png.data[offset + 1] = frame[offset + 1] ?? 0;
    png.data[offset + 2] = frame[offset] ?? 0;
    png.data[offset + 3] = frame[offset + 3] ?? 0;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, PNG.sync.write(png));
}
try {
  await installUiFonts();
  // Real native-close callback, failed save, cancel, overwrite denial, successful save and close once.
  let failSave = true;
  const close = await harness({
    app: {
      save: async (...args) => {
        if (failSave) throw new Error("fixture storage unavailable");
        await savePNG(...args);
      },
    },
  });
  try {
    close.cropDrag();
    assert.ok(documentImage(close.latest.current)?.width !== source.width);
    const pixels = documentImage(close.latest.current);
    close.native.requestClose();
    close.window.tick();
    assert.equal(close.closes(), 0);
    if (process.env.MOIRE_CAPTURE_DIR && close.native.lastFrame)
      await captureFrame(
        close.native.lastFrame,
        close.width,
        close.height,
        path.join(process.env.MOIRE_CAPTURE_DIR, "screenshot-unsaved-prompt.png"),
      );
    close.key(1, "Escape");
    assert.deepEqual(documentImage(close.latest.current), pixels);
    close.native.requestClose();
    close.window.tick();
    close.promptPress("save");
    await close.settle();
    assert.equal(close.closes(), 0);
    assert.equal(isDirty(close.latest.current), true);
    failSave = false;
    await savePNG(replacement, close.output);
    close.promptPress("save");
    await close.settle();
    close.key(1, "Escape");
    assert.deepEqual(
      (await readPNG(close.output)).rgba,
      replacement.rgba,
      "cancel overwrite preserves destination bytes",
    );
    assert.equal(isDirty(close.latest.current), true);
    assert.equal(close.closes(), 0);
    close.promptPress("save");
    await close.settle();
    close.promptPress("replace", "other");
    await close.wait(() => close.closes() === 1);
    assert.deepEqual(await readPNG(close.output), pixels);
    assert.equal(isDirty(close.latest.current), false);
    close.native.requestClose();
    assert.equal(close.closes(), 1, "accepted close callback occurs only once");
  } finally {
    close.destroy();
  }

  // Opening a replacement must not read before guard approval, and read failure preserves edits.
  const opened = path.join(fixture, "opened.png");
  await savePNG(replacement, opened);
  const reads: string[] = [];
  const open = await harness({
    app: {
      read: async (file) => {
        reads.push(file);
        return readPNG(file);
      },
    },
  });
  try {
    open.cropDrag();
    const before = documentImage(open.latest.current);
    await open.open(opened);
    open.key(1, "Escape");
    assert.deepEqual(reads, []);
    assert.deepEqual(documentImage(open.latest.current), before);
    // A file that is not a PNG fails to read after the guard approves it.
    const broken = path.join(fixture, "broken.png");
    await fs.writeFile(broken, "not a png");
    await open.open(broken);
    open.promptPress("discard");
    await open.settle();
    assert.equal(reads.length, 1);
    assert.deepEqual(documentImage(open.latest.current), before);
    assert.equal(isDirty(open.latest.current), true);
    await open.open(opened);
    open.promptPress("save");
    await open.wait(() => reads.length === 2 && !isDirty(open.latest.current));
    assert.deepEqual(await readPNG(open.output), before);
    assert.deepEqual(documentImage(open.latest.current), replacement);
    open.native.requestClose();
    assert.equal(open.closes(), 1, "opened saved PNG closes without a guard");
  } finally {
    open.destroy();
  }

  const captures: Array<{
    resolve: (image: ImageData) => void;
    reject: (error: Error) => void;
  }> = [];
  const capture = await harness({
    app: {
      capture: () => new Promise((resolve, reject) => captures.push({ resolve, reject })),
    },
  });
  try {
    await capture.captureNow();
    capture.key(1, "Escape");
    assert.equal(captures.length, 0);
    await capture.captureNow();
    capture.promptPress("discard");
    // The capture call follows the activation-token request (own-window.ts), not the click itself.
    await capture.wait(() => captures.length === 1);
    capture.press("screenshot-capture");
    captures[0]?.resolve(replacement);
    await capture.settle();
    assert.deepEqual(
      documentImage(capture.latest.current),
      source,
      "canceled late capture cannot replace current image",
    );
    await capture.captureNow();
    capture.promptPress("discard");
    await capture.wait(() => captures.length === 2);
    captures[1]?.reject(new Error("capture unavailable"));
    await capture.settle();
    assert.deepEqual(documentImage(capture.latest.current), source);
    assert.equal(isDirty(capture.latest.current), true);
    await capture.captureNow();
    capture.promptPress("save");
    await capture.wait(() => captures.length === 3);
    captures[2]?.resolve(replacement);
    await capture.settle();
    assert.deepEqual(await readPNG(capture.output), source);
    assert.deepEqual(documentImage(capture.latest.current), replacement);
    assert.equal(isDirty(capture.latest.current), true);
    capture.native.requestClose();
    capture.window.tick();
    capture.promptPress("discard");
    assert.equal(capture.closes(), 1);
  } finally {
    capture.destroy();
  }

  // Native close during pending read: explicit discard cancels ownership, late completion stays inert.
  const delivery: { complete: ((image: ImageData) => void) | null } = {
    complete: null,
  };
  const delayedRead = await harness({
    app: {
      initialImage: undefined,
      initialFile: opened,
      read: () =>
        new Promise((resolve) => {
          delivery.complete = resolve;
        }),
    },
  });
  try {
    delayedRead.native.requestClose();
    delayedRead.window.tick();
    assert.equal(delayedRead.closes(), 0);
    delayedRead.promptPress("discard");
    assert.equal(delayedRead.closes(), 1);
    delayedRead.destroy();
    const complete = delivery.complete;
    assert.ok(complete);
    complete(replacement);
    await delayedRead.settle();
    assert.equal(delayedRead.latest.current.original, null);
  } finally {
    delayedRead.destroy();
  }

  // Save is not cancellable midway; no close until it has completed successfully.
  const deferredSave = { complete: () => {} };
  const saving = await harness({
    app: {
      save: async (...args) => {
        await new Promise<void>((resolve) => {
          deferredSave.complete = resolve;
        });
        await savePNG(...args);
      },
    },
  });
  try {
    saving.key(31, "s", true);
    saving.native.requestClose();
    assert.equal(saving.closes(), 0);
    deferredSave.complete();
    await saving.wait(() => !isDirty(saving.latest.current));
    saving.native.requestClose();
    assert.equal(saving.closes(), 1);
  } finally {
    saving.destroy();
  }

  for (const compact of [false, true]) {
    const app = await harness({
      retained: true,
      scale: 1.5,
      width: compact ? 480 : 1280,
      height: compact ? 460 : 800,
    });
    try {
      app.mode("pen");
      app.cropDrag();
      assert.equal(app.latest.current.edits.at(-1)?.kind, "pen");
      const pen = documentImage(app.latest.current);
      assert.ok(pen);
      const redPixels = (image: ImageData) => {
        let count = 0;
        for (let offset = 0; offset < image.rgba.length; offset += 4)
          if (
            image.rgba[offset] === 255 &&
            image.rgba[offset + 1] === 69 &&
            image.rgba[offset + 2] === 58 &&
            image.rgba[offset + 3] === 255
          )
            count++;
        return count;
      };
      assert.ok(redPixels(pen) > 0, "actual pen gesture paints the selected color");
      app.mode("rectangle");
      app.cropDrag();
      assert.equal(app.latest.current.edits.at(-1)?.kind, "rectangle");
      const box = documentImage(app.latest.current);
      assert.ok(box);
      assert.ok(redPixels(box) > redPixels(pen), "actual box gesture adds real outline pixels");
      app.key(44, "z", true);
      assert.deepEqual(
        documentImage(app.latest.current),
        pen,
        "canvas undo removes the box without losing the pen",
      );
      app.key(31, "s", true);
      await app.wait(() => !isDirty(app.latest.current));
      assert.deepEqual(await readPNG(app.output), pen, "saved PNG keeps actual annotation pixels");
    } finally {
      app.destroy();
    }
  }

  // Five-family light/dark/scale/compact physical bounds plus actual initial Save input and persisted pixels.
  for (const family of ["moire", "cupertino", "redmond", "gnomish", "plasmid"] as const)
    for (const scheme of ["dark", "light"] as const)
      for (const scale of [1, 1.5])
        for (const compact of [false, true]) {
          const app = await harness({
            family,
            scheme,
            scale,
            width: compact ? 480 : 1280,
            height: compact ? 460 : 800,
          });
          try {
            for (const id of [
              "screenshot-open",
              "screenshot-capture",
              "screenshot-crop-bounds",
              "screenshot-save",
            ]) {
              const hit: HitRegion = app.control(id);
              assert.ok(
                hit.x >= 0 &&
                  hit.y >= 0 &&
                  hit.x + hit.width <= app.width &&
                  hit.y + hit.height <= app.height,
                `${family} ${scale} ${id} fits`,
              );
              assert.ok(
                hit.pointerClip &&
                  hit.x >= hit.pointerClip.x &&
                  hit.y >= hit.pointerClip.y &&
                  hit.x + hit.width <= hit.pointerClip.x + hit.pointerClip.width &&
                  hit.y + hit.height <= hit.pointerClip.y + hit.pointerClip.height,
              );
            }
            app.press("screenshot-crop-bounds");
            // Cancel -> Apply -> height -> width -> y -> x. Enter in last field applies numeric crop.
            for (let index = 0; index < 5; index++) app.key(15, "Tab", false, true);
            app.text("2");
            app.key(15, "Tab");
            app.text("3");
            app.key(15, "Tab");
            app.text("12");
            app.key(15, "Tab");
            app.text("8");
            app.key(28, "Enter");
            assert.equal(documentImage(app.latest.current)?.width, 12, "keyboard crop width");
            assert.equal(documentImage(app.latest.current)?.height, 8, "keyboard crop height");
            app.press("screenshot-save");
            await app.wait(() => !isDirty(app.latest.current));
            assert.deepEqual(await readPNG(app.output), documentImage(app.latest.current));
            assert.ok(app.native.lastFrame?.some((byte) => byte !== 0));
            if (
              process.env.MOIRE_CAPTURE_DIR &&
              family === "moire" &&
              scheme === "dark" &&
              scale === 1.5 &&
              app.native.lastFrame
            ) {
              await captureFrame(
                app.native.lastFrame,
                app.width,
                app.height,
                path.join(
                  process.env.MOIRE_CAPTURE_DIR,
                  compact ? "screenshot-compact.png" : "screenshot-wide.png",
                ),
              );
            }
          } finally {
            app.destroy();
          }
        }
  for (const scale of [1, 1.5])
    for (const compact of [false, true]) {
      const app = await harness({
        scale,
        retained: true,
        width: compact ? 480 : 1280,
        height: compact ? 460 : 800,
      });
      try {
        app.cropDrag();
        assert.equal(isDirty(app.latest.current), true);
        app.key(44, "z", true);
        assert.deepEqual(
          documentImage(app.latest.current),
          source,
          "canvas Ctrl+Z restores actual source pixels",
        );
        app.key(31, "s", true);
        await app.wait(() => !isDirty(app.latest.current));
        assert.deepEqual(await readPNG(app.output), source);
        app.native.requestClose();
        assert.equal(app.closes(), 1);
      } finally {
        app.destroy();
      }
    }
  console.log(
    `Screenshot ${cases} actual Window cases passed: guarded close/open/capture, failed save/read/capture, cancel/overwrite, compact keyboard crop/save, retained CPU and exact PNG pixels`,
  );
} finally {
  setUiScaleFactor(1);
  await fs.rm(fixture, { recursive: true, force: true });
  sandbox.restore();
}

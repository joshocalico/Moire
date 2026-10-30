/**
 * Screenshot workflows people use: take a screenshot (whole screen, or select an area), save it
 * under an automatic name in ~/Pictures/Screenshots, Save As through the shared chooser, copy its
 * path, show it in Files, and open a PNG through the chooser.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import {
  Window,
  installUiFonts,
  setUiScaleFactor,
  tickAllMotions,
  type ImageData,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { windowControl, windowTexts } from "@moire/app-tools/testing";
import { ScreenshotApp, type ScreenshotProps } from "./main";
import { readPNG, savePNG } from "./backend";
import { documentImage, emptyDocument, isDirty } from "./document";
import { scratchHome } from "./testing";

const sandbox = scratchHome();
const screenshots = path.join(sandbox.home, "Pictures", "Screenshots");
const source: ImageData = {
  width: 40,
  height: 30,
  rgba: new Uint8Array(40 * 30 * 4),
};
for (let offset = 0; offset < source.rgba.length; offset += 4)
  source.rgba.set([20, 120, 200, 255], offset);

async function mount(app: Partial<ScreenshotProps>, width = 1100, height = 760) {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({ title: "Screenshot workflow", width, height });
  const latest = { current: emptyDocument() };
  window.setContent((size) => (
    <ScreenshotApp
      {...size}
      {...app}
      window={window}
      onDocumentChange={(document) => {
        latest.current = document;
      }}
    />
  ));
  window.mount(backend);
  const native = backend.getWindows()[0]!;
  const settle = async () => {
    for (let frame = 0; frame < 10; frame++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      tickAllMotions(1);
      window.tick();
    }
  };
  const click = (x: number, y: number) => {
    native.injectPointer({ type: "down", x, y, button: "left", timeMs: 1 });
    native.injectPointer({ type: "up", x, y, button: "left", timeMs: 2 });
    window.tick();
  };
  const press = async (match: { focusId: string } | { text: string }) => {
    const point = windowControl(window, match);
    click(point.x, point.y);
    await settle();
  };
  const key = async (code: number, name: string, ctrl = false, shift = false, text?: string) => {
    const modifiers = { ctrl, shift, alt: false, meta: false };
    native.injectKey({
      type: "down",
      code,
      key: name,
      text,
      modifiers,
      timeMs: 1,
    });
    native.injectKey({ type: "up", code, key: name, modifiers, timeMs: 2 });
    await settle();
  };
  const type = async (value: string) => {
    await key(30, "a", true);
    await key(0, value, false, false, value);
  };
  const texts = () => windowTexts(window);
  /** Drag across the middle of the image canvas. */
  const drag = async () => {
    const canvas = (
      window as unknown as {
        hits: {
          focusId?: string;
          x: number;
          y: number;
          width: number;
          height: number;
        }[];
      }
    ).hits.find((hit) => hit.focusId === "screenshot-canvas");
    assert.ok(canvas, "the image has a drag surface");
    const at = (fx: number, fy: number) => ({
      x: canvas.x + canvas.width * fx,
      y: canvas.y + canvas.height * fy,
    });
    native.injectPointer({
      type: "down",
      ...at(0.25, 0.25),
      button: "left",
      timeMs: 1,
    });
    native.injectPointer({
      type: "move",
      ...at(0.75, 0.75),
      button: "left",
      timeMs: 2,
    });
    native.injectPointer({
      type: "up",
      ...at(0.75, 0.75),
      button: "left",
      timeMs: 3,
    });
    await settle();
  };
  await installUiFonts();
  await settle();
  return {
    window,
    latest,
    press,
    key,
    type,
    texts,
    drag,
    settle,
    destroy: () => {
      window.destroy();
      backend.disconnect();
    },
  };
}

try {
  await installUiFonts();

  // An empty window offers the capture options; Select area captures, then crops by dragging.
  {
    let captures = 0;
    const app = await mount({
      capture: async () => {
        captures++;
        return source;
      },
    });
    assert.ok(app.texts().includes("Take a screenshot"), "an empty window explains what to do");
    assert.ok(!app.texts().includes("Save As…"), "no save actions before there is an image");
    await app.press({ text: "Select area" });
    await app.press({ text: "None" });
    await app.press({ focusId: "screenshot-take" });
    assert.equal(captures, 1, "Take Screenshot captures with the chosen options");
    assert.ok(
      app.texts().some((text) => text.startsWith("Drag over the part of the screen to keep")),
      "Select area asks for the part to keep",
    );
    await app.drag();
    const cropped = documentImage(app.latest.current);
    assert.ok(cropped && cropped.width < source.width, "dragging crops to the selected area");

    // Save: an automatic name in ~/Pictures/Screenshots, shown before saving.
    assert.ok(app.texts().some((text) => text.endsWith("Saves to ~/Pictures/Screenshots")));
    const name = app
      .texts()
      .find((text) => /^Screenshot \d{4}-\d\d-\d\d at \d\d\.\d\d\.\d\d\.png$/.test(text));
    assert.ok(name, "the file name is generated from the capture time");
    await app.press({ focusId: "screenshot-save" });
    const saved = path.join(screenshots, name);
    assert.deepEqual(await readPNG(saved), cropped, "Save writes the edited image there");
    assert.equal(isDirty(app.latest.current), false);

    // Copy Path puts the saved file on the clipboard (the clipboard holds text only).
    await app.press({ focusId: "screenshot-copy-path" });
    assert.equal(await app.window.readClipboardText(), saved);
    assert.ok(app.texts().some((text) => text.includes("images can't be copied yet")));

    // New Screenshot from the header: the dialog remembers the options.
    await app.press({ focusId: "screenshot-capture" });
    assert.ok(app.texts().includes("New screenshot"));
    await app.press({ text: "Whole screen" });
    await app.press({ focusId: "screenshot-take" });
    assert.equal(captures, 2);
    assert.deepEqual(documentImage(app.latest.current), source, "the new capture replaced it");
    assert.ok(app.texts().some((text) => text.startsWith("Captured the screen")));
    app.destroy();
  }

  // Save As through the chooser; later saves keep that folder and name and replace it quietly.
  {
    const shown: string[] = [];
    const app = await mount({
      initialImage: source,
      showInFiles: async (file) => {
        shown.push(file);
      },
    });
    await app.press({ focusId: "screenshot-save-as" });
    assert.ok(app.texts().includes("Save screenshot as"), "Save As opens the shared chooser");
    await app.press({ focusId: "file-chooser:name" });
    await app.type("Holiday");
    await app.key(28, "Enter");
    const holiday = path.join(screenshots, "Holiday.png");
    assert.deepEqual(await readPNG(holiday), source, "a name without .png still saves a PNG");
    assert.ok(app.texts().includes("Holiday.png"), "the name field follows Save As");
    await app.drag();
    await app.press({ focusId: "screenshot-save" });
    assert.ok(
      !app.texts().includes("Replace existing PNG?"),
      "re-saving its own file asks nothing",
    );
    assert.equal((await readPNG(holiday)).width, documentImage(app.latest.current)?.width);
    await app.press({ focusId: "screenshot-show-in-files" });
    assert.deepEqual(shown, [holiday], "Show in Files shows the saved file's folder");

    // Saving to another existing file still asks before replacing it.
    const other = path.join(screenshots, "Other.png");
    await savePNG(source, other);
    await app.press({ focusId: "screenshot-file-name" });
    await app.type("Other.png");
    await app.key(28, "Enter");
    assert.ok(app.texts().includes("Replace existing PNG?"));
    await app.key(1, "Escape");
    assert.deepEqual(await readPNG(other), source, "Cancel keeps the other file");
    app.destroy();
  }

  // Unsaved image: Show in Files saves first; a compact window keeps these in a menu.
  {
    setUiScaleFactor(1);
    const shown: string[] = [];
    const app = await mount(
      {
        initialImage: source,
        initialOutput: "Compact",
        showInFiles: async (file) => {
          shown.push(file);
        },
      },
      540,
      650,
    );
    await app.press({ focusId: "screenshot-save-more" });
    await app.press({ text: "Show in Files" });
    const compact = path.join(screenshots, "Compact.png");
    assert.ok(fs.existsSync(compact), "an unsaved image is saved before it is shown");
    assert.deepEqual(shown, [compact]);
    await app.press({ focusId: "screenshot-save-more" });
    await app.press({ text: "Copy Path" });
    assert.equal(await app.window.readClipboardText(), compact);
    app.destroy();
  }

  // Open goes through the chooser; an opened PNG saves beside itself as "(edited)".
  {
    const opened = path.join(sandbox.home, "Pictures", "Photo.png");
    await savePNG(source, opened);
    const app = await mount({ initialImage: source });
    await app.key(24, "o", true);
    assert.ok(app.texts().includes("Open image"), "Ctrl+O opens the shared chooser");
    await app.press({ text: "Pictures" });
    assert.ok(app.texts().includes("Photo.png"), "it lists PNGs in Pictures");
    await app.press({ text: "Edit" });
    await app.type(opened);
    await app.key(28, "Enter");
    // The unsaved capture is guarded before the open replaces it.
    assert.ok(app.texts().includes("Save changes first?"));
    await app.press({ focusId: "screenshot-prompt-discard" });
    await app.settle();
    assert.ok(app.texts().some((text) => text.startsWith("Opened Photo.png")));
    assert.ok(app.texts().includes("Photo (edited).png"));
    assert.ok(app.texts().some((text) => text.endsWith("Saves to ~/Pictures")));
    app.destroy();
  }
  console.log(
    "[screenshot/workflow] capture panel, select area, auto-named save, Save As, copy path, show in files, compact menu and chooser open passed",
  );
} finally {
  setUiScaleFactor(1);
  sandbox.restore();
}

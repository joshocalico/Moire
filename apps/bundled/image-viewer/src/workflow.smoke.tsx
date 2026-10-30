/**
 * Image Viewer as a person uses it: open through the file chooser, step through the folder by
 * keyboard and buttons, zoom with the wheel and keys, drag, show the folder in Files, and see a
 * broken image reported. Real ffmpeg decoding; a stand-in desktop opener records Show in Files.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { loadRecentFiles, runTool } from "@moire/app-tools";
import { mountWindow, withFixture } from "@moire/app-tools/testing";
import { ImageViewerApp } from "./main";

/** The parts of a painted scene node these checks read. */
type SceneNode = { kind: string; x: number; y: number; width: number; children: SceneNode[] };

const KEY = {
  down: 108,
  enter: 28,
  left: 105,
  right: 106,
  equal: 13,
  minus: 12,
  zero: 11,
};

async function picture(file: string, size: string, colour: string) {
  await runTool("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${colour}:s=${size}`,
    "-frames:v",
    "1",
    "-update",
    "1",
    file,
  ]);
}

/** The drawn picture's placement in the window: the widest image node (icons are smaller). */
function imageNode(root: SceneNode): { x: number; width: number } | null {
  let widest: { x: number; width: number } | null = null;
  const walk = (node: SceneNode, x: number) => {
    x += node.x;
    if (node.kind === "image" && node.width > (widest?.width ?? 64))
      widest = { x, width: node.width };
    for (const child of node.children) walk(child, x);
  };
  walk(root, 0);
  return widest;
}

const previousPath = process.env.PATH;
await withFixture(async (home) => {
  const trip = path.join(home, "Pictures", "Trip");
  await fs.mkdir(trip, { recursive: true });
  await picture(path.join(trip, "a.png"), "1600x800", "red");
  await picture(path.join(trip, "b2.png"), "64x32", "green");
  await picture(path.join(trip, "b10.png"), "64x32", "blue");
  await fs.writeFile(path.join(trip, "z-broken.png"), "not an image");
  await fs.writeFile(path.join(trip, "notes.txt"), "not listed");
  // A stand-in desktop opener, so Show in Files is observable without a desktop.
  const bin = path.join(home, "bin");
  const opened = path.join(home, "opened.txt");
  await fs.mkdir(bin);
  await fs.writeFile(
    path.join(bin, "xdg-open"),
    `#!/bin/sh\nprintf '%s\\n' "$1" >> '${opened}'\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;

  const app = await mountWindow((size) => <ImageViewerApp {...size} />, {
    width: 860,
  });
  const root = () => (app.window as unknown as { root: { container: SceneNode } }).root.container;
  const status = () => app.texts().join(" | ");
  try {
    // The empty state's primary action is the chooser, which starts in Pictures.
    app.press({ text: "Open…" });
    await app.settle();
    assert.ok(app.texts().includes("Trip"), "the chooser opens on Pictures");
    app.key(KEY.down, "ArrowDown");
    app.key(KEY.enter, "Enter");
    await app.settle();
    assert.ok(!app.texts().includes("notes.txt"), "only images are offered");
    app.key(KEY.down, "ArrowDown");
    app.key(KEY.enter, "Enter");
    await app.until(() => app.texts().includes("1 of 4 · 1600 × 800"), `a.png opens: ${status()}`);
    assert.deepEqual(loadRecentFiles("org.moire.ImageViewer"), [path.join(trip, "a.png")]);

    // Fit by default: the 1600px image is scaled into the 860px window.
    const fitted = app.texts().find((text) => /^\d+%$/.test(text));
    assert.equal(fitted, "52%");
    const fitWidth = imageNode(root())!.width;

    // The wheel zooms about the pointer: the content under it stays put.
    const pointer = { x: 200, y: 300 };
    const before = imageNode(root())!;
    const ratio = (pointer.x - before.x) / before.width;
    app.native.injectPointer({
      type: "wheel",
      ...pointer,
      deltaY: -200,
      timeMs: 3,
    });
    await app.settle(2);
    const zoomed = imageNode(root())!;
    assert.ok(zoomed.width > fitWidth * 1.4, "wheel up zooms in");
    assert.ok(
      Math.abs(zoomed.x + ratio * zoomed.width - pointer.x) < 2,
      "the point under the pointer stays under it",
    );

    // Dragging moves the zoomed image.
    app.native.injectPointer({
      type: "down",
      button: "left",
      x: 400,
      y: 300,
      timeMs: 4,
    });
    app.native.injectPointer({ type: "move", x: 300, y: 300, timeMs: 5 });
    app.native.injectPointer({
      type: "up",
      button: "left",
      x: 300,
      y: 300,
      timeMs: 6,
    });
    await app.settle(2);
    assert.ok(Math.abs(imageNode(root())!.x - (zoomed.x - 100)) < 1, "drag pans by its distance");

    // Keyboard zoom: 0 fits, = and - step.
    app.key(KEY.zero, "0", { text: "0" });
    await app.settle(2);
    assert.ok(app.texts().includes("52%"), "0 fits again");
    app.key(KEY.equal, "=", { text: "=" });
    await app.settle(2);
    assert.ok(app.texts().includes("65%"), "= zooms in one step");
    app.key(KEY.minus, "-", { text: "-" });
    await app.settle(2);
    assert.ok(app.texts().includes("52%"), "- zooms out one step");

    // The folder in natural order: a, b2, b10, then the broken one.
    app.key(KEY.right, "ArrowRight");
    await app.until(() => app.texts().includes("2 of 4 · 64 × 32"), "→ steps to b2.png");
    assert.ok(app.texts().includes("b2.png"));
    app.press({ focusId: "image:next" });
    await app.until(() => app.texts().includes("b10.png"), "Next steps to b10.png");
    app.key(KEY.left, "ArrowLeft");
    await app.until(() => app.texts().includes("b2.png"), "← steps back");
    app.press({ focusId: "image:next" });
    app.press({ focusId: "image:next" });
    await app.until(
      () => app.texts().includes("This image can't be shown"),
      "a broken image is reported, not shown blank",
    );
    assert.ok(app.texts().includes("Try again"));
    assert.ok(app.texts().some((text) => text.startsWith("4 of 4")));

    // Show in Files hands the image's folder to the desktop opener.
    app.press({ focusId: "image:show-in-files" });
    await app.until(() => app.texts().includes("Opened Trip in Files"), "Show in Files reports");
    let handed = "";
    for (let attempt = 0; attempt < 100 && !handed; attempt++) {
      await app.settle(1);
      handed = await fs.readFile(opened, "utf8").catch(() => "");
    }
    assert.equal(handed.trim(), pathToFileURL(trip).href, "the opener gets the folder's URL");

    // The header's Open… reopens the chooser in the current folder; Escape cancels it.
    app.press({ focusId: "image:open" });
    await app.settle();
    assert.ok(app.texts().includes("b10.png"), "the chooser starts in the open image's folder");
    app.key(1, "Escape");
    await app.settle();
    assert.ok(!app.texts().includes("Cancel"), "Escape closes the chooser");
  } finally {
    app.destroy();
    process.env.PATH = previousPath;
  }
});
console.log(
  "[image-viewer/workflow] chooser open, recent, folder ←/→/buttons, wheel zoom about pointer, drag, +/-/0, Show in Files and broken image passed",
);

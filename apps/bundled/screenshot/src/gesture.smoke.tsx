import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import React from "react";
import * as ui from "@moire/ui";
import * as host from "@moire/react-host";
import { HeadlessPlatform, type HeadlessWindow } from "@moire/ui/testing";
import { PNG } from "pngjs";
import { ScreenshotApp } from "./main";
import { documentImage, emptyDocument, isDirty } from "./document";
import { cropBounds, type Bounds, type Edit, type Point } from "./image";
import { createHash } from "node:crypto";
import { scratchHome } from "./testing";

type Size = { width: number; height: number };
type Mode = Edit["kind"];
type Sequence =
  | "batched-move"
  | "release-endpoint-only"
  | "stationary"
  | "save-without-up"
  | "close-without-up";
type GestureCase = {
  scale: number;
  retained: boolean;
  size: Size;
  mode: Mode;
  sequence: Sequence;
};
type GestureRow = GestureCase & {
  canvas?: Bounds;
  sourceStart?: Point;
  sourceEnd?: Point;
  events?: Array<{ type: ui.UiPointerEvent["type"]; x: number; y: number }>;
  actualImage?: { width: number; height: number; sha256: string };
  edit?: Edit | null;
  revision?: number;
  baselineRevision?: number;
  capture?: ReturnType<typeof captureFrame>;
  previewUnchanged?: boolean;
  savedRevision?: number | null;
  closeBlocked?: boolean;
  undoRestored?: boolean;
};

const sandbox = scratchHome();
const requested = process.env.MOIRE_SCREENSHOT_GESTURE_CASE ?? "all";
assert.ok(["all", "release-endpoint-only", "stationary", "zero-model"].includes(requested));
const artifactDirectory =
  process.env.MOIRE_SCREENSHOT_GESTURE_ARTIFACTS === "1"
    ? fs.mkdtempSync(path.join(os.tmpdir(), "moire-screenshot-gesture-"))
    : null;
await ui.installUiFonts();
const image: ui.ImageData = {
  width: 1280,
  height: 800,
  rgba: new Uint8Array(1280 * 800 * 4),
};
for (let y = 0; y < image.height; y++) {
  for (let x = 0; x < image.width; x++) {
    image.rgba.set([x % 256, y % 256, (x + y) % 256, 255], (y * image.width + x) * 4);
  }
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const originalHash = sha(image.rgba);
function captureFrame(native: HeadlessWindow, size: Size, name: string) {
  if (!artifactDirectory) return null;
  assert.ok(native.lastFrame);
  const png = new PNG(size);
  for (let i = 0; i < native.lastFrame.length; i += 4) {
    png.data[i] = native.lastFrame[i + 2];
    png.data[i + 1] = native.lastFrame[i + 1];
    png.data[i + 2] = native.lastFrame[i];
    png.data[i + 3] = native.lastFrame[i + 3];
  }
  const captureDirectory = path.join(artifactDirectory, "captures");
  fs.mkdirSync(captureDirectory, { recursive: true });
  const file = path.join(captureDirectory, name + ".png");
  fs.writeFileSync(file, PNG.sync.write(png));
  return {
    file: path.relative(artifactDirectory, file),
    sha256: sha(fs.readFileSync(file)),
    width: size.width,
    height: size.height,
  };
}
function canvasHash(native: HeadlessWindow, size: Size, canvas: Bounds) {
  assert.ok(native.lastFrame);
  const left = Math.ceil(canvas.x),
    top = Math.ceil(canvas.y);
  const right = Math.floor(canvas.x + canvas.width),
    bottom = Math.floor(canvas.y + canvas.height);
  const hash = createHash("sha256");
  for (let y = top; y < bottom; y++) {
    hash.update(
      native.lastFrame.subarray((y * size.width + left) * 4, (y * size.width + right) * 4),
    );
  }
  return hash.digest("hex");
}
const rows: GestureRow[] = [];
let externalCalls = 0;
class RetainedCpuPlatform extends HeadlessPlatform {
  override createWindow(opts: ui.PlatformWindowOpts) {
    return Object.assign(super.createWindow(opts), {
      presentScene: () => false,
    });
  }
}
const pixel = (value: ui.ImageData, x: number, y: number) => {
  const offset = (Math.round(y) * value.width + Math.round(x)) * 4;
  return Array.from(value.rgba.subarray(offset, offset + 4));
};
const originalPixel = (x: number, y: number) => pixel(image, x, y);
const pointBounds = (start: Point, end: Point) => ({
  x: Math.floor(Math.min(start.x, end.x)),
  y: Math.floor(Math.min(start.y, end.y)),
  width: Math.ceil(Math.max(start.x, end.x)) - Math.floor(Math.min(start.x, end.x)),
  height: Math.ceil(Math.max(start.y, end.y)) - Math.floor(Math.min(start.y, end.y)),
});
const expectedSourcePoint = (canvas: Bounds, position: Point) => ({
  x: Math.max(0, Math.min(image.width - 1, ((position.x - canvas.x) * image.width) / canvas.width)),
  y: Math.max(
    0,
    Math.min(image.height - 1, ((position.y - canvas.y) * image.height) / canvas.height),
  ),
});
function checkClose(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
}
async function runCase({ scale, retained, size, mode, sequence }: GestureCase) {
  ui.setUiScaleFactor(scale);
  const { width, height } = size;
  const platform = retained ? new RetainedCpuPlatform() : new HeadlessPlatform();
  await platform.connect();
  const theme = ui.createPersonalizedWidgetTheme(
    ui.discoverPersonalization("linux", {
      themeFamily: "moire",
      colorScheme: "dark",
      reducedMotion: true,
      accent: "#b794f4",
    }),
  );
  const wrap = (tree: React.ReactNode) => (
    <ui.WidgetThemeProvider theme={theme}>{tree}</ui.WidgetThemeProvider>
  );
  const latest = { current: emptyDocument() };
  const saved: Array<{ value: ui.ImageData; target: string }> = [];
  const window = new ui.Window({
    title: "Excluded Screenshot gesture fixture",
    width,
    height,
  });
  const scene = host.createShellRoot();
  const events: NonNullable<GestureRow["events"]> = [];
  const row: GestureRow = { scale, retained, size, mode, sequence };
  try {
    window.setContent((allocation) =>
      wrap(
        <ScreenshotApp
          {...allocation}
          window={window}
          initialImage={image}
          initialOutput="/unused-excluded-gesture.png"
          onDocumentChange={(document) => {
            latest.current = document;
          }}
          capture={() => {
            externalCalls++;
            throw new Error("Fixture must not call capture");
          }}
          read={() => {
            externalCalls++;
            throw new Error("Fixture must not read user files");
          }}
          save={async (value, target) => {
            saved.push({ value, target });
          }}
        />,
      ),
    );
    window.mount(platform);
    await Promise.resolve();
    window.tick();
    const native = platform.getWindows()[0];
    assert.ok(native);
    // Independent production scene supplies layout coordinates only. All interaction goes
    // through the actual public Window and its mounted Screenshot component.
    host.renderShell(
      scene,
      wrap(
        <ScreenshotApp
          width={width}
          height={height}
          initialImage={image}
          initialOutput="/unused-layout.png"
        />,
      ),
    );
    const hits = host.collectHits(scene.container);
    const canvas = hits.find((hit) => hit.focusId === "screenshot-canvas");
    assert.ok(canvas);
    const pointer = (type: ui.UiPointerEvent["type"], position: Point) =>
      native.injectPointer({
        type,
        ...(type === "move" ? {} : { button: "left" as const }),
        ...position,
        timeMs: 1,
      });
    if (mode !== "crop") {
      const tab = hits.find(
        (hit) => hit.focusId?.startsWith("tabs:") && hit.focusId.endsWith(`:${mode}`),
      );
      assert.ok(tab);
      const position = { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 };
      pointer("down", position);
      pointer("up", position);
      window.tick();
    }
    native.onPointer((event) => events.push({ type: event.type, x: event.x, y: event.y }));
    const start = {
      x: canvas.x + canvas.width * 0.2123,
      y: canvas.y + canvas.height * 0.2417,
    };
    const end = {
      x: canvas.x + canvas.width * 0.7627,
      y: canvas.y + canvas.height * 0.7981,
    };
    const sourceStart = expectedSourcePoint(canvas, start);
    const sourceEnd = expectedSourcePoint(canvas, sequence === "stationary" ? start : end);
    const baselineCanvas = canvasHash(native, size, canvas);
    const baseline = latest.current;
    const baselineRevision = baseline.revision;
    assert.equal(baseline.edits.length, 0);
    const key = (code: number, key: string, ctrl = false) => {
      const modifiers = {
        shift: false,
        ctrl,
        alt: false,
        meta: false,
        capsLock: false,
        numLock: false,
      };
      native.injectKey({ type: "down", code, key, modifiers, timeMs: 1 });
      native.injectKey({ type: "up", code, key, modifiers, timeMs: 2 });
    };
    pointer("down", start);
    if (sequence !== "release-endpoint-only" && sequence !== "stationary") pointer("move", end);
    if (sequence === "save-without-up") {
      key(31, "s", true);
      await Promise.resolve();
      await Promise.resolve();
    } else if (sequence === "close-without-up") native.requestClose();
    else pointer("up", sequence === "stationary" ? start : end);
    // No tick/await between gesture callbacks. This tests actual synchronous Window routing.
    window.tick();
    await Promise.resolve();
    window.tick();
    const result = documentImage(latest.current);
    assert.ok(result);
    const edit = latest.current.edits.at(-1);
    row.canvas = {
      x: canvas.x,
      y: canvas.y,
      width: canvas.width,
      height: canvas.height,
    };
    row.sourceStart = sourceStart;
    row.sourceEnd = sourceEnd;
    row.events = events;
    row.actualImage = {
      width: result.width,
      height: result.height,
      sha256: sha(result.rgba),
    };
    row.edit = edit ?? null;
    row.revision = latest.current.revision;
    row.baselineRevision = baselineRevision;
    if (
      requested === "all" &&
      !retained &&
      ((width === 980 && scale === 1.5) || (width === 1280 && scale === 1))
    ) {
      row.capture = captureFrame(
        native,
        size,
        `${mode}-${sequence}-${width}x${height}-scale${scale}`,
      );
    }
    if (mode === "crop" && sequence === "stationary") {
      assert.equal(latest.current.revision, baselineRevision, "stationary crop preserves revision");
      assert.equal(
        latest.current.edits.length,
        0,
        "stationary crop cannot create a rounded 1x1 edit",
      );
      assert.equal(latest.current.undo.length, 0);
      assert.equal(row.actualImage.sha256, originalHash);
      assert.deepEqual([result.width, result.height], [image.width, image.height]);
      assert.equal(
        canvasHash(native, size, canvas),
        baselineCanvas,
        "stationary crop leaves actual preview unchanged",
      );
      row.previewUnchanged = true;
    } else {
      assert.equal(latest.current.revision, baselineRevision + 1);
      assert.equal(latest.current.edits.length, 1);
      assert.equal(latest.current.undo.length, 1);
      assert.ok(edit);
      assert.equal(edit.kind, mode === "rectangle" ? "rectangle" : mode);
      if (mode === "crop") {
        assert.ok(edit.kind === "crop");
        const bounds = pointBounds(sourceStart, sourceEnd);
        assert.deepEqual(edit.bounds, bounds, "crop uses final delivered pointer-up endpoint");
        assert.deepEqual([result.width, result.height], [bounds.width, bounds.height]);
        assert.deepEqual(pixel(result, 0, 0), originalPixel(bounds.x, bounds.y));
        assert.deepEqual(
          pixel(result, result.width - 1, result.height - 1),
          originalPixel(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1),
        );
      } else {
        assert.deepEqual([result.width, result.height], [image.width, image.height]);
        const expected = [255, 69, 58, 255];
        assert.deepEqual(pixel(result, sourceStart.x, sourceStart.y), expected);
        assert.deepEqual(
          pixel(result, sourceEnd.x, sourceEnd.y),
          expected,
          "annotation includes release endpoint",
        );
        assert.deepEqual(pixel(result, 0, 0), originalPixel(0, 0), "unannotated pixels preserved");
        if (mode === "pen") {
          assert.ok(edit.kind === "pen");
          assert.equal(
            edit.points.length,
            sequence === "stationary" ? 1 : 2,
            "release does not duplicate final pen point",
          );
          const last = edit.points.at(-1);
          assert.ok(last);
          checkClose(last.x, sourceEnd.x, "pen final x");
          checkClose(last.y, sourceEnd.y, "pen final y");
        } else {
          assert.ok(edit.kind === "rectangle");
          checkClose(edit.bounds.x, Math.min(sourceStart.x, sourceEnd.x), "box x");
          checkClose(edit.bounds.y, Math.min(sourceStart.y, sourceEnd.y), "box y");
          checkClose(edit.bounds.width, Math.abs(sourceEnd.x - sourceStart.x), "box width");
          checkClose(edit.bounds.height, Math.abs(sourceEnd.y - sourceStart.y), "box height");
        }
        // Actual software presentation must contain an opaque red sample at the annotation
        // start. Headless lastFrame is BGRA, not the document's RGBA. The start is snapped to a
        // source pixel and scaled back to the preview, so allow one screen pixel either way.
        const frame = native.lastFrame;
        assert.ok(frame);
        const screenX = Math.round(start.x),
          screenY = Math.round(start.y);
        const red = [-1, 0, 1].some((dy) =>
          [-1, 0, 1].some((dx) => {
            const offset = ((screenY + dy) * width + screenX + dx) * 4;
            return (
              Array.from(frame.subarray(offset, offset + 4)).join() === [58, 69, 255, 255].join()
            );
          }),
        );
        assert.ok(red, "presented frame shows the annotation at its start");
      }
      if (sequence === "save-without-up") {
        assert.equal(
          saved.length,
          1,
          "parameterless Save commits the pending gesture exactly once",
        );
        assert.equal(sha(saved[0].value.rgba), row.actualImage.sha256);
        assert.equal(isDirty(latest.current), false);
        pointer("up", end);
        window.tick();
        assert.equal(
          latest.current.edits.length,
          1,
          "later release cannot duplicate a Save-committed gesture",
        );
        row.savedRevision = latest.current.savedRevision;
      } else if (sequence === "close-without-up") {
        assert.equal(window.isClosed(), false, "dirty close stays open");
        assert.equal(saved.length, 0);
        assert.equal(isDirty(latest.current), true);
        pointer("up", end);
        window.tick();
        assert.equal(
          latest.current.edits.length,
          1,
          "later release cannot duplicate a close-committed gesture",
        );
        row.closeBlocked = true;
      } else {
        key(44, "z", true);
        window.tick();
        const restored = documentImage(latest.current);
        assert.ok(restored);
        assert.equal(latest.current.revision, baselineRevision, "canvas Ctrl+Z restores revision");
        assert.equal(latest.current.edits.length, 0);
        assert.equal(latest.current.undo.length, 0);
        assert.equal(
          sha(restored.rgba),
          originalHash,
          "canvas Ctrl+Z restores exact source pixels",
        );
        assert.equal(
          canvasHash(native, size, canvas),
          baselineCanvas,
          "Undo restores actual preview pixels without selection overlay",
        );
        row.undoRestored = true;
      }
    }
    rows.push(row);
  } finally {
    host.renderShell(scene, null);
    window.destroy();
    platform.disconnect();
  }
}
if (requested !== "zero-model") {
  for (const scale of [1, 1.5]) {
    for (const retained of [false, true]) {
      for (const mode of ["crop", "pen", "rectangle"] as const) {
        for (const sequence of ["batched-move", "release-endpoint-only", "stationary"] as const) {
          if (requested !== "all" && (mode !== "crop" || sequence !== requested)) continue;
          await runCase({
            scale,
            retained,
            mode,
            sequence,
            size: { width: 980, height: 720 },
          });
        }
      }
      if (requested === "all") {
        for (const sequence of ["batched-move", "release-endpoint-only", "stationary"] as const) {
          await runCase({
            scale,
            retained,
            mode: "crop",
            sequence,
            size: { width: 1280, height: 800 },
          });
        }
        for (const sequence of ["save-without-up", "close-without-up"] as const) {
          await runCase({
            scale,
            retained,
            mode: "crop",
            sequence,
            size: { width: 980, height: 720 },
          });
        }
      }
    }
  }
}
const invalidBounds = [
  { x: 271.744, y: 193.36, width: 0, height: 0 },
  { x: 271.744, y: 193.36, width: 0, height: 40 },
  { x: 271.744, y: 193.36, width: 40, height: 0 },
  { x: 271.744, y: 193.36, width: -0.01, height: 0.01 },
];
for (const bounds of invalidBounds) {
  assert.throws(() => cropBounds(image, bounds), /positive width and height/);
}
assert.deepEqual(
  cropBounds(image, { x: 271.744, y: 193.36, width: 0.01, height: 0.01 }),
  { x: 271, y: 193, width: 1, height: 1 },
  "valid subpixel positive crop retains floor/ceil behavior",
);
assert.equal(externalCalls, 0);
assert.equal(sha(image.rgba), originalHash, "source image never mutated");
const report = {
  scope:
    "Production Screenshot public Window/direct and retained CPU Headless gesture fixture; no native/Wayland/capture/files claim",
  requested,
  cases: rows.length,
  invalidBounds,
  externalCalls,
  originalHash,
  rows,
};
if (artifactDirectory) {
  fs.writeFileSync(
    path.join(artifactDirectory, "results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify(
    {
      scope: report.scope,
      requested,
      cases: rows.length,
      externalCalls,
      artifactDirectory,
    },
    null,
    2,
  ),
);
sandbox.restore();

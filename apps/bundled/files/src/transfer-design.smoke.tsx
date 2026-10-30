import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { PNG } from "pngjs";
import {
  Window,
  TextBlock,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  getUiScaleFactor,
  type ButtonVariant,
  type WidgetTheme,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { FileOperations } from "@moire/file-operations";
import { executeTransfer, transferOutcomeNotice, transferRequest } from "./transfer-outcome";
const sourceRoot = process.env.MOIRE_TEST_ROOT;
const { TransferDialog }: typeof import("./transfer-dialog") = sourceRoot
  ? await import(
      pathToFileURL(path.join(sourceRoot, "apps/bundled/files/src/transfer-dialog.tsx")).href
    )
  : await import("./transfer-dialog");

class RetainedCpuPlatform extends HeadlessPlatform {
  override createWindow(options: Parameters<HeadlessPlatform["createWindow"]>[0]) {
    const native = super.createWindow(options);
    native.presentScene = () => false;
    return native;
  }
}

/** Check enclosed letter counters, excluding exterior space that focus decoration can legitimately paint. */
function letterCounters(
  pixels: Uint8Array,
  width: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
): Array<[number, number]> {
  const exterior = new Set<number>();
  const pending: number[] = [];
  const enqueue = (x: number, y: number) => {
    if (x < left || x > right || y < top || y > bottom) return;
    const at = y * width + x;
    if (exterior.has(at) || pixels[at * 4 + 3] !== 0) return;
    exterior.add(at);
    pending.push(at);
  };
  for (let x = left; x <= right; x++) {
    enqueue(x, top);
    enqueue(x, bottom);
  }
  for (let y = top; y <= bottom; y++) {
    enqueue(left, y);
    enqueue(right, y);
  }
  while (pending.length) {
    const at = pending.pop()!;
    const x = at % width,
      y = Math.floor(at / width);
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }
  const counters: Array<[number, number]> = [];
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++)
      if (pixels[(y * width + x) * 4 + 3] === 0 && !exterior.has(y * width + x))
        counters.push([x, y]);
  return counters;
}

type GlyphProbe = { points: Array<[number, number]>; holes: Array<[number, number]> };
type GlyphMode = "body" | "control";
const glyphCache = new Map<string, GlyphProbe>();

function glyphMatches(
  frame: Uint8Array,
  width: number,
  height: number,
  rgb: readonly number[],
  glyph: GlyphProbe,
  x: number,
  y: number,
): boolean {
  const [firstX, firstY] = glyph.points[0]!;
  const inside = (xx: number, yy: number) => xx >= 0 && xx < width && yy >= 0 && yy < height;
  return (
    glyph.points.every(([px, py]) => {
      const xx = x + px - firstX,
        yy = y + py - firstY;
      return inside(xx, yy) && rgb.every((c, i) => frame[(yy * width + xx) * 4 + i] === c);
    }) &&
    glyph.holes.every(([px, py]) => {
      const xx = x + px - firstX,
        yy = y + py - firstY;
      return inside(xx, yy) && rgb.some((c, i) => frame[(yy * width + xx) * 4 + i] !== c);
    })
  );
}

/** Independent full-glyph oracle, including all wrapped lines, rather than a pixel-change assertion. */
function locateText(
  backend: HeadlessPlatform,
  frame: Uint8Array,
  width: number,
  height: number,
  theme: WidgetTheme,
  text: string,
  style: { fontSize: number; fontWeight?: "regular" | "medium" | "bold"; color: number },
  probeWidth = width,
  mode: GlyphMode = "body",
) {
  const rgb = [style.color & 255, (style.color >>> 8) & 255, (style.color >>> 16) & 255];
  const cacheKey = JSON.stringify({ text, style, probeWidth, mode, scale: getUiScaleFactor() });
  let glyph = glyphCache.get(cacheKey);
  if (!glyph) {
    const probeHeight = Math.round(180 * getUiScaleFactor());
    const probe = new Window({
      title: "Transfer text oracle",
      width: probeWidth,
      height: probeHeight,
      decorated: false,
    });
    probe.setContent(
      <WidgetThemeProvider theme={theme}>
        <TextBlock width={probeWidth} height={probeHeight} text={text} {...style} wrap />
      </WidgetThemeProvider>,
    );
    probe.mount(backend);
    probe.tick();
    const pixels = backend.getWindows().at(-1)!.lastFrame!;
    const points: Array<[number, number]> = [];
    for (let y = 0; y < probeHeight; y++)
      for (let x = 0; x < probeWidth; x++) {
        const at = (y * probeWidth + x) * 4;
        if (
          pixels[at + 3] === 255 &&
          pixels[at] === rgb[0] &&
          pixels[at + 1] === rgb[1] &&
          pixels[at + 2] === rgb[2]
        )
          points.push([x, y]);
      }
    assert.ok(points.length > 4, `independent ${text} oracle paints actual glyphs`);
    const left = Math.min(...points.map(([x]) => x)),
      right = Math.max(...points.map(([x]) => x));
    const top = Math.min(...points.map(([, y]) => y)),
      bottom = Math.max(...points.map(([, y]) => y));
    // Ordinary text has no focus decoration and may have no enclosed counters
    // (for example EXISTING). Controls exclude exterior gaps painted by focus.
    const holes: Array<[number, number]> =
      mode === "control" ? letterCounters(pixels, probeWidth, left, right, top, bottom) : [];
    if (mode === "body")
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++)
          if (pixels[(y * probeWidth + x) * 4 + 3] === 0) holes.push([x, y]);
    assert.ok(holes.length > 2, `${mode} ${text} oracle has meaningful transparent negatives`);
    glyph = { points, holes };
    const [anchorX, anchorY] = points[0]!;
    // Exercise the same predicate used to locate labels against actual probe ink,
    // a foreground-colored solid block and an otherwise complete missing stroke.
    assert.ok(
      glyphMatches(pixels, probeWidth, probeHeight, rgb, glyph, anchorX, anchorY),
      `${mode} ${text} probe matches its full glyphs`,
    );
    const solid = pixels.slice();
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) solid.set([...rgb, 255], (y * probeWidth + x) * 4);
    assert.equal(
      glyphMatches(solid, probeWidth, probeHeight, rgb, glyph, anchorX, anchorY),
      false,
      `${mode} ${text} rejects an actual same-color solid rectangle`,
    );
    const missing = pixels.slice();
    const [missingX, missingY] = points[Math.floor(points.length / 2)]!;
    missing[(missingY * probeWidth + missingX) * 4] = (rgb[0]! + 127) % 256;
    assert.equal(
      glyphMatches(missing, probeWidth, probeHeight, rgb, glyph, anchorX, anchorY),
      false,
      `${mode} ${text} rejects a missing full-ink sample`,
    );
    probe.destroy();
    glyphCache.set(cacheKey, glyph);
  }
  const { points } = glyph;
  const [fx, fy] = points[0]!;
  const firstBoundX = Math.min(...points.map(([x]) => x)),
    lastX = Math.max(...points.map(([x]) => x)),
    firstBoundY = Math.min(...points.map(([, y]) => y)),
    lastY = Math.max(...points.map(([, y]) => y));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (frame[at] !== rgb[0] || frame[at + 1] !== rgb[1] || frame[at + 2] !== rgb[2]) continue;
      if (glyphMatches(frame, width, height, rgb, glyph, x, y))
        return { x: x + (firstBoundX + lastX) / 2 - fx, y: y + (firstBoundY + lastY) / 2 - fy };
    }
  return null;
}
function fillBounds(
  frame: Uint8Array,
  width: number,
  height: number,
  point: { x: number; y: number },
  fill: number,
  radius: number,
) {
  const matches = (index: number) =>
    frame[index * 4] === (fill & 255) &&
    frame[index * 4 + 1] === ((fill >>> 8) & 255) &&
    frame[index * 4 + 2] === ((fill >>> 16) & 255);
  let seed: number | undefined;
  for (
    let y = Math.max(0, Math.floor(point.y - radius));
    y < Math.min(height, point.y + radius);
    y++
  )
    for (
      let x = Math.max(0, Math.floor(point.x - radius));
      x < Math.min(width, point.x + radius);
      x++
    )
      if (matches(y * width + x)) seed ??= y * width + x;
  assert.notEqual(seed, undefined, "label must belong to actual painted primary control fill");
  const pending = [seed!],
    visited = new Set<number>();
  let left = width,
    right = 0,
    top = height,
    bottom = 0;
  while (pending.length) {
    const at = pending.pop()!;
    if (visited.has(at) || !matches(at)) continue;
    visited.add(at);
    const x = at % width,
      y = Math.floor(at / width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    if (x > 0) pending.push(at - 1);
    if (x < width - 1) pending.push(at + 1);
    if (y > 0) pending.push(at - width);
    if (y < height - 1) pending.push(at + width);
  }
  assert.ok(
    point.x >= left && point.x <= right && point.y >= top && point.y <= bottom,
    "complete glyph center lies inside connected primary control pixels",
  );
  return { left, right, top, bottom };
}

async function capture(name: string, frame: Uint8Array, width: number, height: number) {
  if (!process.env.MOIRE_CAPTURE_DIR) return;
  await fs.mkdir(process.env.MOIRE_CAPTURE_DIR, { recursive: true });
  const png = new PNG({ width, height });
  for (let at = 0; at < frame.length; at += 4)
    png.data.set([frame[at + 2]!, frame[at + 1]!, frame[at]!, frame[at + 3]!], at);
  await fs.writeFile(path.join(process.env.MOIRE_CAPTURE_DIR, `${name}.png`), PNG.sync.write(png));
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "moire-transfer-design-"));
let cases = 0;
await installUiFonts();
try {
  const source = path.join(root, "Source projects and reference documents"),
    destination = path.join(root, "Archive design documents");
  await fs.mkdir(source);
  await fs.mkdir(destination);
  const incoming = path.join(source, "brand-guidelines.pdf"),
    existing = path.join(destination, "brand-guidelines.pdf");
  await fs.writeFile(incoming, "Incoming original bytes");
  await fs.writeFile(existing, "Existing protected bytes of a different size");
  const operations = new FileOperations(path.join(root, "Trash"));
  const allSkipped = await executeTransfer({
    operations,
    kind: "move",
    sources: [incoming],
    directory: destination,
    signal: new AbortController().signal,
    report: () => {},
    resolveConflict: async () => "skip",
  });
  const complete = await executeTransfer({
    operations,
    kind: "copy",
    sources: [incoming],
    directory: destination,
    signal: new AbortController().signal,
    report: () => {},
    resolveConflict: async () => "keep-both",
  });
  const failed = await executeTransfer({
    operations,
    kind: "move",
    sources: [path.join(source, "missing.txt")],
    directory: destination,
    signal: new AbortController().signal,
    report: () => {},
    resolveConflict: async () => "skip",
  });
  const empty = path.join(source, "zero-byte.txt"),
    emptyFolder = path.join(source, "empty-directory");
  await fs.writeFile(empty, "");
  await fs.mkdir(emptyFolder);
  const advancingSource = path.join(source, "intermediate-copy.bin");
  await fs.writeFile(advancingSource, Buffer.alloc(4 * 1024 * 1024, 91));
  const longName = "long-file-name-".repeat(10) + ".txt";
  const longSource = path.join(source, longName),
    longDestination = path.join(destination, longName);
  await fs.writeFile(longSource, "Long incoming bytes");
  await fs.writeFile(longDestination, "Long existing bytes");
  for (const rendering of ["direct", "retained-cpu"] as const)
    for (const scheme of ["light", "dark"] as const)
      for (const shape of ["wide", "compact"] as const)
        for (const scale of [1, 1.5]) {
          if (
            process.argv.includes("--quick") &&
            (rendering !== "direct" || scheme !== "dark" || scale !== 1)
          )
            continue;
          const representative =
            (rendering === "direct" && scheme === "dark" && shape === "wide" && scale === 1) ||
            (rendering === "retained-cpu" &&
              scheme === "light" &&
              shape === "compact" &&
              scale === 1.5);
          const progressOnly = process.argv.includes("--progress-only");
          if (progressOnly && !representative) continue;
          setUiScaleFactor(scale);
          const theme = createPersonalizedWidgetTheme(
            discoverPersonalization("linux", {
              themeFamily: "moire",
              colorScheme: scheme,
              reducedMotion: true,
            }),
          );
          const pal = theme.foundations.palette;
          const width = Math.round((shape === "wide" ? 1280 : 420) * scale),
            height = Math.round((shape === "wide" ? 800 : 448) * scale);
          const backend =
            rendering === "direct" ? new HeadlessPlatform() : new RetainedCpuPlatform();
          await backend.connect();
          const window = new Window({
            title: "Approved static transfer",
            width,
            height,
            decorated: false,
          });
          const native = () => backend.getWindows()[0]!;
          const settle = async () => {
            for (let n = 0; n < 5; n++) {
              await new Promise((r) => setTimeout(r, 10));
              window.tick();
            }
          };
          const key = (code: number, name: string, shift = false) => {
            const modifiers = { ctrl: false, shift, alt: false, meta: false };
            native().injectKey({ type: "down", code, key: name, modifiers, timeMs: Date.now() });
            native().injectKey({ type: "up", code, key: name, modifiers, timeMs: Date.now() });
            window.tick();
          };
          const button = (label: string, variant: ButtonVariant) => {
            const style = theme.recipes.button[variant].medium.label.base;
            const found = locateText(
              backend,
              native().lastFrame!,
              width,
              height,
              theme,
              label,
              style,
              width,
              "control",
            );
            assert.ok(
              found,
              `${label} complete glyphs initially visible: ${rendering}/${scheme}/${shape}/${scale}`,
            );
            return found;
          };
          const click = (point: { x: number; y: number }) => {
            native().injectPointer({ type: "down", button: "left", ...point, timeMs: Date.now() });
            native().injectPointer({
              type: "up",
              button: "left",
              ...point,
              timeMs: Date.now() + 1,
            });
            window.tick();
          };
          let cancels = 0,
            dismissals = 0,
            reveals = 0;
          const choices: string[] = [];
          const callbacks = {
            onCancel: () => {
              cancels++;
            },
            onDismiss: () => {
              dismissals++;
            },
            onShowInFolder: () => {
              reveals++;
            },
          };
          const request = transferRequest([incoming], destination);
          const value = {
            kind: "move" as const,
            request,
            outcome: "running" as const,
            progress: {
              done: 0,
              total: 1,
              skipped: 0,
              name: path.basename(incoming),
              phase: "waiting" as const,
              source: incoming,
              destination: existing,
            },
          };
          const conflict = {
            source: incoming,
            destination: existing,
            choose: (choice: string) => choices.push(choice),
          };
          const render = (content: React.ReactNode) =>
            window.setContent(<WidgetThemeProvider theme={theme}>{content}</WidgetThemeProvider>);
          try {
            if (!progressOnly) {
              render(
                <TransferDialog
                  width={width}
                  height={height}
                  value={value}
                  conflict={conflict}
                  {...callbacks}
                />,
              );
              window.mount(backend);
              await settle();
              const initial = native().lastFrame!.slice();
              const cancel = button("Cancel transfer", "secondary"),
                skip = button("Skip this item", "secondary"),
                keep = button("Keep both", "primary");
              const keepBounds = fillBounds(
                initial,
                width,
                height,
                keep,
                theme.recipes.button.primary.medium.root.base.fill,
                10 * scale,
              );
              assert.ok(
                keepBounds.right - keepBounds.left >= 60 * scale &&
                  keepBounds.bottom - keepBounds.top >=
                    theme.recipes.button.primary.medium.metrics.height - 4 * scale,
                "actual painted primary control has full allocated width and height",
              );
              await capture(
                `conflict-${rendering}-${scheme}-${shape}-${scale}`,
                initial,
                width,
                height,
              );
              const incomingLabel = locateText(backend, initial, width, height, theme, "INCOMING", {
                fontSize: 11,
                color: pal.muted,
              });
              assert.ok(incomingLabel, "actual incoming card is painted");
              if (shape === "wide") {
                const existingLabel = locateText(
                  backend,
                  initial,
                  width,
                  height,
                  theme,
                  "EXISTING",
                  {
                    fontSize: 11,
                    color: pal.muted,
                  },
                );
                assert.ok(existingLabel);
                assert.equal(
                  existingLabel.y,
                  incomingLabel.y,
                  "wide comparisons share the same row",
                );
              }
              key(15, "Tab", true);
              key(28, "Enter");
              assert.deepEqual(
                choices,
                ["keep-both"],
                "reverse traversal from header reaches visible primary callback",
              );
              await settle();
              const focused = native().lastFrame!;
              await capture(
                `primary-focused-${rendering}-${scheme}-${shape}-${scale}`,
                focused,
                width,
                height,
              );
              let ringChanges = 0;
              for (let y = keepBounds.top; y < keepBounds.bottom + 1; y++)
                for (let x = keepBounds.left; x < keepBounds.right + 1; x++) {
                  const at = (y * width + x) * 4;
                  if (
                    focused[at] !== initial[at] ||
                    focused[at + 1] !== initial[at + 1] ||
                    focused[at + 2] !== initial[at + 2]
                  )
                    ringChanges++;
                }
              assert.ok(
                ringChanges > 10,
                `actual primary focus changes pixels in its own visible control bounds: ${JSON.stringify({ keep, ringChanges, width, height })}`,
              );
              key(15, "Tab");
              key(15, "Tab");
              key(57, " ");
              assert.equal(cancels, 1);
              key(15, "Tab");
              key(28, "Enter");
              assert.deepEqual(choices, ["keep-both", "skip"]);
              key(1, "Escape");
              assert.equal(cancels, 2);
              click(cancel);
              click(skip);
              click(keep);
              assert.equal(cancels, 3);
              assert.deepEqual(choices, ["keep-both", "skip", "skip", "keep-both"]);
              cases++;

              // Replace a pending read without waiting for I/O. Only the latest conflict's observation may paint.
              const stale = { source: incoming, destination: existing, choose: () => {} };
              render(
                <TransferDialog
                  width={width}
                  height={height}
                  value={value}
                  conflict={stale}
                  {...callbacks}
                />,
              );
              window.tick();
              const missing = {
                source: path.join(source, "unavailable.txt"),
                destination: path.join(destination, "unavailable.txt"),
                choose: () => {},
              };
              render(
                <TransferDialog
                  width={width}
                  height={height}
                  value={value}
                  conflict={missing}
                  {...callbacks}
                />,
              );
              await settle();
              assert.ok(
                locateText(
                  backend,
                  native().lastFrame!,
                  width,
                  height,
                  theme,
                  "Metadata unavailable",
                  { fontSize: 13, color: pal.muted },
                ),
                "missing current conflict metadata is explicit and does not display old bytes",
              );
              button("Keep both", "primary");
              await capture(
                `unavailable-${rendering}-${scheme}-${shape}-${scale}`,
                native().lastFrame!,
                width,
                height,
              );
              cases++;

              // Real long-filename observations force compact details to scroll while actions stay still.
              render(
                <TransferDialog
                  width={width}
                  height={height}
                  value={value}
                  conflict={{ source: longSource, destination: longDestination, choose: () => {} }}
                  {...callbacks}
                />,
              );
              await settle();
              const longFooter = button("Keep both", "primary");
              const beforeScroll = native().lastFrame!.slice();
              native().injectPointer({
                type: "wheel",
                x: width / 2,
                y: height / 2,
                deltaY: height * 2,
                timeMs: Date.now(),
              });
              window.tick();
              await settle();
              assert.deepEqual(
                button("Keep both", "primary"),
                longFooter,
                "real long-filename detail scroll cannot move or hide the primary footer",
              );
              if (shape === "compact")
                assert.notDeepEqual(
                  native().lastFrame,
                  beforeScroll,
                  "actual overflowing comparison cards scroll independently of the fixed footer",
                );
              await capture(
                `long-path-scrolled-${rendering}-${scheme}-${shape}-${scale}`,
                native().lastFrame!,
                width,
                height,
              );
              cases++;
            }
            if (progressOnly) {
              render(<TextBlock text="Real operation capture" />);
              window.mount(backend);
            }
            if (representative) {
              // Capture actual running reports and activate actual Cancel through the Window.
              for (const item of [incoming, empty, emptyFolder]) {
                const liveDirectory = await fs.mkdtemp(path.join(root, "live-copy-"));
                const liveRequest = transferRequest([item], liveDirectory);
                const controller = new AbortController();
                let runningFrame: Uint8Array | undefined, preparingFrame: Uint8Array | undefined;
                const live = await executeTransfer({
                  operations,
                  kind: "copy",
                  sources: [item],
                  directory: liveDirectory,
                  signal: controller.signal,
                  report: (progress) => {
                    if (progress.phase === "preparing") {
                      render(
                        <TransferDialog
                          width={width}
                          height={height}
                          value={{
                            kind: "copy",
                            request: liveRequest,
                            outcome: "running",
                            progress,
                          }}
                          conflict={null}
                          onCancel={() => controller.abort()}
                          onDismiss={() => {}}
                        />,
                      );
                      window.tick();
                      preparingFrame = native().lastFrame!.slice();
                      assert.ok(
                        locateText(
                          backend,
                          preparingFrame,
                          width,
                          height,
                          theme,
                          "Preparing: counting files and checking the destination…",
                          { fontSize: 13, color: pal.muted },
                        ),
                        "actual preparing report paints preparation text without an invented percentage",
                      );
                    }
                    if (runningFrame || progress.phase !== "copying" || progress.done !== 0) return;
                    render(
                      <TransferDialog
                        width={width}
                        height={height}
                        value={{ kind: "copy", request: liveRequest, outcome: "running", progress }}
                        conflict={null}
                        onCancel={() => controller.abort()}
                        onDismiss={() => {}}
                      />,
                    );
                    window.tick();
                    runningFrame = native().lastFrame!.slice();
                    const expectedLabel =
                      item === incoming ? "0% of planned bytes copied" : "0% of items resolved";
                    assert.ok(
                      locateText(backend, runningFrame, width, height, theme, expectedLabel, {
                        fontSize: 18,
                        color: pal.text,
                      }),
                      "real zero-byte/empty-directory reports use the same item denominator and label",
                    );
                    click(button("Cancel transfer", "secondary"));
                  },
                  resolveConflict: async () => "skip",
                });
                assert.ok(
                  runningFrame,
                  "actual operation emitted a real running frame before cancellation",
                );
                if (item === incoming) {
                  assert.ok(preparingFrame);
                  await capture(
                    `preparing-copy-${rendering}-${scheme}-${shape}-${scale}`,
                    preparingFrame,
                    width,
                    height,
                  );
                }
                assert.equal(live.state, "cancelled");
                assert.equal(live.progress.done, 0);
                assert.equal(live.progress.committedBytes, 0);
                assert.deepEqual(
                  await fs.readdir(liveDirectory),
                  [],
                  "Window Cancel removes only this actual private unfinished copy",
                );
                await capture(
                  `running-${item === incoming ? "bytes" : item === empty ? "zero-byte" : "empty-directory"}-${rendering}-${scheme}-${shape}-${scale}`,
                  runningFrame,
                  width,
                  height,
                );
                cases++;
              }

              const advancingDirectory = await fs.mkdtemp(path.join(root, "advancing-target-"));
              const advancingRequest = transferRequest([advancingSource], advancingDirectory);
              const advancingAbort = new AbortController();
              let advancingFrame: Uint8Array | undefined;
              const advancing = await executeTransfer({
                operations,
                kind: "copy",
                sources: [advancingSource],
                directory: advancingDirectory,
                signal: advancingAbort.signal,
                report: (progress) => {
                  if (
                    advancingFrame ||
                    progress.phase !== "copying" ||
                    !progress.bytes ||
                    !progress.bytesTotal ||
                    progress.bytes >= progress.bytesTotal
                  )
                    return;
                  const staging = readdirSync(advancingDirectory).find((name) =>
                    name.startsWith(".moire-transfer-"),
                  );
                  assert.ok(staging);
                  assert.equal(
                    statSync(path.join(advancingDirectory, staging, "item")).size,
                    progress.bytes,
                    "positive progress corresponds to actual bytes already written to private staging",
                  );
                  render(
                    <TransferDialog
                      width={width}
                      height={height}
                      value={{
                        kind: "copy",
                        request: advancingRequest,
                        outcome: "running",
                        progress,
                      }}
                      conflict={null}
                      onCancel={() => advancingAbort.abort()}
                      onDismiss={() => {}}
                    />,
                  );
                  window.tick();
                  advancingFrame = native().lastFrame!.slice();
                  assert.ok(
                    locateText(
                      backend,
                      advancingFrame,
                      width,
                      height,
                      theme,
                      `${Math.round((progress.bytes / progress.bytesTotal) * 100)}% of planned bytes copied`,
                      { fontSize: 18, color: pal.text },
                    ),
                    "actual positive intermediate bytes advance the percentage/bar presentation",
                  );
                  click(button("Cancel transfer", "secondary"));
                },
                resolveConflict: async () => "skip",
              });
              assert.ok(advancingFrame);
              assert.equal(advancing.state, "cancelled");
              assert.equal(advancing.progress.committedBytes, 0);
              assert.equal(advancing.progress.done, 0);
              assert.deepEqual(await fs.readdir(advancingDirectory), []);
              assert.equal((await fs.stat(advancingSource)).size, 4 * 1024 * 1024);
              await capture(
                `running-positive-bytes-${rendering}-${scheme}-${shape}-${scale}`,
                advancingFrame,
                width,
                height,
              );
              cases++;

              const movingSource = path.join(
                await fs.mkdtemp(path.join(root, "move-source-")),
                "actual-move.txt",
              );
              const movingDirectory = await fs.mkdtemp(path.join(root, "move-target-"));
              const validatedMoveDirectory = await fs.realpath(movingDirectory);
              await fs.writeFile(movingSource, "Actual published move bytes");
              const moveRequest = transferRequest([movingSource], movingDirectory);
              let movingFrame: Uint8Array | undefined, movePreparing: Uint8Array | undefined;
              const moveAbort = new AbortController();
              const moved = await executeTransfer({
                operations,
                kind: "move",
                sources: [movingSource],
                directory: movingDirectory,
                signal: moveAbort.signal,
                report: (progress) => {
                  if (progress.phase === "preparing" && !movePreparing) {
                    render(
                      <TransferDialog
                        width={width}
                        height={height}
                        value={{ kind: "move", request: moveRequest, outcome: "running", progress }}
                        conflict={null}
                        onCancel={() => moveAbort.abort()}
                        onDismiss={() => {}}
                      />,
                    );
                    window.tick();
                    movePreparing = native().lastFrame!.slice();
                  }
                  if (progress.phase === "moving" && progress.done === 0 && !movingFrame) {
                    render(
                      <TransferDialog
                        width={width}
                        height={height}
                        value={{ kind: "move", request: moveRequest, outcome: "running", progress }}
                        conflict={null}
                        onCancel={() => moveAbort.abort()}
                        onDismiss={() => {}}
                      />,
                    );
                    window.tick();
                    movingFrame = native().lastFrame!.slice();
                    assert.equal(progress.source, movingSource);
                    assert.equal(progress.validatedDirectory, validatedMoveDirectory);
                    assert.ok(
                      locateText(
                        backend,
                        movingFrame,
                        width,
                        height,
                        theme,
                        "0% of items resolved",
                        {
                          fontSize: 18,
                          color: pal.text,
                        },
                      ),
                      "actual Move uses real item progress, never invented rename throughput or ETA",
                    );
                    button("Cancel transfer", "secondary");
                  }
                },
                resolveConflict: async () => "skip",
              });
              assert.equal(moved.state, "complete");
              assert.equal(moved.progress.done, 1);
              assert.equal(
                await fs.readFile(path.join(movingDirectory, "actual-move.txt"), "utf8"),
                "Actual published move bytes",
              );
              assert.ok(movingFrame && movePreparing);
              await capture(
                `moving-${rendering}-${scheme}-${shape}-${scale}`,
                movingFrame,
                width,
                height,
              );
              await capture(
                `preparing-move-${rendering}-${scheme}-${shape}-${scale}`,
                movePreparing,
                width,
                height,
              );
              cases++;
            }
            if (!progressOnly)
              for (const result of [complete, allSkipped, failed]) {
                render(
                  <TransferDialog
                    width={width}
                    height={height}
                    value={{
                      kind: result.kind,
                      request: result.request,
                      outcome: result.state === "complete" ? "complete" : "stopped",
                      progress: result.progress,
                      result,
                      message: transferOutcomeNotice(result),
                    }}
                    conflict={null}
                    {...callbacks}
                  />,
                );
                await settle();
                const done = button("Done", "primary"),
                  show = button("Show in folder", "secondary");
                const terminal = native().lastFrame!.slice();
                const seconds = Math.floor(result.elapsedMs / 1000);
                const elapsed =
                  seconds < 1
                    ? "Elapsed less than a second"
                    : `Elapsed ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
                const elapsedBefore = locateText(backend, terminal, width, height, theme, elapsed, {
                  fontSize: 13,
                  color: pal.muted,
                });
                assert.ok(
                  elapsedBefore,
                  "complete settled duration is naturally allocated and painted",
                );
                const folderWidth =
                  Math.min(width - 8, 560 * scale) -
                  theme.recipes.dialog.medium.metrics.bodyPaddingX * 2 -
                  60 * scale -
                  theme.foundations.space.sm * 2;
                assert.ok(
                  locateText(
                    backend,
                    terminal,
                    width,
                    height,
                    theme,
                    result.progress.validatedDirectory!,
                    { fontSize: 13, color: pal.text },
                    folderWidth,
                  ),
                  "every glyph of the complete real destination path wraps within its actual allocation",
                );
                await new Promise((r) => setTimeout(r, 35));
                window.tick();
                if (elapsedBefore)
                  assert.deepEqual(
                    locateText(backend, native().lastFrame!, width, height, theme, elapsed, {
                      fontSize: 13,
                      color: pal.muted,
                    }),
                    elapsedBefore,
                    "the complete elapsed glyphs stay fixed despite later renders and ordinary control focus paint",
                  );
                await capture(
                  `${result === allSkipped ? "all-skipped" : result === failed ? "failed" : "complete"}-${rendering}-${scheme}-${shape}-${scale}`,
                  terminal,
                  width,
                  height,
                );
                const oldDismissals = dismissals,
                  oldReveals = reveals;
                click(show);
                click(done);
                assert.equal(reveals, oldReveals + 1);
                assert.equal(dismissals, oldDismissals + 1);
                key(1, "Escape");
                assert.equal(dismissals, oldDismissals + 2);
                cases++;
              }
          } finally {
            window.destroy();
            backend.disconnect();
          }
        }
  console.log(
    JSON.stringify({
      kind: "transfer-approved-static-window",
      cases,
      mode: process.argv.includes("--progress-only")
        ? "representative-real-progress"
        : process.argv.includes("--quick")
          ? "quick-dark-direct-scale1"
          : "full",
      source: sourceRoot ?? "workspace",
      scope:
        "actual public Window direct and retained CPU, light/dark, compact/wide and scales, full footer glyphs/callbacks, reverse/forward focus, missing/stale metadata, real preparation/move and advancing copy chunk metrics, zero-byte/empty-directory copy cancellation, long-path stationary footer and immutable terminal elapsed glyphs; no native delivery claim",
    }),
  );
} finally {
  setUiScaleFactor(1);
  await fs.rm(root, { recursive: true, force: true });
}

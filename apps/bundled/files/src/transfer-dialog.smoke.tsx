import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { PNG } from "pngjs";
import {
  Window,
  THEME_FAMILIES,
  TextBlock,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type ButtonVariant,
  type WidgetTheme,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";

const source = process.env.MOIRE_TEST_ROOT;
const { TransferDialog }: typeof import("./transfer-dialog") = source
  ? await import(
      pathToFileURL(path.join(source, "apps/bundled/files/src/transfer-dialog.tsx")).href
    )
  : await import("./transfer-dialog");

/** Exercise the real Window fallback used when Wayland presentScene declines acceleration. */
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

function locateLabel(
  backend: HeadlessPlatform,
  theme: WidgetTheme,
  actual: Uint8Array,
  width: number,
  height: number,
  scale: number,
  label: string,
  variant: ButtonVariant,
): { x: number; y: number } | null {
  const style = theme.recipes.button[variant].medium.label.base;
  const probeWidth = 200 * scale,
    probeHeight = 48 * scale;
  const probe = new Window({
    title: "Action glyph oracle",
    width: probeWidth,
    height: probeHeight,
    decorated: false,
  });
  probe.setContent(
    <WidgetThemeProvider theme={theme}>
      <TextBlock width={probeWidth} height={probeHeight} text={label} {...style} />
    </WidgetThemeProvider>,
  );
  probe.mount(backend);
  probe.tick();
  const pattern = backend.getWindows().at(-1)!.lastFrame!;
  const rgb = [style.color & 255, (style.color >>> 8) & 255, (style.color >>> 16) & 255];
  const solid: Array<[number, number]> = [];
  for (let y = 0; y < probeHeight; y++)
    for (let x = 0; x < probeWidth; x++) {
      const at = (y * probeWidth + x) * 4;
      if (pattern[at + 3] === 255 && rgb.every((channel, index) => pattern[at + index] === channel))
        solid.push([x, y]);
    }
  probe.destroy();
  assert.ok(solid.length > 10, "independent action probe must paint real glyphs");
  const left = Math.min(...solid.map(([x]) => x)),
    right = Math.max(...solid.map(([x]) => x));
  const top = Math.min(...solid.map(([, y]) => y)),
    bottom = Math.max(...solid.map(([, y]) => y));
  const holes = letterCounters(pattern, probeWidth, left, right, top, bottom);
  assert.ok(
    holes.length > 2,
    "enclosed letter counters distinguish glyphs from same-color surfaces",
  );
  const [firstX, firstY] = solid[0]!;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (!rgb.every((channel, index) => actual[at + index] === channel)) continue;
      if (
        solid.every(([sx, sy]) => {
          const px = x + sx - firstX,
            py = y + sy - firstY;
          if (px < 0 || px >= width || py < 0 || py >= height) return false;
          const pixel = (py * width + px) * 4;
          return rgb.every((channel, index) => actual[pixel + index] === channel);
        }) &&
        holes.every(([sx, sy]) => {
          const px = x + sx - firstX,
            py = y + sy - firstY;
          if (px < 0 || px >= width || py < 0 || py >= height) return false;
          const pixel = (py * width + px) * 4;
          return rgb.some((channel, index) => actual[pixel + index] !== channel);
        })
      )
        return {
          x: x + (left + right) / 2 - firstX,
          y: y + (top + bottom) / 2 - firstY,
        };
    }
  return null;
}

await installUiFonts();
let cases = 0;
try {
  for (const family of THEME_FAMILIES)
    for (const scheme of ["dark", "light"] as const)
      for (const scale of [1, 1.5])
        for (const shape of ["wide", "compact", "native-dialog"] as const)
          for (const rendering of ["direct", "retained-cpu"] as const)
            for (const state of ["complete", "stopped", "conflict"] as const) {
              const requestedCase = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7);
              const caseName = `${rendering}-${family}-${scheme}-${scale}-${shape}-${state}`;
              if (requestedCase && requestedCase !== caseName) continue;
              setUiScaleFactor(scale);
              const theme = createPersonalizedWidgetTheme(
                discoverPersonalization("linux", {
                  themeFamily: family,
                  colorScheme: scheme,
                  reducedMotion: true,
                }),
              );
              // The native-dialog viewport gives the production dialog exactly 560×440
              // logical pixels, without assuming body padding or footer coordinates.
              const dimensions =
                shape === "wide" ? [1280, 760] : shape === "compact" ? [640, 480] : [568, 448];
              const width = dimensions[0]! * scale,
                height = dimensions[1]! * scale;
              const backend =
                rendering === "direct" ? new HeadlessPlatform() : new RetainedCpuPlatform();
              await backend.connect();
              const window = new Window({
                title: "Transfer action access",
                width,
                height,
                decorated: false,
              });
              let dismissed = 0,
                cancelled = 0;
              const choices: string[] = [];
              const conflict = state === "conflict";
              const labels: Array<[string, ButtonVariant]> = conflict
                ? [
                    ["Cancel transfer", "secondary"],
                    ["Skip this item", "secondary"],
                    ["Keep both", "primary"],
                  ]
                : [["Done", "primary"]];
              window.setContent(
                <WidgetThemeProvider theme={theme}>
                  <TransferDialog
                    width={width}
                    height={height}
                    value={{
                      kind: "move",
                      request: {
                        sources: ["/tmp/moire-files-native-disposable/partial-source/z-last.txt"],
                        directory: "/tmp/moire-files-native-disposable/partial-destination",
                      },
                      outcome: conflict ? "running" : state,
                      message: conflict
                        ? undefined
                        : state === "complete"
                          ? "1 item completed · 1 skipped."
                          : "Transfer cancelled. 1 completed item is kept; unfinished source items are unchanged.",
                      progress: {
                        done: 1,
                        total: 2,
                        skipped: state === "complete" ? 1 : 0,
                        name: "z-last.txt",
                        bytes: 21,
                        bytesTotal: 42,
                        files: 1,
                        filesTotal: 2,
                        phase: conflict ? "moving" : "finished",
                        source: "/tmp/moire-files-native-disposable/partial-source/z-last.txt",
                        destination:
                          "/tmp/moire-files-native-disposable/partial-destination/z-last.txt",
                      },
                    }}
                    conflict={
                      conflict
                        ? {
                            source: "/tmp/moire-files-native-disposable/partial-source/z-last.txt",
                            destination:
                              "/tmp/moire-files-native-disposable/partial-destination/z-last.txt",
                            choose: (choice) => choices.push(choice),
                          }
                        : null
                    }
                    onCancel={() => {
                      cancelled++;
                    }}
                    onDismiss={() => {
                      dismissed++;
                    }}
                  />
                </WidgetThemeProvider>,
              );
              window.mount(backend);
              await Promise.resolve();
              const native = backend.getWindows()[0]!;
              const settle = async () => {
                for (let frame = 0; frame < 5; frame++) {
                  await new Promise((done) => setTimeout(done, 10));
                  window.tick();
                }
              };
              const key = (code: number, name: string) => {
                const modifiers = { ctrl: false, shift: false, alt: false, meta: false };
                native.injectKey({ type: "down", code, key: name, modifiers, timeMs: Date.now() });
                native.injectKey({ type: "up", code, key: name, modifiers, timeMs: Date.now() });
                window.tick();
              };
              const id = `${rendering}-${family}-${scheme}-${scale}-${shape}-${state}`;
              try {
                await settle();
                const initial = native.lastFrame!.slice();
                if (process.env.MOIRE_CAPTURE_DIR) {
                  const output = process.env.MOIRE_CAPTURE_DIR;
                  await fs.mkdir(output, { recursive: true });
                  const png = new PNG({ width, height });
                  for (let at = 0; at < initial.length; at += 4)
                    png.data.set(
                      [initial[at + 2]!, initial[at + 1]!, initial[at]!, initial[at + 3]!],
                      at,
                    );
                  await fs.writeFile(path.join(output, `footer-${id}.png`), PNG.sync.write(png));
                }
                const positions = labels.map(([label, variant]) => {
                  const position = locateLabel(
                    backend,
                    theme,
                    initial,
                    width,
                    height,
                    scale,
                    label,
                    variant,
                  );
                  assert.ok(
                    position,
                    `${label} must be fully painted initially WITHOUT scroll: ${id}`,
                  );
                  return position;
                });
                if (requestedCase)
                  console.log(
                    JSON.stringify({
                      kind: "actual-footer-glyph-bounds-centers",
                      case: id,
                      labels: labels.map(([label], index) => ({ label, ...positions[index] })),
                    }),
                  );
                // Header close owns initial focus. Every next footer action must be
                // keyboard reachable while its complete label is already on screen.
                for (const _label of labels) {
                  key(15, "Tab");
                  key(28, "Enter");
                }
                if (conflict) {
                  assert.deepEqual(
                    choices,
                    ["skip", "keep-both"],
                    `visible choices follow focus order: ${id}`,
                  );
                  assert.equal(cancelled, 1);
                  assert.equal(dismissed, 0);
                } else {
                  assert.equal(dismissed, 1, `visible Done is keyboard operable: ${id}`);
                  assert.equal(cancelled, 0);
                }
                const captureDiagnostic = async (name: string, frame: Uint8Array) => {
                  if (!process.env.MOIRE_CAPTURE_DIR || !requestedCase) return;
                  const png = new PNG({ width, height });
                  for (let at = 0; at < frame.length; at += 4)
                    png.data.set([frame[at + 2]!, frame[at + 1]!, frame[at]!, frame[at + 3]!], at);
                  await fs.writeFile(
                    path.join(process.env.MOIRE_CAPTURE_DIR, `${name}-${id}.png`),
                    PNG.sync.write(png),
                  );
                };
                await captureDiagnostic("after-keys", native.lastFrame!.slice());
                // Only details scroll. Footer labels must stay in exactly the same
                // screen positions even after a large wheel delta in the body.
                native.injectPointer({
                  type: "wheel",
                  x: width / 2,
                  y: height / 2,
                  deltaY: height * 2,
                  timeMs: Date.now(),
                });
                window.tick();
                await settle();
                const scrolled = native.lastFrame!;
                await captureDiagnostic("after-wheel", scrolled.slice());
                labels.forEach(([label, variant], index) => {
                  assert.deepEqual(
                    locateLabel(backend, theme, scrolled, width, height, scale, label, variant),
                    positions[index],
                    `footer ${label} stays fixed during details scroll: ${id}`,
                  );
                });
                positions.forEach((position) => {
                  native.injectPointer({
                    type: "down",
                    button: "left",
                    ...position,
                    timeMs: Date.now(),
                  });
                  native.injectPointer({
                    type: "up",
                    button: "left",
                    ...position,
                    timeMs: Date.now() + 1,
                  });
                  window.tick();
                });
                if (conflict) {
                  assert.deepEqual(choices, ["skip", "keep-both", "skip", "keep-both"]);
                  assert.equal(cancelled, 2, "visible Cancel retains the actual abort callback");
                  assert.equal(dismissed, 0);
                } else {
                  assert.equal(dismissed, 2, "visible Done retains actual pointer dismissal");
                  assert.equal(cancelled, 0, "receipt dismissal cannot cancel a finished transfer");
                }
                cases++;
              } finally {
                window.destroy();
                backend.disconnect();
              }
            }
  console.log(
    JSON.stringify({
      kind: "transfer-dialog-footer",
      cases,
      source: source ?? "workspace",
      scope:
        "public Window initial full action glyphs + keyboard/pointer without scroll; stationary footer with scrollable details; direct and retained CPU; no native delivery claim",
    }),
  );
} finally {
  setUiScaleFactor(1);
}

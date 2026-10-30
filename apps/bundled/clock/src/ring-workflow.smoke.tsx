import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React, { useState } from "react";
import {
  Window,
  TextBlock,
  WidgetThemeProvider,
  THEME_FAMILIES,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  getUiScaleFactor,
  type ButtonVariant,
  type WidgetTheme,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { windowControl } from "@moire/app-tools/testing";
import { ClockApp } from "./main";
import { AlarmStore } from "./backend";
import { RingNotices, type RingNotice } from "./views/notices";
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
  style: {
    fontSize: number;
    fontWeight?: "regular" | "medium" | "bold";
    fontFamily?: "mono" | "display";
    color: number;
  },
  probeWidth = width,
  mode: GlyphMode = "body",
) {
  const rgb = [style.color & 255, (style.color >>> 8) & 255, (style.color >>> 16) & 255];
  const cacheKey = JSON.stringify({ text, style, probeWidth, mode, scale: getUiScaleFactor() });
  let glyph = glyphCache.get(cacheKey);
  if (!glyph) {
    const probeHeight = Math.round(180 * getUiScaleFactor());
    const probe = new Window({
      title: "Clock notice glyph oracle",
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

const output = process.env.MOIRE_CLOCK_CAPTURE_DIR;
async function capture(name: string, pixels: Uint8Array, width: number, height: number) {
  if (!output) return;
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, `${name}.bgra`), pixels);
  await fs.writeFile(
    path.join(output, `${name}.json`),
    JSON.stringify({
      width,
      height,
      format: "BGRA8888",
      scope: "actual public Window host framebuffer; no native input/visibility claim",
    }),
  );
}
function controls(backend: HeadlessPlatform, window: Window) {
  const native = backend.getWindows().at(-1)!;
  const key = (key: string, shift = false) => {
    native.injectKey({
      type: "down",
      code: key === "Enter" ? 28 : key === "Tab" ? 15 : key === " " ? 57 : 1,
      key,
      modifiers: { shift, ctrl: false, alt: false, meta: false },
      timeMs: 1,
    });
    window.tick();
    window.tick();
  };
  const click = (point: { x: number; y: number }) => {
    native.injectPointer({ type: "down", ...point, button: "left", timeMs: 1 });
    native.injectPointer({ type: "up", ...point, button: "left", timeMs: 2 });
    window.tick();
    window.tick();
  };
  const text = (point: { x: number; y: number }, value: string) => {
    click(point);
    native.injectKey({
      type: "down",
      code: 30,
      key: "a",
      modifiers: { shift: false, ctrl: true, alt: false, meta: false },
      timeMs: 1,
    });
    native.injectKey({
      type: "down",
      code: 30,
      key: "a",
      text: value,
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      timeMs: 2,
    });
    window.tick();
    window.tick();
  };
  return { native, key, click, text };
}
await installUiFonts();
let cases = 0;
try {
  for (const family of THEME_FAMILIES)
    for (const scheme of ["dark", "light"] as const)
      for (const scale of [1, 1.5])
        for (const shape of ["compact", "wide"] as const)
          for (const rendering of ["direct", "retained-cpu"] as const) {
            setUiScaleFactor(scale);
            const theme = createPersonalizedWidgetTheme(
              discoverPersonalization("linux", {
                themeFamily: family,
                colorScheme: scheme,
                reducedMotion: true,
              }),
            );
            const [width, height]: readonly [number, number] =
              shape === "compact" ? [480, 360] : [760, 520];
            const backend =
              rendering === "direct" ? new HeadlessPlatform() : new RetainedCpuPlatform();
            await backend.connect();
            const window = new Window({
              title: "Clock receipt access",
              width,
              height,
              decorated: false,
            });
            const dismissed: string[] = [],
              snoozed: string[] = [];
            const message = "Review the shared project notes before the morning meeting";
            function Harness() {
              const [notices, setNotices] = useState<RingNotice[]>([
                { id: "alarm-one", kind: "alarm", alarmId: "one", message },
                {
                  id: "alarm-two",
                  kind: "alarm",
                  alarmId: "two",
                  message: "Second independent alarm",
                },
                { id: "timer", kind: "timer", message: "Timer finished" },
              ]);
              return (
                <RingNotices
                  width={width}
                  height={height}
                  notices={notices}
                  onDismiss={(id) => {
                    dismissed.push(id);
                    setNotices((n) => n.filter((x) => x.id !== id));
                  }}
                  onSnooze={(notice) => {
                    snoozed.push(notice.alarmId);
                    setNotices((n) => n.filter((x) => x.id !== notice.id));
                  }}
                />
              );
            }
            try {
              window.setContent(
                <WidgetThemeProvider theme={theme}>
                  <Harness />
                </WidgetThemeProvider>,
              );
              window.mount(backend);
              window.tick();
              const { native, key, click } = controls(backend, window),
                frame = native.lastFrame!;
              const label = (text: string, variant: ButtonVariant = "secondary") =>
                locateText(
                  backend,
                  native.lastFrame!,
                  width,
                  height,
                  theme,
                  text,
                  theme.recipes.button[variant].medium.label.base,
                  width,
                  "control",
                );
              const inner =
                width -
                theme.foundations.space.md * 2 -
                theme.recipes.dialog.medium.metrics.bodyPaddingX * 2;
              assert.ok(
                locateText(
                  backend,
                  frame,
                  width,
                  height,
                  theme,
                  message,
                  { fontSize: 15, fontWeight: "medium", color: theme.foundations.palette.text },
                  inner,
                ),
                `all notice lines visible ${family}/${scheme}/${scale}/${shape}/${rendering}`,
              );
              for (const [name, variant] of [
                ["Dismiss", "secondary"],
                ["Snooze 5m", "primary"],
                ["Next notice", "secondary"],
              ] as const) {
                const bounds = label(name, variant);
                if (!bounds)
                  await capture(
                    `failure-${family}-${scheme}-${scale}-${shape}-${rendering}`,
                    frame,
                    width,
                    height,
                  );
                assert.ok(
                  bounds,
                  `complete initially reachable ${name}: ${family}/${scheme}/${scale}/${shape}/${rendering}`,
                );
                assert.ok(
                  bounds.x > 0 && bounds.y > 0 && bounds.x < width && bounds.y < height,
                  "glyph bounds inside current viewport",
                );
              }
              if (family === "moire" && rendering === "retained-cpu")
                await capture(`notices-${scheme}-${scale}-${shape}`, frame, width, height);
              click(label("Next notice")!);
              assert.ok(
                locateText(
                  backend,
                  native.lastFrame!,
                  width,
                  height,
                  theme,
                  "Second independent alarm",
                  { fontSize: 15, fontWeight: "medium", color: theme.foundations.palette.text },
                  inner,
                ),
              );
              click(label("Dismiss")!);
              assert.deepEqual(dismissed, ["alarm-two"]);
              assert.deepEqual(snoozed, []);
              assert.ok(
                label("Snooze 5m", "primary"),
                "other alarm remains independently snoozable",
              );
              key("Enter");
              assert.deepEqual(
                dismissed,
                ["alarm-two", "alarm-one"],
                "focused retained Dismiss activates the current notice once",
              );
              assert.ok(
                locateText(
                  backend,
                  native.lastFrame!,
                  width,
                  height,
                  theme,
                  "Timer finished",
                  { fontSize: 15, fontWeight: "medium", color: theme.foundations.palette.text },
                  inner,
                ),
                "timer receipt survives two alarm dismissals",
              );
              key(" ");
              assert.deepEqual(dismissed, ["alarm-two", "alarm-one", "timer"]);
              assert.equal(label("Dismiss"), null);
              window.setContent(
                <WidgetThemeProvider theme={theme}>
                  <Harness key="snooze" />
                </WidgetThemeProvider>,
              );
              window.tick();
              click(label("Snooze 5m", "primary")!);
              assert.deepEqual(snoozed, ["one"], "pointer snooze targets only its own alarm");
              key(" ");
              assert.deepEqual(
                snoozed,
                ["one", "two"],
                "retained focused snooze keyboard callback targets current alarm once",
              );
              assert.ok(
                locateText(
                  backend,
                  native.lastFrame!,
                  width,
                  height,
                  theme,
                  "Timer finished",
                  { fontSize: 15, fontWeight: "medium", color: theme.foundations.palette.text },
                  inner,
                ),
                "snoozing alarms never dismisses timer receipt",
              );
              cases++;
            } finally {
              window.destroy();
              backend.disconnect();
            }
          }
  setUiScaleFactor(1);
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-clock-ring-flow-")),
    store = new AlarmStore(path.join(fixture, "alarms.json")),
    backend = new RetainedCpuPlatform();
  let wall = new Date(2026, 9, 3, 7, 29, 59).getTime(),
    mono = 1000;
  const calls: string[] = [];
  await backend.connect();
  const window = new Window({
    title: "Clock due-source workflows",
    width: 760,
    height: 520,
    decorated: false,
  });
  const theme = createPersonalizedWidgetTheme(
    discoverPersonalization("linux", {
      themeFamily: "moire",
      colorScheme: "dark",
      reducedMotion: true,
    }),
  );
  try {
    store.write(
      [
        { id: "one", label: "First alarm", time: "07:30", enabled: true, nextAtMs: wall + 1000 },
        { id: "two", label: "Second alarm", time: "07:30", enabled: true, nextAtMs: wall + 1000 },
      ],
      store.load(wall).revision,
      wall,
    );
    window.setContent((size) => (
      <WidgetThemeProvider theme={theme}>
        <ClockApp
          {...size}
          store={store}
          wallNow={() => wall}
          monotonicNow={() => mono}
          onRing={(m) => calls.push(m)}
        />
      </WidgetThemeProvider>
    ));
    window.mount(backend);
    window.tick();
    const { native, key, click, text } = controls(backend, window);
    let width = 760,
      height = 520;
    const label = (name: string, variant: ButtonVariant = "secondary") =>
      locateText(
        backend,
        native.lastFrame!,
        width,
        height,
        theme,
        name,
        theme.recipes.button[variant].medium.label.base,
        width,
        "control",
      );
    const press = (name: string, variant: ButtonVariant = "secondary") => {
      const at = label(name, variant);
      assert.ok(at, `actual Clock control ${name}`);
      click(at);
    };
    const control = (match: { text: string } | { focusId: string }) => windowControl(window, match);
    click(control({ text: "Stopwatch" }));
    press("Start", "primary");
    click(control({ text: "Timer" }));
    text(control({ focusId: "clock:timer-duration" }), "00:01");
    press("Start Timer", "primary");
    wall += 1000;
    mono += 1000;
    await new Promise((resolve) => setTimeout(resolve, 140));
    window.tick();
    assert.deepEqual(
      calls,
      ["Timer finished", "First alarm", "Second alarm"],
      "one real callback per simultaneous due source",
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    window.tick();
    assert.equal(calls.length, 3, "subsequent ticks never ring duplicate due sources");
    await capture("actual-simultaneous", native.lastFrame!, width, height);
    press("Dismiss");
    press("Next notice");
    const actor = new AlarmStore(store.file),
      snapshot = actor.load(wall);
    actor.write(
      [
        ...snapshot.items,
        {
          id: "other",
          label: "Other window alarm",
          time: "12:30",
          enabled: true,
          nextAtMs: wall + 18000000,
        },
      ],
      snapshot.revision,
      wall,
    );
    const before = await fs.readFile(store.file);
    press("Snooze 5m", "primary");
    assert.deepEqual(
      await fs.readFile(store.file),
      before,
      "stale snooze cannot overwrite another instance",
    );
    key("Escape");
    assert.ok(label("Snooze 5m", "primary"), "failed snooze retains its receipt");
    press("Snooze 5m", "primary");
    key("Enter");
    press("Snooze 5m", "primary");
    assert.equal(store.read(wall).length, 3);
    assert.ok(
      locateText(
        backend,
        native.lastFrame!,
        width,
        height,
        theme,
        "First alarm",
        { fontSize: 15, fontWeight: "medium", color: theme.foundations.palette.text },
        600,
      ),
      "snoozing second receipt keeps first receipt",
    );
    width = 480;
    height = 360;
    native.emitConfigure(width, height);
    window.tick();
    assert.ok(label("Dismiss"));
    assert.ok(label("Snooze 5m", "primary"));
    await capture("actual-resized-pending", native.lastFrame!, width, height);
    width = 760;
    height = 520;
    native.emitConfigure(width, height);
    window.tick();
    wall += 300000;
    mono += 2000;
    await new Promise((resolve) => setTimeout(resolve, 140));
    window.tick();
    assert.deepEqual(
      calls,
      ["Timer finished", "First alarm", "Second alarm", "Second alarm"],
      "only successfully snoozed source rings again",
    );
    press("Dismiss");
    press("Dismiss");
    click(control({ text: "Stopwatch" }));
    press("Pause", "primary");
    assert.ok(
      locateText(backend, native.lastFrame!, width, height, theme, "00:00:03.00", {
        fontSize: 84,
        fontFamily: "display",
        color: theme.foundations.palette.text,
      }),
      "stopwatch remains independent through notices, resize and storage reload",
    );
    click(control({ text: "Alarms" }));
    text(control({ focusId: "clock:alarm-label" }), "Draft alarm kept");
    const next = actor.load(wall);
    actor.write(
      [
        ...next.items,
        {
          id: "more",
          label: "Another actor",
          time: "14:30",
          enabled: true,
          nextAtMs: wall + 25200000,
        },
      ],
      next.revision,
      wall,
    );
    press("Add Alarm", "primary");
    key("Escape");
    press("Add Alarm", "primary");
    key("Enter");
    press("Add Alarm", "primary");
    assert.ok(store.read(wall).some((alarm) => alarm.label === "Draft alarm kept"));
    assert.ok(store.read(wall).some((alarm) => alarm.id === "more"));
  } finally {
    window.destroy();
    backend.disconnect();
    await fs.rm(fixture, { recursive: true, force: true });
  }
  console.log(
    `[clock/ring-workflow] ${cases} public Window theme/scale/size/direct-retained cases plus actual simultaneous sources, independent dismissal/snooze/conflict/resize/stopwatch/draft passed`,
  );
} finally {
  setUiScaleFactor(1);
}

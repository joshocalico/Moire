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
import { CalendarApp } from "./main";
import { newDraft, type DraftKey, type EventDraft } from "./model";
import { CalendarEventEditor } from "./views/editor";
import { CalendarStore } from "./events";
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

type GlyphProbe = {
  points: Array<[number, number]>;
  holes: Array<[number, number]>;
};
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
    fontFamily?: "mono";
    color: number;
  },
  probeWidth = width,
  mode: GlyphMode = "body",
) {
  const rgb = [style.color & 255, (style.color >>> 8) & 255, (style.color >>> 16) & 255];
  const cacheKey = JSON.stringify({
    text,
    style,
    probeWidth,
    mode,
    scale: getUiScaleFactor(),
  });
  let glyph = glyphCache.get(cacheKey);
  if (!glyph) {
    const probeHeight = Math.round(180 * getUiScaleFactor());
    const probe = new Window({
      title: "Calendar glyph oracle",
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
    assert.ok(
      points.length > 4,
      `independent ${text} oracle paints actual glyphs: ${JSON.stringify(style)}`,
    );
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
        return {
          x: x + (firstBoundX + lastX) / 2 - fx,
          y: y + (firstBoundY + lastY) / 2 - fy,
        };
    }
  return null;
}

const output = process.env.MOIRE_CALENDAR_CAPTURE_DIR;
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
  const key = (key: string, ctrl = false, text?: string, shift = false) => {
    const codes: Record<string, number> = {
      Enter: 28,
      Tab: 15,
      " ": 57,
      Escape: 1,
      PageDown: 109,
      PageUp: 104,
      n: 49,
      s: 31,
      a: 30,
    };
    native.injectKey({
      type: "down",
      code: codes[key] ?? 30,
      key,
      text,
      modifiers: { shift, ctrl, alt: false, meta: false },
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
  const wheel = (x: number, y: number, deltaY: number) => {
    native.injectPointer({ type: "wheel", x, y, deltaY, timeMs: 1 });
    window.tick();
    window.tick();
  };
  return { native, key, click, wheel };
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
            const [width, height] = shape === "compact" ? [480, 360] : [940, 660];
            const backend =
              rendering === "direct" ? new HeadlessPlatform() : new RetainedCpuPlatform();
            await backend.connect();
            const window = new Window({
              title: "Calendar complete editor",
              width,
              height,
              decorated: false,
            });
            let saves = 0,
              cancels = 0;
            function Harness() {
              const [draft, setDraft] = useState<EventDraft>({
                ...newDraft("2026-10-03", "UTC"),
                title: "Draft",
                notes: "Review draft notes",
              });
              return (
                <CalendarEventEditor
                  width={width}
                  height={height}
                  draft={draft}
                  status="Scroll or use Page Up / Page Down for all fields."
                  onChange={(key: DraftKey, value: string) =>
                    setDraft((old) => ({ ...old, [key]: value }))
                  }
                  onSave={() => saves++}
                  onCancel={() => cancels++}
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
              const { native, key, click, wheel } = controls(backend, window);
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
              const save = label("Save Event", "primary"),
                cancel = label("Cancel");
              assert.ok(
                save,
                `${family}/${scheme}/${scale}/${shape}/${rendering}: full Save Event initially visible`,
              );
              assert.ok(cancel, "full Cancel initially visible");
              const found = new Set<string>();
              const bodyWidth =
                Math.min(520 * scale, width - theme.foundations.space.md * 2) -
                theme.recipes.dialog.medium.metrics.bodyPaddingX * 2;
              for (let page = 0; page < 8; page++) {
                for (const text of [
                  "Title",
                  "Date YYYY-MM-DD",
                  "Start HH:MM",
                  "End HH:MM",
                  "Time zone",
                  "Notes",
                ]) {
                  if (
                    locateText(
                      backend,
                      native.lastFrame!,
                      width,
                      height,
                      theme,
                      text,
                      { fontSize: 13, color: theme.foundations.palette.muted },
                      bodyWidth,
                    )
                  )
                    found.add(text);
                }
                assert.deepEqual(
                  label("Save Event", "primary"),
                  save,
                  "Save footer remains stationary as actual detail viewport scrolls",
                );
                assert.deepEqual(label("Cancel"), cancel);
                wheel(width / 2, height / 2, 120 * scale);
              }
              assert.equal(found.size, 6, `all six full field labels reachable: ${[...found]}`);
              for (let p = 0; p < 8; p++) key("PageUp");
              const keyboardFound = new Set<string>();
              for (let page = 0; page < 8; page++) {
                for (const text of [
                  "Title",
                  "Date YYYY-MM-DD",
                  "Start HH:MM",
                  "End HH:MM",
                  "Time zone",
                  "Notes",
                ]) {
                  if (
                    locateText(
                      backend,
                      native.lastFrame!,
                      width,
                      height,
                      theme,
                      text,
                      { fontSize: 13, color: theme.foundations.palette.muted },
                      bodyWidth,
                    )
                  )
                    keyboardFound.add(text);
                }
                key("PageDown");
                assert.deepEqual(
                  label("Save Event", "primary"),
                  save,
                  "keyboard scrolling leaves Save stationary",
                );
              }
              assert.equal(
                keyboardFound.size,
                6,
                `all fields reachable by actual Page keys: ${[...keyboardFound]}`,
              );
              for (let p = 0; p < 8; p++) key("PageUp");
              click(save);
              assert.equal(saves, 1, "pointer activates visible Save exactly once");
              key("Enter");
              assert.equal(saves, 2, "focused Enter saves once");
              key(" ");
              assert.equal(saves, 3, "focused Space saves once");
              key("Escape");
              assert.equal(cancels, 1, "Escape dismisses editor exactly once");
              if (family === "moire" && rendering === "retained-cpu")
                await capture(
                  `editor-${scheme}-${scale}-${shape}`,
                  native.lastFrame!,
                  width,
                  height,
                );
              cases++;
            } finally {
              window.destroy();
              backend.disconnect();
            }
          }
  setUiScaleFactor(1);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "moire-calendar-close-"));
  try {
    const theme = createPersonalizedWidgetTheme(
      discoverPersonalization("linux", {
        themeFamily: "moire",
        colorScheme: "dark",
        reducedMotion: true,
      }),
    );
    async function harness(name: string, width = 940, height = 660) {
      const store = new CalendarStore(path.join(tmp, name, "events.json")),
        backend = new HeadlessPlatform();
      await backend.connect();
      const window = new Window({
        title: "Calendar guarded close",
        width,
        height,
        decorated: false,
      });
      let closed = 0;
      window.onClose(() => closed++);
      window.setContent((size) => (
        <WidgetThemeProvider theme={theme}>
          <CalendarApp
            {...size}
            store={store}
            now={() => Date.parse("2026-10-03T00:00:00Z")}
            onCloseGuard={(guard) => window.setCloseGuard(guard)}
            onClose={() => window.requestClose()}
          />
        </WidgetThemeProvider>
      ));
      window.mount(backend);
      window.tick();
      const ui = controls(backend, window);
      const label = (text: string, variant: ButtonVariant = "secondary") =>
        locateText(
          backend,
          ui.native.lastFrame!,
          width,
          height,
          theme,
          text,
          theme.recipes.button[variant].medium.label.base,
          width,
          "control",
        );
      const press = (text: string, variant: ButtonVariant = "secondary") => {
        const p = label(text, variant);
        assert.ok(p, `actual guarded-close ${text} visible`);
        ui.click(p);
      };
      return {
        ...ui,
        store,
        window,
        backend,
        label,
        press,
        closed: () => closed,
        dispose: () => {
          window.destroy();
          backend.disconnect();
        },
      };
    }
    {
      const h = await harness("discard");
      try {
        h.key("n", true);
        h.key("a", false, "Retained draft");
        h.native.requestClose();
        h.window.tick();
        assert.equal(h.window.isClosed(), false);
        assert.equal(h.closed(), 0);
        for (const [name, variant] of [
          ["Save", "primary"],
          ["Discard", "danger"],
          ["Cancel", "secondary"],
        ] as const)
          assert.ok(h.label(name, variant), `close prompt full ${name}`);
        await capture("actual-draft-close-prompt", h.native.lastFrame!, 940, 660);
        h.press("Cancel");
        assert.ok(h.label("Save Event", "primary"));
        h.native.requestClose();
        h.window.tick();
        h.key("Escape");
        assert.ok(h.label("Save Event", "primary"));
        h.native.requestClose();
        h.window.tick();
        h.press("Discard", "danger");
        assert.equal(h.window.isClosed(), true);
        assert.equal(h.closed(), 1);
        assert.equal(h.store.read().length, 0);
        h.native.requestClose();
        assert.equal(h.closed(), 1);
      } finally {
        h.dispose();
      }
    }
    {
      const h = await harness("save");
      try {
        h.key("n", true);
        h.key("a", false, "Saved by close");
        h.native.requestClose();
        h.window.tick();
        h.press("Save", "primary");
        assert.equal(h.closed(), 1);
        assert.equal(h.store.read()[0]?.title, "Saved by close");
      } finally {
        h.dispose();
      }
    }
    {
      const h = await harness("invalid");
      try {
        h.key("n", true);
        h.key("a", false, " ");
        h.native.requestClose();
        h.window.tick();
        h.press("Save", "primary");
        assert.equal(h.closed(), 0);
        assert.equal(h.store.read().length, 0);
        assert.ok(h.label("Save", "primary"), "invalid draft remains guarded");
        h.press("Cancel");
        h.key("a", true);
        h.key("a", false, "Repaired title");
        h.native.requestClose();
        h.window.tick();
        h.press("Save", "primary");
        assert.equal(h.closed(), 1);
        assert.equal(h.store.read()[0]?.title, "Repaired title");
      } finally {
        h.dispose();
      }
    }
    {
      const h = await harness("conflict");
      try {
        h.key("n", true);
        h.key("a", false, "My retained draft");
        const actor = new CalendarStore(h.store.file);
        const { eventFromDraft } = await import("./events");
        actor.write(
          [
            eventFromDraft({
              title: "Other instance",
              date: "2026-10-03",
              start: "11:00",
              end: "12:00",
              timeZone: "UTC",
              notes: "",
            }),
          ],
          actor.load().revision,
        );
        const before = await fs.readFile(h.store.file);
        h.native.requestClose();
        h.window.tick();
        h.press("Save", "primary");
        assert.equal(h.closed(), 0);
        assert.deepEqual(await fs.readFile(h.store.file), before);
        h.press("Keep draft");
        h.press("Save", "primary");
        assert.equal(h.closed(), 0);
        h.press("Reload saved", "primary");
        h.press("Save", "primary");
        assert.equal(h.closed(), 1);
        assert.deepEqual(
          h.store
            .read()
            .map((x) => x.title)
            .sort(),
          ["My retained draft", "Other instance"],
        );
      } finally {
        h.dispose();
      }
    }
    {
      const h = await harness("failed-write");
      try {
        h.key("n", true);
        h.key("a", false, "Write failure draft");
        const original = h.store.write.bind(h.store);
        h.store.write = () => {
          throw new Error("Fixture EIO before publication");
        };
        h.native.requestClose();
        h.window.tick();
        h.press("Save", "primary");
        assert.equal(h.closed(), 0);
        assert.equal(h.store.read().length, 0);
        h.press("Keep draft");
        h.store.write = original;
        h.press("Save", "primary");
        assert.equal(h.closed(), 1);
        assert.equal(h.store.read()[0]?.title, "Write failure draft");
      } finally {
        h.dispose();
      }
    }
    for (const scale of [1, 1.5]) {
      setUiScaleFactor(scale);
      const h = await harness(`compact-${scale}`, 480, 360);
      try {
        h.key("n", true);
        h.key("a", false, "Compact retained draft");
        h.native.requestClose();
        h.window.tick();
        for (const [name, variant] of [
          ["Save", "primary"],
          ["Discard", "danger"],
          ["Cancel", "secondary"],
        ] as const)
          assert.ok(h.label(name, variant), `compact ${scale} close prompt full ${name}`);
        await capture(`actual-compact-close-${scale}`, h.native.lastFrame!, 480, 360);
        h.press("Cancel");
        assert.equal(h.closed(), 0);
        h.native.emitConfigure(940, 660);
        h.window.tick();
        h.native.requestClose();
        h.window.tick();
        h.key("Escape");
        assert.equal(h.closed(), 0, "resize and Escape preserve the dirty event");
        h.key("s", true);
        assert.equal(
          h.store.read()[0]?.title,
          "Compact retained draft",
          "compact draft survives resize and saves",
        );
      } finally {
        h.dispose();
      }
    }
    setUiScaleFactor(1);
    {
      const h = await harness("untouched");
      try {
        h.key("n", true);
        h.native.requestClose();
        h.window.tick();
        assert.equal(h.closed(), 1, "untouched new form closes without a needless save prompt");
        assert.equal(h.store.read().length, 0);
      } finally {
        h.dispose();
      }
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  console.log(
    `[calendar/close] ${cases} public Window editor glyph/footer/scroll/pointer/key cases + actual Save/Discard/Cancel/invalid/conflict/EIO/one-close workflows passed`,
  );
} finally {
  setUiScaleFactor(1);
}

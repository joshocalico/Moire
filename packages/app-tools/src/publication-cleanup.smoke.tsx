/* eslint-disable import/no-relative-parent-imports -- Integration fixtures exercise the actual app trees. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
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
  type WindowSize,
  type WidgetTheme,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { CalendarApp } from "../../../apps/bundled/calendar/src/main";
import { ClockApp } from "../../../apps/bundled/clock/src/main";
import { ColorsApp } from "../../../apps/bundled/colors/src/main";
import { CalendarStore, eventFromDraft } from "../../../apps/bundled/calendar/src/events";
import { AlarmStore } from "../../../apps/bundled/clock/src/backend";
import { PaletteStore } from "../../../apps/bundled/colors/src/palettes";
import { retryStoreCleanup, StorageConflictError } from "./local-store";
import { windowControl } from "./testing";
import syncFs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
    fontFamily?: "mono";
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
        return { x: x + (firstBoundX + lastX) / 2 - fx, y: y + (firstBoundY + lastY) / 2 - fy };
    }
  return null;
}

const output = process.env.MOIRE_STORAGE_CAPTURE_DIR;
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
  const key = (key: string, ctrl = false, text?: string) => {
    native.injectKey({
      type: "down",
      code: key === "Enter" ? 28 : key === "Escape" ? 1 : key === "n" ? 49 : key === "s" ? 31 : 30,
      key,
      text,
      modifiers: { shift: false, ctrl, alt: false, meta: false },
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
  /** Press the control with this focusId or painted label (layout-independent). */
  const press = (match: { focusId: string } | { text: string }) =>
    click(windowControl(window, match));
  /** Replace the text of the field with this focusId. */
  const text = (focusId: string, value: string) => {
    press({ focusId });
    key("a", true);
    key("a", false, value);
  };
  return { native, key, click, press, text };
}
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "moire-publication-cleanup-"));
const now = Date.parse("2026-10-03T00:00:00Z");
const item = (title: string) =>
  eventFromDraft({
    title,
    date: "2026-10-03",
    start: "09:00",
    end: "10:00",
    timeZone: "UTC",
    notes: "",
  });
let cases = 0;
try {
  const store = new CalendarStore(path.join(temp, "actor", "events.json"));
  let saved = store.write([item("First")], store.load().revision);
  assert.equal(saved.cleanup.kind, "complete");
  const rmdir = syncFs.rmdirSync;
  let once = false;
  try {
    syncFs.rmdirSync = (dir, ...args) => {
      if (String(dir).startsWith(`${store.file}.write-lock.released-`) && !once) {
        once = true;
        throw new Error("Fixture postpublication rmdir EIO");
      }
      return rmdir(dir, ...args);
    };
    saved = store.write([...saved.items, item("Committed with warning")], saved.revision);
  } finally {
    syncFs.rmdirSync = rmdir;
  }
  assert.equal(saved.cleanup.kind, "pending");
  assert.equal(store.load().revision, saved.revision);
  assert.equal(store.read().length, 2);
  assert.equal(
    syncFs.existsSync(`${store.file}.write-lock`),
    false,
    "retirement vacates canonical lock before failed cleanup",
  );
  const module = fileURLToPath(
      new URL("../../../apps/bundled/calendar/src/events.ts", import.meta.url),
    ),
    loader = fileURLToPath(new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url));
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      loader,
      "--input-type=module",
      "--eval",
      `import {CalendarStore,eventFromDraft} from ${JSON.stringify(module)};const store=new CalendarStore(${JSON.stringify(store.file)});const s=store.load();const item=eventFromDraft({title:'Independent child actor',date:'2026-10-03',start:'11:00',end:'12:00',timeZone:'UTC',notes:''});store.write([...s.items,item],s.revision);`,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(
    store.read().length,
    3,
    "independent actual process saves despite old actor's private cleanup error",
  );
  const loaded = store.load();
  const next = store.write([...loaded.items, item("Next ordinary save")], loaded.revision);
  assert.equal(
    next.cleanup.kind,
    "complete",
    "ordinary save retries authenticated private cleanup",
  );
  assert.equal(store.read().length, 4);
  cases++;
  {
    const file = path.join(temp, "retirement", "events.json"),
      store = new CalendarStore(file),
      before = store.load(),
      rename = syncFs.renameSync;
    let fault = false;
    let result;
    try {
      syncFs.renameSync = (from, to) => {
        if (from === `${file}.write-lock` && !fault) {
          fault = true;
          throw new Error("Fixture retirement rename EIO");
        }
        return rename(from, to);
      };
      result = store.write([item("Already published")], before.revision);
    } finally {
      syncFs.renameSync = rename;
    }
    assert.equal(result.cleanup.kind, "pending");
    const bytes = await fs.readFile(file);
    assert.equal(syncFs.existsSync(`${file}.write-lock`), true);
    assert.equal(
      retryStoreCleanup().kind,
      "complete",
      "exact retained live lease can retire after transient rename failure",
    );
    assert.deepEqual(await fs.readFile(file), bytes);
    assert.equal(store.read().length, 1);
    assert.equal(syncFs.existsSync(`${file}.write-lock`), false);
    cases++;
  }
  {
    const file = path.join(temp, "conflict", "events.json"),
      store = new CalendarStore(file);
    const stale = store.write([item("Original")], store.load().revision);
    const actor = new CalendarStore(file);
    actor.write([...stale.items, item("Other")], stale.revision);
    const bytes = await fs.readFile(file);
    let fault = false;
    try {
      syncFs.rmdirSync = (dir, ...args) => {
        if (String(dir).startsWith(`${file}.write-lock.released-`) && !fault) {
          fault = true;
          throw new Error("Fixture conflict cleanup EIO");
        }
        return rmdir(dir, ...args);
      };
      assert.throws(
        () => store.write([item("Stale")], stale.revision),
        (error) =>
          error instanceof StorageConflictError && /cleanup is pending/.test(error.message),
      );
    } finally {
      syncFs.rmdirSync = rmdir;
    }
    assert.deepEqual(await fs.readFile(file), bytes);
    assert.equal(retryStoreCleanup().kind, "complete");
    cases++;
  }
  {
    const file = path.join(temp, "persistent", "events.json"),
      store = new CalendarStore(file);
    let current = store.load();
    try {
      syncFs.rmdirSync = (dir, ...args) => {
        if (String(dir).startsWith(`${file}.write-lock.released-`))
          throw new Error("Persistent private cleanup EIO");
        return rmdir(dir, ...args);
      };
      for (let i = 0; i < 8; i++) {
        const result = store.write([...current.items, item(`Committed ${i}`)], current.revision);
        assert.equal(result.cleanup.kind, "pending");
        current = result;
      }
      const bytes = await fs.readFile(file);
      assert.throws(
        () => store.write([...current.items, item("Must not publish ninth")], current.revision),
        /eight saves/,
      );
      assert.deepEqual(await fs.readFile(file), bytes);
      assert.equal(store.read().length, 8);
      assert.equal(
        syncFs
          .readdirSync(path.dirname(file))
          .filter((x) => x.startsWith("events.json.write-lock.released-")).length,
        8,
        "pending directories and records remain bounded",
      );
    } finally {
      syncFs.rmdirSync = rmdir;
    }
    assert.equal(retryStoreCleanup().kind, "complete");
    assert.equal(syncFs.readdirSync(path.dirname(file)).length, 1);
    const next = store.write([...current.items, item("Recovered")], current.revision);
    assert.equal(next.cleanup.kind, "complete");
    assert.equal(next.items.length, 9);
    cases++;
  }
  {
    const file = path.join(temp, "unknown", "events.json"),
      store = new CalendarStore(file);
    await fs.mkdir(`${file}.write-lock`, { recursive: true });
    await fs.writeFile(path.join(`${file}.write-lock`, "foreign"), "Kept unchanged");
    assert.throws(() => store.write([item("Not published")], null), /Storage is busy/);
    assert.equal(
      await fs.readFile(path.join(`${file}.write-lock`, "foreign"), "utf8"),
      "Kept unchanged",
    );
    assert.equal(syncFs.existsSync(file), false);
    assert.equal(retryStoreCleanup().kind, "complete", "maintenance never adopts unknown lease");
    assert.equal(
      await fs.readFile(path.join(`${file}.write-lock`, "foreign"), "utf8"),
      "Kept unchanged",
    );
    cases++;
  }
  {
    const file = path.join(temp, "foreign-retired", "events.json"),
      store = new CalendarStore(file);
    let foreign: string | null = null;
    try {
      syncFs.rmdirSync = (dir, ...args) => {
        if (String(dir).startsWith(`${file}.write-lock.released-`) && !foreign) {
          foreign = path.join(String(dir), "unrelated-entry");
          syncFs.writeFileSync(foreign, "Never deleted");
        }
        return rmdir(dir, ...args);
      };
      const result = store.write([item("Published alongside foreign cleanup entry")], null);
      assert.equal(result.cleanup.kind, "pending");
    } finally {
      syncFs.rmdirSync = rmdir;
    }
    assert.ok(foreign);
    assert.equal(await fs.readFile(foreign, "utf8"), "Never deleted");
    assert.equal(retryStoreCleanup().kind, "pending");
    assert.equal(
      await fs.readFile(foreign, "utf8"),
      "Never deleted",
      "maintenance preserves unknown entry even in authenticated retired directory",
    );
    await fs.unlink(foreign);
    assert.equal(retryStoreCleanup().kind, "complete");
    assert.equal(store.read().length, 1);
    cases++;
  }
  {
    const file = path.join(temp, "invalid-clock", "alarms.json"),
      store = new AlarmStore(file);
    await fs.mkdir(path.dirname(file));
    for (const ids of [["same", "same"], [""]]) {
      await fs.writeFile(
        file,
        JSON.stringify(
          ids.map((id, index) => ({ id, label: `Alarm${index}`, time: "07:30", enabled: true })),
        ),
      );
      const bytes = await fs.readFile(file);
      assert.throws(() => store.load(now), /invalid|duplicate/);
      assert.throws(() =>
        store.write(
          [
            {
              id: "new",
              label: "Never overwrite",
              time: "08:30",
              enabled: true,
              nextAtMs: now + 1000,
            },
          ],
          null,
          now,
        ),
      );
      assert.deepEqual(await fs.readFile(file), bytes);
    }
    cases++;
  }
  await installUiFonts();
  setUiScaleFactor(1);
  const theme = createPersonalizedWidgetTheme(
    discoverPersonalization("linux", {
      themeFamily: "moire",
      colorScheme: "dark",
      reducedMotion: true,
    }),
  );
  const calendar = new CalendarStore(path.join(temp, "ui-calendar", "events.json")),
    clock = new AlarmStore(path.join(temp, "ui-clock", "alarms.json")),
    colors = new PaletteStore(path.join(temp, "ui-colors", "palettes.json"));
  type Ui = ReturnType<typeof controls>;
  const plans: {
    name: string;
    file: string;
    width: number;
    height: number;
    render: (size: WindowSize, window: Window) => React.ReactNode;
    draft: (ui: Ui) => void;
    commit: (
      ui: Ui,
      window: Window,
      press: (name: string, variant?: ButtonVariant) => void,
    ) => void;
    ids: () => string[];
    cleanRetry: (ui: Ui) => void;
  }[] = [
    {
      name: "calendar",
      file: calendar.file,
      width: 940,
      height: 660,
      render: (size, window) => (
        <CalendarApp
          {...size}
          store={calendar}
          now={() => now}
          onCloseGuard={(g) => window.setCloseGuard(g)}
          onClose={() => window.requestClose()}
        />
      ),
      draft: (ui) => {
        ui.key("n", true);
        ui.key("a", false, "Published event");
      },
      commit: (ui, window, press) => {
        ui.native.requestClose();
        window.tick();
        press("Save", "primary");
      },
      ids: () => calendar.read().map((x) => x.id),
      cleanRetry: (ui) => ui.key("s", true),
    },
    {
      name: "clock",
      file: clock.file,
      width: 760,
      height: 520,
      render: (size) => (
        <ClockApp {...size} store={clock} wallNow={() => now} monotonicNow={() => 1000} />
      ),
      draft: (ui) => {
        ui.press({ text: "Alarms" });
        ui.text("clock:alarm-label", "Published alarm");
      },
      commit: (ui) => ui.press({ focusId: "clock:add-alarm" }),
      ids: () => clock.read(now).map((x) => x.id),
      cleanRetry: (ui) => ui.key("Escape"),
    },
    {
      name: "colors",
      file: colors.file,
      width: 840,
      height: 680,
      render: (size) => <ColorsApp {...size} store={colors} />,
      draft: (ui) => ui.text("colors:palette-name", "Published palette"),
      commit: (ui) => ui.press({ focusId: "colors:new-palette" }),
      ids: () => colors.read().map((x) => x.id),
      cleanRetry: (ui) => ui.key("Escape"),
    },
  ];
  for (const plan of plans) {
    const backend = new HeadlessPlatform();
    await backend.connect();
    const window = new Window({
      title: "Published cleanup warning",
      width: plan.width,
      height: plan.height,
      decorated: false,
    });
    let closes = 0;
    window.onClose(() => closes++);
    try {
      window.setContent((size) => (
        <WidgetThemeProvider theme={theme}>{plan.render(size, window)}</WidgetThemeProvider>
      ));
      window.mount(backend);
      window.tick();
      const ui = controls(backend, window);
      const label = (text: string, variant: ButtonVariant = "secondary") =>
        locateText(
          backend,
          ui.native.lastFrame!,
          plan.width,
          plan.height,
          theme,
          text,
          theme.recipes.button[variant].medium.label.base,
          plan.width,
          "control",
        );
      const press = (name: string, variant: ButtonVariant = "secondary") => {
        const p = label(name, variant);
        assert.ok(p, `actual ${plan.name} ${name} control visible`);
        ui.click(p);
      };
      plan.draft(ui);
      let fault = false;
      try {
        syncFs.rmdirSync = (dir, ...args) => {
          if (String(dir).startsWith(`${plan.file}.write-lock.released-`) && !fault) {
            fault = true;
            throw new Error(`Fixture ${plan.name} published cleanup EIO`);
          }
          return rmdir(dir, ...args);
        };
        plan.commit(ui, window, press);
      } finally {
        syncFs.rmdirSync = rmdir;
      }
      assert.equal(plan.ids().length, 1);
      const beforeIds = plan.ids(),
        bytes = await fs.readFile(plan.file);
      assert.equal(
        closes,
        0,
        "published cleanup warning remains visible rather than exiting Calendar",
      );
      assert.ok(
        locateText(
          backend,
          ui.native.lastFrame!,
          plan.width,
          plan.height,
          theme,
          "Saved; cleanup pending",
          { fontSize: 17, fontWeight: "medium", color: theme.foundations.palette.text },
        ),
        `actual ${plan.name} full truthful warning heading visible`,
      );
      assert.ok(label("Retry", "primary"));
      assert.ok(label("Close"));
      await capture(
        `actual-${plan.name}-published-warning`,
        ui.native.lastFrame!,
        plan.width,
        plan.height,
      );
      press("Retry", "primary");
      assert.equal(
        locateText(
          backend,
          ui.native.lastFrame!,
          plan.width,
          plan.height,
          theme,
          "Saved; cleanup pending",
          { fontSize: 17, fontWeight: "medium", color: theme.foundations.palette.text },
        ),
        null,
        "successful cleanup clears the warning",
      );
      assert.deepEqual(
        await fs.readFile(plan.file),
        bytes,
        "maintenance retry never republishes data",
      );
      assert.deepEqual(plan.ids(), beforeIds, "maintenance retry never duplicates IDs");
      plan.cleanRetry(ui);
      assert.deepEqual(plan.ids(), beforeIds);
      ui.native.requestClose();
      window.tick();
      assert.equal(closes, 1, "published clean Calendar draft permits one deliberate close");
      await capture(
        `actual-${plan.name}-acknowledged`,
        ui.native.lastFrame!,
        plan.width,
        plan.height,
      );
      cases++;
    } finally {
      window.destroy();
      backend.disconnect();
    }
  }
  console.log(
    `[storage/publication-cleanup] ${cases} real filesystem/child/duplicate-ID/public Window committed-warning/retry/nonduplicate-close cases passed`,
  );
} finally {
  retryStoreCleanup();
  setUiScaleFactor(1);
  await fs.rm(temp, { recursive: true, force: true });
}

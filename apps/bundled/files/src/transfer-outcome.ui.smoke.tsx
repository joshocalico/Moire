import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { PNG } from "pngjs";
import { Window, Label, getWidgetTheme, installUiFonts, type ContextMenuAction } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";

const sourceRoot = process.env.MOIRE_TEST_ROOT;
const { FilesApp }: typeof import("./main") = sourceRoot
  ? await import(pathToFileURL(path.join(sourceRoot, "apps/bundled/files/src/main.tsx")).href)
  : await import("./main");
const fixture = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), "moire-transfer-notice-ui-")),
);
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
// The session file clipboard lives in the runtime directory; keep it in the fixture.
process.env.XDG_RUNTIME_DIR = path.join(fixture, ".run");
process.env.XDG_DATA_HOME = path.join(fixture, ".local", "share");
const backend = new HeadlessPlatform();
const window = new Window({
  title: "Transfer outcome notices",
  width: 1280,
  height: 760,
  decorated: false,
});
let busy = false;
let actions: ContextMenuAction[] = [];
try {
  const source = path.join(fixture, "source"),
    destination = path.join(fixture, "destination");
  await fs.mkdir(source);
  await fs.mkdir(destination);
  await fs.writeFile(path.join(source, "only.txt"), "Unmoved source bytes");
  await fs.writeFile(path.join(destination, "only.txt"), "Unchanged destination bytes");
  await fs.mkdir(path.join(fixture, ".config", "moire"), { recursive: true });
  await fs.writeFile(
    path.join(fixture, ".config", "moire", "files-view.json"),
    JSON.stringify({ view: "list" }),
  );
  await installUiFonts();
  await backend.connect();
  window.setContent((size) => (
    <FilesApp
      {...size}
      initialPath={source}
      windowActions={window}
      onQuit={() => {}}
      onBusyChange={(value) => {
        busy = value;
      }}
      onShowContextMenu={(request) => {
        actions = request.actions;
        return true;
      }}
    />
  ));
  window.mount(backend);
  const native = backend.getWindows()[0]!;
  const key = (code: number, name: string, ctrl = false, text?: string) => {
    const modifiers = { ctrl, shift: false, alt: false, meta: false };
    native.injectKey({ type: "down", code, key: name, text, modifiers, timeMs: Date.now() });
    native.injectKey({ type: "up", code, key: name, modifiers, timeMs: Date.now() });
    window.tick();
  };
  const settle = async () => {
    for (let n = 0; n < 25; n++) {
      await new Promise((done) => setTimeout(done, 10));
      window.tick();
    }
  };
  const findText = (
    text: string,
    color: number,
    fontSize = 11,
    fontWeight: "regular" | "medium" | "bold" = "regular",
  ) => {
    const probe = new Window({
      title: "Independent text glyph oracle",
      width: 500,
      height: 40,
      decorated: false,
    });
    probe.setContent(
      <Label
        width={500}
        height={40}
        text={text}
        fontSize={fontSize}
        fontWeight={fontWeight}
        color={color}
      />,
    );
    probe.mount(backend);
    probe.tick();
    const pattern = backend.getWindows().at(-1)!.lastFrame!;
    const rgb = [color & 255, (color >>> 8) & 255, (color >>> 16) & 255];
    const points: [number, number][] = [];
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 500; x++) {
        const at = (y * 500 + x) * 4;
        if (pattern[at + 3] === 255 && rgb.every((c, i) => pattern[at + i] === c))
          points.push([x, y]);
      }
    probe.destroy();
    assert.ok(
      points.length > 10,
      `the independent oracle paints real foreground glyphs: color=${color} rgb=${rgb} points=${points.length}`,
    );
    const [firstX, firstY] = points[0]!;
    const frame = native.lastFrame!;
    for (let y = 0; y < 760; y++)
      for (let x = 0; x < 1280; x++) {
        const at = (y * 1280 + x) * 4;
        if (!rgb.every((c, i) => frame[at + i] === c)) continue;
        if (
          points.every(([px, py]) => {
            const xx = x + px - firstX,
              yy = y + py - firstY;
            if (xx < 0 || xx >= 1280 || yy < 0 || yy >= 760) return false;
            return rgb.every((c, i) => frame[(yy * 1280 + xx) * 4 + i] === c);
          })
        )
          return { x, y };
      }
    return null;
  };
  const paints = (text: string, color: number) => !!findText(text, color);
  const capture = async (name: string) => {
    if (!process.env.MOIRE_CAPTURE_DIR) return;
    await fs.mkdir(process.env.MOIRE_CAPTURE_DIR, { recursive: true });
    const png = new PNG({ width: 1280, height: 760 });
    const pixels = native.lastFrame!;
    for (let at = 0; at < pixels.length; at += 4)
      png.data.set([pixels[at + 2]!, pixels[at + 1]!, pixels[at]!, pixels[at + 3]!], at);
    await fs.writeFile(
      path.join(process.env.MOIRE_CAPTURE_DIR, `${name}.png`),
      PNG.sync.write(png),
    );
  };
  await settle();
  key(30, "a", true);
  key(45, "x", true);
  key(38, "l", true);
  for (const character of destination) key(0, character, false, character);
  key(28, "Enter");
  await settle();
  key(47, "v", true);
  await settle();
  assert.equal(busy, true);
  key(15, "Tab");
  key(15, "Tab");
  key(28, "Enter");
  await settle();
  assert.equal(busy, false);
  const palette = getWidgetTheme().foundations.palette;
  await capture("all-skipped-dialog");
  assert.equal(
    paints("No items were completed. Source items are unchanged.", palette.muted),
    true,
    "real all-skipped dialog must paint accurate details instead of promising Undo",
  );
  assert.equal(
    paints("Moves preserve the original item; Undo is available.", palette.muted),
    false,
  );
  key(1, "Escape");
  await settle();
  await capture("all-skipped-notice");
  assert.equal(
    // The operation card paints outcomes at 12px.
    !!findText("No items moved. 1 item skipped.", palette.text, 12),
    true,
    "actual Files terminal notice must state zero completed and real Skip",
  );
  key(139, "ContextMenu");
  assert.equal(
    actions.find((action) => action.id === "undo")?.disabled,
    true,
    "no real move receipt means no new Undo action",
  );
  assert.notEqual(
    actions.find((action) => action.id === "paste")?.disabled,
    true,
    "the skipped cut source remains available to retry",
  );
  assert.equal(await fs.readFile(path.join(source, "only.txt"), "utf8"), "Unmoved source bytes");
  assert.equal(
    await fs.readFile(path.join(destination, "only.txt"), "utf8"),
    "Unchanged destination bytes",
  );
  // A real Move-to command keeps the current folder at source until Show in folder acts.
  key(38, "l", true);
  for (const character of source) key(0, character, false, character);
  key(28, "Enter");
  await settle();
  key(30, "a", true);
  key(139, "ContextMenu");
  const move = actions.find((action) => action.id === "move-to");
  assert.ok(move && !move.disabled);
  move.onPress?.();
  await settle();
  key(30, "a", true);
  for (const character of destination) key(0, character, false, character);
  key(28, "Enter");
  await settle();
  assert.equal(busy, true);
  key(15, "Tab");
  key(15, "Tab");
  key(15, "Tab");
  key(57, " ");
  await settle();
  assert.equal(busy, false);
  assert.equal(
    await fs.readFile(path.join(destination, "only (2).txt"), "utf8"),
    "Unmoved source bytes",
  );
  await assert.rejects(fs.stat(path.join(source, "only.txt")), /ENOENT/);
  const showStyle = getWidgetTheme().recipes.button.secondary.medium.label.base;
  const show = findText(
    "Show in folder",
    showStyle.color,
    showStyle.fontSize,
    showStyle.fontWeight,
  );
  assert.ok(show, "real terminal navigation action paints its complete label");
  native.injectPointer({ type: "down", button: "left", ...show, timeMs: Date.now() });
  native.injectPointer({ type: "up", button: "left", ...show, timeMs: Date.now() + 1 });
  window.tick();
  await settle();
  await capture("show-in-folder-real-navigation");
  assert.ok(
    // Rows name their file in the medium weight.
    findText("only (2).txt", palette.text, 13, "medium"),
    "Show in folder navigates to the retained destination and paints the actual numbered result",
  );
  key(139, "ContextMenu");
  assert.equal(
    actions.find((action) => action.id === "undo")?.disabled,
    false,
    "successful publication retains genuine Undo after navigation",
  );
  // Destination disappearance is a real read-only navigation failure, not a successful dismissal.
  const gone = path.join(fixture, "removed-destination");
  await fs.mkdir(gone);
  key(30, "a", true);
  key(139, "ContextMenu");
  const copy = actions.find((action) => action.id === "copy-to");
  assert.ok(copy && !copy.disabled);
  copy.onPress?.();
  await settle();
  key(30, "a", true);
  for (const character of gone) key(0, character, false, character);
  key(28, "Enter");
  await settle();
  assert.equal(busy, false);
  assert.ok((await fs.readdir(gone)).includes("only (2).txt"));
  await fs.rm(gone, { recursive: true });
  const failedShow = findText(
    "Show in folder",
    showStyle.color,
    showStyle.fontSize,
    showStyle.fontWeight,
  );
  assert.ok(failedShow);
  native.injectPointer({ type: "down", button: "left", ...failedShow, timeMs: Date.now() });
  native.injectPointer({ type: "up", button: "left", ...failedShow, timeMs: Date.now() + 1 });
  window.tick();
  await settle();
  await capture("show-in-folder-missing-destination");
  assert.ok(
    findText("Copy complete", palette.text, 24, "medium"),
    "failed folder reveal preserves the genuine completed receipt",
  );
  const doneStyle = getWidgetTheme().recipes.button.primary.medium.label.base;
  assert.ok(
    findText("Done", doneStyle.color, doneStyle.fontSize, doneStyle.fontWeight),
    "missing destination leaves usable dismissal",
  );
  key(1, "Escape");
  await settle();
  console.log(
    JSON.stringify({
      kind: "transfer-outcome-ui",
      source: sourceRoot ?? "workspace",
      scope:
        "actual public Window Cut/Paste/Skip, full terminal detail and notice glyphs, real Undo disabled and retry retained, Move-to/Keep-both/Show-in-folder real destination navigation and numbered bytes; no native delivery claim",
    }),
  );
} finally {
  window.destroy();
  backend.disconnect();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await fs.rm(fixture, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { PNG } from "pngjs";
import {
  installUiFonts,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  TextBlock,
  type ContextMenuAction,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
const sourceRoot = process.env.MOIRE_TEST_ROOT;
const { FilesApp }: typeof import("./main") = sourceRoot
  ? await import(pathToFileURL(path.join(sourceRoot, "apps/bundled/files/src/main.tsx")).href)
  : await import("./main");
const width = Number(process.env.MOIRE_CAPTURE_WIDTH ?? 1280);
const height = Number(process.env.MOIRE_CAPTURE_HEIGHT ?? 800);
assert.ok(
  Number.isInteger(width) &&
    width >= 440 &&
    width <= 1600 &&
    Number.isInteger(height) &&
    height >= 480 &&
    height <= 1000,
);
const colorScheme = process.env.MOIRE_CAPTURE_SCHEME === "light" ? "light" : "dark";
const theme = createPersonalizedWidgetTheme(
  discoverPersonalization("linux", { themeFamily: "moire", colorScheme, reducedMotion: true }),
);

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-visual-"));
const output =
  process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ??
  (await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-captures-")));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
process.env.XDG_DATA_HOME = path.join(fixture, ".local", "share");
const backend = new HeadlessPlatform();
const window = new Window({
  title: "Files visual fixture",
  width,
  height,
  decorated: false,
});
let menuTitle = "";
let menuActions: ContextMenuAction[] = [];
try {
  await installUiFonts();
  const directory = path.join(fixture, "Projects", "Moire");
  await fs.mkdir(directory, { recursive: true });
  for (const name of ["design", "icons", "packages", "wallpapers"])
    await fs.mkdir(path.join(directory, name));
  for (const name of [
    "brand-guidelines.txt",
    "desktop.tsx",
    "palette.json",
    "README.md",
    "wallpaper-study.txt",
    "window-motion.txt",
    "workspace.txt",
  ])
    await fs.writeFile(path.join(directory, name), `Disposable visual fixture: ${name}\n`);
  const artworkPath = fileURLToPath(
    new URL("../../../../themes/default/botanical-wisteria.png", import.meta.url),
  );
  await fs.copyFile(artworkPath, path.join(directory, "bloom.png"));
  const config = path.join(fixture, ".config", "moire");
  await fs.mkdir(config, { recursive: true });
  await fs.writeFile(path.join(config, "files-view.json"), JSON.stringify({ view: "list" }));
  await fs.writeFile(
    path.join(config, "files-places.json"),
    JSON.stringify({
      version: 1,
      favorites: [{ label: "Projects", path: path.dirname(directory) }],
    }),
  );
  await fs.writeFile(
    path.join(config, "files-tags.json"),
    JSON.stringify({
      version: 1,
      records: [{ path: path.join(directory, "bloom.png"), tags: ["Design", "Wallpapers"] }],
    }),
  );
  await fs.mkdir(output, { recursive: true });
  await backend.connect();
  window.setContent((size) => (
    <WidgetThemeProvider theme={theme}>
      <FilesApp
        {...size}
        initialPath={directory}
        windowActions={window}
        onQuit={() => {}}
        onShowContextMenu={(request) => {
          menuTitle = request.title;
          menuActions = request.actions;
          return false;
        }}
      />
    </WidgetThemeProvider>
  ));
  window.mount(backend);
  await Promise.resolve();
  const native = backend.getWindows()[0];
  assert.ok(native);
  const settle = async () => {
    for (let step = 0; step < 15; step++) {
      await new Promise((done) => setTimeout(done, 10));
      window.tick();
    }
  };
  const key = (code: number, name: string) => {
    const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
    native.injectKey({ type: "down", code, key: name, modifiers, timeMs: Date.now() });
    native.injectKey({ type: "up", code, key: name, modifiers, timeMs: Date.now() });
    window.tick();
  };
  const click = (x: number, y: number) => {
    native.injectPointer({ type: "down", button: "left", x, y, timeMs: Date.now() });
    native.injectPointer({ type: "up", button: "left", x, y, timeMs: Date.now() + 1 });
    window.tick();
  };
  const inspectSelection = async () => {
    key(139, "ContextMenu");
    await settle();
    assert.equal(menuTitle, "bloom.png", "preview dismissal/resize retains the real selected file");
    const enabled = menuActions.filter((action) => !action.disabled);
    const index = enabled.findIndex((action) => action.id === "inspect");
    assert.ok(index >= 0);
    key(102, "Home");
    for (let row = 0; row < index; row++) key(108, "ArrowDown");
    key(28, "Enter");
    await settle();
  };
  const save = async (name: string) => {
    assert.ok(native.lastFrame);
    const png = new PNG({ width: window.getWidth(), height: window.getHeight() });
    for (let offset = 0; offset < native.lastFrame.length; offset += 4)
      png.data.set(
        [
          native.lastFrame[offset + 2] ?? 0,
          native.lastFrame[offset + 1] ?? 0,
          native.lastFrame[offset] ?? 0,
          native.lastFrame[offset + 3] ?? 0,
        ],
        offset,
      );
    await fs.writeFile(path.join(output, name), PNG.sync.write(png));
  };
  const assertPaintedText = (text: string, color: number) => {
    // Independent public Window glyph oracle, matched only at fully painted foreground
    // pixels. It tolerates the app's actual layout and background without reading private state.
    const probe = new Window({ title: "Glyph oracle", width: 240, height: 32, decorated: false });
    probe.setContent(
      <WidgetThemeProvider theme={theme}>
        <TextBlock width={240} height={32} text={text} fontSize={13} color={color} />
      </WidgetThemeProvider>,
    );
    probe.mount(backend);
    probe.tick();
    const frame = backend.getWindows().at(-1)!.lastFrame!;
    const rgb = [color & 255, (color >>> 8) & 255, (color >>> 16) & 255];
    const solid: Array<[number, number]> = [];
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 240; x++) {
        const at = (y * 240 + x) * 4;
        if (frame[at + 3] === 255 && rgb.every((channel, index) => frame[at + index] === channel))
          solid.push([x, y]);
      }
    probe.destroy();
    assert.ok(solid.length > 6, `${text} glyph oracle must paint real solid foreground`);
    const [firstX, firstY] = solid[0]!;
    const offsets = solid.map(([x, y]) => [x - firstX, y - firstY]);
    const actual = native.lastFrame!;
    let found = false;
    for (let y = 0; y < window.getHeight() && !found; y++)
      for (let x = 0; x < window.getWidth() && !found; x++) {
        const at = (y * window.getWidth() + x) * 4;
        if (!rgb.every((channel, index) => actual[at + index] === channel)) continue;
        found = offsets.every(([dx, dy]) => {
          const px = x + dx!,
            py = y + dy!;
          if (px < 0 || px >= window.getWidth() || py < 0 || py >= window.getHeight()) return false;
          const pixel = (py * window.getWidth() + px) * 4;
          return rgb.every((channel, index) => actual[pixel + index] === channel);
        });
      }
    assert.ok(found, `actual visible inspector must paint ${text}`);
  };
  await settle();
  await save("files-folder.png");
  key(102, "Home");
  for (let index = 0; index < 4; index++) key(108, "ArrowDown");
  await settle();
  await save("files-image-preview.png");
  key(139, "ContextMenu");
  await settle();
  await save("files-item-menu.png");
  key(1, "Escape");
  await settle();
  if (width < 960) {
    click(155, 170);
    await settle();
    await save("files-preview-open.png");
    const colors = new Set<number>();
    for (let at = 0; at < native.lastFrame!.length; at += 4)
      colors.add(
        (native.lastFrame![at]! << 16) |
          (native.lastFrame![at + 1]! << 8) |
          native.lastFrame![at + 2]!,
      );
    assert.ok(
      colors.size > 5000,
      "opened inspector must paint the actual full photo, beyond the small row thumbnail",
    );
    const beforeScroll = Buffer.from(native.lastFrame!);
    native.injectPointer({
      type: "wheel",
      x: width / 2,
      y: height - 100,
      deltaY: 340,
      timeMs: Date.now(),
    });
    window.tick();
    await settle();
    assert.notEqual(
      Buffer.compare(beforeScroll, Buffer.from(native.lastFrame!)),
      0,
      "compact inspector metadata/tags are accessible through actual scrolling",
    );
    assertPaintedText("Tags", theme.foundations.palette.muted);
    assertPaintedText("1586 × 992 pixels", theme.foundations.palette.text);
    await save("files-preview-metadata-tags.png");
    key(1, "Escape");
    await settle();
    await inspectSelection();
    await save("files-preview-reopened.png");
    native.setSize(1280, 800);
    window.tick();
    await settle();
    await save("files-preview-resized-wide.png");
    native.setSize(width, height);
    window.tick();
    await settle();
    await save("files-preview-resized-small.png");
    key(1, "Escape");
    await settle();
    key(139, "ContextMenu");
    await settle();
    assert.equal(menuTitle, "bloom.png");
  }
  console.log(
    JSON.stringify({
      kind: "files-visual-captures",
      output,
      width,
      height,
      colorScheme,
      appSource: sourceRoot ?? "current workspace",
      sharedUi: "current fixture loader resolution; host baseline is not immutable native C21",
      files: (await fs.readdir(output)).filter((name) => name.endsWith(".png")).sort(),
    }),
  );
} finally {
  window.destroy();
  backend.disconnect();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(fixture, { recursive: true, force: true });
}

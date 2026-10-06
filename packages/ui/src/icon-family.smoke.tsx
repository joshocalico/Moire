/** Verify shipped artwork through the actual Icon/renderer path at normal sizes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { PNG } from "pngjs";
import { createShellRoot, renderShell, SoftwareRenderer } from "@moire/react-host";
import { ICON_NAMES, Icon, applicationIcon } from "./widgets/icon";
import { loadSvgIconSync } from "#ui/image/svg-icon";

const renderer = new SoftwareRenderer();
const directory = fileURLToPath(new URL("../icons/", import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-icon-family-"));
const frame = (name: string, size: number, color: number, symbolic?: boolean, file?: string) => {
  const root = createShellRoot();
  try {
    renderShell(
      root,
      <Icon name={name} size={size} color={color} symbolic={symbolic} path={file} />,
    );
    return renderer.render(root.container, { width: size, height: size }).pixels.slice();
  } finally {
    renderShell(root, null);
  }
};
let cases = 0;
try {
  for (const name of ICON_NAMES)
    for (const size of [16, 20, 24, 32, 44]) {
      const file = path.join(directory, `${name}.svg`);
      assert.ok(fs.existsSync(file), `Missing vector artwork: ${name}`);
      for (const color of [0xffeeeaf7, 0xff392857]) {
        const artwork = loadSvgIconSync(file, size, color);
        assert.ok(
          artwork.rgba.some((value, index) => index % 4 === 3 && value > 0),
          `${name}: blank asset`,
        );
        const pixels = frame(name, size, color);
        assert.deepEqual(
          pixels,
          frame(name, size, color, true),
          `${name}: default fell back to legacy bitmap`,
        );
        let painted = 0;
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++) {
            if (!pixels[(y * size + x) * 4 + 3]) continue;
            painted++;
            assert.ok(
              x > 0 && y > 0 && x < size - 1 && y < size - 1,
              `${name}/${size}: artwork touches its allocation boundary at ${x},${y}`,
            );
          }
        assert.ok(painted >= 4, `${name}/${size}: unreadable empty glyph`);
        cases++;
      }
    }
  const apps = [
    "Files",
    "Editor",
    "ImageViewer",
    "Calculator",
    "Notes",
    "Music",
    "ArchiveManager",
    "SystemMonitor",
    "Calendar",
    "Clock",
    "Screenshot",
    "DocumentViewer",
    "VideoPlayer",
    "DiskUsage",
    "FontViewer",
    "Characters",
    "Colors",
    "SoundRecorder",
    "Weather",
    "Dictionary",
    "Help",
  ];
  const glyphs = new Set<string>();
  for (const id of apps) {
    const name = applicationIcon(`org.moire.${id}`);
    assert.notEqual(name, "app", `${id}: generic identity`);
    assert.equal(
      applicationIcon(`moire-${id.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}.desktop`),
      name,
    );
    const key = Buffer.from(frame(name, 24, 0xffeeeaf7)).toString("base64");
    assert.ok(!glyphs.has(key), `${id}: duplicated application glyph`);
    glyphs.add(key);
  }
  assert.equal(applicationIcon("org.example.Unrelated"), "app");
  const png = new PNG({ width: 2, height: 2 });
  png.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
  const raster = path.join(fixture, "explicit.png");
  fs.writeFileSync(raster, PNG.sync.write(png));
  assert.notDeepEqual(
    frame("app", 24, 0xffeeeaf7, undefined, raster),
    frame("app", 24, 0xffeeeaf7),
    "Explicit application artwork was overridden",
  );
  const unsupported = path.join(fixture, "unsupported.svg");
  fs.writeFileSync(unsupported, '<svg viewBox="0 0 24 24"><path d="M0 0 L24 24" /></svg>');
  assert.throws(() => loadSvgIconSync(unsupported, 24, 0xffeeeaf7), /unsupported/);
  assert.ok(
    frame("file", 24, 0xffeeeaf7, true, unsupported).some(
      (value, index) => index % 4 === 3 && value > 0,
    ),
    "Unsupported explicit SVG produced a blank icon",
  );
  console.log(
    `[icon-family] ${cases} size/tint/default-vector frames, ${glyphs.size} distinct app identities, explicit artwork passed`,
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

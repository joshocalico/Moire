import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { PNG } from "pngjs";
import {
  Window,
  TextBlock,
  installUiFonts,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
const source = process.env.MOIRE_TEST_ROOT;
const { FileInspector }: typeof import("./inspector") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/files/src/inspector.tsx")).href)
  : await import("./inspector");
const { inspectFiles }: typeof import("./inspection") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/files/src/inspection.ts")).href)
  : await import("./inspection");
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-timestamp-"));
const output =
  process.env.MOIRE_CAPTURE_DIR ??
  (await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-timestamp-captures-")));
try {
  await fs.writeFile(path.join(fixture, "sample.txt"), "Actual inspection file");
  const instant = new Date("2026-10-03T01:02:03.456Z");
  await fs.utimes(fixture, instant, instant);
  const stat = await fs.lstat(fixture),
    metadata = await inspectFiles([], fixture);
  const multiple = await inspectFiles(
    [
      { name: "folder", path: fixture, isDir: true, size: stat.size, modified: stat.mtimeMs },
      {
        name: "sample",
        path: path.join(fixture, "sample.txt"),
        isDir: false,
        size: 22,
        modified: stat.mtimeMs,
      },
    ],
    fixture,
  );
  assert.equal(
    multiple.modifiedAt,
    undefined,
    "a selection range must not pretend to be a single timestamp",
  );
  await installUiFonts();
  await fs.mkdir(output, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    const theme = createPersonalizedWidgetTheme(
      discoverPersonalization("linux", {
        themeFamily: "moire",
        colorScheme: scheme,
        reducedMotion: true,
      }),
    );
    const backend = new HeadlessPlatform();
    await backend.connect();
    const window = new Window({
      title: "Current folder modified timestamp",
      width: 320,
      height: 560,
      decorated: false,
    });
    window.setContent(
      <WidgetThemeProvider theme={theme}>
        <FileInspector
          width={320}
          height={560}
          entries={[]}
          cwd={fixture}
          refresh={0}
          tags={[]}
          tagsReady
          busy={false}
          onTags={() => {}}
          onTextFocus={() => {}}
          onOpen={() => {}}
          onReveal={() => {}}
          onRename={() => {}}
          onActions={() => {}}
        />
      </WidgetThemeProvider>,
    );
    window.mount(backend);
    await Promise.resolve();
    const native = backend.getWindows()[0]!;
    try {
      for (let frame = 0; frame < 20; frame++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        window.tick();
      }
      const actual = native.lastFrame!;
      assert.equal(actual.length, 320 * 560 * 4);
      const png = new PNG({ width: 320, height: 560 });
      for (let at = 0; at < actual.length; at += 4)
        png.data.set([actual[at + 2]!, actual[at + 1]!, actual[at]!, actual[at + 3]!], at);
      await fs.writeFile(
        path.join(output, `files-current-folder-${scheme}.png`),
        PNG.sync.write(png),
      );
      // Match an independently painted compact timestamp against the real current-folder
      // inspector. The raw locale date used in C22 cannot satisfy this glyph oracle.
      const expected = new Date(stat.mtimeMs).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        color = theme.foundations.palette.text;
      const probe = new Window({
        title: "Timestamp glyph oracle",
        width: 240,
        height: 32,
        decorated: false,
      });
      probe.setContent(
        <WidgetThemeProvider theme={theme}>
          <TextBlock width={240} height={32} text={expected} fontSize={13} color={color} />
        </WidgetThemeProvider>,
      );
      probe.mount(backend);
      probe.tick();
      const pattern = backend.getWindows().at(-1)!.lastFrame!;
      const rgb = [color & 255, (color >>> 8) & 255, (color >>> 16) & 255];
      const solid: Array<[number, number]> = [];
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 240; x++) {
          const at = (y * 240 + x) * 4;
          if (
            pattern[at + 3] === 255 &&
            rgb.every((channel, index) => pattern[at + index] === channel)
          )
            solid.push([x, y]);
        }
      probe.destroy();
      assert.ok(solid.length > 10);
      const [firstX, firstY] = solid[0]!;
      let found = false;
      for (let y = 0; y < 560 && !found; y++)
        for (let x = 0; x < 320 && !found; x++) {
          const at = (y * 320 + x) * 4;
          if (!rgb.every((channel, index) => actual[at + index] === channel)) continue;
          found = solid.every(([sx, sy]) => {
            const px = x + sx - firstX,
              py = y + sy - firstY;
            if (px < 0 || px >= 320 || py < 0 || py >= 560) return false;
            const pixel = (py * 320 + px) * 4;
            return rgb.every((channel, index) => actual[pixel + index] === channel);
          });
        }
      assert.ok(
        found,
        `actual current-folder inspector must fully paint compact timestamp ${expected}`,
      );
    } finally {
      window.destroy();
      backend.disconnect();
    }
  }
  assert.equal(
    metadata.modifiedAt,
    stat.mtimeMs,
    "current-folder inspection exposes its actual stat timestamp without locale parsing",
  );
  console.log(
    JSON.stringify({
      kind: "files-current-folder-timestamp",
      source: source ?? "workspace",
      output,
      modifiedAt: stat.mtimeMs,
      scope: "actual stat boundary + public Window foreground glyphs; native acceptance Root-owned",
    }),
  );
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}

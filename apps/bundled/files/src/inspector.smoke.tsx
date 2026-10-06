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
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  measureWrappedText,
  installUiFonts,
  usePalette,
  setUiScaleFactor,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
const source = process.env.MOIRE_TEST_ROOT;
const { FileInspector, inspectionValue }: typeof import("./inspector") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/files/src/inspector.tsx")).href)
  : await import("./inspector");
const { inspectFiles }: typeof import("./inspection") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/files/src/inspection.ts")).href)
  : await import("./inspection");
import { readDirectory } from "./filesystem";
import { formatBytes } from "./format";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-inspector-"));
try {
  await fs.mkdir(path.join(fixture, "Folder"));
  await fs.writeFile(path.join(fixture, "sample.txt"), "Actual preview");
  const earliest = new Date("2025-12-31T12:34:00Z"),
    latest = new Date("2026-10-03T03:45:00Z");
  await fs.utimes(path.join(fixture, "Folder"), earliest, earliest);
  await fs.utimes(path.join(fixture, "sample.txt"), latest, latest);
  const inspection = await inspectFiles([], fixture);
  assert.equal(inspection.details.find(([key]) => key === "Contents")?.[1], "2 items · 1 folder");
  assert.match(
    inspection.details.find(([key]) => key === "Available bytes")?.[1] ?? "",
    /^\d+(\.\d+)? (B|KB|MB|GB|TB|PB)$/,
  );
  assert.equal(formatBytes(1024 ** 4), "1.00 TB");
  const capacity = inspection.details.find(([key]) => key === "Available bytes")?.[1];
  assert.ok(capacity);
  assert.equal(
    inspectionValue("Available bytes", capacity),
    capacity,
    "the inspector must not parse formatted capacity as raw bytes",
  );
  assert.equal(inspectionValue("File bytes", "1,024"), "1.0 KB");
  const entries = await readDirectory(fixture, false);
  const selection = await inspectFiles(entries, fixture);
  assert.equal(selection.details.find(([key]) => key === "Selection")?.[1], "2 items · 1 folder");
  assert.equal(selection.details.find(([key]) => key === "File bytes")?.[1], "14");
  if (!source) assert.deepEqual(selection.modifiedRange, [earliest.getTime(), latest.getTime()]);
  await installUiFonts();
  for (const scale of [1, 1.5]) {
    setUiScaleFactor(scale);
    const backend = new HeadlessPlatform();
    await backend.connect();
    const width = 360 * scale,
      height = 520 * scale;
    const window = new Window({ title: "Inspector geometry", width, height, decorated: false });
    let accent = 0;
    function Inspector() {
      accent = usePalette().accent;
      return (
        <FileInspector
          width={width}
          height={height}
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
      );
    }
    window.setContent(<Inspector />);
    window.mount(backend);
    await Promise.resolve();
    window.tick();
    const native = backend.getWindows()[0]!;
    for (let i = 0; i < 10; i++) {
      await new Promise((done) => setTimeout(done, 10));
      window.tick();
    }
    assert.ok(native.lastFrame);
    // The preview is allocated by Column: inset, header, gap, then its 96px card.
    const top = 54 * scale,
      bottom = top + 96 * scale;
    let minX = width,
      maxX = 0,
      minY = height,
      maxY = 0;
    const r = (accent >>> 16) & 255,
      g = (accent >>> 8) & 255,
      b = accent & 255;
    for (let y = Math.ceil(top); y < bottom; y++)
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        if (
          native.lastFrame[index] === b &&
          native.lastFrame[index + 1] === g &&
          native.lastFrame[index + 2] === r
        ) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    assert.ok(minX <= maxX && minY <= maxY, "folder artwork must have real painted pixels");
    assert.ok(
      Math.abs((minX + maxX) / 2 - width / 2) <= 8 * scale,
      "folder artwork is horizontally centered",
    );
    assert.ok(
      Math.abs((minY + maxY) / 2 - (top + bottom) / 2) <= 8 * scale,
      "folder artwork is vertically centered",
    );
    assert.ok(
      maxY < bottom - 8 * scale,
      "folder artwork does not touch or clip at the card bottom",
    );
    window.destroy();
    backend.disconnect();
  }
  let rangeCases = 0;
  for (const scale of [1, 1.5])
    for (const scheme of ["light", "dark"] as const)
      for (const logicalWidth of [240, 360]) {
        setUiScaleFactor(scale);
        const width = logicalWidth * scale,
          height = 720 * scale,
          valueWidth = width - 56 * scale;
        const expected = [earliest, latest]
          .map((date) =>
            date.toLocaleString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          )
          .join(" —\n");
        const measured = measureWrappedText(expected, valueWidth, { fontSize: 13 });
        assert.ok(measured.lines.length >= 2, "both actual timestamps occupy wrapped lines");
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
          title: "Selected timestamps",
          width,
          height,
          decorated: false,
        });
        window.setContent(
          <WidgetThemeProvider theme={theme}>
            <FileInspector
              width={width}
              height={height}
              entries={entries.map((entry) => ({ ...entry, modified: 0 }))}
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
            await new Promise((done) => setTimeout(done, 10));
            window.tick();
          }
          const actual = native.lastFrame!;
          if (process.env.MOIRE_CAPTURE_DIR) {
            await fs.mkdir(process.env.MOIRE_CAPTURE_DIR, { recursive: true });
            const png = new PNG({ width, height });
            for (let at = 0; at < actual.length; at += 4)
              png.data.set([actual[at + 2]!, actual[at + 1]!, actual[at]!, actual[at + 3]!], at);
            await fs.writeFile(
              path.join(
                process.env.MOIRE_CAPTURE_DIR,
                `selection-range-${scheme}-${scale}-${logicalWidth}.png`,
              ),
              PNG.sync.write(png),
            );
          }
          // Independent TextBlock pixels require every metadata value to survive its
          // real allocation, including complete counts, both dates and the actual path.
          const findText = (text: string, color: number, probeWidth: number) => {
            const probeHeight = Math.ceil(
              measureWrappedText(text, probeWidth, { fontSize: 13 }).height,
            );
            const probe = new Window({
              title: "Metadata glyph oracle",
              width: probeWidth,
              height: probeHeight,
              decorated: false,
            });
            probe.setContent(
              <WidgetThemeProvider theme={theme}>
                <TextBlock width={probeWidth} text={text} fontSize={13} color={color} wrap />
              </WidgetThemeProvider>,
            );
            probe.mount(backend);
            probe.tick();
            const pattern = backend.getWindows().at(-1)!.lastFrame!;
            const rgb = [color & 255, (color >>> 8) & 255, (color >>> 16) & 255];
            const solid: Array<[number, number]> = [];
            for (let y = 0; y < probeHeight; y++)
              for (let x = 0; x < probeWidth; x++) {
                const at = (y * probeWidth + x) * 4;
                if (
                  pattern[at + 3] === 255 &&
                  rgb.every((channel, index) => pattern[at + index] === channel)
                )
                  solid.push([x, y]);
              }
            probe.destroy();
            assert.ok(solid.length > 10, "independent metadata probe paints real glyphs");
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
                  })
                )
                  return { top: y - firstY, bottom: y - firstY + probeHeight };
              }
            return null;
          };
          const count = findText("2 items · 1 folder", theme.foundations.palette.text, valueWidth);
          assert.ok(
            count,
            `complete selected count must paint at ${logicalWidth}px/${scale}/${scheme}`,
          );
          const range = findText(expected, theme.foundations.palette.text, valueWidth);
          assert.ok(
            range,
            `complete selected timestamp range must paint at ${logicalWidth}px/${scale}/${scheme}`,
          );
          assert.ok(range.top > count.bottom, "the measured range row cannot overlap the count");
          const location = findText(fixture, theme.foundations.palette.text, valueWidth);
          assert.ok(
            location,
            `complete selected location must paint at ${logicalWidth}px/${scale}/${scheme}`,
          );
          assert.ok(location.top > range.bottom, "the full location follows the measured range");
          const tags = findText("Tags", theme.foundations.palette.muted, valueWidth);
          assert.ok(
            tags && tags.top > location.bottom,
            "following tags cannot overlap the complete wrapped location",
          );
          rangeCases++;
        } finally {
          window.destroy();
          backend.disconnect();
        }
      }
  console.log(
    `[files/inspector] actual capacity/count/selection, preview centering and ${rangeCases} complete count/range/location and row-spacing cases passed; source=${source ?? "workspace"}`,
  );
} finally {
  setUiScaleFactor(1);
  await fs.rm(fixture, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withFixture } from "@moire/app-tools/testing";
import { fontPreview } from "./backend";
await withFixture(async (directory) => {
  const font = path.join(directory, "sample.ttf");
  await fs.copyFile(
    fileURLToPath(
      new URL("../../../../packages/ui/fonts/IBMPlexSans-Regular.ttf", import.meta.url),
    ),
    font,
  );
  const first = await fontPreview(font, "A real font sample", 32),
    second = await fontPreview(font, "Different sample", 48);
  try {
    assert.match(first.family, /IBM Plex Sans/);
    assert.equal(first.preview.width, 1200);
    assert.notDeepEqual(
      await fs.readFile(first.preview.file),
      await fs.readFile(second.preview.file),
      "sample text and size render the selected font",
    );
  } finally {
    await first.preview.dispose();
    await second.preview.dispose();
  }
  const unsupported = path.join(directory, "other.woff");
  await fs.writeFile(unsupported, "bad");
  await assert.rejects(fontPreview(unsupported, "Text", 32), /TrueType/);
  console.log(
    "[font-viewer] real font family/style, text/size rasterization, cleanup and unsupported format passed",
  );
});

await withFixture(async (directory) => {
  const font = path.join(directory, "selected.ttf");
  await fs.copyFile(
    fileURLToPath(
      new URL("../../../../packages/ui/fonts/IBMPlexSans-Regular.ttf", import.meta.url),
    ),
    font,
  );
  const sample = "W".repeat(120) + "\nFinal glyphs: ÅgjΩ";
  const viewport = { width: 480, height: 240 };
  const first = await fontPreview(font, sample, 96, undefined, viewport);
  const last = await fontPreview(font, sample, 96, undefined, {
    ...viewport,
    page: first.pageCount - 1,
  });
  const original = await fs.readFile(font);
  try {
    assert.ok(first.pageCount > 10, "long unbroken text is wrapped across accessible pages");
    assert.equal(
      first.lines.join(""),
      sample.replaceAll("\n", ""),
      "all characters survive wrapping",
    );
    assert.equal(last.page, last.pageCount - 1);
    assert.equal(first.preview.width, 480);
    assert.equal(first.preview.height, 240);
    for (const result of [first, last]) {
      const { rgba, width, height } = result.preview.bitmap;
      let ink = 0,
        edgeInk = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          if ((rgba[offset] ?? 255) < 245) {
            ink++;
            if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) edgeInk++;
          }
        }
      assert.ok(ink > 100, "selected font actually paints each nonempty page");
      assert.equal(
        edgeInk,
        0,
        "ink remains inside the viewport instead of clipping at its boundary",
      );
    }
    assert.ok(
      !Buffer.from(first.preview.bitmap.rgba).equals(Buffer.from(last.preview.bitmap.rgba)),
      "final characters paint a distinct retrievable page",
    );
  } finally {
    await first.preview.dispose();
    await last.preview.dispose();
  }
  await assert.rejects(fontPreview(font, "x".repeat(501), 36), /500 characters/);
  await assert.rejects(
    fontPreview(font, "text", 36, undefined, { width: 0, height: 240 }),
    /viewport/,
  );
  const empty = await fontPreview(font, "\n\n", 96, undefined, viewport);
  await empty.preview.dispose();
  const maximum = await fontPreview(font, "x".repeat(500), 12, undefined, {
    width: 480,
    height: 240,
  });
  assert.equal(maximum.lines.join("").length, 500);
  await maximum.preview.dispose();
  // A real first-face collection with rebased absolute table offsets. Both
  // fc-scan and ffmpeg consume the original collection, not a renamed TTF.
  const collection = Buffer.alloc(original.length + 16);
  collection.write("ttcf");
  collection.writeUInt32BE(0x00010000, 4);
  collection.writeUInt32BE(1, 8);
  collection.writeUInt32BE(16, 12);
  original.copy(collection, 16);
  const tables = original.readUInt16BE(4);
  for (let index = 0; index < tables; index++) {
    const table = 16 + 12 + index * 16;
    collection.writeUInt32BE(collection.readUInt32BE(table + 8) + 16, table + 8);
  }
  const ttc = path.join(directory, "first-face.ttc");
  await fs.writeFile(ttc, collection);
  const collected = await fontPreview(ttc, "Collection face", 48, undefined, viewport);
  assert.match(collected.family, /IBM Plex Sans/);
  await collected.preview.dispose();
  assert.ok((await fs.readFile(font)).equals(original), "source font remains exact");
  assert.deepEqual(
    await fs.readdir(path.join(directory, "tmp")),
    [],
    "all raster pages and font copies disposed",
  );
  console.log(
    "[font-viewer/pages] real selected-font metrics, long words/newlines/final page/500 character boundary/white edge raster/TTC first face and cleanup passed",
  );
});

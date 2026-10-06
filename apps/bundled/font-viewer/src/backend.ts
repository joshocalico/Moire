import fs from "node:fs/promises";
import path from "node:path";
// eslint-disable-next-line import/default -- The pinned CommonJS package exposes a runtime namespace default.
import opentype, { type Font } from "opentype.js";
import { privatePreview, readableFile, runTool, type Preview } from "@moire/app-tools";
export const MAX_SAMPLE_CHARACTERS = 500;
export type FontPreviewViewport = { width: number; height: number; page?: number };

function firstFace(bytes: Buffer): Font {
  // OpenType collections store absolute table offsets. Move only the first
  // SFNT directory to offset zero; the original table data stays in place.
  if (bytes.subarray(0, 4).toString("ascii") === "ttcf") {
    if (bytes.length < 16 || bytes.readUInt32BE(8) < 1)
      throw new Error("The font collection has no readable first face.");
    const offset = bytes.readUInt32BE(12);
    if (offset + 12 > bytes.length)
      throw new Error("The font collection's first face is truncated.");
    const end = offset + 12 + bytes.readUInt16BE(offset + 4) * 16;
    if (end > bytes.length) throw new Error("The font collection's table directory is truncated.");
    bytes = Buffer.from(bytes);
    bytes.copy(bytes, 0, offset, end);
  }
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
function extent(font: Font, text: string, size: number) {
  const box = font.getPath(text, 0, 0, size).getBoundingBox();
  const left = text.trim() ? Math.min(0, box.x1) : 0;
  const right = text.trim()
    ? Math.max(font.getAdvanceWidth(text, size), box.x2)
    : font.getAdvanceWidth(text, size);
  const height = text.trim() ? box.y2 - box.y1 : 0;
  if (![left, right, height].every(Number.isFinite))
    throw new Error("This font has unsupported glyph metrics.");
  return { width: right - left, left, height };
}
/** Preserve every character; wrap at whitespace or a character boundary for long words. */
export function wrapFontSample(font: Font, sample: string, size: number, width: number): string[] {
  const lines: string[] = [],
    graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const paragraph of sample.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")) {
    let line = "";
    for (const { segment: character } of graphemes.segment(paragraph)) {
      if (extent(font, line + character, size).width <= width) {
        line += character;
        continue;
      }
      const breakAt = line.search(/\s+\S*$/u);
      if (breakAt >= 0) {
        const prefix = line.slice(0, breakAt + 1);
        lines.push(prefix);
        line = line.slice(breakAt + 1);
      } else if (line) {
        lines.push(line);
        line = "";
      }
      if (extent(font, line + character, size).width > width && line) {
        lines.push(line);
        line = "";
      }
      if (extent(font, character, size).width > width)
        throw new Error(
          "A glyph is wider than this preview. Choose a smaller size or a wider window.",
        );
      line += character;
    }
    lines.push(line);
  }
  return lines;
}
export async function fontPreview(
  value: string,
  sample: string,
  size: number,
  signal?: AbortSignal,
  viewport: FontPreviewViewport = { width: 1200, height: 320 },
): Promise<{
  preview: Preview;
  family: string;
  style: string;
  page: number;
  pageCount: number;
  lines: string[];
}> {
  const file = await readableFile(value);
  if (![".ttf", ".otf", ".ttc"].includes(path.extname(file).toLowerCase()))
    throw new Error("Open a TrueType, OpenType or TrueType collection font.");
  if (!Number.isInteger(size) || size < 12 || size > 96)
    throw new Error("Choose a font size between 12 and 96.");
  if ([...sample].length > MAX_SAMPLE_CHARACTERS)
    throw new Error("Sample text supports up to 500 characters. Shorten the sample to preview it.");
  if (
    !Number.isInteger(viewport.width) ||
    viewport.width < 160 ||
    viewport.width > 4096 ||
    !Number.isInteger(viewport.height) ||
    viewport.height < 160 ||
    viewport.height > 2048 ||
    !Number.isSafeInteger(viewport.page ?? 0) ||
    (viewport.page ?? 0) < 0
  )
    throw new Error("Choose a valid preview viewport and page.");
  if ((await fs.stat(file)).size > 32 * 1024 * 1024)
    throw new Error("This font exceeds the preview's 32 MiB limit.");
  const font = firstFace(await fs.readFile(file));
  const metadata = await runTool(
    "fc-scan",
    ["--format", "%{family[0]}\n%{style[0]}\n", file],
    signal,
  );
  const [family, style] = metadata.split("\n");
  if (!family) throw new Error("The selected file contains no readable font face.");
  const padding = 24,
    lines = wrapFontSample(font, sample, size, viewport.width - padding * 2);
  const lineHeight =
    Math.ceil(
      Math.max(
        ((font.ascender - font.descender) * size) / font.unitsPerEm,
        ...lines.map((line) => extent(font, line, size).height),
      ),
    ) + 8;
  const height = Math.max(viewport.height, padding * 2 + lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0 || height > 2048)
    throw new Error("This font has unsupported vertical glyph metrics.");
  const rows = Math.max(1, Math.floor((height - padding * 2) / lineHeight)),
    pageCount = Math.max(1, Math.ceil(lines.length / rows)),
    page = Math.min(viewport.page ?? 0, pageCount - 1);
  const preview = await privatePreview(async (output, directory) => {
    const copy = path.join(directory, "font" + path.extname(file));
    await fs.copyFile(file, copy);
    const filters: string[] = [];
    for (const [row, line] of lines.slice(page * rows, (page + 1) * rows).entries()) {
      if (!line.trim()) continue;
      const text = path.join(directory, `line-${row}.txt`);
      await fs.writeFile(text, line);
      filters.push(
        `drawtext=fontfile=${copy}:textfile=${text}:expansion=none:fontcolor=black:fontsize=${size}:x=${Math.ceil(padding - extent(font, line, size).left)}:y=${padding + row * lineHeight}`,
      );
    }
    await runTool(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=white:s=${viewport.width}x${height}`,
        ...(filters.length ? ["-vf", filters.join(",")] : []),
        "-frames:v",
        "1",
        "-update",
        "1",
        output,
      ],
      signal,
    );
  });
  return { preview, family, style: style || "Regular", page, pageCount, lines };
}

import fs from "node:fs/promises";
import path from "node:path";
import type { Font } from "opentype.js";
import { parseFontFile } from "@moire/ui";
import { privatePreview, readableFile, runTool, type Preview } from "@moire/app-tools";
import { isFontFile } from "./model";
export const MAX_SAMPLE_CHARACTERS = 500;
export type FontPreviewViewport = {
  width: number;
  height: number;
  page?: number;
};

/** Fonts above this are refused, keeping parsing and rasterizing bounded. */
const MAX_FONT_BYTES = 32 * 1024 * 1024;

/** Read the font at `value`: its parsed first face and fontconfig's family and style names. */
async function openFace(value: string, signal?: AbortSignal) {
  const file = await readableFile(value);
  if (!isFontFile(file)) throw new Error("Open a TrueType, OpenType or TrueType collection font.");
  if ((await fs.stat(file)).size > MAX_FONT_BYTES)
    throw new Error("This font exceeds the preview's 32 MiB limit.");
  const font = parseFontFile(await fs.readFile(file));
  const metadata = await runTool(
    "fc-scan",
    ["--format", "%{family[0]}\n%{style[0]}\n", file],
    signal,
  );
  const [family, style] = metadata.split("\n");
  if (!family) throw new Error("The selected file contains no readable font face.");
  return { file, font, family, style: style || "Regular" };
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
  const { file, font, family, style } = await openFace(value, signal);
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
      await fs.writeFile(text, line, { signal });
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
  }, signal);
  return { preview, family, style, page, pageCount, lines };
}

export const SPECIMEN_SIZES = [12, 16, 24, 32, 48, 64] as const;
const SPECIMEN_TEXT = "The quick brown fox jumps over the lazy dog";
const SPECIMEN_GLYPHS = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789 !?&@#$%*()[]{}<>/|+-=_.,:;'\"",
  "ÀÉÎÕÜÇÑßØÆŒ àéîõüçñøæœ",
].join("\n");
export type FontSpecimen = {
  family: string;
  style: string;
  glyphCount: number;
  /** The sample sentence at each of SPECIMEN_SIZES, labelled. */
  sizes: Preview;
  /** The Latin character set the face covers. */
  glyphs: Preview;
};
type SpecimenLine = {
  text: string;
  size: number;
  x: number;
  y: number;
  alpha?: number;
};

/** Draw lines of the selected face on a transparent canvas in `color` (0xRRGGBB). */
async function drawLines(
  file: string,
  lines: readonly SpecimenLine[],
  width: number,
  height: number,
  color: number,
  signal?: AbortSignal,
): Promise<Preview> {
  const hex = `0x${(color & 0xffffff).toString(16).padStart(6, "0")}`;
  return privatePreview(async (output, directory) => {
    const copy = path.join(directory, "font" + path.extname(file));
    await fs.copyFile(file, copy);
    const filters: string[] = ["format=rgba"];
    for (const [index, line] of lines.entries()) {
      if (!line.text.trim()) continue;
      const text = path.join(directory, `line-${index}.txt`);
      await fs.writeFile(text, line.text, { signal });
      filters.push(
        `drawtext=fontfile=${copy}:textfile=${text}:expansion=none:fontcolor=${hex}@${line.alpha ?? 1}:fontsize=${line.size}:x=${Math.round(line.x)}:y=${Math.round(line.y)}`,
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
        `color=c=black@0:s=${width}x${height},format=rgba`,
        "-vf",
        filters.join(","),
        "-frames:v",
        "1",
        "-update",
        "1",
        output,
      ],
      signal,
    );
  }, signal);
}

/** Fit `text` on one line of `width` at `size`, dropping trailing characters (with an ellipsis). */
function clipLine(font: Font, text: string, size: number, width: number): string {
  if (extent(font, text, size).width <= width) return text;
  const characters = [...text];
  while (characters.length && extent(font, characters.join("") + "…", size).width > width)
    characters.pop();
  return characters.join("").trimEnd() + "…";
}

/**
 * A specimen of the selected font: the sample sentence at several sizes and the characters it
 * covers, drawn in `color` on transparent canvases `width` device pixels wide. `scale` is the UI
 * scale, so sizes match the rest of the interface.
 */
export async function fontSpecimen(
  value: string,
  options: { width: number; color: number; scale?: number },
  signal?: AbortSignal,
): Promise<FontSpecimen> {
  if (!Number.isInteger(options.width) || options.width < 160 || options.width > 4096)
    throw new Error("Choose a valid specimen width.");
  const { file, font, family, style } = await openFace(value, signal);
  const scale = options.scale ?? 1;
  const lineHeight = (size: number) =>
    Math.ceil(((font.ascender - font.descender) * size) / font.unitsPerEm);
  // drawtext places a line by the top of its tallest glyph; offset each line from a shared
  // baseline so the size labels sit on the sample's baseline.
  const topFromBaseline = (text: string, size: number) =>
    Math.max(0, -font.getPath(text, 0, 0, size).getBoundingBox().y1);
  const labelSize = Math.round(11 * scale);
  const gutter = Math.round(40 * scale);
  const sizeLines: SpecimenLine[] = [];
  let y = 0;
  for (const logical of SPECIMEN_SIZES) {
    const size = Math.round(logical * scale);
    const baseline = y + Math.ceil((font.ascender * size) / font.unitsPerEm);
    const label = String(logical);
    const text = clipLine(font, SPECIMEN_TEXT, size, options.width - gutter);
    sizeLines.push({
      text: label,
      size: labelSize,
      x: 0,
      y: baseline - topFromBaseline(label, labelSize),
      alpha: 0.7,
    });
    sizeLines.push({ text, size, x: gutter, y: baseline - topFromBaseline(text, size) });
    y += lineHeight(size) + Math.round(10 * scale);
  }
  const covered = SPECIMEN_GLYPHS.split("\n")
    .map((group) =>
      [...group]
        .filter((character) => character === " " || font.charToGlyphIndex(character) > 0)
        .join("")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
  const glyphSize = Math.round(28 * scale);
  const glyphRows = wrapFontSample(font, covered, glyphSize, options.width);
  const glyphLine = lineHeight(glyphSize) + Math.round(6 * scale);
  const sizes = await drawLines(
    file,
    sizeLines,
    options.width,
    Math.min(2048, Math.max(1, y)),
    options.color,
    signal,
  );
  try {
    const glyphs = await drawLines(
      file,
      glyphRows.map((text, row) => ({
        text: text.trim(),
        size: glyphSize,
        x: 0,
        y:
          row * glyphLine +
          Math.ceil((font.ascender * glyphSize) / font.unitsPerEm) -
          topFromBaseline(text.trim(), glyphSize),
      })),
      options.width,
      Math.min(2048, Math.max(1, glyphRows.length * glyphLine)),
      options.color,
      signal,
    );
    return {
      family,
      style,
      glyphCount: font.numGlyphs,
      sizes,
      glyphs,
    };
  } catch (error) {
    await sizes.dispose();
    throw error;
  }
}

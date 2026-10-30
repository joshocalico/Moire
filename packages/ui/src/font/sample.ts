/**
 * Any font file drawn into a bitmap: Font Viewer's specimens and Files' font previews read faces
 * with `parseFontFile` and draw sample lines with the UI's own rasterizer.
 */
// eslint-disable-next-line import/default -- The pinned CommonJS package exposes a runtime namespace default.
import opentype, { type Font } from "opentype.js";
import type { ImageData } from "#ui/image/load";
import { rasterizePathAlpha } from "./engine";

/**
 * The first face of a TrueType/OpenType font or collection. Collections store absolute table
 * offsets, so only the first SFNT directory moves to offset zero; the table data stays in place.
 */
export function parseFontFile(bytes: Buffer): Font {
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

/** The face's family and style from its name table ("Inter", "Semibold Italic"). */
export function fontNames(font: Font): { family: string; style: string } {
  const names = font.names as unknown as Record<string, Record<string, string> | undefined>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = names[key];
      const text = value?.en ?? Object.values(value ?? {})[0];
      if (text) return text;
    }
    return "";
  };
  return {
    family: pick("typographicFamily", "preferredFamily", "fontFamily") || "Unnamed font",
    style: pick("typographicSubfamily", "preferredSubfamily", "fontSubfamily") || "Regular",
  };
}

export type FontSampleLine = { text: string; size: number };

/**
 * Lines of text in `font`, `ink`-coloured on transparent, each scaled down to fit `maxWidth`.
 * Characters the face lacks are left out rather than drawn as boxes.
 */
export function renderFontSample(
  font: Font,
  lines: readonly FontSampleLine[],
  ink: number,
  maxWidth: number,
): ImageData {
  const scale = (size: number) => size / font.unitsPerEm;
  const laid = lines.map((line) => {
    const text = [...line.text]
      .filter((character) => font.charToGlyphIndex(character) > 0)
      .join("");
    const width = font.getAdvanceWidth(text, line.size);
    const size =
      width > maxWidth ? Math.max(4, Math.floor((line.size * maxWidth) / width)) : line.size;
    return {
      text,
      size,
      ascent: Math.ceil(font.ascender * scale(size)),
      height: Math.ceil((font.ascender - font.descender) * scale(size) * 1.15),
    };
  });
  // As wide as the widest line, so callers can centre the sample.
  const width = Math.max(
    1,
    Math.min(
      Math.ceil(maxWidth),
      Math.ceil(Math.max(...laid.map((line) => font.getAdvanceWidth(line.text, line.size)))) + 2,
    ),
  );
  const height = Math.max(
    1,
    laid.reduce((total, line) => total + line.height, 0),
  );
  const alpha = new Uint8Array(width * height);
  let top = 0;
  for (const line of laid) {
    if (line.text) {
      const path = font.getPath(line.text, 0, top + line.ascent, line.size);
      rasterizePathAlpha(path, alpha, width, height, 0, 0);
    }
    top += line.height;
  }
  const rgba = new Uint8Array(width * height * 4);
  const [r, g, b] = [(ink >>> 16) & 0xff, (ink >>> 8) & 0xff, ink & 0xff];
  for (let index = 0; index < alpha.length; index++) {
    const coverage = alpha[index]!;
    if (!coverage) continue;
    rgba[index * 4] = r;
    rgba[index * 4 + 1] = g;
    rgba[index * 4 + 2] = b;
    rgba[index * 4 + 3] = coverage;
  }
  return { rgba, width, height };
}

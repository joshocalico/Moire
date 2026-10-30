/**
 * A picture for any file that has one: images decoded here (or by ffmpeg for WebP, BMP, TIFF and
 * HEIF), a video's frame (ffmpeg), embedded album art, a PDF's page (pdftoppm, the first unless asked), and a
 * font's "Aa". The external tools are optional: without them those files simply have no picture.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { readMediaInfo } from "@moire/file-formats";
import { parseFontFile, renderFontSample } from "#ui/font/sample";
import { DECODED_FORMATS, decodeImage, fitImage, imageSize, sniffImage } from "./decode";
import type { ImageData } from "./load";

export type ThumbnailSource =
  | { kind: "image"; image: ImageData; source: { width: number; height: number } | null }
  | { kind: "none"; reason: string };

/** Pictures above this are not decoded for a thumbnail (a 100 MP photo is ~40 MB). */
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_FONT_BYTES = 32 * 1024 * 1024;
const SNIFF_BYTES = 64;
const TOOL_TIMEOUT_MS = 20_000;
/** A PNG frame from a tool; posters are small, this only stops runaway output. */
const MAX_TOOL_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Video posters come from a tenth of the way in (skipping fades from black), at most this far. */
const POSTER_MAX_SECONDS = 5;
/** Font pictures are dark glyphs on white paper, so they read on light and dark pages alike. */
const FONT_INK = 0xff202428;
const PAPER = 0xfffbfaf7;
const PAGE_EDGE = [0xc8, 0xc8, 0xcc, 0xff];

const FONT_MAGIC = new Set(["\0\x01\0\0", "OTTO", "true", "ttcf", "wOFF"]);

const none = (reason: string): ThumbnailSource => ({ kind: "none", reason });

/** The file's picture, at most `edge` pixels along its long side; `page` (from 1) picks a PDF page. */
export async function thumbnailSource(
  file: string,
  edge: number,
  signal?: AbortSignal,
  page = 1,
): Promise<ThumbnailSource> {
  const stat = await fs.stat(file);
  if (!stat.isFile()) return none("Not a file.");
  const head = await readHead(file);
  const ascii = head.toString("latin1", 0, 4);
  const format = sniffImage(head);
  if (format) {
    if (stat.size > MAX_IMAGE_BYTES) return none("This image is too large to preview.");
    if (DECODED_FORMATS.has(format)) {
      const bytes = await fs.readFile(file);
      const decoded = decodeImage(bytes, { maxEdge: edge });
      return { kind: "image", image: shrink(decoded, edge), source: imageSize(bytes) };
    }
    return fromTool("ffmpeg", ffmpegFrame(file, edge, 0), edge, signal);
  }
  if (ascii === "%PDF") {
    const at = String(Math.max(1, Math.floor(page)));
    const rendered = await fromTool(
      "pdftoppm",
      ["-f", at, "-l", at, "-singlefile", "-scale-to", String(edge), "-png", file],
      edge,
      signal,
    );
    return rendered.kind === "image" ? { ...rendered, image: withEdge(rendered.image) } : rendered;
  }
  if (FONT_MAGIC.has(ascii)) {
    if (stat.size > MAX_FONT_BYTES) return none("This font is too large to preview.");
    const font = parseFontFile(await fs.readFile(file));
    const glyphs = renderFontSample(
      font,
      [{ text: "Aa", size: Math.round(edge * 0.5) }],
      FONT_INK,
      edge,
    );
    return { kind: "image", image: onPaper(glyphs, edge), source: null };
  }
  const media = await readMediaInfo(file, signal);
  if (media.picture) {
    const art = decodeImage(media.picture.data, { maxEdge: edge });
    return { kind: "image", image: shrink(art, edge), source: null };
  }
  if (media.video || (media.format === "matroska" && !media.audio)) {
    const at = Math.min(POSTER_MAX_SECONDS, (media.duration ?? 0) / 10);
    const poster = await fromTool("ffmpeg", ffmpegFrame(file, edge, at), edge, signal);
    // A seek past a short clip's last frame yields nothing; its first frame will do.
    return poster.kind === "none" && at > 0
      ? fromTool("ffmpeg", ffmpegFrame(file, edge, 0), edge, signal)
      : poster;
  }
  return none("This file has no picture.");
}

async function readHead(file: string): Promise<Buffer> {
  const handle = await fs.open(file, "r");
  try {
    const head = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function shrink(image: ImageData, edge: number): ImageData {
  return fitImage(image, edge, edge, "contain");
}

/** A hairline round a page, so white paper still reads as a page on a white tile. */
function withEdge(image: ImageData): ImageData {
  const rgba = image.rgba.slice();
  const { width, height } = image;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (x > 0 && y > 0 && x < width - 1 && y < height - 1) continue;
      rgba.set(PAGE_EDGE, (y * width + x) * 4);
    }
  return { ...image, rgba };
}

/** Glyphs centred on an opaque square of paper. */
function onPaper(glyphs: ImageData, edge: number): ImageData {
  const rgba = new Uint8Array(edge * edge * 4);
  const [r, g, b] = [(PAPER >>> 16) & 0xff, (PAPER >>> 8) & 0xff, PAPER & 0xff];
  for (let at = 0; at < rgba.length; at += 4) {
    rgba[at] = r;
    rgba[at + 1] = g;
    rgba[at + 2] = b;
    rgba[at + 3] = 255;
  }
  const left = Math.max(0, Math.floor((edge - glyphs.width) / 2));
  const top = Math.max(0, Math.floor((edge - glyphs.height) / 2));
  for (let y = 0; y < Math.min(glyphs.height, edge - top); y++)
    for (let x = 0; x < Math.min(glyphs.width, edge - left); x++) {
      const from = (y * glyphs.width + x) * 4;
      const alpha = glyphs.rgba[from + 3]! / 255;
      if (!alpha) continue;
      const to = ((top + y) * edge + left + x) * 4;
      for (let channel = 0; channel < 3; channel++)
        rgba[to + channel] = Math.round(
          glyphs.rgba[from + channel]! * alpha + rgba[to + channel]! * (1 - alpha),
        );
    }
  return { rgba, width: edge, height: edge };
}

function ffmpegFrame(file: string, edge: number, seconds: number): string[] {
  return [
    "-v",
    "error",
    ...(seconds > 0 ? ["-ss", seconds.toFixed(2)] : []),
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease`,
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "-",
  ];
}

/** Run a tool that prints one PNG; a missing tool or empty output means no picture. */
async function fromTool(
  tool: string,
  args: string[],
  edge: number,
  signal?: AbortSignal,
): Promise<ThumbnailSource> {
  let output: Buffer;
  try {
    output = await new Promise<Buffer>((resolve, reject) =>
      execFile(
        tool,
        args,
        {
          encoding: "buffer",
          maxBuffer: MAX_TOOL_OUTPUT_BYTES,
          timeout: TOOL_TIMEOUT_MS,
          signal,
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    );
  } catch (error) {
    signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return none(`${tool} is not installed.`);
    return none(`${tool} could not read this file.`);
  }
  if (!output.length) return none(`${tool} found no picture.`);
  return { kind: "image", image: shrink(decodeImage(output), edge), source: null };
}

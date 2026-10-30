/**
 * Thumbnails on disk, named as the freedesktop thumbnail spec names them: the MD5 of the file's
 * URI under a size directory, a PNG carrying `Thumb::URI` and `Thumb::MTime` so a changed file is
 * never shown with an old picture. They live under `$XDG_CACHE_HOME/moire/thumbnails`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { crc32 } from "node:zlib";
import { PNG } from "pngjs";
import type { ImageData } from "./load";

/** The spec's sizes: the long edge of each directory's thumbnails. */
export const THUMBNAIL_BUCKETS = [
  ["normal", 128],
  ["large", 256],
  ["x-large", 512],
  ["xx-large", 1024],
] as const;

export type ThumbnailBucket = (typeof THUMBNAIL_BUCKETS)[number];

/** The smallest bucket at least `edge` pixels long, or the largest. */
export function thumbnailBucket(edge: number): ThumbnailBucket {
  return THUMBNAIL_BUCKETS.find(([, size]) => size >= edge) ?? THUMBNAIL_BUCKETS.at(-1)!;
}

export function thumbnailRoot(): string {
  const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cache, "moire", "thumbnails");
}

/** What a cached thumbnail must match: the file's URI, whole-second mtime and size. */
export type ThumbnailIdentity = { uri: string; mtime: number; size: number };

export function thumbnailIdentity(file: string, mtimeMs: number, size: number): ThumbnailIdentity {
  return { uri: pathToFileURL(file).href, mtime: Math.floor(mtimeMs / 1000), size };
}

export function thumbnailFile(identity: ThumbnailIdentity, bucket: ThumbnailBucket): string {
  const name = createHash("md5").update(identity.uri).digest("hex");
  return path.join(thumbnailRoot(), bucket[0], `${name}.png`);
}

export type CachedThumbnail = ImageData & {
  sourceWidth: number | null;
  sourceHeight: number | null;
};

/** The cached thumbnail when it is current for `identity`, else null. */
export async function readCachedThumbnail(
  identity: ThumbnailIdentity,
  bucket: ThumbnailBucket,
): Promise<CachedThumbnail | null> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(thumbnailFile(identity, bucket));
  } catch {
    return null;
  }
  const text = pngText(bytes);
  if (
    text.get("Thumb::URI") !== identity.uri ||
    text.get("Thumb::MTime") !== String(identity.mtime) ||
    text.get("Thumb::Size") !== String(identity.size)
  )
    return null;
  try {
    const png = PNG.sync.read(bytes);
    const dimension = (key: string) => {
      const value = Number(text.get(key));
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    };
    return {
      rgba: new Uint8Array(png.data),
      width: png.width,
      height: png.height,
      sourceWidth: dimension("Thumb::Image::Width"),
      sourceHeight: dimension("Thumb::Image::Height"),
    };
  } catch {
    return null;
  }
}

/** Write atomically (temp file, then rename) and privately, as the spec asks. */
export async function writeCachedThumbnail(
  identity: ThumbnailIdentity,
  bucket: ThumbnailBucket,
  image: ImageData,
  source: { width: number; height: number } | null,
): Promise<void> {
  const file = thumbnailFile(identity, bucket);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.rgba.buffer, image.rgba.byteOffset, image.rgba.byteLength);
  const text: Array<[string, string]> = [
    ["Thumb::URI", identity.uri],
    ["Thumb::MTime", String(identity.mtime)],
    ["Thumb::Size", String(identity.size)],
    ["Software", "Moire"],
  ];
  if (source)
    text.push(
      ["Thumb::Image::Width", String(source.width)],
      ["Thumb::Image::Height", String(source.height)],
    );
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(temporary, withText(PNG.sync.write(png), text), { mode: 0o600 });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

const PNG_SIGNATURE_BYTES = 8;
/** The signature plus the IHDR chunk, which must come first. */
const IHDR_END = PNG_SIGNATURE_BYTES + 25;

/** Insert tEXt chunks straight after IHDR. */
function withText(png: Buffer, entries: ReadonlyArray<[string, string]>): Buffer {
  const chunks = entries.map(([key, value]) => {
    const body = Buffer.concat([
      Buffer.from("tEXt", "latin1"),
      Buffer.from(`${key}\0${value}`, "latin1"),
    ]);
    const chunk = Buffer.alloc(body.length + 8);
    chunk.writeUInt32BE(body.length - 4, 0);
    body.copy(chunk, 4);
    chunk.writeUInt32BE(crc32(body), body.length + 4);
    return chunk;
  });
  return Buffer.concat([png.subarray(0, IHDR_END), ...chunks, png.subarray(IHDR_END)]);
}

/** tEXt keys and values up to the first image data. */
function pngText(png: Buffer): Map<string, string> {
  const text = new Map<string, string>();
  let at = PNG_SIGNATURE_BYTES;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    if (type === "IDAT" || at + 12 + length > png.length) break;
    if (type === "tEXt") {
      const body = png.toString("latin1", at + 8, at + 8 + length);
      const split = body.indexOf("\0");
      if (split > 0) text.set(body.slice(0, split), body.slice(split + 1));
    }
    at += 12 + length;
  }
  return text;
}

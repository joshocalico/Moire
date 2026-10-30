/** GIF decoding: the first image, composited on transparent at the logical screen size. */
import type { ImageData } from "./raster";

const MAX_SIDE = 16384;
const MAX_CODES = 4096;
const EXTENSION = 0x21;
const IMAGE = 0x2c;
const TRAILER = 0x3b;
const GRAPHIC_CONTROL = 0xf9;

function isGif(bytes: Uint8Array): boolean {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  return signature === "GIF87a" || signature === "GIF89a";
}

export function gifSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10 || !isGif(bytes)) return null;
  return { width: bytes[6]! | (bytes[7]! << 8), height: bytes[8]! | (bytes[9]! << 8) };
}

/** LZW-coded indices of one image; a short stream leaves the remaining pixels at index 0. */
function decodeLzw(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const prefix = new Int16Array(MAX_CODES);
  const suffix = new Uint8Array(MAX_CODES);
  const first = new Uint8Array(MAX_CODES);
  const stack = new Uint8Array(MAX_CODES);
  for (let code = 0; code < clear; code++) {
    suffix[code] = code;
    first[code] = code;
  }
  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let previous = -1;
  let written = 0;
  let acc = 0;
  let bits = 0;
  let at = 0;
  while (written < pixelCount) {
    while (bits < codeSize && at < data.length) {
      acc |= data[at++]! << bits;
      bits += 8;
    }
    if (bits < codeSize) break;
    const code = acc & ((1 << codeSize) - 1);
    acc >>>= codeSize;
    bits -= codeSize;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) break;
    if (previous < 0) {
      out[written++] = code;
      previous = code;
      continue;
    }
    // A code not yet in the table is the previous string plus its own first byte.
    const known = code < next;
    let walk = known ? code : previous;
    let depth = 0;
    if (!known) stack[depth++] = first[previous]!;
    while (walk >= clear) {
      stack[depth++] = suffix[walk]!;
      walk = prefix[walk]!;
    }
    stack[depth++] = walk;
    while (depth > 0 && written < pixelCount) out[written++] = stack[--depth]!;
    if (next < MAX_CODES) {
      prefix[next] = previous;
      suffix[next] = first[known ? code : previous]!;
      first[next] = first[previous]!;
      next++;
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    previous = code;
  }
  return out;
}

/** Concatenated data sub-blocks starting at `at`, and the offset after their terminator. */
function subBlocks(bytes: Uint8Array, at: number): { data: Uint8Array; end: number } {
  const parts: Uint8Array[] = [];
  let total = 0;
  while (at < bytes.length) {
    const size = bytes[at++]!;
    if (size === 0) break;
    const part = bytes.subarray(at, Math.min(bytes.length, at + size));
    parts.push(part);
    total += part.length;
    at += size;
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return { data, end: at };
}

/** Interlaced rows arrive in four passes: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1. */
function interlacedRows(height: number): Int32Array {
  const rows = new Int32Array(height);
  let index = 0;
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const)
    for (let row = start; row < height; row += step) rows[index++] = row;
  return rows;
}

export function decodeGif(bytes: Uint8Array): ImageData {
  const size = gifSize(bytes);
  if (!size) throw new Error("Not a GIF image.");
  const { width, height } = size;
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE)
    throw new Error(`GIF has an unsupported size (${width}×${height}).`);
  const packed = bytes[10]!;
  let at = 13;
  let globalTable: Uint8Array | null = null;
  if (packed & 0x80) {
    const length = 3 * (1 << ((packed & 7) + 1));
    globalTable = bytes.subarray(at, at + length);
    at += length;
  }
  let transparent = -1;
  while (at < bytes.length) {
    const block = bytes[at++]!;
    if (block === TRAILER) break;
    if (block === EXTENSION) {
      const label = bytes[at++]!;
      if (label === GRAPHIC_CONTROL && bytes[at] === 4 && bytes[at + 1]! & 1)
        transparent = bytes[at + 4]!;
      at = subBlocks(bytes, at).end;
      continue;
    }
    if (block !== IMAGE) throw new Error("GIF has an unknown block.");
    const left = bytes[at]! | (bytes[at + 1]! << 8);
    const top = bytes[at + 2]! | (bytes[at + 3]! << 8);
    const frameWidth = bytes[at + 4]! | (bytes[at + 5]! << 8);
    const frameHeight = bytes[at + 6]! | (bytes[at + 7]! << 8);
    const flags = bytes[at + 8]!;
    at += 9;
    let table = globalTable;
    if (flags & 0x80) {
      const length = 3 * (1 << ((flags & 7) + 1));
      table = bytes.subarray(at, at + length);
      at += length;
    }
    if (!table) throw new Error("GIF has no colour table.");
    const minCodeSize = bytes[at++]!;
    if (minCodeSize < 1 || minCodeSize > 11) throw new Error("GIF image data is corrupt.");
    const indices = decodeLzw(subBlocks(bytes, at).data, minCodeSize, frameWidth * frameHeight);
    const rows = flags & 0x40 ? interlacedRows(frameHeight) : null;
    const rgba = new Uint8Array(width * height * 4);
    for (let source = 0; source < frameHeight; source++) {
      const y = top + (rows ? rows[source]! : source);
      if (y >= height) continue;
      for (let x = 0; x < frameWidth && left + x < width; x++) {
        const index = indices[source * frameWidth + x]!;
        if (index === transparent || index * 3 + 2 >= table.length) continue;
        const out = (y * width + left + x) * 4;
        rgba[out] = table[index * 3]!;
        rgba[out + 1] = table[index * 3 + 1]!;
        rgba[out + 2] = table[index * 3 + 2]!;
        rgba[out + 3] = 255;
      }
    }
    return { rgba, width, height };
  }
  throw new Error("GIF has no image.");
}

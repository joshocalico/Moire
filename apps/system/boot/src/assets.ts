import fs from "node:fs";
import type { SoftwareFrame } from "@moire/react-host";
import type { SilkBackdropSource } from "@moire/ui";

export const BOOT_WIDTH = 1280;
export const BOOT_HEIGHT = 800;
export const BOOT_MAX_WIDTH = 1920;
export const BOOT_MAX_HEIGHT = 1200;
export const BOOT_SOURCE_BYTES = BOOT_WIDTH * BOOT_HEIGHT * 4;

/** Build-time RGBA texture, not the full static PNG with its baked wordmark. */
export function loadBootArtwork(file: string): SilkBackdropSource {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size !== BOOT_SOURCE_BYTES)
      throw new Error(`Boot Fold texture must contain exactly ${BOOT_SOURCE_BYTES} RGBA bytes`);
    const rgba = new Uint8Array(BOOT_SOURCE_BYTES);
    let at = 0;
    while (at < rgba.length) {
      const count = fs.readSync(fd, rgba, at, rgba.length - at, at);
      if (!count) throw new Error("Boot Fold texture ended before its declared size");
      at += count;
    }
    return Object.freeze({
      variant: "fold-e",
      background: 0xff080a10,
      image: Object.freeze({ rgba, width: BOOT_WIDTH, height: BOOT_HEIGHT }),
      metrics: Object.freeze({ filaments: 512, segments: 98304, bytes: rgba.byteLength }),
    });
  } finally {
    fs.closeSync(fd);
  }
}

export function boundedBootViewport(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > BOOT_MAX_WIDTH ||
    height > BOOT_MAX_HEIGHT
  )
    throw new Error(`Unsupported boot viewport ${width}x${height}`);
}

/** KMS's CPU publication contract uses the output's padded source pitch. */
export function packBootScanout(frame: SoftwareFrame, pitch: number): Uint8Array {
  const rowBytes = frame.width * 4;
  if (!Number.isSafeInteger(pitch) || pitch < rowBytes)
    throw new Error("Boot output pitch cannot contain its pixel rows");
  if (pitch === rowBytes) return frame.pixels;
  const packed = new Uint8Array(pitch * frame.height);
  for (let row = 0; row < frame.height; row++) {
    packed.set(frame.pixels.subarray(row * rowBytes, (row + 1) * rowBytes), row * pitch);
  }
  return packed;
}

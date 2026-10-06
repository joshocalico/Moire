import { wlShm } from "@moire/protocol/generated";

export type ShmFormat = typeof wlShm.enums.format.argb8888 | typeof wlShm.enums.format.xrgb8888;
export type ShmFrameLayout = Readonly<{
  width: number;
  height: number;
  stride: number;
  size: number;
}>;
export type ShmFrame = ShmFrameLayout & Readonly<{ format: ShmFormat }>;

/** wl_shm pool size/stride are signed 32-bit; CPU frames are tightly packed BGRA. */
export function validateShmFrame(
  pixels: Uint8Array,
  width: number,
  height: number,
): ShmFrameLayout {
  const stride = width * 4;
  const size = stride * height;
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    !Number.isSafeInteger(size) ||
    size > 0x7fffffff ||
    pixels.byteLength !== size
  )
    throw new RangeError(
      "SHM frame requires complete tightly packed BGRA pixels and positive bounded dimensions",
    );
  return { width, height, stride, size };
}

/** Certify every alpha byte of the complete CPU frame, never damage alone. */
export function classifyShmFrame(pixels: Uint8Array, width: number, height: number): ShmFrame {
  const layout = validateShmFrame(pixels, width, height);
  for (let alpha = 3; alpha < layout.size; alpha += 4) {
    if (pixels[alpha] !== 255) return { ...layout, format: wlShm.enums.format.argb8888 };
  }
  return { ...layout, format: wlShm.enums.format.xrgb8888 };
}

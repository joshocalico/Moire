/**
 * Pure TypeScript picture decoding: JPEG (baseline and progressive, upright by EXIF) and GIF
 * (first frame), plus the raster helpers. PNG needs zlib inflate and is left to callers
 * (`pngjs` in @moire/ui and @moire/theme), so this package stays dependency-free.
 */
import { readExif } from "../exif";
import { decodeGif } from "./gif";
import { decodeJpeg } from "./jpeg";
import { orientImage, sniffImage, type ImageData } from "./raster";

export { decodeGif, gifSize } from "./gif";
export { decodeJpeg, jpegSize, type JpegDecodeOptions } from "./jpeg";
export {
  fitImage,
  imageSize,
  orientImage,
  resizeImage,
  sniffImage,
  type ImageData,
  type ImageFit,
  type ImageFormat,
} from "./raster";

export type DecodeOptions = {
  /** Long edge the caller needs; lets the JPEG decoder skip detail it would discard. */
  maxEdge?: number;
};

/**
 * Decode JPEG (turned upright by its EXIF orientation) or GIF bytes to straight-alpha RGBA, or
 * null when they are another format (PNG included) for the caller to handle.
 */
export function decodeJpegOrGif(bytes: Uint8Array, options: DecodeOptions = {}): ImageData | null {
  const format = sniffImage(bytes);
  if (format === "jpeg")
    return orientImage(decodeJpeg(bytes, options), readExif(bytes)?.orientation ?? 1);
  if (format === "gif") return decodeGif(bytes);
  return null;
}

/**
 * Image files to RGBA: PNG (pngjs) here, JPEG and GIF through `@moire/file-formats/image`, which
 * also holds the format sniffing, orientation and scaling helpers re-exported below. Other
 * formats are recognised so callers can hand them to an external decoder instead.
 */
import { PNG } from "pngjs";
import {
  decodeJpegOrGif,
  sniffImage,
  type DecodeOptions,
  type ImageFormat,
} from "@moire/file-formats/image";
import type { ImageData } from "./load";

export {
  fitImage,
  imageSize,
  sniffImage,
  type DecodeOptions,
  type ImageFit,
  type ImageFormat,
} from "@moire/file-formats/image";

/** Formats decoded here; the rest need an external tool. */
export const DECODED_FORMATS: ReadonlySet<ImageFormat> = new Set(["png", "jpeg", "gif"]);

/** Decode PNG, JPEG or GIF bytes to straight-alpha RGBA. Throws for any other format. */
export function decodeImage(bytes: Uint8Array, options: DecodeOptions = {}): ImageData {
  const format = sniffImage(bytes);
  if (format === "png") {
    const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return { rgba: new Uint8Array(png.data), width: png.width, height: png.height };
  }
  const decoded = decodeJpegOrGif(bytes, options);
  if (decoded) return decoded;
  throw new Error(
    format ? `${format.toUpperCase()} images are not supported here.` : "This is not an image.",
  );
}

/**
 * Raster pictures as straight-alpha RGBA, and what every decoder shares: recognising a format by
 * its magic bytes, the header size, EXIF orientation, and area-averaged scaling.
 */
import { readExif } from "../exif";
import { gifSize } from "./gif";
import { jpegSize } from "./jpeg";

export type ImageData = {
  rgba: Uint8Array;
  width: number;
  height: number;
};

export type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "heif";

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** The format by magic bytes, or null when this is not a known image. */
export function sniffImage(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (ascii(bytes, 0, 4) === "GIF8") return "gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (ascii(bytes, 0, 2) === "BM") return "bmp";
  if (ascii(bytes, 0, 4) === "II*\0" || ascii(bytes, 0, 4) === "MM\0*") return "tiff";
  if (
    ascii(bytes, 4, 8) === "ftyp" &&
    /^(heic|heix|mif1|msf1|avif|avis)$/.test(ascii(bytes, 8, 12))
  )
    return "heif";
  return null;
}

/** Pixel size from the header alone (upright for JPEGs), or null. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const format = sniffImage(bytes);
  if (format === "png" && bytes.length >= 24) {
    const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
  }
  if (format === "gif") return gifSize(bytes);
  if (format === "jpeg") {
    const size = jpegSize(bytes);
    if (!size) return null;
    return quarterTurned(readExif(bytes)?.orientation ?? 1)
      ? { width: size.height, height: size.width }
      : size;
  }
  return null;
}

/** EXIF orientations 5–8 swap width and height. */
function quarterTurned(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/** Apply a TIFF/EXIF orientation (1–8) so the picture reads upright. */
export function orientImage(image: ImageData, orientation: number): ImageData {
  if (orientation <= 1 || orientation > 8) return image;
  const { width, height, rgba } = image;
  const swap = quarterTurned(orientation);
  const outWidth = swap ? height : width;
  const outHeight = swap ? width : height;
  const out = new Uint8Array(rgba.length);
  for (let y = 0; y < outHeight; y++)
    for (let x = 0; x < outWidth; x++) {
      // The source pixel each upright pixel comes from, per orientation.
      let sx: number, sy: number;
      switch (orientation) {
        case 2:
          [sx, sy] = [width - 1 - x, y];
          break;
        case 3:
          [sx, sy] = [width - 1 - x, height - 1 - y];
          break;
        case 4:
          [sx, sy] = [x, height - 1 - y];
          break;
        case 5:
          [sx, sy] = [y, x];
          break;
        case 6:
          [sx, sy] = [y, height - 1 - x];
          break;
        case 7:
          [sx, sy] = [width - 1 - y, height - 1 - x];
          break;
        default:
          [sx, sy] = [width - 1 - y, x];
      }
      const from = (sy * width + sx) * 4;
      const to = (y * outWidth + x) * 4;
      out[to] = rgba[from]!;
      out[to + 1] = rgba[from + 1]!;
      out[to + 2] = rgba[from + 2]!;
      out[to + 3] = rgba[from + 3]!;
    }
  return { rgba: out, width: outWidth, height: outHeight };
}

/**
 * Scale down by averaging every source pixel under each target pixel (alpha-weighted, so
 * transparent pixels don't darken edges). Bitmaps are drawn nearest-neighbour, so thumbnails
 * are made at the size they are shown; this keeps them free of shimmer.
 */
export function resizeImage(image: ImageData, width: number, height: number): ImageData {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  if (width === image.width && height === image.height) return image;
  const out = new Uint8Array(width * height * 4);
  const xScale = image.width / width;
  const yScale = image.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = y * yScale;
    const y1 = Math.max(y0 + 1e-6, (y + 1) * yScale);
    for (let x = 0; x < width; x++) {
      const x0 = x * xScale;
      const x1 = Math.max(x0 + 1e-6, (x + 1) * xScale);
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        area = 0;
      for (let sy = Math.floor(y0); sy < Math.min(image.height, Math.ceil(y1)); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.min(image.width, Math.ceil(x1)); sx++) {
          const weight = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const at = (sy * image.width + sx) * 4;
          const alpha = image.rgba[at + 3]! * weight;
          r += image.rgba[at]! * alpha;
          g += image.rgba[at + 1]! * alpha;
          b += image.rgba[at + 2]! * alpha;
          a += alpha;
          area += weight;
        }
      }
      const to = (y * width + x) * 4;
      if (a > 0) {
        out[to] = Math.round(r / a);
        out[to + 1] = Math.round(g / a);
        out[to + 2] = Math.round(b / a);
      }
      out[to + 3] = area > 0 ? Math.round(a / area) : 0;
    }
  }
  return { rgba: out, width, height };
}

export type ImageFit = "contain" | "cover";

/**
 * `image` scaled (never up) to fit or fill a `width`×`height` box; "cover" crops the overflow
 * from the centre so the result is exactly the box.
 */
export function fitImage(
  image: ImageData,
  width: number,
  height: number,
  fit: ImageFit,
): ImageData {
  const scale = Math.min(
    1,
    fit === "contain"
      ? Math.min(width / image.width, height / image.height)
      : Math.max(width / image.width, height / image.height),
  );
  const scaled = resizeImage(
    image,
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
  if (fit === "contain") return scaled;
  const cropWidth = Math.min(scaled.width, Math.round(width));
  const cropHeight = Math.min(scaled.height, Math.round(height));
  if (cropWidth === scaled.width && cropHeight === scaled.height) return scaled;
  const left = Math.floor((scaled.width - cropWidth) / 2);
  const top = Math.floor((scaled.height - cropHeight) / 2);
  const out = new Uint8Array(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) {
    const from = ((top + y) * scaled.width + left) * 4;
    out.set(scaled.rgba.subarray(from, from + cropWidth * 4), y * cropWidth * 4);
  }
  return { rgba: out, width: cropWidth, height: cropHeight };
}

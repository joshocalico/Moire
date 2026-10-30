/**
 * Image file loader with a module-level cache: PNG, JPEG (upright by EXIF) and GIF.
 * Safe to import anywhere in @moire/ui; no Wayland/platform deps. Decoding is synchronous, so
 * large photos belong in `requestThumbnail`, which decodes off the render thread.
 */
import fs from "node:fs";
import { decodeImage } from "./decode";

export type ImageData = {
  rgba: Uint8Array;
  width: number;
  height: number;
};

const cache = new Map<string, ImageData>();
const inFlight = new Map<string, Promise<ImageData>>();

/** Synchronously return the cached image, or null if not yet loaded. */
export function getCachedImage(path: string): ImageData | null {
  return cache.get(path) ?? null;
}

/** Sync read + cache. Prefer for bundled icons that must paint on first frame. */
export function loadImageSync(filePath: string): ImageData {
  const hit = cache.get(filePath);
  if (hit) return hit;
  const img = decodeImage(fs.readFileSync(filePath));
  cache.set(filePath, img);
  return img;
}

/**
 * Load an image file and return its RGBA pixel data.
 * Subsequent calls for the same path return the cached result immediately.
 * Concurrent calls while a load is in progress share the same Promise.
 */
export async function loadImage(path: string): Promise<ImageData> {
  const hit = cache.get(path);
  if (hit) return hit;

  const flying = inFlight.get(path);
  if (flying) return flying;

  const promise = new Promise<ImageData>((resolve, reject) => {
    try {
      resolve(loadImageSync(path));
      inFlight.delete(path);
    } catch (err) {
      inFlight.delete(path);
      reject(err);
    }
  });

  inFlight.set(path, promise);
  return promise;
}

/** Remove all cached images (useful in tests). */
export function clearImageCache(): void {
  cache.clear();
}

/**
 * Async PNG loader with module-level cache.
 * Uses pngjs.  Safe to import anywhere in @moire/ui; no Wayland/platform deps.
 */
import { PNG } from "pngjs";
import fs from "node:fs";

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

/**
 * Load a PNG file and return its RGBA pixel data.
 * Subsequent calls for the same path return the cached result immediately.
 * Concurrent calls while a load is in progress share the same Promise.
 */
export async function loadImage(path: string): Promise<ImageData> {
  const hit = cache.get(path);
  if (hit) return hit;

  const flying = inFlight.get(path);
  if (flying) return flying;

  const promise = new Promise<ImageData>((resolve, reject) => {
    const png = new PNG();
    png.on("parsed", () => {
      const rgba = new Uint8Array(png.data);
      const img: ImageData = { rgba, width: png.width, height: png.height };
      cache.set(path, img);
      inFlight.delete(path);
      resolve(img);
    });
    png.on("error", (err: unknown) => {
      inFlight.delete(path);
      reject(err);
    });
    fs.createReadStream(path).pipe(png);
  });

  inFlight.set(path, promise);
  return promise;
}

/** Remove all cached images (useful in tests). */
export function clearImageCache(): void {
  cache.clear();
}

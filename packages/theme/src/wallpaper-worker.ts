/** Decodes one wallpaper picture off the compositor's frame loop; see `wallpaper-image.ts`. */
import { parentPort, workerData } from "node:worker_threads";
import { decodeWallpaper } from "./wallpaper-image";

const { file, width, height } = workerData as { file: string; width: number; height: number };
try {
  let image = decodeWallpaper(file, { width, height });
  // Pixels are transferred; a view into a larger (pooled) buffer is copied first.
  if (image.rgba.byteOffset !== 0 || image.rgba.byteLength !== image.rgba.buffer.byteLength)
    image = { ...image, rgba: image.rgba.slice() };
  parentPort?.postMessage({ ok: true, image }, [image.rgba.buffer as ArrayBuffer]);
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Wallpaper pictures: decoding (PNG, JPEG upright by EXIF, GIF's first frame) and a loader that
 * decodes off the compositor's frame loop. A 24 MP JPEG takes over a second to decode in
 * TypeScript, so the loader runs it on a worker thread, reduces it to just cover the largest
 * output, and hands the result back; the frame loop never decodes.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { PNG } from "pngjs";
import {
  decodeJpegOrGif,
  resizeImage,
  sniffImage,
  type ImageData,
} from "@moire/file-formats/image";
import type { MoireTheme } from "./index";

/** Smallest box a picture is kept at, so a later, larger output rarely needs a re-decode. */
const MIN_BOX = { width: 1920, height: 1080 };

/**
 * Decode a picture file: PNG (pngjs), JPEG (baseline or progressive, upright by EXIF) or GIF
 * (first frame). Synchronous; `maxEdge` lets a JPEG skip detail no output will show.
 */
export function loadImageFile(filePath: string, options: { maxEdge?: number } = {}): ImageData {
  const bytes = fs.readFileSync(filePath);
  if (sniffImage(bytes) === "png") {
    const png = PNG.sync.read(bytes);
    return {
      rgba: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
      width: png.width,
      height: png.height,
    };
  }
  const decoded = decodeJpegOrGif(bytes, options);
  if (!decoded) throw new Error(`${path.basename(filePath)} is not a PNG, JPEG or GIF picture`);
  return decoded;
}

/** The picture averaged down until it just covers `box` (never scaled up). */
export function decodeWallpaper(
  filePath: string,
  box: { width: number; height: number },
): ImageData {
  const image = loadImageFile(filePath, { maxEdge: Math.max(box.width, box.height) });
  const scale = Math.min(1, Math.max(box.width / image.width, box.height / image.height));
  if (scale >= 1) return image;
  return resizeImage(image, Math.ceil(image.width * scale), Math.ceil(image.height * scale));
}

type WorkerReply = { ok: true; image: ImageData } | { ok: false; message: string };

/**
 * The worker script. A precompiled session (plain Node, no TypeScript loader) ships the worker as
 * its own bundle entry beside the session; source runs load the `.ts` file through tsx.
 */
function workerUrl(): URL {
  const bundle = process.env.MOIRE_SESSION_BUNDLE;
  return bundle
    ? pathToFileURL(path.join(bundle, "wallpaper-worker.mjs"))
    : new URL("./wallpaper-worker.ts", import.meta.url);
}

/** Decode on a worker thread; if the worker can't start or dies, decode in-process instead. */
function decodeOffThread(
  filePath: string,
  box: { width: number; height: number },
): { result: Promise<ImageData>; cancel(): void } {
  const inProcess = () => Promise.resolve().then(() => decodeWallpaper(filePath, box));
  let worker: Worker;
  try {
    worker = new Worker(workerUrl(), {
      workerData: { file: filePath, width: box.width, height: box.height },
    });
  } catch {
    return { result: inProcess(), cancel() {} };
  }
  const result = new Promise<ImageData>((resolve, reject) => {
    let answered = false;
    worker.once("message", (reply: WorkerReply) => {
      answered = true;
      if (reply.ok) resolve(reply.image);
      else reject(new Error(reply.message));
      void worker.terminate();
    });
    // A worker that fails to load (e.g. a missing loader) errors asynchronously; the picture
    // still loads, just on this thread.
    worker.once("error", () => {
      if (answered) return;
      answered = true;
      inProcess().then(resolve, reject);
    });
    worker.once("exit", () => {
      if (!answered) reject(new Error("the wallpaper decoder stopped"));
    });
  });
  return { result, cancel: () => void worker.terminate() };
}

export type WallpaperImageLoader = {
  /** The theme changed: reload when its picture (path or file contents) did. */
  setTheme(theme: MoireTheme): void;
  /**
   * An output of this size paints the wallpaper. The first call after a theme change starts
   * the decode; an output larger than any seen before decodes again at its size.
   */
  ensureSize(width: number, height: number): void;
  /** Resolves when no decode is running (for smokes). */
  idle(): Promise<void>;
  dispose(): void;
};

/**
 * Follows the theme's wallpaper picture and reports each decoded picture, or null (not a
 * picture, or it failed to load), to `onImage`.
 */
export function createWallpaperImageLoader(
  onImage: (image: ImageData | null) => void,
  options: { onError?: (error: unknown) => void; offThread?: boolean } = {},
): WallpaperImageLoader {
  const report =
    options.onError ?? ((error) => console.warn("[wallpaper] picture couldn't be loaded:", error));
  const box = { ...MIN_BOX };
  /** The file wanted now (path + stamp), and the one last decoded at which box. */
  let wanted: { file: string; stamp: string } | null = null;
  let loaded = "";
  let running: { key: string; cancel(): void; done: Promise<void> } | null = null;

  const stampOf = (file: string) => {
    try {
      const stat = fs.statSync(file);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "missing";
    }
  };
  const start = () => {
    if (!wanted) return;
    const target = wanted;
    const size = { ...box };
    const key = `${target.file}|${target.stamp}|${size.width}x${size.height}`;
    if (key === loaded || running?.key === key) return;
    running?.cancel();
    const job =
      options.offThread === false
        ? {
            result: Promise.resolve().then(() => decodeWallpaper(target.file, size)),
            cancel() {},
          }
        : decodeOffThread(target.file, size);
    const done = job.result.then(
      (image) => {
        if (running?.key !== key) return;
        running = null;
        loaded = key;
        onImage(image);
      },
      (error: unknown) => {
        if (running?.key !== key) return;
        running = null;
        loaded = key;
        report(error);
        onImage(null);
      },
    );
    running = { key, cancel: job.cancel, done };
  };

  return {
    setTheme(theme) {
      const wallpaper = theme.wallpaper;
      if (wallpaper.mode !== "image") {
        const had = wanted || loaded;
        wanted = null;
        loaded = "";
        running?.cancel();
        running = null;
        if (had) onImage(null);
        return;
      }
      wanted = { file: wallpaper.path, stamp: stampOf(wallpaper.path) };
    },
    ensureSize(width, height) {
      if (width > box.width || height > box.height) {
        box.width = Math.max(box.width, Math.ceil(width));
        box.height = Math.max(box.height, Math.ceil(height));
      }
      start();
    },
    async idle() {
      while (running) await running.done;
    },
    dispose() {
      running?.cancel();
      running = null;
      wanted = null;
    },
  };
}

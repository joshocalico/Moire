/**
 * The thumbnail worker: decodes, scales and caches pictures off the render thread. Each request is
 * answered with the picture fitted to the asked box, and the bucket-sized one goes to disk.
 */
import { parentPort } from "node:worker_threads";
import fs from "node:fs/promises";
import { parseFontFile, renderFontSample, type FontSampleLine } from "#ui/font/sample";
import { fitImage, type ImageFit } from "./decode";
import { imageStats, type ImageStats } from "./image-stats";
import {
  readCachedThumbnail,
  thumbnailBucket,
  thumbnailIdentity,
  thumbnailRoot,
  writeCachedThumbnail,
  type ThumbnailBucket,
} from "./thumbnail-cache";
import { thumbnailSource } from "./thumbnail-source";
import type { ImageData } from "./load";

/** Work a client asks for; `WorkerRequest` adds its id, or cancels one. */
export type WorkerJob =
  | {
      type: "thumbnail";
      file: string;
      mtimeMs: number;
      size: number;
      width: number;
      height: number;
      fit: ImageFit;
      /** The page of a document, from 1; pages after the first skip the disk cache. */
      page?: number;
      /** The source decode may be skipped when the disk cache is current. */
      cache: boolean;
    }
  | { type: "image-stats"; file: string; mtimeMs: number; size: number; cache: boolean }
  | { type: "font-sample"; file: string; lines: FontSampleLine[]; ink: number; maxWidth: number };

export type WorkerRequest = { id: number } & (WorkerJob | { type: "cancel" });

export type WorkerResponse = { id: number } & (
  | { kind: "image"; image: ImageData; source: { width: number; height: number } | null }
  | { kind: "stats"; stats: ImageStats }
  | { kind: "none"; reason: string }
  | { kind: "error"; message: string }
);

/** Statistics come from the smallest bucket's picture: enough pixels, and usually on disk. */
const STATS_EDGE = 128;

/** Cover fits crop a fitted picture; the decode must be long enough on its short side. */
const COVER_OVERSCAN = 2;
const running = new Map<number, AbortController>();

parentPort?.on("message", (request: WorkerRequest) => {
  if (request.type === "cancel") {
    running.get(request.id)?.abort();
    return;
  }
  const controller = new AbortController();
  running.set(request.id, controller);
  void answer(request, controller.signal)
    .catch((error: unknown): WorkerResponse => ({
      id: request.id,
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    }))
    .then((response) => {
      running.delete(request.id);
      if (controller.signal.aborted) return;
      const transfer = response.kind === "image" ? [response.image.rgba.buffer as ArrayBuffer] : [];
      parentPort?.postMessage(response, transfer);
    });
});

/** Pixels are transferred, not copied; a view into a shared pool buffer must be copied first. */
function ownBuffer(image: ImageData): ImageData {
  const { rgba } = image;
  return rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength
    ? image
    : { ...image, rgba: rgba.slice() };
}

async function answer(
  request: WorkerJob & { id: number },
  signal: AbortSignal,
): Promise<WorkerResponse> {
  const { id } = request;
  if (request.type === "font-sample") {
    const font = parseFontFile(await fs.readFile(request.file));
    return {
      id,
      kind: "image",
      image: ownBuffer(renderFontSample(font, request.lines, request.ink, request.maxWidth)),
      source: null,
    };
  }
  if (request.type === "image-stats") {
    const found = await bucketPicture(request, thumbnailBucket(STATS_EDGE), 1, signal);
    if (found.kind === "none") return { id, ...found };
    return { id, kind: "stats", stats: imageStats(found.picture) };
  }
  const longEdge = Math.max(request.width, request.height);
  const bucket = thumbnailBucket(request.fit === "cover" ? longEdge * COVER_OVERSCAN : longEdge);
  const found = await bucketPicture(request, bucket, request.page ?? 1, signal);
  if (found.kind === "none") return { id, ...found };
  const image = fitImage(found.picture, request.width, request.height, request.fit);
  return { id, kind: "image", image: ownBuffer(image), source: found.source };
}

/** The file's bucket-sized picture, from the disk cache when current, else made and cached. */
async function bucketPicture(
  request: { file: string; mtimeMs: number; size: number; cache: boolean },
  bucket: ThumbnailBucket,
  page: number,
  signal: AbortSignal,
): Promise<
  | { kind: "picture"; picture: ImageData; source: { width: number; height: number } | null }
  | { kind: "none"; reason: string }
> {
  const identity = thumbnailIdentity(request.file, request.mtimeMs, request.size);
  // The spec forbids thumbnailing thumbnails, and names one picture per file (its first page).
  const cacheable = request.cache && page === 1 && !request.file.startsWith(thumbnailRoot());
  const cached = cacheable ? await readCachedThumbnail(identity, bucket) : null;
  if (cached) {
    const source =
      cached.sourceWidth && cached.sourceHeight
        ? { width: cached.sourceWidth, height: cached.sourceHeight }
        : null;
    return { kind: "picture", picture: cached, source };
  }
  const made = await thumbnailSource(request.file, bucket[1], signal, page);
  if (made.kind === "none") return made;
  // A failed cache write still leaves a thumbnail to show.
  if (cacheable)
    await writeCachedThumbnail(identity, bucket, made.image, made.source).catch(() => {});
  return { kind: "picture", picture: made.image, source: made.source };
}

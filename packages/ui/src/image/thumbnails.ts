/**
 * Thumbnails for any app: `requestThumbnail` asks a small pool of workers for a file's picture
 * fitted to a box, so decoding a folder of photos never blocks a frame. Pictures are cached on disk
 * (freedesktop layout, keyed by path, mtime and size) and the last few in memory; newest requests
 * run first, so the rows on screen fill before ones scrolled past.
 */
import os from "node:os";
import { Worker } from "node:worker_threads";
import type { FontSampleLine } from "#ui/font/sample";
import type { ImageFit } from "./decode";
import type { ImageStats } from "./image-stats";
import type { ImageData } from "./load";
import type { WorkerJob, WorkerRequest, WorkerResponse } from "./thumbnail-worker";

export type ThumbnailRequest = {
  file: string;
  mtimeMs: number;
  /** The file's size in bytes, part of its identity. */
  size: number;
  /** The box the picture is drawn in, in device pixels. */
  width: number;
  height: number;
  fit: ImageFit;
  /** The page of a document (a PDF), from 1; the first when left out. */
  page?: number;
};

/** The file whose picture's statistics are wanted, with its identity. */
export type ImageStatsRequest = { file: string; mtimeMs: number; size: number };

export type ThumbnailResult =
  | { kind: "image"; image: ImageData; source: { width: number; height: number } | null }
  | { kind: "none"; reason: string }
  | { kind: "error"; message: string };

/** What a worker answers: a picture, or a picture's statistics. */
type WorkResult = ThumbnailResult | { kind: "stats"; stats: ImageStats };

/** Pixels held in memory across all finished thumbnails. */
const MEMORY_BUDGET_BYTES = 96 * 1024 * 1024;
/** Workers kept: decoding is CPU-bound, and the app's own thread must stay free. */
const MAX_WORKERS = 2;

type Job = {
  request: WorkerJob;
  key: string;
  waiters: Array<(result: WorkResult) => void>;
  id: number;
  worker: Worker | null;
};

const memory = new Map<string, WorkResult>();
let memoryBytes = 0;
const pending: Job[] = [];
const running = new Map<number, Job>();
const byKey = new Map<string, Job>();
const idle: Worker[] = [];
let workers = 0;
let nextId = 1;
let diskCache = true;

/** Smokes and the gallery render without writing into the user's cache. */
export function setThumbnailDiskCache(enabled: boolean): void {
  diskCache = enabled;
}

/** A finished thumbnail already in memory, for drawing it on the first frame. */
export function cachedThumbnail(request: ThumbnailRequest): ThumbnailResult | null {
  return asThumbnail(remember(thumbnailKey(request)));
}

export async function requestThumbnail(
  request: ThumbnailRequest,
  signal?: AbortSignal,
): Promise<ThumbnailResult> {
  const result = await enqueue(
    thumbnailKey(request),
    { type: "thumbnail", ...request, cache: diskCache },
    signal,
  );
  return asThumbnail(result) ?? { kind: "error", message: "Unexpected thumbnail answer." };
}

/** Statistics already in memory, for drawing them on the first frame. */
export function cachedImageStats(request: ImageStatsRequest): ImageStats | null {
  const hit = remember(statsKey(request));
  return hit?.kind === "stats" ? hit.stats : null;
}

/**
 * A picture's luminance histogram and dominant colours, computed in a worker from its small
 * thumbnail. Null when the file has no picture (or it could not be read).
 */
export async function requestImageStats(
  request: ImageStatsRequest,
  signal?: AbortSignal,
): Promise<ImageStats | null> {
  const { file, mtimeMs, size } = request;
  const result = await enqueue(
    statsKey(request),
    { type: "image-stats", file, mtimeMs, size, cache: diskCache },
    signal,
  );
  return result.kind === "stats" ? result.stats : null;
}

function asThumbnail(result: WorkResult | null): ThumbnailResult | null {
  return result && result.kind !== "stats" ? result : null;
}

function statsKey(request: ImageStatsRequest): string {
  return ["stats", request.file, request.mtimeMs, request.size].join("\n");
}

/** Lines of sample text drawn in a font file, `ink`-coloured on transparent. */
export async function requestFontSample(
  file: string,
  lines: readonly FontSampleLine[],
  ink: number,
  maxWidth: number,
  signal?: AbortSignal,
): Promise<ThumbnailResult> {
  const key = [
    "font",
    file,
    ink,
    maxWidth,
    ...lines.map((line) => `${line.size}:${line.text}`),
  ].join("\n");
  const result = await enqueue(
    key,
    { type: "font-sample", file, lines: [...lines], ink, maxWidth: Math.round(maxWidth) },
    signal,
  );
  return asThumbnail(result) ?? { kind: "error", message: "Unexpected font sample answer." };
}

function thumbnailKey(request: ThumbnailRequest): string {
  return [
    request.file,
    request.mtimeMs,
    request.size,
    Math.round(request.width),
    Math.round(request.height),
    request.fit,
    request.page ?? 1,
  ].join("\n");
}

function remember(key: string): WorkResult | null {
  const hit = memory.get(key);
  if (!hit) return null;
  // Most recently used last, so eviction takes the oldest.
  memory.delete(key);
  memory.set(key, hit);
  return hit;
}

function store(key: string, result: WorkResult): void {
  if (result.kind === "error") return;
  memory.set(key, result);
  memoryBytes += result.kind === "image" ? result.image.rgba.byteLength : 0;
  for (const [oldest, value] of memory) {
    if (memoryBytes <= MEMORY_BUDGET_BYTES) break;
    memory.delete(oldest);
    if (value.kind === "image") memoryBytes -= value.image.rgba.byteLength;
  }
}

function enqueue(key: string, request: Job["request"], signal?: AbortSignal): Promise<WorkResult> {
  const hit = remember(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    let job = byKey.get(key);
    if (!job) {
      job = { request, key, waiters: [], id: nextId++, worker: null };
      byKey.set(key, job);
      pending.push(job);
    } else if (!job.worker) {
      // Asked again: it is wanted now, so it moves to the front.
      pending.splice(pending.indexOf(job), 1);
      pending.push(job);
    }
    const owner = job;
    const waiter = (result: WorkResult) => {
      signal?.removeEventListener("abort", abandon);
      resolve(result);
    };
    const abandon = () => {
      owner.waiters.splice(owner.waiters.indexOf(waiter), 1);
      if (!owner.waiters.length) cancel(owner);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abandon, { once: true });
    owner.waiters.push(waiter);
    pump();
  });
}

function cancel(job: Job): void {
  byKey.delete(job.key);
  if (job.worker) {
    job.worker.postMessage({ id: job.id, type: "cancel" } satisfies WorkerRequest);
    running.delete(job.id);
    release(job.worker);
  } else pending.splice(pending.indexOf(job), 1);
}

function settle(job: Job, result: WorkResult): void {
  byKey.delete(job.key);
  running.delete(job.id);
  store(job.key, result);
  for (const waiter of job.waiters.splice(0)) waiter(result);
}

function pump(): void {
  while (pending.length) {
    const worker = idle.pop() ?? spawn();
    if (!worker) return;
    const job = pending.pop()!;
    job.worker = worker;
    running.set(job.id, job);
    worker.ref();
    worker.postMessage({ ...job.request, id: job.id } as WorkerRequest);
  }
}

function release(worker: Worker): void {
  // Idle workers must not keep a finished smoke or a closing app alive.
  worker.unref();
  idle.push(worker);
  pump();
}

function spawn(): Worker | null {
  const limit = Math.min(MAX_WORKERS, Math.max(1, os.availableParallelism() - 1));
  if (workers >= limit) return null;
  workers++;
  const worker = new Worker(new URL("./thumbnail-worker.ts", import.meta.url));
  worker.on("message", (response: WorkerResponse) => {
    const job = running.get(response.id);
    if (job?.worker !== worker) return;
    const { id: _id, ...result } = response;
    settle(job, result);
    release(worker);
  });
  worker.on("error", (error) => {
    console.error("[ui/thumbnails] worker failed:", error);
    retire(worker, error.message);
  });
  worker.on("exit", () => retire(worker, "The thumbnail worker stopped."));
  return worker;
}

/** A dead worker's jobs fail (as values) and a new worker takes the queue. */
function retire(worker: Worker, message: string): void {
  const at = idle.indexOf(worker);
  if (at >= 0) idle.splice(at, 1);
  else if (![...running.values()].some((job) => job.worker === worker)) return;
  workers--;
  // Settling removes jobs from `running`, so iterate over a copy.
  for (const job of Array.from(running.values()))
    if (job.worker === worker) settle(job, { kind: "error", message });
  pump();
}

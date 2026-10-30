/**
 * Previews by item version (path, mtime, size): paging back and forth in the Space sheet, or
 * moving through columns, shows a preview already read without reading it again. Concurrent asks
 * share one load; an abandoned load stops once no one waits for it.
 */
import { loadPreview, type PreviewProgress } from "./loaders";
import type { Preview, PreviewSubject } from "./model";

/** Previews kept; each is small (text excerpts are capped), so this is about churn, not memory. */
const CACHE_ENTRIES = 96;

type Flight = {
  controller: AbortController;
  promise: Promise<Preview>;
  waiters: number;
  listeners: Set<PreviewProgress>;
  latest: Preview | null;
};

const cache = new Map<string, Preview>();
const inFlight = new Map<string, Flight>();

export function previewKey(subject: PreviewSubject): string {
  return `${subject.path}\n${subject.modified}\n${subject.size}`;
}

/** A finished preview, for drawing it on the first frame. */
export function cachedPreview(subject: PreviewSubject): Preview | null {
  return cache.get(previewKey(subject)) ?? null;
}

export function requestPreview(
  subject: PreviewSubject,
  signal: AbortSignal,
  onProgress?: PreviewProgress,
): Promise<Preview> {
  const key = previewKey(subject);
  const hit = cache.get(key);
  if (hit) {
    // Most recently used last, so eviction takes the oldest.
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit);
  }
  let flight = inFlight.get(key);
  if (!flight) {
    const controller = new AbortController();
    const listeners = new Set<PreviewProgress>();
    const started: Flight = { controller, listeners, waiters: 0, latest: null, promise: null! };
    started.promise = loadPreview(subject, controller.signal, (partial) => {
      started.latest = partial;
      for (const listener of listeners) listener(partial);
    }).then((preview) => {
      inFlight.delete(key);
      // Errors may be passing (a file mid-write), and a folder's size changes with anything
      // under it, not just its own mtime: both are read again next time.
      if (preview.kind !== "error" && preview.kind !== "folder") remember(key, preview);
      return preview;
    });
    started.promise.catch(() => inFlight.delete(key));
    flight = started;
    inFlight.set(key, flight);
  }
  const shared = flight;
  shared.waiters++;
  if (onProgress) {
    shared.listeners.add(onProgress);
    if (shared.latest) onProgress(shared.latest);
  }
  return new Promise<Preview>((resolve, reject) => {
    const leave = () => {
      if (onProgress) shared.listeners.delete(onProgress);
      if (--shared.waiters === 0 && inFlight.get(key) === shared) {
        inFlight.delete(key);
        shared.controller.abort();
      }
    };
    const abandon = () => {
      leave();
      reject(signal.reason);
    };
    if (signal.aborted) return abandon();
    signal.addEventListener("abort", abandon, { once: true });
    shared.promise.then(
      (preview) => {
        signal.removeEventListener("abort", abandon);
        if (onProgress) shared.listeners.delete(onProgress);
        shared.waiters--;
        resolve(preview);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abandon);
        leave();
        reject(error);
      },
    );
  });
}

function remember(key: string, preview: Preview): void {
  cache.set(key, preview);
  while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
}

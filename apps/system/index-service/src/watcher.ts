/**
 * Live updates: a recursive `fs.watch` per root, its events filtered by the exclusion rules and
 * gathered into debounced batches of changed paths. Where a recursive watch cannot be had, or
 * fails later (inotify limits), the service relies on the periodic reconcile pass instead.
 */
import fs from "node:fs";
import path from "node:path";
import { isExcluded, type ExclusionRules } from "./config";

/** Quiet time before a batch is delivered, and the longest a busy stream can delay one. */
const WATCH_DEBOUNCE_MS = 300;
const WATCH_MAX_WAIT_MS = 2000;

export type WatchMode = "recursive" | "reconcile";
export type WatchHandle = { readonly mode: WatchMode; close(): void };

export type WatchOptions = {
  rules: ExclusionRules;
  /** Changed absolute paths. A root itself in the set means "rescan this root". */
  onChanges(paths: ReadonlySet<string>): void;
  /** The watch broke after starting; the caller should fall back to reconciling. */
  onFailure(error: Error): void;
  debounceMs?: number;
  maxWaitMs?: number;
};

/** Changes inside excluded folders (node_modules, .git, hidden folders) are noise. */
function insideExcluded(root: string, relative: string, rules: ExclusionRules): boolean {
  const parts = relative.split(path.sep);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (isExcluded(rules, current, part, true)) return true;
  }
  return false;
}

export function watchRoots(roots: readonly string[], options: WatchOptions): WatchHandle {
  const debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? WATCH_MAX_WAIT_MS;
  const watchers: fs.FSWatcher[] = [];
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let firstAt = 0;
  let closed = false;
  const deliver = () => {
    timer = null;
    const batch = pending;
    pending = new Set();
    if (batch.size && !closed) options.onChanges(batch);
  };
  const record = (file: string) => {
    if (closed) return;
    if (!pending.size) firstAt = performance.now();
    pending.add(file);
    if (timer) clearTimeout(timer);
    const waited = performance.now() - firstAt;
    timer = setTimeout(deliver, Math.max(0, Math.min(debounceMs, maxWaitMs - waited)));
  };
  const close = () => {
    closed = true;
    if (timer) clearTimeout(timer);
    for (const watcher of watchers.splice(0)) watcher.close();
  };
  try {
    for (const root of roots) {
      const watcher = fs.watch(root, { recursive: true, persistent: false }, (_event, name) => {
        // No name: the platform lost track of what changed, so rescan the root.
        if (name === null) return record(root);
        const relative = String(name);
        if (!insideExcluded(root, relative, options.rules)) record(path.join(root, relative));
      });
      watcher.on("error", (error) => {
        if (closed) return;
        close();
        options.onFailure(error);
      });
      watchers.push(watcher);
    }
  } catch {
    // ERR_FEATURE_UNAVAILABLE_ON_PLATFORM, ENOSPC (inotify watches exhausted) and the like.
    close();
    return { mode: "reconcile", close() {} };
  }
  return { mode: "recursive", close };
}

/**
 * The breadth-first walk. One directory at a time, its entries are compared with what the index
 * holds and only differences are written, so the first crawl and every later reconcile are the
 * same pass. Work is committed and the event loop yielded every `BATCH_SIZE` entries.
 */
import type { Dir, Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileKind } from "@moire/file-operations";
import type { Gate } from "./activity";
import { isExcluded, type ExclusionRules } from "./config";
import { hasExtractableText } from "./content";
import type { EntryFacts, IndexStore } from "./store";

const BATCH_SIZE = 200;
/** Concurrent lstat calls; enough to hide disk latency without crowding libuv's thread pool. */
const STAT_PARALLELISM = 8;

export type CrawlProgress = { directories: number; entries: number; queued: number };

export type CrawlContext = {
  store: IndexStore;
  rules: ExclusionRules;
  gate: Gate;
  signal: AbortSignal;
  progress: CrawlProgress;
  /** Called after each committed batch that changed the index. */
  onChange(): void;
};

export type DirectoryOutcome =
  | { kind: "read"; subdirs: string[]; added: string[] }
  /** The folder no longer exists; it and everything below it were removed. */
  | { kind: "gone" }
  /** It could not be read (permissions); what the index holds for it is kept. */
  | { kind: "unreadable" };

async function facts(dir: string, entry: Dirent): Promise<EntryFacts | null> {
  if (!entry.isFile() && !entry.isDirectory() && !entry.isSymbolicLink()) return null;
  const file = path.join(dir, entry.name);
  try {
    const stat = await fs.lstat(file);
    // Links are indexed as themselves and never followed, so a link cannot loop the walk.
    const isDir = stat.isDirectory();
    return {
      path: file,
      name: entry.name,
      dir,
      kind: fileKind(entry.name, isDir),
      isDir,
      size: isDir ? 0 : stat.size,
      mtime: stat.mtimeMs,
      atime: stat.atimeMs,
      hidden: entry.name.startsWith("."),
      textual: stat.isFile() && hasExtractableText(entry.name, stat.size),
    };
  } catch {
    // Gone between listing and stat; the next pass settles it.
    return null;
  }
}

/** Bring one directory's direct children in line with the disk. */
export async function reconcileDirectory(
  context: CrawlContext,
  dir: string,
): Promise<DirectoryOutcome> {
  const { store, rules, gate, signal } = context;
  let handle: Dir;
  try {
    handle = await fs.opendir(dir, { bufferSize: 64 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      if (store.transaction(() => store.removeBelow(dir))) context.onChange();
      return { kind: "gone" };
    }
    return { kind: "unreadable" };
  }
  const existing = store.children(dir);
  const seen = new Set<string>();
  const subdirs: string[] = [];
  const added: string[] = [];
  let pending: Dirent[] = [];
  const flush = async () => {
    const batch = pending;
    pending = [];
    const found: EntryFacts[] = [];
    for (let index = 0; index < batch.length; index += STAT_PARALLELISM) {
      const group = await Promise.all(
        batch.slice(index, index + STAT_PARALLELISM).map((entry) => facts(dir, entry)),
      );
      for (const item of group) if (item) found.push(item);
    }
    signal.throwIfAborted();
    let changed = false;
    store.transaction(() => {
      for (const item of found) {
        seen.add(item.name);
        if (item.isDir) subdirs.push(item.path);
        const row = existing.get(item.name);
        if (!row) {
          store.insert(item);
          if (item.isDir) added.push(item.path);
          changed = true;
        } else if (row.isDir !== item.isDir) {
          store.remove(item.path, row.isDir);
          store.insert(item);
          if (item.isDir) added.push(item.path);
          changed = true;
        } else if (row.size !== item.size || row.mtime !== Math.trunc(item.mtime)) {
          store.update(row.id, item);
          changed = true;
        }
      }
    });
    context.progress.entries += batch.length;
    if (changed) context.onChange();
    await gate.pass(signal);
  };
  try {
    for await (const entry of handle) {
      const file = path.join(dir, entry.name);
      if (isExcluded(rules, file, entry.name, entry.isDirectory())) continue;
      pending.push(entry);
      if (pending.length >= BATCH_SIZE) await flush();
    }
    if (pending.length) await flush();
  } catch (error) {
    if (signal.aborted) throw error;
    // The folder vanished or became unreadable mid-listing; keep what was committed.
    return { kind: "unreadable" };
  }
  const missing = [...existing].filter(([name]) => !seen.has(name));
  if (missing.length) {
    store.transaction(() => {
      for (const [name, row] of missing) store.remove(path.join(dir, name), row.isDir);
    });
    context.onChange();
  }
  context.progress.directories++;
  return { kind: "read", subdirs, added };
}

/** Walk breadth-first from `roots`, reconciling every folder below them. */
export async function walk(context: CrawlContext, roots: readonly string[]): Promise<void> {
  const queue = [...roots];
  while (queue.length) {
    context.signal.throwIfAborted();
    const dir = queue.shift()!;
    context.progress.queued = queue.length;
    const outcome = await reconcileDirectory(context, dir);
    if (outcome.kind === "read") queue.push(...outcome.subdirs);
    context.progress.queued = queue.length;
  }
}

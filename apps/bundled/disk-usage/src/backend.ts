import syncFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type UsageNode = {
  path: string;
  name: string;
  kind: "directory" | "file" | "symlink" | "other";
  allocated: number;
  logical: number;
  children: UsageNode[];
};
export type UsageScan = {
  root: UsageNode;
  entries: number;
  skipped: Array<{ path: string; reason: string }>;
  truncated: boolean;
};
export async function scanUsage(
  directory: string,
  options: {
    signal?: AbortSignal;
    maxEntries?: number;
    /** Entries visited and bytes measured so far, every few hundred entries. */
    onProgress?: (entries: number, bytes: number) => void;
  } = {},
): Promise<UsageScan> {
  const rootPath = await fs.realpath(directory),
    rootStat = await fs.lstat(rootPath);
  if (!rootStat.isDirectory()) throw new Error("Choose a directory to scan");
  const seen = new Set<string>(),
    skipped: UsageScan["skipped"] = [];
  let entries = 0,
    bytes = 0,
    truncated = false;
  const maximum = options.maxEntries ?? 100_000;
  const visit = async (file: string, depth: number): Promise<UsageNode> => {
    options.signal?.throwIfAborted();
    const result: UsageNode = {
      path: file,
      name: path.basename(file) || file,
      kind: "other",
      allocated: 0,
      logical: 0,
      children: [],
    };
    if (entries >= maximum || depth > 128) {
      truncated = true;
      skipped.push({ path: file, reason: "Scan limit reached" });
      return result;
    }
    entries++;
    if (entries % 250 === 0) options.onProgress?.(entries, bytes);
    try {
      const stat = await fs.lstat(file);
      result.kind = stat.isSymbolicLink()
        ? "symlink"
        : stat.isDirectory()
          ? "directory"
          : stat.isFile()
            ? "file"
            : "other";
      if (stat.dev !== rootStat.dev) {
        skipped.push({ path: file, reason: "Other filesystem skipped" });
        return result;
      }
      const identity = `${stat.dev}:${stat.ino}`;
      if (!seen.has(identity)) {
        seen.add(identity);
        result.allocated = stat.blocks * 512;
        bytes += result.allocated;
        result.logical = stat.isFile() || stat.isSymbolicLink() ? stat.size : 0;
      }
      if (stat.isDirectory()) {
        const children = (await fs.readdir(file)).sort();
        for (const child of children) {
          if (entries >= maximum) {
            truncated = true;
            skipped.push({ path: file, reason: "Remaining entries omitted at scan limit" });
            break;
          }
          const item = await visit(path.join(file, child), depth + 1);
          result.children.push(item);
          result.allocated += item.allocated;
          result.logical += item.logical;
        }
        result.children.sort((a, b) => b.allocated - a.allocated || a.name.localeCompare(b.name));
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      skipped.push({ path: file, reason: error instanceof Error ? error.message : String(error) });
    }
    return result;
  };
  const root = await visit(rootPath, 0);
  options.onProgress?.(entries, bytes);
  return { root, entries, skipped, truncated };
}
/** Folders offered before a scan: home, its usual folders, and the whole disk when readable. */
export function quickPicks(): Array<{ id: string; label: string; path: string }> {
  const home = realHome();
  const picks = [{ id: "home", label: "Home", path: home }];
  for (const name of ["Downloads", "Documents"])
    if (readableFolder(path.join(home, name)))
      picks.push({ id: name.toLowerCase(), label: name, path: path.join(home, name) });
  if (readableFolder("/")) picks.push({ id: "root", label: "Whole disk", path: "/" });
  return picks;
}

function readableFolder(folder: string): boolean {
  try {
    syncFs.accessSync(folder, syncFs.constants.R_OK | syncFs.constants.X_OK);
    return syncFs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

/** The home folder as scans report it: scans resolve links, so ~ must be resolved too. */
export function realHome(): string {
  try {
    return syncFs.realpathSync(os.homedir());
  } catch {
    return os.homedir();
  }
}

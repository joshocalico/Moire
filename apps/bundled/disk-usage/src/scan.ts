import fs from "node:fs/promises";
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
    onProgress?: (entries: number) => void;
  } = {},
): Promise<UsageScan> {
  const rootPath = await fs.realpath(directory),
    rootStat = await fs.lstat(rootPath);
  if (!rootStat.isDirectory()) throw new Error("Choose a directory to scan");
  const seen = new Set<string>(),
    skipped: UsageScan["skipped"] = [];
  let entries = 0,
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
    if (entries % 250 === 0) options.onProgress?.(entries);
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
  options.onProgress?.(entries);
  return { root, entries, skipped, truncated };
}
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024,
    index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

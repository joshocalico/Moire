/**
 * Recent files: what apps recorded as opened, merged with what the index saw modified in the
 * last 14 days. Without an index (indexing off) only the opened files are offered.
 */
import {
  fileKind,
  openedRecentFiles,
  type OpenedFile,
  type RecentFile,
} from "@moire/file-operations";
import type { IndexStore } from "./store";

const RECENT_MODIFIED_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function recentFiles(
  store: IndexStore | null,
  opened: readonly OpenedFile[],
  limit: number,
  now = Date.now(),
): Promise<RecentFile[]> {
  const merged = new Map<string, RecentFile>();
  for (const entry of await openedRecentFiles(opened, limit)) merged.set(entry.path, entry);
  if (store) {
    const rows = store
      .prepare(
        `SELECT path, name, kind, size, mtime FROM files
         WHERE is_dir = 0 AND hidden = 0 AND mtime >= ? ORDER BY mtime DESC LIMIT ?`,
      )
      .all(now - RECENT_MODIFIED_DAYS * DAY_MS, limit);
    for (const row of rows) {
      const file = String(row.path);
      const modified = Number(row.mtime);
      const previous = merged.get(file);
      if (previous) {
        previous.usedAt = Math.max(previous.usedAt, modified);
        continue;
      }
      merged.set(file, {
        path: file,
        name: String(row.name),
        kind: fileKind(String(row.name), false),
        size: Number(row.size),
        modified,
        usedAt: modified,
        source: "modified",
        app: null,
      });
    }
  }
  return [...merged.values()].sort((a, b) => b.usedAt - a.usedAt).slice(0, limit);
}

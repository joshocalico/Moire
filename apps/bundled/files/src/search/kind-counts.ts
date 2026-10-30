/** The folder page's filter chips: All, then one chip per kind present, with counts. */
import { FILE_KINDS, fileKind, kindLabel, type FileKind } from "@moire/file-operations";
import type { SearchEntry } from "./filters";

export type KindFilter = FileKind | "all";
export type KindChip = { filter: KindFilter; label: string; count: number };

export function countKinds(entries: readonly SearchEntry[]): Map<FileKind, number> {
  const counts = new Map<FileKind, number>();
  for (const entry of entries) {
    const kind = fileKind(entry.name, entry.isDir);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

/** Kinds in `FILE_KINDS` order; kinds with no entries get no chip. */
export function kindChips(entries: readonly SearchEntry[]): KindChip[] {
  const counts = countKinds(entries);
  return [
    { filter: "all", label: "All", count: entries.length },
    ...FILE_KINDS.flatMap((kind) => {
      const count = counts.get(kind);
      return count ? [{ filter: kind, label: kindLabel(kind), count }] : [];
    }),
  ];
}

export function filterByKind<T extends SearchEntry>(
  entries: readonly T[],
  filter: KindFilter,
): T[] {
  return filter === "all"
    ? [...entries]
    : entries.filter((entry) => fileKind(entry.name, entry.isDir) === filter);
}

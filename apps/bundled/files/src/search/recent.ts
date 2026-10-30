/**
 * The Recent page: files grouped Today, Yesterday, This week and Earlier. The index supplies
 * them; without it, `loadRecentWithoutIndex` reads the apps' own recent lists.
 */
import { openedRecentFiles, readOpenedFiles, type RecentFile } from "@moire/file-operations";

export type RecentGroupId = "today" | "yesterday" | "week" | "earlier";
export type RecentGroup<T> = { id: RecentGroupId; label: string; items: readonly T[] };

const LABELS: Readonly<Record<RecentGroupId, string>> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  earlier: "Earlier",
};
/** "This week" is the five days before yesterday, so the three recent groups span a week. */
const WEEK_DAYS = 7;

/** Local midnight `days` calendar days before `now`'s, so DST changes do not shift a day. */
function midnight(now: number, days: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

/** Newest first within each group; empty groups are left out. */
export function groupRecent<T extends { usedAt: number }>(
  items: readonly T[],
  now: number,
): RecentGroup<T>[] {
  const bounds: ReadonlyArray<readonly [RecentGroupId, number]> = [
    ["today", midnight(now, 0)],
    ["yesterday", midnight(now, 1)],
    ["week", midnight(now, WEEK_DAYS - 1)],
    ["earlier", -Infinity],
  ];
  const groups = new Map<RecentGroupId, T[]>();
  for (const item of [...items].sort((a, b) => b.usedAt - a.usedAt)) {
    const id = bounds.find(([, start]) => item.usedAt >= start)![0];
    groups.set(id, [...(groups.get(id) ?? []), item]);
  }
  return bounds.flatMap(([id]) => {
    const group = groups.get(id);
    return group ? [{ id, label: LABELS[id], items: group }] : [];
  });
}

/** Apps' recent lists, when the index service is not running. */
export async function loadRecentWithoutIndex(
  limit: number,
  directory?: string,
): Promise<RecentFile[]> {
  return openedRecentFiles(await readOpenedFiles(directory), limit);
}

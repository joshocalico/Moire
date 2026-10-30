/**
 * What the inspector says about an item or a selection, as plain values: the caption under the
 * name, the Information rows, the History rows, a selection's summary. Pure; views draw them.
 */
import path from "node:path";
import type { FileKind } from "@moire/file-operations";
import type { Entry } from "#files/filesystem";
import { countLabel, formatBytes, formatDay, formatRecent, tidyPath } from "#files/format";
import { entryKind, kindName } from "#files/kind-style";
import { previewFacts, type Preview } from "#files/preview/model";
import { permissionsSummary } from "#files/permissions";

/** A fact row; `accent` values read as links (the app an item was last opened in). */
export type Row = { label: string; value: string; accent?: boolean };

/** What `lstat` says about an item, beyond its listing. */
export type ItemStat = {
  path: string;
  mode: number;
  uid: number;
  gid: number;
  /** Birth time where the filesystem keeps one. */
  created: number | null;
  modified: number;
  accessed: number;
  isDir: boolean;
  linkTarget: string | null;
};

export type LastOpened = { app: string; at: number };

export const KIND_PLURAL: Readonly<Record<FileKind, string>> = {
  folder: "Folders",
  image: "Images",
  document: "Documents",
  code: "Code",
  audio: "Audio",
  video: "Video",
  archive: "Archives",
  font: "Fonts",
  other: "Other",
};

const KIND_NOUN: Readonly<Record<FileKind, [string, string]>> = {
  folder: ["folder", "folders"],
  image: ["image", "images"],
  document: ["document", "documents"],
  code: ["source file", "source files"],
  audio: ["audio file", "audio files"],
  video: ["video", "videos"],
  archive: ["archive", "archives"],
  font: ["font", "fonts"],
  other: ["file", "files"],
};

/** "JPG image · 54.9 KB · Today, 17:19"; folders leave out the size. */
export function itemCaption(entry: Entry, now = Date.now()): string {
  return [
    kindName(entry),
    entry.isDir ? null : formatBytes(entry.size),
    formatDay(entry.modified, now),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "2 images · 1 document", most common kind first. */
export function kindBreakdown(entries: readonly Entry[]): string {
  const counts = new Map<FileKind, number>();
  for (const entry of entries) {
    const kind = entryKind(entry);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${count} ${KIND_NOUN[kind][count === 1 ? 0 : 1]}`)
    .join(" · ");
}

/** Bytes in the selected files (folders count by what the listing knows: nothing). */
export const totalBytes = (entries: readonly Entry[]) =>
  entries.reduce((sum, entry) => sum + (entry.isDir ? 0 : entry.size), 0);

export const exactBytes = (bytes: number) =>
  `${formatBytes(bytes)} (${bytes.toLocaleString()} bytes)`;

/** The Information card: kind, size, then what the preview knows for the kind. */
export function infoRows(entry: Entry, preview: Preview | null, home: string): Row[] {
  const rows: Row[] = [{ label: "Kind", value: entry.isDir ? "Folder" : kindName(entry) }];
  if (entry.trash) {
    rows.push(
      {
        label: "Was in",
        value: entry.trash.originalPath
          ? tidyPath(path.dirname(entry.trash.originalPath), home)
          : "Unknown",
      },
      {
        label: "Deleted",
        value: entry.trash.deletedAt ? formatDay(entry.trash.deletedAt) : "Unknown",
      },
    );
  }
  if (!entry.isDir) rows.push({ label: "Size", value: exactBytes(entry.size) });
  for (const [label, value] of previewFacts(preview)) {
    // The folder hero already counts the items; the size row says the total.
    if (preview?.kind === "folder" && label === "Contents") continue;
    rows.push({ label, value });
  }
  return rows;
}

/** The History card: created, modified, accessed, and the app it was last opened in. */
export function historyRows(
  stat: ItemStat | null,
  entry: Entry,
  lastOpened: LastOpened | null,
  now = Date.now(),
): Row[] {
  const rows: Row[] = [];
  if (stat?.created) rows.push({ label: "Created", value: formatDay(stat.created, now) });
  rows.push({ label: "Modified", value: formatDay(stat?.modified ?? entry.modified, now) });
  if (stat && !entry.isDir) rows.push({ label: "Accessed", value: formatDay(stat.accessed, now) });
  if (lastOpened)
    rows.push({
      label: "Last opened",
      value: `${lastOpened.app} · ${formatRecent(lastOpened.at, now)}`,
      accent: true,
    });
  if (stat?.linkTarget) rows.push({ label: "Links to", value: stat.linkTarget });
  return rows;
}

/** The Selection card for several items. */
export function selectionRows(
  entries: readonly Entry[],
  stats: readonly ItemStat[],
  home: string,
  currentUid: number,
  now = Date.now(),
): Row[] {
  const bytes = totalBytes(entries);
  const dates = entries.map((entry) => entry.modified);
  const earliest = formatDay(Math.min(...dates), now);
  const latest = formatDay(Math.max(...dates), now);
  const parents = [...new Set(entries.map((entry) => path.dirname(entry.path)))];
  const rows: Row[] = [
    { label: "Items", value: entries.map((entry) => entry.name).join(", ") },
    { label: "Total size", value: exactBytes(bytes) },
    { label: "Modified", value: earliest === latest ? earliest : `${earliest} – ${latest}` },
    {
      label: "Location",
      value: parents.length === 1 ? tidyPath(parents[0]!, home) : `${parents.length} folders`,
    },
  ];
  if (stats.length === entries.length)
    rows.push({
      label: "Permissions",
      value: permissionsSummary(
        stats.map((stat) => stat.mode),
        stats.map((stat) => stat.uid),
        currentUid,
      ),
    });
  return rows;
}

/** The title for a selection: "3 items", with folders named when all are folders. */
export function selectionTitle(entries: readonly Entry[]): string {
  return entries.every((entry) => entry.isDir)
    ? countLabel(entries.length, "folder")
    : countLabel(entries.length);
}

/** "jpg" for "photo.JPG"; "" without an extension. */
export function extensionOf(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

/** "83% smaller" from packed and unpacked sizes; null when it did not shrink. */
export function savedShare(packed: number, unpacked: number): number | null {
  if (!unpacked || packed >= unpacked) return null;
  return Math.round((1 - packed / unpacked) * 100);
}

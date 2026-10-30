/** How each kind of file looks in Files: a tint for its tile and icon, and its row caption. */
import path from "node:path";
import { fileKind, kindIconName, type FileKind } from "@moire/file-operations";
import type { IconName } from "@moire/ui";
import { formatBytes } from "./format";

/** Fixed tints read on both themes; folders and unknown files take the theme's own colours. */
const TINTS: Readonly<Partial<Record<FileKind, number>>> = {
  image: 0xff4fbf8a,
  document: 0xff6aa6f0,
  code: 0xffa58bf0,
  audio: 0xffe0709b,
  video: 0xffe39a6a,
  archive: 0xffd9a441,
  font: 0xff4fb8c4,
};

const NOUNS: Readonly<Record<FileKind, string>> = {
  folder: "Folder",
  image: "image",
  document: "document",
  code: "source",
  audio: "audio",
  video: "video",
  archive: "archive",
  font: "font",
  other: "file",
};

export type KindPalette = { accentLine: number; muted: number };

export function kindTint(kind: FileKind, palette: KindPalette): number {
  return TINTS[kind] ?? (kind === "folder" ? palette.accentLine : palette.muted);
}

export function kindIcon(kind: FileKind): IconName {
  return (kind === "folder" ? "folder-filled" : kindIconName(kind)) as IconName;
}

export function entryKind(entry: { name: string; isDir: boolean }): FileKind {
  return fileKind(entry.name, entry.isDir);
}

/** "PNG image", "PDF document", "Folder". */
export function kindName(entry: { name: string; isDir: boolean }): string {
  const kind = entryKind(entry);
  if (kind === "folder") return NOUNS.folder;
  const extension = path.extname(entry.name).slice(1).toUpperCase();
  const noun = NOUNS[kind];
  return extension ? `${extension} ${noun}` : noun[0]!.toUpperCase() + noun.slice(1);
}

/** A row's second line: "PNG image · 3.1 MB". */
export function entryCaption(entry: { name: string; isDir: boolean; size: number }): string {
  return entry.isDir ? kindName(entry) : `${kindName(entry)} · ${formatBytes(entry.size)}`;
}

/** The short label on a grid tile's badge: the extension, up to four letters. */
export function extensionBadge(name: string): string {
  return path.extname(name).slice(1).slice(0, 4);
}

/** Folder cards take one of a few tints, chosen by name so a folder keeps its colour. */
const FOLDER_TINTS = [0xff8b7cf6, 0xff4fbf8a, 0xffe39a6a, 0xff6aa6f0] as const;

export function folderTint(name: string): number {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return FOLDER_TINTS[hash % FOLDER_TINTS.length]!;
}

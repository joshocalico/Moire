import path from "node:path";

/**
 * What a file is, independent of how it is drawn. Files' filter chips, search tokens and the
 * index service all classify with this one map so a count in one place matches a filter in another.
 */
export type FileKind =
  | "folder"
  | "image"
  | "document"
  | "code"
  | "audio"
  | "video"
  | "archive"
  | "font"
  | "other";

/** Every kind, in the order Files lists filter chips and result groups. */
export const FILE_KINDS: readonly FileKind[] = [
  "folder",
  "image",
  "document",
  "audio",
  "video",
  "archive",
  "code",
  "font",
  "other",
];

const EXTENSIONS: ReadonlyArray<readonly [FileKind, readonly string[]]> = [
  [
    "image",
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tif", ".tiff", ".heic", ".avif"],
  ],
  [
    "document",
    [
      ".txt",
      ".md",
      ".markdown",
      ".pdf",
      ".odt",
      ".ods",
      ".odp",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".rtf",
      ".csv",
      ".tsv",
      ".epub",
    ],
  ],
  [
    "code",
    [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".json",
      ".css",
      ".html",
      ".htm",
      ".xml",
      ".yaml",
      ".yml",
      ".toml",
      ".sh",
      ".py",
      ".rs",
      ".go",
      ".c",
      ".h",
      ".cpp",
      ".hpp",
      ".java",
      ".rb",
      ".lua",
      ".nix",
      ".sql",
    ],
  ],
  ["audio", [".mp3", ".flac", ".ogg", ".opus", ".wav", ".m4a", ".aac"]],
  ["video", [".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v"]],
  ["archive", [".zip", ".tar", ".gz", ".xz", ".bz2", ".zst", ".7z", ".tgz", ".rar"]],
  ["font", [".ttf", ".otf", ".woff", ".woff2"]],
];

const KIND_BY_EXTENSION = new Map(
  EXTENSIONS.flatMap(([kind, extensions]) => extensions.map((extension) => [extension, kind])),
);

/** Kinds keep their existing artwork: code files draw the editor icon, audio the music icon. */
const ICON_BY_KIND: Readonly<Record<FileKind, string>> = {
  folder: "folder",
  image: "image",
  document: "document",
  code: "editor",
  audio: "music",
  video: "video",
  archive: "archive",
  font: "font",
  other: "file",
};

const PLURAL_LABELS: Readonly<Record<FileKind, string>> = {
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

/** Words people type after `kind:`; each kind also accepts its own name. */
const KIND_ALIASES: ReadonlyMap<string, FileKind> = new Map([
  ["folders", "folder"],
  ["dir", "folder"],
  ["directory", "folder"],
  ["images", "image"],
  ["picture", "image"],
  ["pictures", "image"],
  ["photo", "image"],
  ["photos", "image"],
  ["documents", "document"],
  ["doc", "document"],
  ["docs", "document"],
  ["text", "document"],
  ["source", "code"],
  ["music", "audio"],
  ["sound", "audio"],
  ["videos", "video"],
  ["movie", "video"],
  ["movies", "video"],
  ["archives", "archive"],
  ["zip", "archive"],
  ["fonts", "font"],
]);

export function fileKind(name: string, isDir: boolean): FileKind {
  if (isDir) return "folder";
  return KIND_BY_EXTENSION.get(path.extname(name).toLowerCase()) ?? "other";
}

/** The symbolic icon name for a file, by kind, so Files and the desktop draw the same artwork. */
export function fileIconName(name: string, isDir: boolean): string {
  return kindIconName(fileKind(name, isDir));
}

export function kindIconName(kind: FileKind): string {
  return ICON_BY_KIND[kind];
}

/** "Images", "Documents": the label of a filter chip or result group. */
export function kindLabel(kind: FileKind): string {
  return PLURAL_LABELS[kind];
}

/** A kind from user or wire text, or null when the text names no kind. */
export function parseFileKind(value: string): FileKind | null {
  const key = value.trim().toLowerCase();
  if ((FILE_KINDS as readonly string[]).includes(key)) return key as FileKind;
  return KIND_ALIASES.get(key) ?? null;
}

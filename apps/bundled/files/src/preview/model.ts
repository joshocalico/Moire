/**
 * What Files can say about an item before it is opened: one `Preview` value per kind, and the
 * facts and one-line summaries every surface (the Space sheet, the columns pane, the best-match
 * card) shows from it. Pure: loaders in `loaders.ts` produce the values.
 */
import path from "node:path";
import { fileKind, type FileKind } from "@moire/file-operations";
import type { ArchiveSummary } from "@moire/file-formats";
import { codeLanguageFor, formatPlaybackTime, type CodeLanguage } from "@moire/ui";
import { countLabel, formatBytes } from "#files/format";

/** The item a preview describes; `modified` and `size` make it a distinct version. */
export type PreviewSubject = {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
};

export type Exposure = {
  camera: string | null;
  lens: string | null;
  taken: number | null;
  /** "1/250 s · f/2.8 · ISO 200 · 35 mm" */
  settings: string | null;
};

export type FolderSize = {
  bytes: number;
  files: number;
  /** Bytes per kind of file (by name), tallied with the total. */
  byKind: Partial<Record<FileKind, number>>;
  /** Still counting, or stopped at the cap ("at least"). */
  state: "measuring" | "complete" | "partial";
};

export type Preview =
  | {
      kind: "image";
      format: string;
      width: number | null;
      height: number | null;
      exposure: Exposure | null;
    }
  | {
      kind: "text";
      text: string;
      language: CodeLanguage;
      markdown: boolean;
      lines: number;
      encoding: string;
      /** Only the start was read; `lines` counts what was read. */
      truncated: boolean;
    }
  | {
      kind: "pdf";
      pages: number | null;
      title: string | null;
      author: string | null;
      excerpt: string;
      encrypted: boolean;
    }
  | {
      kind: "audio";
      duration: number | null;
      title: string | null;
      artist: string | null;
      album: string | null;
      year: string | null;
      track: string | null;
      codec: string | null;
      sampleRate: number | null;
      channels: number | null;
      bitrate: number | null;
      hasArt: boolean;
    }
  | {
      kind: "video";
      duration: number | null;
      width: number | null;
      height: number | null;
      codec: string | null;
      title: string | null;
    }
  | { kind: "archive"; summary: ArchiveSummary }
  | {
      kind: "font";
      format: string;
      family: string | null;
      style: string | null;
      version: string | null;
      glyphs: number | null;
      faces: number;
    }
  | {
      kind: "folder";
      items: number;
      folders: number;
      hidden: number;
      /** The first few children, folders first. */
      children: ReadonlyArray<{ name: string; isDir: boolean }>;
      /** Up to four children that have pictures, images first, for a mosaic. */
      pictures: ReadonlyArray<PreviewSubject>;
      size: FolderSize;
    }
  | { kind: "document"; excerpt: string }
  | { kind: "none" }
  | { kind: "error"; message: string };

export type PreviewKind = Preview["kind"];

/** The loader an item needs, by what it is called; loaders still check the bytes. */
export function previewKindFor(subject: Pick<PreviewSubject, "name" | "isDir">): PreviewKind {
  if (subject.isDir) return "folder";
  const extension = path.extname(subject.name).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (OFFICE_EXTENSIONS.has(extension)) return "document";
  if (TEXT_EXTENSIONS.has(extension) || codeLanguageFor(subject.name) !== "plain") return "text";
  const kind = fileKind(subject.name, false);
  if (
    kind === "image" ||
    kind === "audio" ||
    kind === "video" ||
    kind === "archive" ||
    kind === "font"
  )
    return kind;
  return "none";
}

const OFFICE_EXTENSIONS = new Set([".odt", ".ods", ".odp", ".docx"]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".rst",
  ".org",
  ".tex",
  ".csv",
  ".tsv",
  ".log",
  ".diff",
  ".patch",
]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

export function isMarkdown(name: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** Kinds whose items can have a picture (a thumbnail) rather than a kind icon. */
export function hasPicture(subject: Pick<PreviewSubject, "name" | "isDir">): boolean {
  const kind = previewKindFor(subject);
  return (
    kind === "image" || kind === "video" || kind === "audio" || kind === "pdf" || kind === "font"
  );
}

export type Fact = readonly [label: string, value: string];

/** Container fourccs and ffprobe names as people know them. */
const CODEC_NAMES: Readonly<Record<string, string>> = {
  avc1: "H.264",
  h264: "H.264",
  hvc1: "HEVC",
  hev1: "HEVC",
  hevc: "HEVC",
  vp08: "VP8",
  vp8: "VP8",
  vp09: "VP9",
  vp9: "VP9",
  av01: "AV1",
  av1: "AV1",
  mp4v: "MPEG-4",
  mpeg4: "MPEG-4",
  mp4a: "AAC",
  aac: "AAC",
  mp3: "MP3",
  flac: "FLAC",
  opus: "Opus",
  vorbis: "Vorbis",
};

/** "1586 × 992", as the Properties sheet writes sizes. */
const dimensions = (width: number | null, height: number | null) =>
  width && height ? `${width} × ${height}` : null;
const pixels = (width: number | null, height: number | null) => {
  const size = dimensions(width, height);
  return size && `${size} pixels`;
};

function audioFormat(preview: Extract<Preview, { kind: "audio" }>): string | null {
  const parts = [
    preview.codec && (CODEC_NAMES[preview.codec] ?? preview.codec),
    preview.sampleRate ? `${(preview.sampleRate / 1000).toLocaleString()} kHz` : null,
    preview.channels === 1
      ? "mono"
      : preview.channels === 2
        ? "stereo"
        : preview.channels
          ? `${preview.channels} ch`
          : null,
    preview.bitrate ? `${Math.round(preview.bitrate / 1000)} kbps` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function folderSizeText(size: FolderSize): string {
  if (size.state === "measuring" && !size.files) return "Measuring…";
  const total = `${formatBytes(size.bytes)} in ${countLabel(size.files, "file")}`;
  return size.state === "complete"
    ? total
    : size.state === "partial"
      ? `At least ${total}`
      : `${total}…`;
}

/** The details a preview adds beyond name, kind, size and dates. */
export function previewFacts(preview: Preview | null): Fact[] {
  if (!preview) return [];
  const facts: Array<readonly [string, string | null]> = [];
  switch (preview.kind) {
    case "image":
      facts.push(
        ["Dimensions", pixels(preview.width, preview.height)],
        ["Camera", preview.exposure?.camera ?? null],
        [
          "Taken",
          preview.exposure?.taken ? new Date(preview.exposure.taken).toLocaleString() : null,
        ],
        ["Exposure", preview.exposure?.settings ?? null],
        ["Lens", preview.exposure?.lens ?? null],
      );
      break;
    case "text":
      facts.push(
        ["Lines", `${preview.lines.toLocaleString()}${preview.truncated ? "+" : ""}`],
        ["Encoding", preview.encoding],
      );
      break;
    case "pdf":
      facts.push(
        ["Pages", preview.pages?.toLocaleString() ?? null],
        ["Title", preview.title],
        ["Author", preview.author],
        ["Security", preview.encrypted ? "Encrypted" : null],
      );
      break;
    case "audio":
      facts.push(
        ["Duration", preview.duration ? formatPlaybackTime(preview.duration) : null],
        ["Title", preview.title],
        ["Artist", preview.artist],
        ["Album", preview.album],
        ["Year", preview.year],
        ["Track", preview.track],
        ["Format", audioFormat(preview)],
      );
      break;
    case "video":
      facts.push(
        ["Duration", preview.duration ? formatPlaybackTime(preview.duration) : null],
        ["Dimensions", pixels(preview.width, preview.height)],
        ["Codec", preview.codec && (CODEC_NAMES[preview.codec] ?? preview.codec)],
        ["Title", preview.title],
      );
      break;
    case "archive": {
      const { summary } = preview;
      facts.push(
        [
          "Contents",
          `${summary.truncated ? "At least " : ""}${countLabel(summary.files, "file")} · ${countLabel(summary.folders, "folder")}`,
        ],
        ["Uncompressed", formatBytes(summary.totalSize)],
      );
      break;
    }
    case "font":
      facts.push(
        ["Family", preview.family],
        ["Style", preview.style],
        ["Glyphs", preview.glyphs?.toLocaleString() ?? null],
        [
          "Format",
          preview.faces > 1 ? `${preview.format}, ${preview.faces} faces` : preview.format,
        ],
        ["Version", preview.version],
      );
      break;
    case "folder":
      facts.push(
        ["Contents", `${countLabel(preview.items)} · ${countLabel(preview.folders, "folder")}`],
        ["Size", folderSizeText(preview.size)],
      );
      break;
    case "error":
      facts.push(["Preview", preview.message]);
      break;
  }
  return facts.filter((fact): fact is Fact => !!fact[1]);
}

/** One line for compact surfaces: "4,032 × 3,024 · Canon EOS R6", "12 pages · Annual report". */
export function previewSummary(preview: Preview | null): string | null {
  if (!preview) return null;
  const join = (...parts: Array<string | null | undefined>) =>
    parts.filter(Boolean).join(" · ") || null;
  switch (preview.kind) {
    case "image":
      return join(dimensions(preview.width, preview.height), preview.exposure?.camera);
    case "text":
      return join(
        `${preview.lines.toLocaleString()}${preview.truncated ? "+" : ""} lines`,
        preview.encoding,
      );
    case "pdf":
      return join(preview.pages ? countLabel(preview.pages, "page") : null, preview.title);
    case "audio":
      return join(
        preview.duration ? formatPlaybackTime(preview.duration) : null,
        [preview.artist, preview.album].filter(Boolean).join(" — ") || preview.title,
      );
    case "video":
      return join(
        preview.duration ? formatPlaybackTime(preview.duration) : null,
        dimensions(preview.width, preview.height),
      );
    case "archive":
      return join(
        countLabel(preview.summary.files, "file"),
        `${formatBytes(preview.summary.totalSize)} uncompressed`,
      );
    case "font":
      return join(preview.family, preview.style);
    case "folder":
      return join(
        countLabel(preview.items),
        preview.size.state === "measuring" ? null : formatBytes(preview.size.bytes),
      );
    case "document":
      return preview.excerpt ? preview.excerpt.slice(0, 120) : null;
    default:
      return null;
  }
}

/** "1/250 s · f/2.8 · ISO 200 · 35 mm" from EXIF numbers. */
export function exposureSettings(fields: {
  exposureTime: number | null;
  fNumber: number | null;
  iso: number | null;
  focalLength: number | null;
}): string | null {
  const shutter = fields.exposureTime
    ? fields.exposureTime >= 1
      ? `${+fields.exposureTime.toFixed(1)} s`
      : `1/${Math.round(1 / fields.exposureTime)} s`
    : null;
  const parts = [
    shutter,
    fields.fNumber ? `f/${+fields.fNumber.toFixed(1)}` : null,
    fields.iso ? `ISO ${fields.iso}` : null,
    fields.focalLength ? `${+fields.focalLength.toFixed(1)} mm` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Text squeezed onto a few lines: runs of whitespace become single spaces. */
export function excerptOf(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

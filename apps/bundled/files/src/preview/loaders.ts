/**
 * Preview loaders, one per kind: each reads only what its preview shows (a header, the first
 * pages, a capped excerpt), honours its abort signal, and returns failures as `error` previews.
 * Pictures are not made here; thumbnails come from the worker pool in `@moire/ui`.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  archiveSummary,
  decodeText,
  officeText,
  readExif,
  readFontInfo,
  readMediaInfo,
  readPdf,
} from "@moire/file-formats";
import { fileKind, operationError, type FileKind } from "@moire/file-operations";
import { codeLanguageFor, imageSize, sniffImage } from "@moire/ui";
import {
  exposureSettings,
  hasPicture,
  isMarkdown,
  previewKindFor,
  type FolderSize,
  type Preview,
  type PreviewSubject,
} from "./model";

/** Headers, EXIF and the JPEG frame header sit in the first part of an image. */
const IMAGE_HEAD_BYTES = 256 * 1024;
const TEXT_READ_BYTES = 256 * 1024;
/** The text stage shows the start of a file; more lines only cost layout. */
const TEXT_SHOWN_LINES = 400;
const TEXT_SHOWN_CHARS = 48 * 1024;
const DOCUMENT_READ_BYTES = 32 * 1024 * 1024;
const EXCERPT_CHARS = 1500;
const PDF_EXCERPT_PAGES = 3;
const FONT_READ_BYTES = 32 * 1024 * 1024;
const FOLDER_CHILDREN = 6;
const FOLDER_PICTURES = 4;
/** Which children a folder's mosaic prefers: photos, then video frames and pages. */
const PICTURE_ORDER: Readonly<Partial<Record<string, number>>> = {
  image: 0,
  video: 1,
  pdf: 2,
  audio: 3,
  font: 4,
};
/** A folder's size is counted up to this many entries or this long, then reported as "at least". */
const FOLDER_WALK_ENTRIES = 100_000;
const FOLDER_WALK_MS = 4000;
/** The walk reports progress this often, and yields to the app between batches. */
const FOLDER_PROGRESS_MS = 150;
const FOLDER_BATCH = 64;
const PROBE_TIMEOUT_MS = 10_000;

export type PreviewProgress = (preview: Preview) => void;

export async function loadPreview(
  subject: PreviewSubject,
  signal: AbortSignal,
  onProgress?: PreviewProgress,
): Promise<Preview> {
  try {
    return await load(subject, signal, onProgress);
  } catch (error) {
    signal.throwIfAborted();
    return { kind: "error", message: operationError(error) };
  }
}

async function load(
  subject: PreviewSubject,
  signal: AbortSignal,
  onProgress?: PreviewProgress,
): Promise<Preview> {
  const file = subject.path;
  switch (previewKindFor(subject)) {
    case "folder":
      return folderPreview(file, signal, onProgress);
    case "image": {
      const head = await readHead(file, IMAGE_HEAD_BYTES);
      const format = sniffImage(head);
      if (!format) return { kind: "error", message: "This file is not a readable image." };
      const size = imageSize(head) ?? (await probe(file, signal))?.video ?? null;
      const exif = format === "jpeg" ? readExif(head) : null;
      return {
        kind: "image",
        format: format.toUpperCase(),
        width: size?.width ?? null,
        height: size?.height ?? null,
        exposure: exif && {
          camera: cameraName(exif.make, exif.model),
          lens: exif.lens,
          taken: exif.taken,
          settings: exposureSettings(exif),
        },
      };
    }
    case "text": {
      const head = await readHead(file, TEXT_READ_BYTES);
      const truncated = subject.size > head.length;
      const decoded = decodeText(head, truncated);
      if (!decoded) return { kind: "none" };
      const lines = decoded.text.split("\n");
      const count = lines.length - (decoded.text.endsWith("\n") ? 1 : 0);
      return {
        kind: "text",
        // A final newline ends the last line; it does not start another.
        text: lines
          .slice(0, Math.min(count, TEXT_SHOWN_LINES))
          .join("\n")
          .slice(0, TEXT_SHOWN_CHARS),
        language: codeLanguageFor(subject.name),
        markdown: isMarkdown(subject.name),
        lines: count,
        encoding: decoded.encoding,
        truncated,
      };
    }
    case "pdf": {
      const pdf = readPdf(await readHead(file, DOCUMENT_READ_BYTES), {
        maxPages: PDF_EXCERPT_PAGES,
        maxTextChars: EXCERPT_CHARS,
      });
      return {
        kind: "pdf",
        pages: pdf.pages,
        title: pdf.title,
        author: pdf.author,
        excerpt: pdf.text.trim(),
        encrypted: pdf.encrypted,
      };
    }
    case "document": {
      const text = officeText(await readHead(file, DOCUMENT_READ_BYTES));
      return text ? { kind: "document", excerpt: text.slice(0, EXCERPT_CHARS) } : { kind: "none" };
    }
    case "audio": {
      const media = await readMediaInfo(file, signal);
      const fallback = media.duration === null ? await probe(file, signal) : null;
      return {
        kind: "audio",
        duration: media.duration ?? fallback?.duration ?? null,
        title: media.title,
        artist: media.artist,
        album: media.album,
        year: media.year,
        track: media.track,
        codec: media.audio?.codec ?? null,
        sampleRate: media.audio?.sampleRate ?? null,
        channels: media.audio?.channels ?? null,
        bitrate: media.bitrate,
        hasArt: !!media.picture,
      };
    }
    case "video": {
      const media = await readMediaInfo(file, signal);
      // Containers read here (MP4, Matroska) cover most; ffprobe fills in the rest when present.
      const fallback = media.duration === null || !media.video ? await probe(file, signal) : null;
      return {
        kind: "video",
        duration: media.duration ?? fallback?.duration ?? null,
        width: media.video?.width ?? fallback?.video?.width ?? null,
        height: media.video?.height ?? fallback?.video?.height ?? null,
        codec: media.video?.codec ?? fallback?.codec ?? null,
        title: media.title,
      };
    }
    case "archive":
      return { kind: "archive", summary: await archiveSummary(file, signal) };
    case "font": {
      const info = readFontInfo(await readHead(file, FONT_READ_BYTES));
      if (!info) return { kind: "error", message: "This file is not a readable font." };
      return {
        kind: "font",
        format: info.format,
        family: info.family,
        style: info.style,
        version: info.version,
        glyphs: info.glyphs,
        faces: info.faces,
      };
    }
    default:
      return { kind: "none" };
  }
}

function cameraName(make: string | null, model: string | null): string | null {
  // Models usually repeat the maker ("Canon" + "Canon EOS R6").
  if (make && model)
    return model.toLowerCase().startsWith(make.toLowerCase().split(" ")[0]!)
      ? model
      : `${make} ${model}`;
  return model ?? make;
}

async function readHead(file: string, limit: number): Promise<Buffer> {
  const handle = await fs.open(file, "r");
  try {
    const size = Math.min(limit, (await handle.stat()).size);
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

type Probe = {
  duration: number | null;
  video: { width: number; height: number } | null;
  codec: string | null;
};

/** ffprobe's view of a file, or null when ffprobe is missing or cannot read it. */
function probe(file: string, signal: AbortSignal): Promise<Probe | null> {
  return new Promise((resolve) =>
    execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height",
        "-of",
        "json",
        file,
      ],
      { timeout: PROBE_TIMEOUT_MS, signal, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          const parsed = JSON.parse(stdout) as {
            format?: { duration?: string };
            streams?: Array<{
              codec_type?: string;
              codec_name?: string;
              width?: number;
              height?: number;
            }>;
          };
          const video = parsed.streams?.find(
            (stream) => stream.codec_type === "video" && stream.width,
          );
          const duration = Number(parsed.format?.duration);
          resolve({
            duration: Number.isFinite(duration) ? duration : null,
            video: video ? { width: video.width!, height: video.height ?? 0 } : null,
            codec: video?.codec_name ?? null,
          });
        } catch {
          resolve(null);
        }
      },
    ),
  );
}

async function folderPreview(
  directory: string,
  signal: AbortSignal,
  onProgress?: PreviewProgress,
): Promise<Preview> {
  const children = await fs.readdir(directory, { withFileTypes: true });
  const shown = children.filter((child) => !child.name.startsWith("."));
  const listing = {
    kind: "folder" as const,
    items: shown.length,
    folders: shown.filter((child) => child.isDirectory()).length,
    hidden: children.length - shown.length,
    children: shown
      .map((child) => ({ name: child.name, isDir: child.isDirectory() }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
      .slice(0, FOLDER_CHILDREN),
  };
  const pictures = await folderPictures(directory, shown, signal);
  const report = (size: FolderSize): Preview => ({ ...listing, pictures, size });
  onProgress?.(report({ bytes: 0, files: 0, byKind: {}, state: "measuring" }));
  const size = await measureFolder(directory, signal, (partial) => onProgress?.(report(partial)));
  return report(size);
}

/** The first children with pictures, images first, each as a full subject for a thumbnail. */
async function folderPictures(
  directory: string,
  children: ReadonlyArray<import("node:fs").Dirent>,
  signal: AbortSignal,
): Promise<PreviewSubject[]> {
  const candidates = children
    .filter((child) => child.isFile() && hasPicture({ name: child.name, isDir: false }))
    .map((child) => ({
      name: child.name,
      rank: PICTURE_ORDER[previewKindFor({ name: child.name, isDir: false })] ?? 9,
    }))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const pictures: PreviewSubject[] = [];
  for (const { name } of candidates) {
    if (pictures.length >= FOLDER_PICTURES) break;
    signal.throwIfAborted();
    const file = path.join(directory, name);
    const stat = await fs.lstat(file).catch(() => null);
    // Gone since the listing: the next candidate takes its place.
    if (!stat?.isFile()) continue;
    pictures.push({ path: file, name, isDir: false, size: stat.size, modified: stat.mtimeMs });
  }
  return pictures;
}

/**
 * Bytes under a folder, breadth first, without following links. Unreadable subfolders are
 * skipped (their size is unknown, so the total says "at least").
 */
async function measureFolder(
  root: string,
  signal: AbortSignal,
  onProgress: (size: FolderSize) => void,
): Promise<FolderSize> {
  const started = Date.now();
  let reported = started;
  let bytes = 0;
  let files = 0;
  let entries = 0;
  const byKind: Partial<Record<FileKind, number>> = {};
  let complete = true;
  const queue = [root];
  while (queue.length) {
    signal.throwIfAborted();
    if (entries >= FOLDER_WALK_ENTRIES || Date.now() - started > FOLDER_WALK_MS) {
      complete = false;
      break;
    }
    const directory = queue.shift()!;
    let children;
    try {
      children = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      complete = false;
      continue;
    }
    for (let at = 0; at < children.length; at += FOLDER_BATCH) {
      const batch = children.slice(at, at + FOLDER_BATCH);
      const stats = await Promise.all(
        batch.map((child) =>
          child.isFile() ? fs.lstat(path.join(directory, child.name)).catch(() => null) : null,
        ),
      );
      signal.throwIfAborted();
      batch.forEach((child, index) => {
        entries++;
        if (child.isDirectory()) queue.push(path.join(directory, child.name));
        const stat = stats[index];
        if (stat) {
          bytes += stat.size;
          files++;
          const kind = fileKind(child.name, false);
          byKind[kind] = (byKind[kind] ?? 0) + stat.size;
        }
      });
    }
    if (Date.now() - reported > FOLDER_PROGRESS_MS) {
      reported = Date.now();
      onProgress({ bytes, files, byKind: { ...byKind }, state: "measuring" });
    }
  }
  return { bytes, files, byKind, state: complete ? "complete" : "partial" };
}

/**
 * Text extraction for search: plain text and source, OpenDocument and Word text, PDF text, and the
 * camera and date fields of JPEG EXIF. The readers live in `@moire/file-formats` (Files' previews
 * use the same ones); here every read is size-capped and returns null rather than throwing,
 * because one odd file must never stall the queue behind it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { decodeText, officeText, readExif, readPdf } from "@moire/file-formats";

/** Files larger than this are indexed by name only. */
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
/** PDFs are mostly images and fonts; their text is a small share of a larger file. */
const MAX_PDF_BYTES = 16 * 1024 * 1024;
/** Searchable text kept from one PDF, and the pages read to find it. */
const MAX_PDF_TEXT_CHARS = 200_000;
const MAX_PDF_PAGES = 200;
/** EXIF sits in the first APP1 segment, which is at most 64 KiB. */
const EXIF_READ_BYTES = 64 * 1024;

const PLAIN_TEXT = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".rst",
  ".org",
  ".tex",
  ".csv",
  ".tsv",
  ".log",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".lua",
  ".sql",
  ".nix",
]);
const OFFICE = new Set([".odt", ".ods", ".odp", ".docx"]);
const JPEG = new Set([".jpg", ".jpeg"]);
const PDF = ".pdf";

/** Whether a file's text (or EXIF) is worth reading. */
export function hasExtractableText(name: string, size: number): boolean {
  const extension = path.extname(name).toLowerCase();
  if (extension === PDF) return size <= MAX_PDF_BYTES;
  if (size > MAX_TEXT_FILE_BYTES) return false;
  return PLAIN_TEXT.has(extension) || OFFICE.has(extension) || JPEG.has(extension);
}

export type ExtractedText = { body: string | null; taken: number | null };

const NOTHING: ExtractedText = { body: null, taken: null };

export async function extractText(file: string, name: string): Promise<ExtractedText> {
  const extension = path.extname(name).toLowerCase();
  try {
    if (OFFICE.has(extension)) return { body: officeText(await readCapped(file)), taken: null };
    if (extension === PDF) {
      const pdf = readPdf(await readCapped(file, MAX_PDF_BYTES), {
        maxTextChars: MAX_PDF_TEXT_CHARS,
        maxPages: MAX_PDF_PAGES,
      });
      const body = [pdf.title, pdf.author, pdf.subject, pdf.text].filter(Boolean).join("\n");
      return { body: body.trim() || null, taken: null };
    }
    if (JPEG.has(extension)) {
      const exif = readExif(await readCapped(file, EXIF_READ_BYTES));
      if (!exif) return NOTHING;
      // Camera fields become searchable text; the capture date is kept as a time.
      const camera = [exif.make, exif.model, exif.lens].filter(Boolean).join(" ");
      return { body: camera || null, taken: exif.taken };
    }
    const bytes = await readCapped(file);
    const decoded = decodeText(bytes, bytes.length === MAX_TEXT_FILE_BYTES);
    return { body: decoded?.text.trim() || null, taken: null };
  } catch {
    return NOTHING;
  }
}

async function readCapped(file: string, limit = MAX_TEXT_FILE_BYTES): Promise<Buffer> {
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

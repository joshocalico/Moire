/**
 * Office documents' words, one line per paragraph or cell: OpenDocument (`.odt`, `.ods`, `.odp`)
 * from `content.xml`, and Word (`.docx`) from `word/document.xml`.
 */
import { readZipEntry } from "./zip";

/** The XML may inflate far beyond its file; stop reading it here. */
const MAX_CONTENT_XML_BYTES = 4 * 1024 * 1024;

const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Paragraphs, headings and cells end with a break; everything else is markup. */
export function officeText(archive: Buffer): string | null {
  const odf = readZipEntry(archive, "content.xml", MAX_CONTENT_XML_BYTES)?.toString("utf8");
  const xml =
    odf
      ?.replace(/<text:(?:s|tab|line-break)\b[^>]*\/>/g, " ")
      .replace(/<\/(?:text:p|text:h|table:table-cell)>/g, "\n") ??
    readZipEntry(archive, "word/document.xml", MAX_CONTENT_XML_BYTES)
      ?.toString("utf8")
      .replace(/<w:(?:tab|br)\b[^>]*\/>/g, " ")
      .replace(/<\/w:p>/g, "\n");
  if (!xml) return null;
  const body = xml
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (entity, code: string) => {
      if (code.startsWith("#")) {
        const value =
          code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(value) && value > 0 && value <= 0x10ffff
          ? String.fromCodePoint(value)
          : " ";
      }
      return XML_ENTITIES[code] ?? entity;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return body || null;
}

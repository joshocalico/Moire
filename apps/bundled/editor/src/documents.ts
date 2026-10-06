import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

export type TextDocument = {
  path: string | null;
  text: string;
  savedText: string;
  fingerprint: string | null;
};
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const blankDocument = (): TextDocument => ({
  path: null,
  text: "",
  savedText: "",
  fingerprint: null,
});
export const documentDirty = (document: TextDocument): boolean =>
  document.text !== document.savedText;
export function documentPath(input: string): string {
  if (!input.trim()) throw new Error("Enter a file path.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !input.startsWith("file:"))
    throw new Error("Only local files can be opened.");
  const resolved = input.startsWith("file:") ? fileURLToPath(input) : path.resolve(input);
  if (fs.existsSync(resolved)) return fs.realpathSync(resolved);
  const directory = path.dirname(resolved);
  return fs.existsSync(directory)
    ? path.join(fs.realpathSync(directory), path.basename(resolved))
    : resolved;
}
export function openDocument(input: string): TextDocument {
  const target = documentPath(input);
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error("Choose a text file, not a folder.");
  if (stat.size > MAX_DOCUMENT_BYTES)
    throw new Error("This file is larger than the editor's 5 MiB limit.");
  const bytes = fs.readFileSync(target);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.includes("\0")) throw new Error("This file contains binary data.");
  return { path: target, text, savedText: text, fingerprint: hash(bytes) };
}
export function saveDocument(
  document: TextDocument,
  input = document.path ?? "",
  overwrite = false,
): TextDocument {
  if (Buffer.byteLength(document.text, "utf8") > MAX_DOCUMENT_BYTES)
    throw new Error("This document is larger than the editor's 5 MiB limit.");
  const target = documentPath(input);
  const exists = fs.existsSync(target);
  const same = target === document.path;
  if (exists) {
    if (!fs.statSync(target).isFile()) throw new Error("Choose a file path, not a folder.");
    if (same && document.fingerprint !== hash(fs.readFileSync(target)))
      throw new Error("The file changed outside Editor. Save As to keep both versions.");
    if (!same && !overwrite) throw new Error("A file already exists at this path.");
  } else if (same && document.fingerprint !== null) {
    throw new Error("The file was removed outside Editor. Save As to choose a new path.");
  }
  const mode = exists ? fs.statSync(target).mode & 0o777 : 0o600;
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  );
  let fd: number | null = null;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, document.text, "utf8");
    // Restore the source permissions explicitly; open modes are filtered by umask.
    fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    // Recheck the source after writing, before replacing it.
    if (exists && same && document.fingerprint !== hash(fs.readFileSync(target)))
      throw new Error("The file changed while saving. Save As to keep both versions.");
    if (!exists) {
      // A new path is published exclusively, so another writer cannot be replaced.
      fs.linkSync(temporary, target);
    } else {
      fs.renameSync(temporary, target);
    }
  } finally {
    if (fd !== null) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return {
    path: target,
    text: document.text,
    savedText: document.text,
    fingerprint: hash(Buffer.from(document.text, "utf8")),
  };
}

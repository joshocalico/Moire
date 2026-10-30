/**
 * A zip central-directory reader: enough to list an archive and pull one small member out of it
 * (OpenDocument's `content.xml`, a preview's listing) without unpacking anything else.
 */
import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
/** The end record sits in the last 22 bytes plus a comment of at most 65535 bytes. */
const END_SEARCH_BYTES = 0xffff + 22;
/** A member is inflated at most this far, so a zip bomb can't exhaust memory. */
const DEFAULT_MAX_MEMBER_BYTES = 4 * 1024 * 1024;

export type ZipEntry = {
  name: string;
  /** Uncompressed size in bytes. */
  size: number;
  compressedSize: number;
  method: number;
  isDir: boolean;
  /** Offset of the member's local header. */
  offset: number;
};

/** Every member of a zip held in memory, or null when it has no readable central directory. */
export function listZip(archive: Buffer): ZipEntry[] | null {
  const floor = Math.max(0, archive.length - END_SEARCH_BYTES);
  let end = -1;
  for (let at = archive.length - 22; at >= floor; at--)
    if (archive.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) {
      end = at;
      break;
    }
  if (end < 0) return null;
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count && at + 46 <= archive.length; index++) {
    if (archive.readUInt32LE(at) !== CENTRAL_ENTRY) return entries.length ? entries : null;
    const nameLength = archive.readUInt16LE(at + 28);
    const name = archive.toString("utf8", at + 46, at + 46 + nameLength);
    entries.push({
      name,
      method: archive.readUInt16LE(at + 10),
      compressedSize: archive.readUInt32LE(at + 20),
      size: archive.readUInt32LE(at + 24),
      isDir: name.endsWith("/"),
      offset: archive.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
  }
  return entries;
}

/** The bytes of one member (by name or entry), or null when it is missing or unreadable. */
export function readZipEntry(
  archive: Buffer,
  wanted: string | ZipEntry,
  maxBytes = DEFAULT_MAX_MEMBER_BYTES,
): Buffer | null {
  const entry =
    typeof wanted === "string"
      ? listZip(archive)?.find((candidate) => candidate.name === wanted)
      : wanted;
  if (!entry) return null;
  const local = entry.offset;
  if (local + 30 > archive.length || archive.readUInt32LE(local) !== LOCAL_HEADER) return null;
  const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
  const data = archive.subarray(start, start + entry.compressedSize);
  try {
    if (entry.method === STORED) return data.subarray(0, maxBytes);
    if (entry.method === DEFLATED) return inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch {
    // A damaged or oversized member reads as missing.
  }
  return null;
}

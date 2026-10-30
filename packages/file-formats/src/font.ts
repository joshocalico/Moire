/**
 * A font's names and glyph count from its `name` and `maxp` tables, without parsing outlines:
 * TrueType, OpenType, collections (first face) and WOFF. WOFF2 compresses its tables together
 * with transforms and is only recognised.
 */
import { inflateSync } from "node:zlib";

export type FontInfo = {
  format: "TrueType" | "OpenType" | "TrueType Collection" | "WOFF" | "WOFF2";
  family: string | null;
  style: string | null;
  fullName: string | null;
  version: string | null;
  glyphs: number | null;
  /** Faces in a collection; 1 otherwise. */
  faces: number;
};

const NAME_FAMILY = 1;
const NAME_STYLE = 2;
const NAME_FULL = 4;
const NAME_VERSION = 5;
const NAME_TYPOGRAPHIC_FAMILY = 16;
const NAME_TYPOGRAPHIC_STYLE = 17;
const PLATFORM_UNICODE = 0;
const PLATFORM_MAC = 1;
const PLATFORM_WINDOWS = 3;
const LANGUAGE_EN_US = 0x409;
/** Names and glyph counts sit in small tables; anything bigger is not a real one. */
const MAX_TABLE_BYTES = 4 * 1024 * 1024;

type Tables = Map<string, Buffer>;

/** Font facts, or null when the bytes are not a font this reads. */
export function readFontInfo(bytes: Buffer): FontInfo | null {
  if (bytes.length < 12) return null;
  const magic = bytes.toString("latin1", 0, 4);
  try {
    if (magic === "wOF2")
      return {
        format: "WOFF2",
        family: null,
        style: null,
        fullName: null,
        version: null,
        glyphs: null,
        faces: 1,
      };
    if (magic === "wOFF") return describe("WOFF", woffTables(bytes), 1);
    if (magic === "ttcf") {
      const faces = bytes.readUInt32BE(8);
      return describe("TrueType Collection", sfntTables(bytes, bytes.readUInt32BE(12)), faces);
    }
    if (magic === "OTTO") return describe("OpenType", sfntTables(bytes, 0), 1);
    if (magic === "\0\x01\0\0" || magic === "true")
      return describe("TrueType", sfntTables(bytes, 0), 1);
  } catch {
    // A damaged directory reads as not a font.
  }
  return null;
}

function describe(format: FontInfo["format"], tables: Tables, faces: number): FontInfo {
  const names = readNames(tables.get("name"));
  const maxp = tables.get("maxp");
  return {
    format,
    family: names.get(NAME_TYPOGRAPHIC_FAMILY) ?? names.get(NAME_FAMILY) ?? null,
    style: names.get(NAME_TYPOGRAPHIC_STYLE) ?? names.get(NAME_STYLE) ?? null,
    fullName: names.get(NAME_FULL) ?? null,
    version: names.get(NAME_VERSION)?.replace(/^Version\s+/i, "") ?? null,
    glyphs: maxp && maxp.length >= 6 ? maxp.readUInt16BE(4) : null,
    faces,
  };
}

function sfntTables(bytes: Buffer, start: number): Tables {
  const tables: Tables = new Map();
  const count = bytes.readUInt16BE(start + 4);
  for (let index = 0; index < count; index++) {
    const record = start + 12 + index * 16;
    const tag = bytes.toString("latin1", record, record + 4);
    if (tag !== "name" && tag !== "maxp") continue;
    const offset = bytes.readUInt32BE(record + 8);
    const length = Math.min(bytes.readUInt32BE(record + 12), MAX_TABLE_BYTES);
    tables.set(tag, bytes.subarray(offset, offset + length));
  }
  return tables;
}

function woffTables(bytes: Buffer): Tables {
  const tables: Tables = new Map();
  const count = bytes.readUInt16BE(12);
  for (let index = 0; index < count; index++) {
    const record = 44 + index * 20;
    const tag = bytes.toString("latin1", record, record + 4);
    if (tag !== "name" && tag !== "maxp") continue;
    const offset = bytes.readUInt32BE(record + 4);
    const compressed = bytes.readUInt32BE(record + 8);
    const original = Math.min(bytes.readUInt32BE(record + 12), MAX_TABLE_BYTES);
    const data = bytes.subarray(offset, offset + compressed);
    tables.set(
      tag,
      compressed < original ? inflateSync(data, { maxOutputLength: original }) : data,
    );
  }
  return tables;
}

/** English names, preferring Windows (UTF-16) records over Mac Roman ones. */
function readNames(table: Buffer | undefined): Map<number, string> {
  const names = new Map<number, string>();
  if (!table || table.length < 6) return names;
  const count = table.readUInt16BE(2);
  const strings = table.readUInt16BE(4);
  const rank = new Map<number, number>();
  for (let index = 0; index < count; index++) {
    const record = 6 + index * 12;
    if (record + 12 > table.length) break;
    const platform = table.readUInt16BE(record);
    const language = table.readUInt16BE(record + 4);
    const id = table.readUInt16BE(record + 6);
    const length = table.readUInt16BE(record + 8);
    const offset = strings + table.readUInt16BE(record + 10);
    if (offset + length > table.length) continue;
    const score =
      platform === PLATFORM_WINDOWS
        ? language === LANGUAGE_EN_US
          ? 3
          : 1
        : platform === PLATFORM_MAC && language === 0
          ? 2
          : platform === PLATFORM_UNICODE
            ? 1
            : 0;
    if (!score || (rank.get(id) ?? 0) >= score) continue;
    const raw = table.subarray(offset, offset + length);
    const text =
      platform === PLATFORM_MAC
        ? raw.toString("latin1")
        : Buffer.from(raw.subarray(0, raw.length & ~1))
            .swap16()
            .toString("utf16le");
    if (!text.trim()) continue;
    names.set(id, text.trim());
    rank.set(id, score);
  }
  return names;
}

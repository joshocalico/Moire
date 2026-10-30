/**
 * The other faces of a font's family (Regular, Medium, Bold…) for the
 * inspector's weight picker: the font's own folder and the installed font
 * folders, scanned within bounds and reading only each font's small tables.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFontInfo } from "@moire/file-formats";

export type FontFace = {
  path: string;
  family: string;
  style: string;
  /** 100…900, from the OS/2 table or else the style name. */
  weight: number;
};

/** Folders below a font folder that are searched; families often keep faces in `static/`. */
const MAX_DEPTH = 3;
/** Font files examined per lookup, so a huge font library stays quick. */
const MAX_FILES = 2000;
/** Name tables are a few kilobytes; anything bigger is not read. */
const MAX_TABLE_BYTES = 2 * 1024 * 1024;
const FONT_EXTENSIONS = new Set([".ttf", ".otf"]);
/** The tables a face's names, glyph count and weight live in. */
const TABLES = new Set(["name", "maxp", "OS/2"]);

/** Style keywords, most specific first ("extrabold" before "bold"). */
const WEIGHTS: ReadonlyArray<[RegExp, number]> = [
  [/thin|hairline/, 100],
  [/(extra|ultra)light/, 200],
  [/(semi|demi)bold/, 600],
  [/(extra|ultra)bold/, 800],
  [/black|heavy/, 900],
  [/light/, 300],
  [/medium/, 500],
  [/bold/, 700],
];

/** The CSS weight a style name stands for: "SemiBold Italic" → 600, unknown → 400. */
export function fontWeightOf(style: string): number {
  const key = style.toLowerCase().replace(/[\s_-]+/g, "");
  return WEIGHTS.find(([pattern]) => pattern.test(key))?.[1] ?? 400;
}

const isItalic = (style: string) => /italic|oblique/i.test(style);

/**
 * Read a face from just its `name`, `maxp` and `OS/2` tables, rebuilt into a
 * small font so readFontInfo needs no more than a few kilobytes of the file.
 */
async function readFace(file: string): Promise<FontFace | null> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, "r");
    const header = Buffer.alloc(12);
    if ((await handle.read(header, 0, 12, 0)).bytesRead < 12) return null;
    const magic = header.toString("latin1", 0, 4);
    if (magic !== "\0\x01\0\0" && magic !== "OTTO" && magic !== "true") return null;
    const count = header.readUInt16BE(4);
    const directory = Buffer.alloc(count * 16);
    if ((await handle.read(directory, 0, directory.length, 12)).bytesRead < directory.length)
      return null;
    const tables: Array<{ tag: string; data: Buffer }> = [];
    for (let index = 0; index < count; index++) {
      const record = index * 16;
      const tag = directory.toString("latin1", record, record + 4);
      if (!TABLES.has(tag)) continue;
      const length = Math.min(directory.readUInt32BE(record + 12), MAX_TABLE_BYTES);
      const data = Buffer.alloc(length);
      const offset = directory.readUInt32BE(record + 8);
      const { bytesRead } = await handle.read(data, 0, length, offset);
      tables.push({ tag, data: data.subarray(0, bytesRead) });
    }
    const font = Buffer.concat([
      Buffer.alloc(12 + tables.length * 16),
      ...tables.map((table) => table.data),
    ]);
    header.copy(font, 0, 0, 4);
    font.writeUInt16BE(tables.length, 4);
    let offset = 12 + tables.length * 16;
    for (const [index, table] of tables.entries()) {
      const record = 12 + index * 16;
      font.write(table.tag, record, "latin1");
      font.writeUInt32BE(offset, record + 8);
      font.writeUInt32BE(table.data.length, record + 12);
      offset += table.data.length;
    }
    const info = readFontInfo(font);
    if (!info?.family) return null;
    const style = info.style ?? "Regular";
    // OS/2 usWeightClass sits at byte 4.
    const os2 = tables.find((table) => table.tag === "OS/2")?.data;
    const stated = os2 && os2.length >= 6 ? os2.readUInt16BE(4) : 0;
    const weight = stated >= 100 && stated <= 1000 ? stated : fontWeightOf(style);
    return { path: file, family: info.family, style, weight };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/** Where installed fonts live, per the XDG base directories and the classic folders. */
function fontFolders(): string[] {
  const home = os.homedir();
  const data = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return [
    path.join(data, "fonts"),
    path.join(home, ".fonts"),
    "/usr/share/fonts",
    "/usr/local/share/fonts",
  ];
}

/**
 * The faces of `file`'s family: the file itself, then same-family .ttf/.otf
 * files beside it and in the installed font folders, one per style, sorted by
 * weight with uprights before italics.
 */
export async function fontFamilyFaces(file: string, signal?: AbortSignal): Promise<FontFace[]> {
  const own = await readFace(file);
  signal?.throwIfAborted();
  if (!own) {
    // Not a face this reads: the file alone, named from "Family-Style.ttf".
    const stem = path.basename(file, path.extname(file));
    const dash = stem.lastIndexOf("-");
    const style = dash > 0 ? stem.slice(dash + 1) : "Regular";
    const family = dash > 0 ? stem.slice(0, dash) : stem;
    return [{ path: file, family, style, weight: fontWeightOf(style) }];
  }
  const family = own.family.toLowerCase();
  const faces = new Map<string, FontFace>([[own.style.toLowerCase(), own]]);
  const visited = new Set<string>([path.resolve(file)]);
  let examined = 0;

  const scan = async (folder: string, depth: number): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (examined >= MAX_FILES) return;
      const child = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !entry.name.startsWith(".")) await scan(child, depth + 1);
        continue;
      }
      if (!entry.isFile() || !FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (visited.has(child)) continue;
      visited.add(child);
      examined++;
      const face = await readFace(child);
      if (!face || face.family.toLowerCase() !== family) continue;
      const style = face.style.toLowerCase();
      if (!faces.has(style)) faces.set(style, face);
    }
  };

  // Beside the file, faces sit in the same folder or one below it (e.g. `static/`).
  await scan(path.dirname(path.resolve(file)), MAX_DEPTH - 1);
  for (const folder of fontFolders()) await scan(folder, 0);
  return [...faces.values()].sort(
    (a, b) =>
      a.weight - b.weight ||
      Number(isItalic(a.style)) - Number(isItalic(b.style)) ||
      a.style.localeCompare(b.style),
  );
}

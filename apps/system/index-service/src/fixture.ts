/** Smoke fixtures: a throwaway HOME with XDG folders, and the odd file formats content.ts reads. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { indexEnvironment, type IndexEnvironment } from "./config";

export type Fixture = { root: string; env: IndexEnvironment; home: string; remove(): void };

export function homeFixture(prefix: string): Fixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `moire-index-${prefix}-`)));
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const env = indexEnvironment({
    HOME: home,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
  });
  return { root, env, home, remove: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function write(file: string, contents: string | Buffer, mtime?: Date): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  if (mtime) fs.utimesSync(file, mtime, mtime);
}

/** A minimal zip with deflated members, enough to be an OpenDocument file. */
export function zip(members: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(members)) {
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(members).length, 8);
  end.writeUInt16LE(Object.keys(members).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function odt(paragraphs: readonly string[]): Buffer {
  const body = paragraphs.map((text) => `<text:p text:style-name="P1">${text}</text:p>`).join("");
  return zip({
    mimetype: "application/vnd.oasis.opendocument.text",
    "content.xml": `<?xml version="1.0"?><office:document-content><office:body><office:text>${body}</office:text></office:body></office:document-content>`,
  });
}

/** A JPEG holding only an EXIF block with make, model and the date taken (little-endian TIFF). */
export function jpegWithExif(make: string, model: string, taken: string): Buffer {
  const ascii = (value: string) => Buffer.from(`${value}\0`, "latin1");
  const makeBytes = ascii(make);
  const modelBytes = ascii(model);
  const dateBytes = ascii(taken);
  const ifd0Entries = 3;
  const ifd0 = 8;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const exifIfd = ifd0 + ifd0Size;
  const exifSize = 2 + 12 + 4;
  let data = exifIfd + exifSize;
  const tiff = Buffer.alloc(data + makeBytes.length + modelBytes.length + dateBytes.length);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifd0, 4);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    tiff.writeUInt32LE(value, at + 8);
  };
  tiff.writeUInt16LE(ifd0Entries, ifd0);
  entry(ifd0 + 2, 0x010f, 2, makeBytes.length, data);
  makeBytes.copy(tiff, data);
  data += makeBytes.length;
  entry(ifd0 + 14, 0x0110, 2, modelBytes.length, data);
  modelBytes.copy(tiff, data);
  data += modelBytes.length;
  entry(ifd0 + 26, 0x8769, 4, 1, exifIfd);
  tiff.writeUInt16LE(1, exifIfd);
  entry(exifIfd + 2, 0x9003, 2, dateBytes.length, data);
  dateBytes.copy(tiff, data);
  const app1 = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(app1.length + 2, 4);
  return Buffer.concat([header, app1, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
}

/**
 * Duration, tags and cover art of audio and video files, read in TypeScript with a few bounded
 * random-access reads: MP3 (ID3v2/ID3v1 and the first MPEG frame), FLAC, Ogg Vorbis and Opus,
 * WAV/RF64, MP4/M4A/MOV and Matroska/WebM. The container is recognised by its magic bytes.
 * Nothing here decodes audio; an unrecognised file comes back as format "unknown".
 */
import fs from "node:fs/promises";

export type MediaPicture = { mime: string; data: Uint8Array };
export type MediaInfo = {
  format: "mp3" | "flac" | "ogg" | "opus" | "wav" | "mp4" | "matroska" | "unknown";
  /** Seconds. */
  duration: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: string | null;
  track: string | null;
  genre: string | null;
  /** Embedded cover art, the front cover when there are several. */
  picture: MediaPicture | null;
  audio: { sampleRate: number | null; channels: number | null; codec: string | null } | null;
  video: { width: number; height: number; codec: string | null } | null;
  /** Bits per second. */
  bitrate: number | null;
};

/** Metadata (ID3 tags, FLAC blocks, Ogg headers, `moov`) is read up to this far into a file. */
const HEAD_CAP = 8 * 1024 * 1024;
/** The end of a file is searched this far back for ID3v1 and the last Ogg page. */
const TAIL_BYTES = 64 * 1024;
/** Larger embedded pictures are left out. */
const PICTURE_CAP = 4 * 1024 * 1024;
/** How far past the ID3 tag the first MPEG frame is looked for. */
const SYNC_SEARCH = 64 * 1024;
const FRONT_COVER = 3;

class Reader {
  constructor(
    private readonly handle: fs.FileHandle,
    readonly size: number,
    private readonly signal?: AbortSignal,
  ) {}

  /** Up to `length` bytes at `offset`, fewer at the end of the file. */
  async read(offset: number, length: number): Promise<Buffer> {
    this.signal?.throwIfAborted();
    const start = Math.max(0, Math.min(offset, this.size));
    const count = Math.max(0, Math.min(length, this.size - start));
    const buffer = Buffer.alloc(count);
    if (count === 0) return buffer;
    const { bytesRead } = await this.handle.read(buffer, 0, count, start);
    return buffer.subarray(0, bytesRead);
  }
}

function emptyInfo(format: MediaInfo["format"]): MediaInfo {
  return {
    format,
    duration: null,
    title: null,
    artist: null,
    album: null,
    year: null,
    track: null,
    genre: null,
    picture: null,
    audio: null,
    video: null,
    bitrate: null,
  };
}

export async function readMediaInfo(file: string, signal?: AbortSignal): Promise<MediaInfo> {
  signal?.throwIfAborted();
  const handle = await fs.open(file, "r");
  try {
    const reader = new Reader(handle, (await handle.stat()).size, signal);
    const head = await reader.read(0, 64);
    const ascii = (from: number, to: number) => head.toString("latin1", from, to);
    let info: MediaInfo;
    if (ascii(0, 3) === "ID3") info = await readId3File(reader, head);
    else if (ascii(0, 4) === "fLaC") info = await readFlac(reader, 0);
    else if (ascii(0, 4) === "OggS") info = await readOgg(reader);
    else if ((ascii(0, 4) === "RIFF" || ascii(0, 4) === "RF64") && ascii(8, 12) === "WAVE")
      info = await readWav(reader);
    else if (["ftyp", "moov", "mdat", "free", "wide", "skip"].includes(ascii(4, 8)))
      info = await readMp4(reader);
    else if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3)
      info = await readMatroska(reader);
    else if (mpegHeader(head, 0)) info = await readMpeg(reader, 0, emptyInfo("mp3"));
    else info = emptyInfo("unknown");
    if (info.bitrate === null && info.duration && info.format !== "unknown")
      info.bitrate = Math.round((reader.size * 8) / info.duration);
    return info;
  } finally {
    await handle.close();
  }
}

// ---- Shared text and tag helpers.

function clean(value: string): string | null {
  const text = value.replace(/\0+$/, "").replace(/\0/g, " ").trim();
  return text || null;
}

function utf16(bytes: Buffer, bigEndian: boolean): string {
  if (!bigEndian) return bytes.toString("utf16le", 0, bytes.length - (bytes.length % 2));
  const swapped = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2)));
  return swapped.swap16().toString("utf16le");
}

/** Text in an ID3 encoding: 0 Latin-1, 1 UTF-16 with BOM, 2 UTF-16BE, 3 UTF-8. */
function id3Text(bytes: Buffer, encoding: number): string {
  if (encoding === 0) return bytes.toString("latin1");
  if (encoding === 3) return bytes.toString("utf8");
  if (encoding === 2) return utf16(bytes, true);
  // UTF-16 with a BOM; every value after a NUL separator carries its own.
  const parts: string[] = [];
  let at = 0;
  let bigEndian = false;
  while (at + 1 < bytes.length) {
    let end = at;
    while (end + 1 < bytes.length && (bytes[end] !== 0 || bytes[end + 1] !== 0)) end += 2;
    let chunk = bytes.subarray(at, end);
    if (chunk[0] === 0xfe && chunk[1] === 0xff) [bigEndian, chunk] = [true, chunk.subarray(2)];
    else if (chunk[0] === 0xff && chunk[1] === 0xfe)
      [bigEndian, chunk] = [false, chunk.subarray(2)];
    parts.push(utf16(chunk, bigEndian));
    at = end + 2;
  }
  return parts.join("\0");
}

/** Where an encoded NUL terminator ends (one byte, or two aligned bytes for UTF-16). */
function terminated(bytes: Buffer, from: number, encoding: number): [number, number] {
  if (encoding === 1 || encoding === 2) {
    for (let at = from; at + 1 < bytes.length; at += 2)
      if (bytes[at] === 0 && bytes[at + 1] === 0) return [at, at + 2];
    return [bytes.length, bytes.length];
  }
  const end = bytes.indexOf(0, from);
  return end < 0 ? [bytes.length, bytes.length] : [end, end + 1];
}

function pictureMime(data: Uint8Array, declared: string): string {
  if (data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50) return "image/png";
  const mime = declared.toLowerCase();
  if (mime === "jpg" || mime === "jpeg") return "image/jpeg";
  if (mime === "png") return "image/png";
  return mime.includes("/") ? mime : `image/${mime || "unknown"}`;
}

/** The first four-digit year in a date ("2024-05-01", "2024"). */
function yearOf(value: string | null): string | null {
  return value ? (/\d{4}/.exec(value)?.[0] ?? value) : null;
}

// The ID3v1 genre list (as also used by ID3v2 "(nn)" references and MP4 `gnre`).
const GENRES = (
  "Blues|Classic Rock|Country|Dance|Disco|Funk|Grunge|Hip-Hop|Jazz|Metal|New Age|Oldies|Other|" +
  "Pop|R&B|Rap|Reggae|Rock|Techno|Industrial|Alternative|Ska|Death Metal|Pranks|Soundtrack|" +
  "Euro-Techno|Ambient|Trip-Hop|Vocal|Jazz+Funk|Fusion|Trance|Classical|Instrumental|Acid|House|" +
  "Game|Sound Clip|Gospel|Noise|Alternative Rock|Bass|Soul|Punk|Space|Meditative|Instrumental Pop|" +
  "Instrumental Rock|Ethnic|Gothic|Darkwave|Techno-Industrial|Electronic|Pop-Folk|Eurodance|Dream|" +
  "Southern Rock|Comedy|Cult|Gangsta|Top 40|Christian Rap|Pop/Funk|Jungle|Native American|Cabaret|" +
  "New Wave|Psychedelic|Rave|Showtunes|Trailer|Lo-Fi|Tribal|Acid Punk|Acid Jazz|Polka|Retro|" +
  "Musical|Rock & Roll|Hard Rock"
).split("|");

function genreName(value: string | null): string | null {
  if (!value) return null;
  const match = /^\(?(\d{1,3})\)?(.*)$/.exec(value.trim());
  if (!match) return value;
  return match[2]?.trim() || GENRES[Number(match[1])] || value;
}

/** Copy the fields `from` has and `into` lacks. */
function fillMissing(into: MediaInfo, from: Partial<MediaInfo>): void {
  for (const key of ["title", "artist", "album", "year", "track", "genre"] as const)
    if (!into[key] && from[key]) into[key] = from[key]!;
  if (!into.picture && from.picture) into.picture = from.picture;
}

// ---- MP3: ID3v2, the first MPEG frame (Xing/Info/VBRI), ID3v1.

const syncsafe = (bytes: Buffer, at: number) =>
  ((bytes[at]! & 0x7f) << 21) |
  ((bytes[at + 1]! & 0x7f) << 14) |
  ((bytes[at + 2]! & 0x7f) << 7) |
  (bytes[at + 3]! & 0x7f);

/** Remove the 0x00 that unsynchronisation inserts after each 0xFF. */
function resync(bytes: Buffer): Buffer {
  const out = Buffer.alloc(bytes.length);
  let length = 0;
  for (let at = 0; at < bytes.length; at++) {
    out[length++] = bytes[at]!;
    if (bytes[at] === 0xff && bytes[at + 1] === 0) at++;
  }
  return out.subarray(0, length);
}

async function readId3File(reader: Reader, head: Buffer): Promise<MediaInfo> {
  const tagEnd = 10 + syncsafe(head, 6) + (head[5]! & 0x10 ? 10 : 0);
  const tag = await reader.read(0, Math.min(tagEnd, HEAD_CAP));
  const fields = parseId3v2(tag);
  // An ID3 tag may sit in front of FLAC too.
  const after = await reader.read(tagEnd, 4);
  if (after.toString("latin1") === "fLaC") {
    const flac = await readFlac(reader, tagEnd);
    fillMissing(flac, fields);
    return flac;
  }
  // ID3v2 goes first: the ID3v1 fallback only fills what it lacks (and truncates at 30 bytes).
  const info = emptyInfo("mp3");
  fillMissing(info, fields);
  return readMpeg(reader, tagEnd, info);
}

function parseId3v2(tag: Buffer): Partial<MediaInfo> {
  const version = tag[3]!;
  const flags = tag[5]!;
  if (version < 2 || version > 4) return {};
  let body = tag.subarray(10);
  if (version < 4 && flags & 0x80) body = resync(body);
  let at = 0;
  if (flags & 0x40 && version >= 3)
    at = version === 3 ? 4 + body.readUInt32BE(0) : syncsafe(body, 0);
  const text = new Map<string, string>();
  const pictures: Array<{ type: number; picture: MediaPicture }> = [];
  const idLength = version === 2 ? 3 : 4;
  const headerLength = version === 2 ? 6 : 10;
  while (at + headerLength <= body.length) {
    const id = body.toString("latin1", at, at + idLength);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size =
      version === 2
        ? body.readUIntBE(at + 3, 3)
        : version === 4
          ? syncsafe(body, at + 4)
          : body.readUInt32BE(at + 4);
    const format = version === 2 ? 0 : body[at + 9]!;
    let data = body.subarray(at + headerLength, at + headerLength + size);
    at += headerLength + size;
    if (version === 3 && format & 0xc0) continue; // compressed or encrypted
    if (version === 4) {
      if (format & 0x0c) continue;
      if (format & 0x40) data = data.subarray(1);
      if (format & 0x01) data = data.subarray(4);
      if (format & 0x02) data = resync(data);
    } else if (version === 3 && format & 0x20) data = data.subarray(1);
    if (data.length < 1) continue;
    if (id[0] === "T" && id !== "TXXX" && id !== "TXX") {
      const value = id3Text(data.subarray(1), data[0]!).split("\0").filter(Boolean).join("; ");
      if (value) text.set(id, value);
    } else if (id === "APIC" || id === "PIC") {
      const encoding = data[0]!;
      let mime: string;
      let cursor: number;
      if (id === "PIC") {
        mime = data.toString("latin1", 1, 4);
        cursor = 4;
      } else {
        const end = data.indexOf(0, 1);
        if (end < 0) continue;
        mime = data.toString("latin1", 1, end);
        cursor = end + 1;
      }
      const type = data[cursor]!;
      const [, start] = terminated(data, cursor + 1, encoding);
      const image = data.subarray(start);
      if (image.length && image.length <= PICTURE_CAP)
        pictures.push({
          type,
          picture: { mime: pictureMime(image, mime), data: new Uint8Array(image) },
        });
    }
  }
  const get = (...ids: string[]) => clean(ids.map((id) => text.get(id) ?? "").find(Boolean) ?? "");
  return {
    title: get("TIT2", "TT2"),
    artist: get("TPE1", "TP1", "TPE2", "TP2"),
    album: get("TALB", "TAL"),
    year: yearOf(get("TDRC", "TYER", "TYE", "TDOR", "TORY")),
    track: get("TRCK", "TRK"),
    genre: genreName(get("TCON", "TCO")),
    picture: (pictures.find((entry) => entry.type === FRONT_COVER) ?? pictures[0])?.picture ?? null,
  };
}

const MPEG_BITRATES = {
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MPEG_RATES = [44100, 48000, 32000];

type MpegFrame = {
  mpeg1: boolean;
  layer: number;
  bitrate: number;
  sampleRate: number;
  channels: number;
  samples: number;
  length: number;
};

function mpegHeader(bytes: Buffer, at: number): MpegFrame | null {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1]! & 0xe0) !== 0xe0) return null;
  const versionBits = (bytes[at + 1]! >> 3) & 3;
  const layerBits = (bytes[at + 1]! >> 1) & 3;
  const bitrateIndex = bytes[at + 2]! >> 4;
  const rateIndex = (bytes[at + 2]! >> 2) & 3;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15)
    return null;
  if (rateIndex === 3) return null;
  const mpeg1 = versionBits === 3;
  const layer = 4 - layerBits;
  const table = mpeg1
    ? [MPEG_BITRATES.v1l1, MPEG_BITRATES.v1l2, MPEG_BITRATES.v1l3][layer - 1]!
    : layer === 1
      ? MPEG_BITRATES.v2l1
      : MPEG_BITRATES.v2l23;
  const bitrate = table[bitrateIndex]! * 1000;
  const sampleRate = MPEG_RATES[rateIndex]! / (mpeg1 ? 1 : versionBits === 2 ? 2 : 4);
  const padding = (bytes[at + 2]! >> 1) & 1;
  const samples = layer === 1 ? 384 : layer === 3 && !mpeg1 ? 576 : 1152;
  const length =
    layer === 1
      ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
      : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
  const channels = bytes[at + 3]! >> 6 === 3 ? 1 : 2;
  return { mpeg1, layer, bitrate, sampleRate, channels, samples, length };
}

async function readMpeg(reader: Reader, start: number, info: MediaInfo): Promise<MediaInfo> {
  const window = await reader.read(start, SYNC_SEARCH);
  let frameAt = -1;
  let frame: MpegFrame | null = null;
  for (let at = 0; at + 4 <= window.length; at++) {
    const candidate = mpegHeader(window, at);
    if (!candidate) continue;
    // A real frame is followed by another (unless the file ends first).
    const next = at + candidate.length;
    if (next + 4 <= window.length && !mpegHeader(window, next)) continue;
    frameAt = at;
    frame = candidate;
    break;
  }
  const tail = await reader.read(reader.size - 128, 128);
  const hasV1 = tail.length === 128 && tail.toString("latin1", 0, 3) === "TAG";
  if (hasV1) fillMissing(info, parseId3v1(tail));
  if (!frame) return info;
  info.format = "mp3";
  info.audio = {
    sampleRate: frame.sampleRate,
    channels: frame.channels,
    codec: `mp${frame.layer}`,
  };
  const audioBytes = reader.size - start - frameAt - (hasV1 ? 128 : 0);
  const side = frame.mpeg1 ? (frame.channels === 1 ? 17 : 32) : frame.channels === 1 ? 9 : 17;
  const xing = frameAt + 4 + side;
  const tag = window.toString("latin1", xing, xing + 4);
  let frames: number | null = null;
  let bytes: number | null = null;
  if (tag === "Xing" || tag === "Info") {
    const flags = window.readUInt32BE(xing + 4);
    let at = xing + 8;
    if (flags & 1) {
      frames = window.readUInt32BE(at);
      at += 4;
    }
    if (flags & 2) bytes = window.readUInt32BE(at);
  } else if (window.toString("latin1", frameAt + 36, frameAt + 40) === "VBRI") {
    bytes = window.readUInt32BE(frameAt + 46);
    frames = window.readUInt32BE(frameAt + 50);
  }
  if (frames) {
    info.duration = (frames * frame.samples) / frame.sampleRate;
    info.bitrate = Math.round(((bytes ?? audioBytes) * 8) / info.duration);
  } else {
    info.duration = (audioBytes * 8) / frame.bitrate;
    info.bitrate = frame.bitrate;
  }
  return info;
}

function parseId3v1(tag: Buffer): Partial<MediaInfo> {
  const field = (from: number, to: number) => clean(tag.toString("latin1", from, to));
  const track = tag[125] === 0 && tag[126] !== 0 ? String(tag[126]) : null;
  return {
    title: field(3, 33),
    artist: field(33, 63),
    album: field(63, 93),
    year: field(93, 97),
    track,
    genre: GENRES[tag[127]!] ?? null,
  };
}

// ---- FLAC metadata blocks and Vorbis comments.

/** A FLAC PICTURE block body (also base64'd into Ogg METADATA_BLOCK_PICTURE). */
function flacPicture(block: Buffer): { type: number; picture: MediaPicture } | null {
  if (block.length < 32) return null;
  const type = block.readUInt32BE(0);
  const mimeLength = block.readUInt32BE(4);
  const mime = block.toString("latin1", 8, 8 + mimeLength);
  let at = 8 + mimeLength;
  at += 4 + block.readUInt32BE(at); // description
  at += 16; // width, height, depth, colours
  const length = block.readUInt32BE(at);
  const data = block.subarray(at + 4, at + 4 + length);
  if (!data.length || data.length !== length || length > PICTURE_CAP) return null;
  return { type, picture: { mime: pictureMime(data, mime), data: new Uint8Array(data) } };
}

/** `KEY=value` comments after a vendor string, all lengths little-endian. */
function vorbisComments(bytes: Buffer): Partial<MediaInfo> {
  const values = new Map<string, string>();
  const pictures: Array<{ type: number; picture: MediaPicture }> = [];
  if (bytes.length < 8) return {};
  let at = 4 + bytes.readUInt32LE(0);
  if (at + 4 > bytes.length) return {};
  const count = bytes.readUInt32LE(at);
  at += 4;
  for (let index = 0; index < count && at + 4 <= bytes.length; index++) {
    const length = bytes.readUInt32LE(at);
    const comment = bytes.toString("utf8", at + 4, Math.min(bytes.length, at + 4 + length));
    at += 4 + length;
    const equals = comment.indexOf("=");
    if (equals <= 0) continue;
    const key = comment.slice(0, equals).toUpperCase();
    const value = comment.slice(equals + 1);
    if (key === "METADATA_BLOCK_PICTURE") {
      const picture = flacPicture(Buffer.from(value, "base64"));
      if (picture) pictures.push(picture);
    } else if (key === "COVERART") {
      const data = Buffer.from(value, "base64");
      if (data.length && data.length <= PICTURE_CAP)
        pictures.push({ type: FRONT_COVER, picture: { mime: pictureMime(data, ""), data } });
    } else if (!values.has(key)) values.set(key, value);
  }
  const get = (...keys: string[]) =>
    clean(keys.map((key) => values.get(key) ?? "").find(Boolean) ?? "");
  return {
    title: get("TITLE"),
    artist: get("ARTIST", "ALBUMARTIST", "ALBUM ARTIST"),
    album: get("ALBUM"),
    year: yearOf(get("DATE", "YEAR", "ORIGINALDATE")),
    track: get("TRACKNUMBER", "TRACK"),
    genre: get("GENRE"),
    picture: (pictures.find((entry) => entry.type === FRONT_COVER) ?? pictures[0])?.picture ?? null,
  };
}

async function readFlac(reader: Reader, start: number): Promise<MediaInfo> {
  const info = emptyInfo("flac");
  let at = start + 4;
  const pictures: Array<{ type: number; picture: MediaPicture }> = [];
  for (let last = false; !last && at < Math.min(reader.size, start + HEAD_CAP);) {
    const header = await reader.read(at, 4);
    if (header.length < 4) break;
    last = (header[0]! & 0x80) !== 0;
    const type = header[0]! & 0x7f;
    const length = header.readUIntBE(1, 3);
    at += 4;
    if (type === 0 || type === 4 || (type === 6 && length <= PICTURE_CAP + 1024)) {
      const block = await reader.read(at, length);
      if (type === 0 && block.length >= 18) {
        const sampleRate = block.readUIntBE(10, 3) >> 4;
        const channels = ((block[12]! >> 1) & 7) + 1;
        const samples = (block[13]! & 0x0f) * 2 ** 32 + block.readUInt32BE(14);
        info.audio = { sampleRate, channels, codec: "flac" };
        if (sampleRate && samples) info.duration = samples / sampleRate;
      } else if (type === 4) fillMissing(info, vorbisComments(block));
      else if (type === 6) {
        const picture = flacPicture(block);
        if (picture) pictures.push(picture);
      }
    }
    at += length;
  }
  if (!info.picture)
    info.picture =
      (pictures.find((entry) => entry.type === FRONT_COVER) ?? pictures[0])?.picture ?? null;
  if (info.duration) info.bitrate = Math.round(((reader.size - at) * 8) / info.duration);
  return info;
}

// ---- Ogg Vorbis and Opus.

type OggPage = { serial: number; granule: bigint; body: Buffer; segments: number[]; next: number };

function oggPage(bytes: Buffer, at: number): OggPage | null {
  if (at + 27 > bytes.length || bytes.toString("latin1", at, at + 4) !== "OggS") return null;
  const count = bytes[at + 26]!;
  if (at + 27 + count > bytes.length) return null;
  const segments = [...bytes.subarray(at + 27, at + 27 + count)];
  const bodyStart = at + 27 + count;
  const bodyLength = segments.reduce((sum, value) => sum + value, 0);
  return {
    serial: bytes.readUInt32LE(at + 14),
    granule: bytes.readBigInt64LE(at + 6),
    body: bytes.subarray(bodyStart, bodyStart + bodyLength),
    segments,
    next: bodyStart + bodyLength,
  };
}

async function readOgg(reader: Reader): Promise<MediaInfo> {
  const head = await reader.read(0, HEAD_CAP);
  // Reassemble the first logical stream's first two packets (identification, comments).
  const packets: Buffer[] = [];
  let partial: Buffer[] = [];
  let serial: number | null = null;
  for (let at = 0; packets.length < 2;) {
    const page = oggPage(head, at);
    if (!page) break;
    at = page.next;
    if (serial === null) serial = page.serial;
    if (page.serial !== serial) continue;
    let offset = 0;
    for (const segment of page.segments) {
      partial.push(page.body.subarray(offset, offset + segment));
      offset += segment;
      if (segment < 255) {
        packets.push(Buffer.concat(partial));
        partial = [];
        if (packets.length === 2) break;
      }
    }
  }
  const [identification, comments] = packets;
  const info = emptyInfo("ogg");
  if (!identification) return info;
  let rate = 0;
  let preSkip = 0;
  if (identification.toString("latin1", 0, 8) === "OpusHead") {
    info.format = "opus";
    rate = 48000;
    preSkip = identification.readUInt16LE(10);
    info.audio = {
      sampleRate: identification.readUInt32LE(12) || 48000,
      channels: identification[9]!,
      codec: "opus",
    };
    if (comments?.toString("latin1", 0, 8) === "OpusTags")
      fillMissing(info, vorbisComments(comments.subarray(8)));
  } else if (identification.toString("latin1", 1, 7) === "vorbis" && identification[0] === 1) {
    rate = identification.readUInt32LE(12);
    const nominal = identification.readInt32LE(20);
    info.audio = { sampleRate: rate, channels: identification[11]!, codec: "vorbis" };
    if (nominal > 0) info.bitrate = nominal;
    if (comments?.[0] === 3 && comments.toString("latin1", 1, 7) === "vorbis")
      fillMissing(info, vorbisComments(comments.subarray(7)));
  } else if (identification.toString("latin1", 1, 5) === "FLAC") {
    info.audio = { sampleRate: null, channels: null, codec: "flac" };
    return info;
  } else return info;
  // Duration: the granule position of the stream's last page.
  const tailStart = Math.max(0, reader.size - TAIL_BYTES);
  const tail = await reader.read(tailStart, TAIL_BYTES);
  for (
    let at = tail.lastIndexOf("OggS");
    at >= 0;
    at = at > 0 ? tail.lastIndexOf("OggS", at - 1) : -1
  ) {
    if (at + 27 > tail.length) continue;
    if (tail.readUInt32LE(at + 14) !== serial) continue;
    const granule = tail.readBigInt64LE(at + 6);
    if (granule < 0n) continue;
    if (rate > 0) info.duration = Math.max(0, Number(granule) - preSkip) / rate;
    break;
  }
  if (info.duration && info.format === "opus")
    info.bitrate = Math.round((reader.size * 8) / info.duration);
  return info;
}

// ---- WAV / RF64.

async function readWav(reader: Reader): Promise<MediaInfo> {
  const info = emptyInfo("wav");
  const rf64 = (await reader.read(0, 4)).toString("latin1") === "RF64";
  let dataSize: number | null = null;
  let byteRate = 0;
  const tags: Partial<MediaInfo> = {};
  for (let at = 12; at + 8 <= reader.size;) {
    const header = await reader.read(at, 8);
    if (header.length < 8) break;
    const id = header.toString("latin1", 0, 4);
    let size = header.readUInt32LE(4);
    if (id === "ds64") {
      const body = await reader.read(at + 8, 24);
      if (body.length >= 16) dataSize = Number(body.readBigUInt64LE(8));
    } else if (id === "fmt ") {
      const body = await reader.read(at + 8, Math.min(size, 40));
      if (body.length >= 16) {
        const tag = body.readUInt16LE(0);
        byteRate = body.readUInt32LE(8);
        const subFormat = tag === 0xfffe && body.length >= 26 ? body.readUInt16LE(24) : tag;
        info.audio = {
          sampleRate: body.readUInt32LE(4),
          channels: body.readUInt16LE(2),
          codec:
            subFormat === 1
              ? "pcm"
              : subFormat === 3
                ? "pcm_float"
                : subFormat === 0x55
                  ? "mp3"
                  : `0x${subFormat.toString(16)}`,
        };
      }
    } else if (id === "data") {
      if (!(rf64 && size === 0xffffffff && dataSize !== null)) dataSize = size;
      if (size === 0xffffffff) size = dataSize ?? reader.size - at - 8;
    } else if (id === "LIST" && size <= HEAD_CAP) {
      const body = await reader.read(at + 8, size);
      if (body.toString("latin1", 0, 4) === "INFO")
        for (let cursor = 4; cursor + 8 <= body.length;) {
          const key = body.toString("latin1", cursor, cursor + 4);
          const length = body.readUInt32LE(cursor + 4);
          const value = clean(body.toString("utf8", cursor + 8, cursor + 8 + length));
          if (key === "INAM") tags.title = value;
          else if (key === "IART") tags.artist = value;
          else if (key === "IPRD") tags.album = value;
          else if (key === "ICRD") tags.year = yearOf(value);
          else if (key === "IGNR") tags.genre = value;
          else if (key === "ITRK" || key === "IPRT") tags.track = value;
          cursor += 8 + length + (length & 1);
        }
    }
    at += 8 + size + (size & 1);
  }
  fillMissing(info, tags);
  if (dataSize !== null && byteRate > 0) {
    info.duration = dataSize / byteRate;
    info.bitrate = byteRate * 8;
  }
  return info;
}

// ---- MP4 / M4A / MOV (ISO base media).

type Box = { type: string; start: number; end: number };

/** The child boxes of `bytes[from, to)`. */
function boxes(bytes: Buffer, from: number, to: number): Box[] {
  const found: Box[] = [];
  for (let at = from; at + 8 <= to;) {
    let size = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) break;
      size = Number(bytes.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) size = to - at;
    if (size < header || at + size > to) break;
    found.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return found;
}

const child = (bytes: Buffer, box: Box | undefined, type: string, skip = 0): Box | undefined =>
  box ? boxes(bytes, box.start + skip, box.end).find((entry) => entry.type === type) : undefined;

async function readMp4(reader: Reader): Promise<MediaInfo> {
  const info = emptyInfo("mp4");
  // Walk top-level boxes by their headers alone; `mdat` is never read.
  let moov: Buffer | null = null;
  for (let at = 0; at + 8 <= reader.size;) {
    const header = await reader.read(at, 16);
    if (header.length < 8) break;
    let size = header.readUInt32BE(0);
    const type = header.toString("latin1", 4, 8);
    let length = 8;
    if (size === 1 && header.length >= 16) {
      size = Number(header.readBigUInt64BE(8));
      length = 16;
    } else if (size === 0) size = reader.size - at;
    if (size < length) break;
    if (type === "moov") {
      if (size <= HEAD_CAP * 2) moov = await reader.read(at + length, size - length);
      break;
    }
    at += size;
  }
  if (!moov) return info;
  const root: Box = { type: "moov", start: 0, end: moov.length };
  const mvhd = child(moov, root, "mvhd");
  if (mvhd) {
    const version = moov[mvhd.start]!;
    const timescale = moov.readUInt32BE(mvhd.start + (version === 1 ? 20 : 12));
    const duration =
      version === 1
        ? Number(moov.readBigUInt64BE(mvhd.start + 24))
        : moov.readUInt32BE(mvhd.start + 16);
    if (timescale > 0 && duration > 0 && duration !== 0xffffffff)
      info.duration = duration / timescale;
  }
  for (const trak of boxes(moov, 0, moov.length).filter((box) => box.type === "trak")) {
    const mdia = child(moov, trak, "mdia");
    const hdlr = child(moov, mdia, "hdlr");
    const handler = hdlr ? moov.toString("latin1", hdlr.start + 8, hdlr.start + 12) : "";
    const stsd = child(moov, child(moov, child(moov, mdia, "minf"), "stbl"), "stsd");
    const entry = stsd ? boxes(moov, stsd.start + 8, stsd.end)[0] : undefined;
    const codec = entry ? entry.type.trim() : null;
    if (handler === "vide" && !info.video) {
      const tkhd = child(moov, trak, "tkhd");
      let width = 0;
      let height = 0;
      if (tkhd) {
        const at = tkhd.start + (moov[tkhd.start] === 1 ? 88 : 76);
        if (at + 8 <= tkhd.end) {
          width = Math.round(moov.readUInt32BE(at) / 65536);
          height = Math.round(moov.readUInt32BE(at + 4) / 65536);
        }
      }
      if ((!width || !height) && entry && entry.start + 28 <= entry.end) {
        width = moov.readUInt16BE(entry.start + 24);
        height = moov.readUInt16BE(entry.start + 26);
      }
      if (width && height) info.video = { width, height, codec };
    } else if (handler === "soun" && !info.audio) {
      const audio = entry && entry.start + 28 <= entry.end ? entry : null;
      info.audio = {
        sampleRate: audio ? moov.readUInt32BE(audio.start + 24) >>> 16 || null : null,
        channels: audio ? moov.readUInt16BE(audio.start + 16) || null : null,
        codec: codec === "mp4a" ? "aac" : codec,
      };
    }
  }
  const udta = child(moov, root, "udta");
  const meta = child(moov, udta, "meta");
  if (meta) {
    // ISO `meta` is a full box (4 bytes of version and flags); QuickTime's is not.
    const skip = moov.toString("latin1", meta.start + 4, meta.start + 8) === "hdlr" ? 0 : 4;
    const ilst = child(moov, meta, "ilst", skip);
    if (ilst) fillMissing(info, itunesTags(moov, ilst));
  }
  return info;
}

function itunesTags(bytes: Buffer, ilst: Box): Partial<MediaInfo> {
  const tags: Partial<MediaInfo> = {};
  for (const item of boxes(bytes, ilst.start, ilst.end)) {
    const data = boxes(bytes, item.start, item.end).find((box) => box.type === "data");
    if (!data || data.end - data.start < 8) continue;
    const kind = bytes.readUInt32BE(data.start) & 0xffffff;
    const value = bytes.subarray(data.start + 8, data.end);
    const text = () => clean(value.toString("utf8"));
    switch (item.type) {
      case "©nam":
        tags.title = text();
        break;
      case "©ART":
      case "aART":
        tags.artist ??= text();
        break;
      case "©alb":
        tags.album = text();
        break;
      case "©day":
        tags.year = yearOf(text());
        break;
      case "©gen":
        tags.genre = text();
        break;
      case "gnre":
        if (value.length >= 2) tags.genre ??= GENRES[value.readUInt16BE(0) - 1] ?? null;
        break;
      case "trkn":
        if (value.length >= 6) {
          const number = value.readUInt16BE(2);
          const total = value.readUInt16BE(4);
          tags.track = number ? (total ? `${number}/${total}` : String(number)) : null;
        }
        break;
      case "covr":
        if (!tags.picture && value.length && value.length <= PICTURE_CAP)
          tags.picture = {
            mime: pictureMime(value, kind === 14 ? "png" : kind === 13 ? "jpeg" : ""),
            data: new Uint8Array(value),
          };
        break;
    }
  }
  return tags;
}

// ---- Matroska / WebM: Segment › Info (duration, title) and Tracks (sizes, codecs).

const EBML = {
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  title: 0x7ba9,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackType: 0x83,
  codecId: 0x86,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  audio: 0xe1,
  samplingFrequency: 0xb5,
  channels: 0x9f,
  cluster: 0x1f43b675,
} as const;

type Element = { id: number; start: number; end: number };

/** A variable-length integer at `at`: its value (marker kept for IDs) and length. */
function vint(bytes: Buffer, at: number, keepMarker: boolean): [number, number] | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (at + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let index = 1; index < length; index++) {
    value = value * 256 + bytes[at + index]!;
    if (bytes[at + index] !== 0xff) allOnes = false;
  }
  return [!keepMarker && allOnes ? -1 : value, length];
}

function elements(bytes: Buffer, from: number, to: number): Element[] {
  const found: Element[] = [];
  for (let at = from; at < to;) {
    const id = vint(bytes, at, true);
    if (!id) break;
    const size = vint(bytes, at + id[1], false);
    if (!size) break;
    const start = at + id[1] + size[1];
    // Unknown size (live streams): the element runs to the end of what was read.
    const end = size[0] < 0 ? to : Math.min(to, start + size[0]);
    found.push({ id: id[0], start, end });
    if (id[0] === EBML.cluster) break;
    at = end;
  }
  return found;
}

async function readMatroska(reader: Reader): Promise<MediaInfo> {
  const info = emptyInfo("matroska");
  const bytes = await reader.read(0, Math.min(HEAD_CAP, 1024 * 1024));
  const segment = elements(bytes, 0, bytes.length).find((entry) => entry.id === EBML.segment);
  if (!segment) return info;
  const uint = (entry: Element) =>
    bytes.readUIntBE(entry.start, Math.min(6, entry.end - entry.start));
  const float = (entry: Element) =>
    entry.end - entry.start === 4
      ? bytes.readFloatBE(entry.start)
      : bytes.readDoubleBE(entry.start);
  const text = (entry: Element) => clean(bytes.toString("utf8", entry.start, entry.end));
  const find = (parent: Element, id: number) =>
    elements(bytes, parent.start, parent.end).find((entry) => entry.id === id);
  for (const section of elements(bytes, segment.start, segment.end)) {
    if (section.id === EBML.info) {
      const scale = find(section, EBML.timecodeScale);
      const duration = find(section, EBML.duration);
      const title = find(section, EBML.title);
      if (duration) info.duration = (float(duration) * (scale ? uint(scale) : 1_000_000)) / 1e9;
      if (title) info.title = text(title);
    } else if (section.id === EBML.tracks) {
      for (const track of elements(bytes, section.start, section.end)) {
        if (track.id !== EBML.trackEntry) continue;
        const type = find(track, EBML.trackType);
        const codecId = find(track, EBML.codecId);
        const codec = codecId
          ? (text(codecId)
              ?.replace(/^[AV]_/, "")
              .toLowerCase() ?? null)
          : null;
        if (type && uint(type) === 1 && !info.video) {
          const video = find(track, EBML.video);
          const width = video && find(video, EBML.pixelWidth);
          const height = video && find(video, EBML.pixelHeight);
          if (width && height) info.video = { width: uint(width), height: uint(height), codec };
        } else if (type && uint(type) === 2 && !info.audio) {
          const audio = find(track, EBML.audio);
          const rate = audio && find(audio, EBML.samplingFrequency);
          const channels = audio && find(audio, EBML.channels);
          info.audio = {
            sampleRate: rate ? Math.round(float(rate)) : null,
            channels: channels ? uint(channels) : null,
            codec,
          };
        }
      }
    }
  }
  return info;
}

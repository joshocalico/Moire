/**
 * JPEG EXIF: the camera, when the photo was taken, its exposure, and the orientation the picture
 * must be turned to. Only the fields previews and search show are read.
 */

export type ExifData = {
  make: string | null;
  model: string | null;
  lens: string | null;
  /** When the photo was taken, as local wall-clock time in ms (EXIF stores no zone). */
  taken: number | null;
  /** Seconds. */
  exposureTime: number | null;
  fNumber: number | null;
  iso: number | null;
  /** Millimetres. */
  focalLength: number | null;
  /** 1–8 as in TIFF: 1 upright, 3 upside down, 6 needs a clockwise quarter turn, 8 counter. */
  orientation: number;
};

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_ORIENTATION = 0x0112;
const TAG_DATE_TIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_F_NUMBER = 0x829d;
const TAG_ISO = 0x8827;
const TAG_DATE_TAKEN = 0x9003;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_LENS_MODEL = 0xa434;

const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_SRATIONAL = 10;
const TYPE_SIZES: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 };
const MARKER_SOS = 0xda;
const MARKER_APP1 = 0xe1;
/** A hostile IFD could list thousands of entries; real ones hold a few dozen. */
const MAX_IFD_ENTRIES = 512;

/** The TIFF block inside a JPEG's APP1 "Exif" segment, or null. */
export function jpegExifTiff(bytes: Uint8Array): Buffer | null {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8) return null;
  let at = 2;
  while (at + 4 <= data.length && data[at] === 0xff) {
    const marker = data[at + 1]!;
    // Fill bytes may pad between segments.
    if (marker === 0xff) {
      at++;
      continue;
    }
    // Image data follows the start of scan; no metadata segments come after it.
    if (marker === MARKER_SOS) return null;
    const length = data.readUInt16BE(at + 2);
    if (marker === MARKER_APP1 && data.toString("latin1", at + 4, at + 10) === "Exif\0\0")
      return data.subarray(at + 10, Math.min(data.length, at + 2 + length));
    at += 2 + length;
  }
  return null;
}

/** EXIF fields of a JPEG (its first 64 KiB are enough), or null when it carries none. */
export function readExif(bytes: Uint8Array): ExifData | null {
  const tiff = jpegExifTiff(bytes);
  if (!tiff || tiff.length < 8) return null;
  const little = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const i32 = (at: number) => (little ? tiff.readInt32LE(at) : tiff.readInt32BE(at));
  const fields = new Map<number, string | number>();
  const readIfd = (offset: number) => {
    if (offset + 2 > tiff.length) return;
    const count = Math.min(u16(offset), MAX_IFD_ENTRIES);
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12;
      if (entry + 12 > tiff.length) return;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const length = u32(entry + 4);
      const size = (TYPE_SIZES[type] ?? 0) * length;
      if (!size) continue;
      const at = size > 4 ? u32(entry + 8) : entry + 8;
      if (at + size > tiff.length) continue;
      if (type === TYPE_ASCII)
        fields.set(
          tag,
          tiff
            .toString("latin1", at, at + length)
            .replace(/\0.*$/s, "")
            .trim(),
        );
      else if (type === TYPE_SHORT) fields.set(tag, u16(at));
      else if (type === TYPE_LONG) fields.set(tag, u32(at));
      else if (type === TYPE_BYTE) fields.set(tag, tiff[at]!);
      else if (type === TYPE_RATIONAL || type === TYPE_SRATIONAL) {
        const numerator = type === TYPE_RATIONAL ? u32(at) : i32(at);
        const denominator = type === TYPE_RATIONAL ? u32(at + 4) : i32(at + 4);
        if (denominator) fields.set(tag, numerator / denominator);
      }
    }
  };
  try {
    readIfd(u32(4));
    const exif = fields.get(TAG_EXIF_IFD);
    if (typeof exif === "number") readIfd(exif);
  } catch {
    return null;
  }
  if (!fields.size) return null;
  const text = (tag: number) => {
    const value = fields.get(tag);
    return typeof value === "string" && value ? value : null;
  };
  const number = (tag: number) => {
    const value = fields.get(tag);
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  };
  const orientation = number(TAG_ORIENTATION);
  return {
    make: text(TAG_MAKE),
    model: text(TAG_MODEL),
    lens: text(TAG_LENS_MODEL),
    taken: exifDate(text(TAG_DATE_TAKEN) ?? text(TAG_DATE_TIME)),
    exposureTime: number(TAG_EXPOSURE_TIME),
    fNumber: number(TAG_F_NUMBER),
    iso: number(TAG_ISO),
    focalLength: number(TAG_FOCAL_LENGTH),
    orientation: orientation && orientation <= 8 ? orientation : 1,
  };
}

/** EXIF dates are local wall-clock time: "2024:06:01 14:30:00". */
function exifDate(value: string | null): number | null {
  const match = value ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(value) : null;
  if (!match) return null;
  const time = new Date(
    +match[1]!,
    +match[2]! - 1,
    +match[3]!,
    +match[4]!,
    +match[5]!,
    +match[6]!,
  ).getTime();
  return Number.isFinite(time) ? time : null;
}

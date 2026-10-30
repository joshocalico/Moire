/** Text files of unknown encoding: UTF-8 or UTF-16 by BOM, valid UTF-8, else Latin-1; binary is null. */

export type DecodedText = {
  text: string;
  encoding: "UTF-8" | "UTF-16LE" | "UTF-16BE" | "Latin-1" | "ASCII";
};

/** NUL bytes this early mean the file is binary (UTF-16 is recognised by its BOM first). */
const BINARY_SNIFF_BYTES = 8192;

/** `truncated`: the bytes are the start of a longer file, so a cut character at the end is expected. */
export function decodeText(bytes: Uint8Array, truncated = false): DecodedText | null {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf)
    return { text: data.toString("utf8", 3), encoding: "UTF-8" };
  if (data[0] === 0xff && data[1] === 0xfe)
    return { text: data.toString("utf16le", 2), encoding: "UTF-16LE" };
  if (data[0] === 0xfe && data[1] === 0xff) {
    const swapped = Buffer.from(data.subarray(2, 2 + ((data.length - 2) & ~1)));
    return { text: swapped.swap16().toString("utf16le"), encoding: "UTF-16BE" };
  }
  if (data.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
  if (data.every((byte) => byte < 0x80))
    return { text: data.toString("latin1"), encoding: "ASCII" };
  try {
    // A capped read may cut a multi-byte character; only that tail is allowed to be invalid.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      truncated ? trimPartial(data) : data,
    );
    return { text, encoding: "UTF-8" };
  } catch {
    return { text: data.toString("latin1"), encoding: "Latin-1" };
  }
}

/** Drop an incomplete UTF-8 sequence at the very end. */
function trimPartial(data: Buffer): Buffer {
  for (let back = 1; back <= Math.min(3, data.length); back++) {
    const byte = data[data.length - back]!;
    if ((byte & 0xc0) === 0x80) continue;
    const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return needed > back ? data.subarray(0, data.length - back) : data;
  }
  return data;
}

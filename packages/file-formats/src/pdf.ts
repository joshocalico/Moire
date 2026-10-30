/**
 * PDF facts and text for search and previews: page count, the Info dictionary and a best-effort
 * reading-order excerpt of the first pages. The cross-reference table is not trusted (it is often
 * stale or broken); objects are found by scanning for `N G obj`, and object streams are expanded
 * because modern writers keep the catalog, page tree and Info there. Damaged parts read as
 * null or empty text; only a file without a PDF header throws.
 */
import { constants, inflateSync } from "node:zlib";

export type PdfInfo = {
  pages: number | null;
  title: string | null;
  author: string | null;
  subject: string | null;
  creator: string | null;
  producer: string | null;
  /** Milliseconds since the epoch, from `/CreationDate`. */
  created: number | null;
  /** The trailer names an `/Encrypt` dictionary: strings and streams are unreadable. */
  encrypted: boolean;
  text: string;
};

const DEFAULT_MAX_TEXT_CHARS = 20_000;
const DEFAULT_MAX_PAGES = 20;
/** The header may follow some junk, but never far into the file. */
const HEADER_WINDOW = 1024;
/** Total inflated bytes per document, so a deflate bomb costs at most this much memory. */
const MAX_INFLATED_BYTES = 32 * 1024 * 1024;
/** Reference chains and page trees deeper than this are cycles or garbage. */
const MAX_DEPTH = 32;
/** TJ adjustments (thousandths of an em) beyond this read as a word gap. */
const TJ_SPACE_THRESHOLD = -200;
/** Pen movements, as a share of the font size, that read as a new line or a word gap. */
const NEWLINE_SHARE = 0.5;
const SPACE_SHARE = 0.2;
/** Glyph width when a font gives none (thousandths of an em). */
const DEFAULT_GLYPH_WIDTH = 500;
const DEFAULT_CID_WIDTH = 1000;

// ---- Objects

class Name {
  constructor(readonly name: string) {}
}
class Ref {
  constructor(
    readonly num: number,
    readonly gen: number,
  ) {}
}
class Str {
  constructor(readonly bytes: Uint8Array) {}
}
/** A bare keyword: a content-stream operator, or `R`/`obj`/`stream` while parsing the file. */
class Op {
  constructor(readonly op: string) {}
}
type Dict = Map<string, PdfValue>;
class Stream {
  constructor(
    readonly dict: Dict,
    readonly raw: Uint8Array,
  ) {}
}
type PdfValue = null | boolean | number | Name | Ref | Str | Dict | Stream | PdfValue[];
type Token = PdfValue | Op | "[" | "]" | "<<" | ">>" | "{" | "}";

const isDict = (value: unknown): value is Dict => value instanceof Map;
const isWhite = (byte: number) =>
  byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x0c || byte === 0;
const isDelimiter = (byte: number) =>
  byte === 0x28 || // (
  byte === 0x29 || // )
  byte === 0x3c || // <
  byte === 0x3e || // >
  byte === 0x5b || // [
  byte === 0x5d || // ]
  byte === 0x7b || // {
  byte === 0x7d || // }
  byte === 0x2f || // /
  byte === 0x25; // %
const hexValue = (byte: number) =>
  byte >= 0x30 && byte <= 0x39
    ? byte - 0x30
    : byte >= 0x41 && byte <= 0x46
      ? byte - 0x37
      : byte >= 0x61 && byte <= 0x66
        ? byte - 0x57
        : -1;

class Lexer {
  constructor(
    readonly bytes: Uint8Array,
    public pos = 0,
  ) {}

  skipSpace(): void {
    const b = this.bytes;
    while (this.pos < b.length) {
      const byte = b[this.pos]!;
      if (isWhite(byte)) this.pos++;
      else if (byte === 0x25) {
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  token(): Token | undefined {
    this.skipSpace();
    const b = this.bytes;
    if (this.pos >= b.length) return undefined;
    const byte = b[this.pos]!;
    if (byte === 0x28) return this.literal();
    if (byte === 0x3c) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return "<<";
      }
      return this.hex();
    }
    if (byte === 0x3e) {
      this.pos += b[this.pos + 1] === 0x3e ? 2 : 1;
      return ">>";
    }
    if (byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d) {
      this.pos++;
      return String.fromCharCode(byte) as "[" | "]" | "{" | "}";
    }
    if (byte === 0x2f) return this.name();
    if (byte === 0x29) {
      // A stray close paren: skip it rather than loop.
      this.pos++;
      return this.token();
    }
    const start = this.pos;
    while (this.pos < b.length && !isWhite(b[this.pos]!) && !isDelimiter(b[this.pos]!)) this.pos++;
    const word = latin1(b.subarray(start, this.pos));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    return new Op(word);
  }

  private name(): Name {
    const b = this.bytes;
    this.pos++;
    const out: number[] = [];
    while (this.pos < b.length && !isWhite(b[this.pos]!) && !isDelimiter(b[this.pos]!)) {
      const byte = b[this.pos]!;
      const high = hexValue(b[this.pos + 1] ?? 0);
      const low = hexValue(b[this.pos + 2] ?? 0);
      if (byte === 0x23 && high >= 0 && low >= 0) {
        out.push(high * 16 + low);
        this.pos += 3;
      } else {
        out.push(byte);
        this.pos++;
      }
    }
    return new Name(latin1(Uint8Array.from(out)));
  }

  private hex(): Str {
    const b = this.bytes;
    this.pos++;
    const out: number[] = [];
    let pending = -1;
    while (this.pos < b.length && b[this.pos] !== 0x3e) {
      const value = hexValue(b[this.pos++]!);
      if (value < 0) continue;
      if (pending < 0) pending = value;
      else {
        out.push(pending * 16 + value);
        pending = -1;
      }
    }
    this.pos++;
    if (pending >= 0) out.push(pending * 16);
    return new Str(Uint8Array.from(out));
  }

  private literal(): Str {
    const b = this.bytes;
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      const byte = b[this.pos++]!;
      if (byte === 0x28) depth++;
      else if (byte === 0x29 && --depth === 0) break;
      if (byte === 0x0d) {
        // Any end of line inside a string reads as \n.
        if (b[this.pos] === 0x0a) this.pos++;
        out.push(0x0a);
      } else if (byte !== 0x5c) out.push(byte);
      else {
        const next = b[this.pos++];
        if (next === undefined) break;
        const escaped = ESCAPES[next];
        if (escaped !== undefined) out.push(escaped);
        else if (next >= 0x30 && next <= 0x37) {
          let value = next - 0x30;
          for (let digit = 0; digit < 2; digit++) {
            const following = b[this.pos];
            if (following === undefined || following < 0x30 || following > 0x37) break;
            value = value * 8 + following - 0x30;
            this.pos++;
          }
          out.push(value & 0xff);
        } else if (next === 0x0d) {
          // A backslash before an end of line continues the string on the next line.
          if (b[this.pos] === 0x0a) this.pos++;
        } else if (next !== 0x0a) out.push(next);
      }
    }
    return new Str(Uint8Array.from(out));
  }
}

const ESCAPES: Readonly<Record<number, number>> = {
  0x6e: 0x0a, // n
  0x72: 0x0d, // r
  0x74: 0x09, // t
  0x62: 0x08, // b
  0x66: 0x0c, // f
  0x28: 0x28,
  0x29: 0x29,
  0x5c: 0x5c,
};

/** One value; `refs` reads `N G R` as a reference (never in content streams). */
function parseValue(lexer: Lexer, refs: boolean, first = lexer.token()): PdfValue | Op | undefined {
  if (first === "[") {
    const items: PdfValue[] = [];
    for (;;) {
      const token = lexer.token();
      if (token === undefined || token === "]") return items;
      const value = parseValue(lexer, refs, token);
      if (value instanceof Op) {
        // A keyword inside an array means the array is damaged; stop at it.
        if (refs) return items;
        continue;
      }
      if (value !== undefined) items.push(value);
    }
  }
  if (first === "<<") {
    const dict: Dict = new Map();
    for (;;) {
      const key = lexer.token();
      if (key === undefined || key === ">>") return dict;
      if (!(key instanceof Name)) continue;
      const value = parseValue(lexer, refs);
      if (value === undefined) return dict;
      if (!(value instanceof Op)) dict.set(key.name, value);
    }
  }
  if (first === "]" || first === ">>" || first === "{" || first === "}") return null;
  if (refs && typeof first === "number" && Number.isInteger(first) && first >= 0) {
    const mark = lexer.pos;
    const gen = lexer.token();
    if (typeof gen === "number" && Number.isInteger(gen)) {
      const r = lexer.token();
      if (r instanceof Op && r.op === "R") return new Ref(first, gen);
    }
    lexer.pos = mark;
  }
  return first as PdfValue | Op | undefined;
}

// ---- Documents

type Budget = { inflated: number };

class PdfDocument {
  readonly objects = new Map<number, PdfValue>();
  readonly trailer: Dict = new Map();
  private readonly budget: Budget = { inflated: 0 };

  constructor(readonly bytes: Uint8Array) {
    this.scan();
    this.expandObjectStreams();
  }

  get encrypted(): boolean {
    return this.trailer.has("Encrypt");
  }

  resolve(value: PdfValue | undefined, depth = 0): PdfValue {
    while (value instanceof Ref && depth++ < MAX_DEPTH) value = this.objects.get(value.num);
    return value instanceof Ref || value === undefined ? null : value;
  }

  dict(value: PdfValue | undefined): Dict | null {
    const resolved = this.resolve(value);
    return resolved instanceof Stream ? resolved.dict : isDict(resolved) ? resolved : null;
  }

  get(dict: Dict | null, key: string): PdfValue {
    return dict ? this.resolve(dict.get(key)) : null;
  }

  /** A stream's decoded bytes, or null when a filter is unsupported or the data is damaged. */
  decode(stream: Stream): Uint8Array | null {
    if (this.encrypted) return null;
    const filters = this.resolve(stream.dict.get("Filter"));
    const params = this.resolve(stream.dict.get("DecodeParms"));
    const filterList = Array.isArray(filters) ? filters : filters ? [filters] : [];
    const paramList = Array.isArray(params) ? params : [params];
    let data: Uint8Array | null = stream.raw;
    for (const [index, filter] of filterList.entries()) {
      const name = this.resolve(filter);
      if (!(name instanceof Name) || !data) return null;
      data = applyFilter(name.name, data, this.dict(paramList[index] ?? null), this.budget);
    }
    return data;
  }

  private scan(): void {
    const text = latin1(this.bytes);
    const objectPattern = /(\d+)\s+(\d+)\s+obj\b/g;
    const lexer = new Lexer(this.bytes);
    let skipUntil = 0;
    for (const match of text.matchAll(objectPattern)) {
      // `obj` inside a stream's data was already skipped with its stream.
      if (match.index < skipUntil) continue;
      lexer.pos = match.index + match[0].length;
      const value = parseValue(lexer, true);
      if (value === undefined || value instanceof Op) continue;
      let object: PdfValue = value;
      if (isDict(value)) {
        const mark = lexer.pos;
        const keyword = lexer.token();
        if (keyword instanceof Op && keyword.op === "stream") {
          const stream = this.readStream(value, lexer.pos, text);
          object = stream.value;
          skipUntil = stream.end;
          if (value.get("Type") instanceof Name && (value.get("Type") as Name).name === "XRef")
            this.mergeTrailer(value);
        } else lexer.pos = mark;
      }
      this.objects.set(Number(match[1]), object);
      skipUntil = Math.max(skipUntil, lexer.pos);
    }
    for (const match of text.matchAll(/\btrailer\b/g)) {
      lexer.pos = match.index + match[0].length;
      const value = parseValue(lexer, true);
      if (isDict(value)) this.mergeTrailer(value);
    }
  }

  /** Later trailers (incremental updates) override earlier ones key by key. */
  private mergeTrailer(dict: Dict): void {
    for (const key of ["Root", "Info", "Encrypt"])
      if (dict.has(key)) this.trailer.set(key, dict.get(key)!);
  }

  private readStream(dict: Dict, keywordEnd: number, text: string): { value: Stream; end: number } {
    const b = this.bytes;
    let start = keywordEnd;
    // The keyword is followed by CRLF or LF (a lone CR from sloppy writers is tolerated).
    if (b[start] === 0x0d) start++;
    if (b[start] === 0x0a) start++;
    const length = dict.get("Length");
    if (typeof length === "number" && length >= 0 && start + length <= b.length) {
      const after = text.slice(start + length, start + length + 32);
      if (/^\s*endstream/.test(after))
        return { value: new Stream(dict, b.subarray(start, start + length)), end: start + length };
    }
    const found = text.indexOf("endstream", start);
    let end = found < 0 ? b.length : found;
    if (found >= 0 && b[end - 1] === 0x0a) end--;
    if (found >= 0 && b[end - 1] === 0x0d) end--;
    return { value: new Stream(dict, b.subarray(start, Math.max(start, end))), end };
  }

  private expandObjectStreams(): void {
    if (this.encrypted) return;
    const defined = new Set(this.objects.keys());
    for (const object of this.objects.values()) {
      if (!(object instanceof Stream)) continue;
      const type = object.dict.get("Type");
      if (!(type instanceof Name) || type.name !== "ObjStm") continue;
      const count = this.resolve(object.dict.get("N"));
      const first = this.resolve(object.dict.get("First"));
      if (typeof count !== "number" || typeof first !== "number") continue;
      const data = this.decode(object);
      if (!data) continue;
      const lexer = new Lexer(data);
      const header: Array<[number, number]> = [];
      for (let index = 0; index < count; index++) {
        const num = lexer.token();
        const offset = lexer.token();
        if (typeof num !== "number" || typeof offset !== "number") break;
        header.push([num, offset]);
      }
      for (const [num, offset] of header) {
        // An object written directly in the file is an update to the compressed one.
        if (defined.has(num)) continue;
        lexer.pos = first + offset;
        const value = parseValue(lexer, true);
        if (value !== undefined && !(value instanceof Op)) this.objects.set(num, value);
      }
    }
  }
}

function applyFilter(
  name: string,
  data: Uint8Array,
  params: Dict | null,
  budget: Budget,
): Uint8Array | null {
  switch (name) {
    case "FlateDecode":
    case "Fl": {
      const inflated = inflate(data, budget);
      return inflated && predict(inflated, params);
    }
    case "ASCIIHexDecode":
    case "AHx":
      return asciiHex(data);
    case "ASCII85Decode":
    case "A85":
      return ascii85(data);
    default:
      return null;
  }
}

function inflate(data: Uint8Array, budget: Budget): Uint8Array | null {
  const maxOutputLength = MAX_INFLATED_BYTES - budget.inflated;
  if (maxOutputLength <= 0) return null;
  let output: Buffer | null = null;
  try {
    output = inflateSync(data, { maxOutputLength });
  } catch (error) {
    if (error instanceof RangeError) return null;
    try {
      // Truncated or slightly damaged streams still yield what decoded before the damage.
      output = inflateSync(data, { maxOutputLength, finishFlush: constants.Z_SYNC_FLUSH });
    } catch {
      return null;
    }
  }
  budget.inflated += output.length;
  return output;
}

/** PNG row predictors (xref and object streams use them); TIFF predictors are not supported. */
function predict(data: Uint8Array, params: Dict | null): Uint8Array | null {
  const predictor = params?.get("Predictor");
  if (typeof predictor !== "number" || predictor < 10) return predictor === 2 ? null : data;
  const numberParam = (key: string, fallback: number) => {
    const value = params!.get(key);
    return typeof value === "number" && value > 0 ? value : fallback;
  };
  const colors = numberParam("Colors", 1);
  const bits = numberParam("BitsPerComponent", 8);
  const columns = numberParam("Columns", 1);
  const pixelBytes = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowBytes = Math.ceil((colors * bits * columns) / 8);
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  for (let row = 0; row < rows; row++) {
    const type = data[row * (rowBytes + 1)]!;
    const source = row * (rowBytes + 1) + 1;
    const target = row * rowBytes;
    for (let column = 0; column < rowBytes; column++) {
      const raw = data[source + column]!;
      const left = column >= pixelBytes ? out[target + column - pixelBytes]! : 0;
      const up = row > 0 ? out[target - rowBytes + column]! : 0;
      const upLeft =
        row > 0 && column >= pixelBytes ? out[target - rowBytes + column - pixelBytes]! : 0;
      let value = raw;
      if (type === 1) value = raw + left;
      else if (type === 2) value = raw + up;
      else if (type === 3) value = raw + ((left + up) >> 1);
      else if (type === 4) {
        const estimate = left + up - upLeft;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toUpLeft = Math.abs(estimate - upLeft);
        value =
          raw + (toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft);
      }
      out[target + column] = value & 0xff;
    }
  }
  return out;
}

function asciiHex(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let pending = -1;
  for (const byte of data) {
    if (byte === 0x3e) break;
    const value = hexValue(byte);
    if (value < 0) continue;
    if (pending < 0) pending = value;
    else {
      out.push(pending * 16 + value);
      pending = -1;
    }
  }
  if (pending >= 0) out.push(pending * 16);
  return Uint8Array.from(out);
}

function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  const group: number[] = [];
  /** A group of `count` digits (2–5) carries `count - 1` bytes; short groups pad with `u`. */
  const flush = (count: number) => {
    while (group.length < 5) group.push(84);
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    for (let index = 0; index < count - 1; index++) out.push((value >>> (24 - index * 8)) & 0xff);
    group.length = 0;
  };
  for (let index = 0; index < data.length; index++) {
    const byte = data[index]!;
    if (byte === 0x7e) break; // ~> ends the data
    if (isWhite(byte)) continue;
    if (byte === 0x7a && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (byte < 0x21 || byte > 0x75) continue;
    group.push(byte - 0x21);
    if (group.length === 5) flush(5);
  }
  if (group.length > 1) flush(group.length);
  return Uint8Array.from(out);
}

// ---- Strings

const latin1 = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString("latin1");

const WIN_ANSI = new TextDecoder("windows-1252").decode(
  Uint8Array.from({ length: 256 }, (_, i) => i),
);
const MAC_ROMAN = new TextDecoder("macintosh").decode(
  Uint8Array.from({ length: 256 }, (_, i) => i),
);
/** PDFDocEncoding is Latin-1 except for these code points. */
const PDF_DOC_HIGH = "•†‡…—–ƒ⁄‹›−‰„“”‘’‚™ﬁﬂŁŒŠŸŽıłœšž�€";
const PDF_DOC_LOW = "˘ˇˆ˙˝˛˚˜";
const PDF_DOC = Array.from({ length: 256 }, (_, code) =>
  code >= 0x80 && code <= 0xa0
    ? PDF_DOC_HIGH[code - 0x80]!
    : code >= 0x18 && code <= 0x1f
      ? PDF_DOC_LOW[code - 0x18]!
      : String.fromCharCode(code),
).join("");

function utf16be(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index + 1 < bytes.length; index += 2)
    out += String.fromCharCode((bytes[index]! << 8) | bytes[index + 1]!);
  return out;
}

/** A text string (Info values): UTF-16BE or UTF-8 with a byte-order mark, else PDFDocEncoding. */
function textString(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16be(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder().decode(bytes.subarray(3));
  let out = "";
  for (const byte of bytes) out += PDF_DOC[byte]!;
  return out;
}

/** `D:YYYYMMDDHHmmSSOHH'mm'`, every part after the year optional. */
function pdfDate(value: string): number | null {
  const match =
    /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([+\-Z])(\d{2})?'?(\d{2})?'?)?/.exec(
      value.trim(),
    );
  if (!match) return null;
  const part = (index: number, fallback: number) =>
    match[index] ? Number(match[index]) : fallback;
  const utc = Date.UTC(part(1, 0), part(2, 1) - 1, part(3, 1), part(4, 0), part(5, 0), part(6, 0));
  const sign = match[7] === "-" ? -1 : match[7] === "+" ? 1 : 0;
  const offset = sign * (part(8, 0) * 60 + part(9, 0)) * 60_000;
  const time = utc - offset;
  return Number.isFinite(time) ? time : null;
}

// ---- Fonts

/** StandardEncoding's upper half: only the characters text extraction can use. */
const STANDARD_HIGH: Readonly<Record<number, string>> = {
  0xa1: "¡",
  0xa2: "¢",
  0xa3: "£",
  0xa4: "⁄",
  0xa5: "¥",
  0xa6: "ƒ",
  0xa7: "§",
  0xa8: "¤",
  0xa9: "'",
  0xaa: "“",
  0xab: "«",
  0xac: "‹",
  0xad: "›",
  0xae: "ﬁ",
  0xaf: "ﬂ",
  0xb1: "–",
  0xb2: "†",
  0xb3: "‡",
  0xb4: "·",
  0xb6: "¶",
  0xb7: "•",
  0xb8: "‚",
  0xb9: "„",
  0xba: "”",
  0xbb: "»",
  0xbc: "…",
  0xbd: "‰",
  0xbf: "¿",
  0xd0: "—",
  0xe1: "Æ",
  0xe8: "Ł",
  0xe9: "Ø",
  0xea: "Œ",
  0xf1: "æ",
  0xf5: "ı",
  0xf8: "ł",
  0xf9: "ø",
  0xfa: "œ",
  0xfb: "ß",
};

/** The base encodings, as 256-character strings indexed by code. */
const STANDARD = Array.from({ length: 256 }, (_, code) =>
  code === 0x27
    ? "’"
    : code === 0x60
      ? "‘"
      : code >= 0x20 && code < 0x7f
        ? String.fromCharCode(code)
        : (STANDARD_HIGH[code] ?? ""),
).join("");

const BASE_ENCODINGS: Readonly<Record<string, string>> = {
  WinAnsiEncoding: WIN_ANSI,
  MacRomanEncoding: MAC_ROMAN,
  StandardEncoding: STANDARD,
  PDFDocEncoding: PDF_DOC,
};

const GLYPH_NAMES: Readonly<Record<string, string>> = {
  space: " ",
  nbspace: " ",
  exclam: "!",
  quotedbl: '"',
  numbersign: "#",
  dollar: "$",
  percent: "%",
  ampersand: "&",
  quotesingle: "'",
  quoteright: "’",
  quoteleft: "‘",
  quotedblleft: "“",
  quotedblright: "”",
  quotesinglbase: "‚",
  quotedblbase: "„",
  guillemotleft: "«",
  guillemotright: "»",
  guilsinglleft: "‹",
  guilsinglright: "›",
  parenleft: "(",
  parenright: ")",
  asterisk: "*",
  plus: "+",
  comma: ",",
  hyphen: "-",
  minus: "−",
  period: ".",
  slash: "/",
  backslash: "\\",
  colon: ":",
  semicolon: ";",
  less: "<",
  equal: "=",
  greater: ">",
  question: "?",
  questiondown: "¿",
  exclamdown: "¡",
  at: "@",
  bracketleft: "[",
  bracketright: "]",
  braceleft: "{",
  braceright: "}",
  asciicircum: "^",
  asciitilde: "~",
  underscore: "_",
  grave: "`",
  bar: "|",
  endash: "–",
  emdash: "—",
  bullet: "•",
  ellipsis: "…",
  dagger: "†",
  daggerdbl: "‡",
  trademark: "™",
  copyright: "©",
  registered: "®",
  degree: "°",
  section: "§",
  paragraph: "¶",
  multiply: "×",
  divide: "÷",
  Euro: "€",
  sterling: "£",
  yen: "¥",
  cent: "¢",
  germandbls: "ß",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  oslash: "ø",
  Oslash: "Ø",
  fi: "fi",
  fl: "fl",
  ff: "ff",
  ffi: "ffi",
  ffl: "ffl",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

const COMBINING: Readonly<Record<string, string>> = {
  acute: "́",
  grave: "̀",
  circumflex: "̂",
  dieresis: "̈",
  tilde: "̃",
  ring: "̊",
  cedilla: "̧",
  caron: "̌",
  macron: "̄",
  breve: "̆",
  ogonek: "̨",
  dotaccent: "̇",
  hungarumlaut: "̋",
};

function glyphText(glyph: string): string {
  // Suffixes (`a.sc`, `one.oldstyle`) are variants of the same character; `_` joins ligatures.
  const name = glyph.split(".")[0]!;
  if (name.includes("_")) return name.split("_").map(glyphText).join("");
  const known = GLYPH_NAMES[name];
  if (known !== undefined) return known;
  if (/^[A-Za-z]$/.test(name)) return name;
  const uni = /^uni((?:[0-9A-F]{4})+)$/.exec(name);
  if (uni)
    return uni[1]!
      .match(/.{4}/g)!
      .map((hex) => String.fromCharCode(parseInt(hex, 16)))
      .join("");
  const u = /^u([0-9A-F]{4,6})$/.exec(name);
  if (u) {
    const code = parseInt(u[1]!, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : "";
  }
  const accented =
    /^([A-Za-z])(acute|grave|circumflex|dieresis|tilde|ring|cedilla|caron|macron|breve|ogonek|dotaccent|hungarumlaut)$/.exec(
      name,
    );
  if (accented) return (accented[1]! + COMBINING[accented[2]!]!).normalize("NFC");
  return "";
}

type Shown = { text: string; width: number; spaces: number };

type FontDecoder = {
  /** Text for some shown bytes, their total glyph width (thousandths of an em), and single-byte spaces. */
  show(bytes: Uint8Array): Shown;
};

const FALLBACK_FONT: FontDecoder = {
  show: (bytes) => ({
    text: latin1(bytes),
    width: bytes.length * DEFAULT_GLYPH_WIDTH,
    spaces: bytes.filter((byte) => byte === 0x20).length,
  }),
};

/** A ToUnicode CMap: code byte length and code → text. */
type UnicodeMap = { codeBytes: number; map: Map<number, string> };

function parseToUnicode(data: Uint8Array): UnicodeMap {
  const lexer = new Lexer(data);
  const map = new Map<number, string>();
  let codeBytes = 0;
  const code = (value: Str) => value.bytes.reduce((total, byte) => total * 256 + byte, 0);
  const tokens: Token[] = [];
  for (let token = lexer.token(); token !== undefined; token = lexer.token()) {
    if (token === "[") {
      const value = parseValue(lexer, false, token);
      tokens.push(value as PdfValue);
      continue;
    }
    if (!(token instanceof Op)) {
      tokens.push(token);
      continue;
    }
    const op = token.op;
    if (op === "endcodespacerange") {
      const low = tokens.find((value): value is Str => value instanceof Str);
      if (low && !codeBytes) codeBytes = low.bytes.length;
    } else if (op === "endbfchar") {
      for (let index = 0; index + 1 < tokens.length; index += 2) {
        const source = tokens[index];
        const target = tokens[index + 1];
        if (source instanceof Str && target instanceof Str) {
          map.set(code(source), utf16be(target.bytes));
          codeBytes ||= source.bytes.length;
        }
      }
    } else if (op === "endbfrange") {
      for (let index = 0; index + 2 < tokens.length; index += 3) {
        const low = tokens[index];
        const high = tokens[index + 1];
        const target = tokens[index + 2];
        if (!(low instanceof Str) || !(high instanceof Str)) continue;
        codeBytes ||= low.bytes.length;
        const first = code(low);
        // Cap ranges: a damaged CMap must not loop over billions of codes.
        const last = Math.min(code(high), first + 0xffff);
        for (let value = first; value <= last; value++) {
          if (Array.isArray(target)) {
            const item = target[value - first];
            if (item instanceof Str) map.set(value, utf16be(item.bytes));
          } else if (target instanceof Str && target.bytes.length >= 2) {
            // The range increments the last UTF-16 unit of the destination.
            const units = utf16be(target.bytes);
            map.set(
              value,
              units.slice(0, -1) +
                String.fromCharCode(units.charCodeAt(units.length - 1) + value - first),
            );
          }
        }
      }
    }
    tokens.length = 0;
  }
  return { codeBytes: codeBytes || 1, map };
}

function makeFont(doc: PdfDocument, font: Dict): FontDecoder {
  const subtype = (doc.get(font, "Subtype") as Name | null)?.name ?? "";
  const toUnicodeStream = doc.resolve(font.get("ToUnicode"));
  const decoded = toUnicodeStream instanceof Stream ? doc.decode(toUnicodeStream) : null;
  const unicode = decoded ? parseToUnicode(decoded) : null;
  if (subtype === "Type0") {
    const descendants = doc.get(font, "DescendantFonts");
    const cidFont = doc.dict(Array.isArray(descendants) ? descendants[0] : null);
    const widths = cidWidths(doc, cidFont);
    const encoding = doc.get(font, "Encoding");
    // UCS-2/UTF-16 CMaps make the codes themselves Unicode.
    const unicodeCodes = encoding instanceof Name && /UCS2|UTF16/.test(encoding.name);
    const codeBytes = unicode?.codeBytes ?? 2;
    return {
      show(bytes) {
        let text = "";
        let width = 0;
        for (let index = 0; index + codeBytes <= bytes.length; index += codeBytes) {
          let code = 0;
          for (let byte = 0; byte < codeBytes; byte++) code = code * 256 + bytes[index + byte]!;
          text += unicode?.map.get(code) ?? (unicodeCodes ? String.fromCharCode(code) : "");
          width += widths(code);
        }
        return { text, width, spaces: 0 };
      },
    };
  }
  const table = simpleEncoding(doc, font, subtype);
  const widths = simpleWidths(doc, font, subtype);
  return {
    show(bytes) {
      let text = "";
      let width = 0;
      let spaces = 0;
      for (const byte of bytes) {
        text += unicode?.map.get(byte) ?? table[byte] ?? "";
        width += widths(byte);
        if (byte === 0x20) spaces++;
      }
      return { text, width, spaces };
    },
  };
}

function simpleEncoding(doc: PdfDocument, font: Dict, subtype: string): string[] {
  const encoding = doc.get(font, "Encoding");
  const encodingDict = isDict(encoding) ? encoding : null;
  const baseName =
    encoding instanceof Name
      ? encoding.name
      : (doc.get(encodingDict, "BaseEncoding") as Name | null)?.name;
  const base = BASE_ENCODINGS[baseName ?? ""] ?? (subtype === "TrueType" ? WIN_ANSI : STANDARD);
  const table = [...base];
  const differences = doc.get(encodingDict, "Differences");
  if (Array.isArray(differences)) {
    let code = 0;
    for (const item of differences) {
      const value = doc.resolve(item);
      if (typeof value === "number") code = value;
      else if (value instanceof Name && code < 256) table[code++] = glyphText(value.name);
    }
  }
  return table;
}

function simpleWidths(doc: PdfDocument, font: Dict, subtype: string): (code: number) => number {
  const widths = doc.get(font, "Widths");
  const first = doc.get(font, "FirstChar");
  const descriptor = doc.dict(font.get("FontDescriptor"));
  const missing = doc.get(descriptor, "MissingWidth");
  const fallback = typeof missing === "number" && missing > 0 ? missing : DEFAULT_GLYPH_WIDTH;
  // Type 3 widths are in glyph space; the font matrix maps them to text space.
  const matrix = doc.get(font, "FontMatrix");
  const scale =
    subtype === "Type3" && Array.isArray(matrix) && typeof matrix[0] === "number"
      ? matrix[0] * 1000
      : 1;
  if (!Array.isArray(widths)) return () => fallback;
  const start = typeof first === "number" ? first : 0;
  return (code) => {
    const width = doc.resolve(widths[code - start]);
    return typeof width === "number" ? width * scale : fallback;
  };
}

function cidWidths(doc: PdfDocument, cidFont: Dict | null): (code: number) => number {
  const defaultWidth = doc.get(cidFont, "DW");
  const fallback = typeof defaultWidth === "number" ? defaultWidth : DEFAULT_CID_WIDTH;
  const table = new Map<number, number>();
  const w = doc.get(cidFont, "W");
  if (Array.isArray(w)) {
    for (let index = 0; index < w.length;) {
      const first = doc.resolve(w[index]);
      const next = doc.resolve(w[index + 1]);
      if (typeof first !== "number") break;
      if (Array.isArray(next)) {
        next.forEach((width, offset) => {
          const value = doc.resolve(width);
          if (typeof value === "number") table.set(first + offset, value);
        });
        index += 2;
      } else {
        const width = doc.resolve(w[index + 2]);
        if (typeof next === "number" && typeof width === "number")
          for (let code = first; code <= Math.min(next, first + 0xffff); code++)
            table.set(code, width);
        index += 3;
      }
    }
  }
  return (code) => table.get(code) ?? fallback;
}

// ---- Text

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

type GraphicsState = {
  ctm: Matrix;
  font: FontDecoder;
  size: number;
  charSpacing: number;
  wordSpacing: number;
  scale: number;
  leading: number;
};

/** Collects page text, deciding line breaks and word gaps from where the pen moves. */
class TextCollector {
  private parts: string[] = [];
  length = 0;
  /** Where the last shown text ended, in device space, and its font size there. */
  private end: { x: number; y: number } | null = null;

  constructor(private readonly limit: number) {}

  get full(): boolean {
    return this.length >= this.limit;
  }

  push(text: string): void {
    if (!text || this.full) return;
    this.parts.push(text);
    this.length += text.length;
  }

  /** A break before text drawn at `at` (device space) with font size `size`. */
  moveTo(at: { x: number; y: number }, size: number): void {
    const end = this.end;
    if (!end) return;
    const unit = Math.max(1, size);
    if (Math.abs(at.y - end.y) > unit * NEWLINE_SHARE) this.push("\n");
    else if (at.x - end.x > unit * SPACE_SHARE) this.push(" ");
  }

  endAt(at: { x: number; y: number }): void {
    this.end = at;
  }

  breakPage(): void {
    if (this.length) this.push("\n\n");
    this.end = null;
  }

  text(): string {
    return this.parts
      .join("")
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, this.limit);
  }
}

class PageReader {
  private readonly fonts = new Map<PdfValue, FontDecoder>();

  constructor(
    private readonly doc: PdfDocument,
    private readonly out: TextCollector,
  ) {}

  read(content: Uint8Array, resources: Dict | null, depth = 0): void {
    const doc = this.doc;
    const lexer = new Lexer(content);
    const operands: Array<PdfValue> = [];
    let state: GraphicsState = {
      ctm: IDENTITY,
      font: FALLBACK_FONT,
      size: 1,
      charSpacing: 0,
      wordSpacing: 0,
      scale: 1,
      leading: 0,
    };
    const saved: GraphicsState[] = [];
    let text: Matrix = IDENTITY;
    let line: Matrix = IDENTITY;
    const number = (index: number) => {
      const value = operands[index];
      return typeof value === "number" ? value : 0;
    };
    const device = (): { x: number; y: number; size: number } => {
      const m = multiply(text, state.ctm);
      return { x: m[4], y: m[5], size: state.size * Math.hypot(m[2], m[3]) };
    };
    const moveLine = (tx: number, ty: number) => {
      line = multiply([1, 0, 0, 1, tx, ty], line);
      text = line;
    };
    const show = (bytes: Uint8Array, checkGap: boolean) => {
      const shown = state.font.show(bytes);
      if (checkGap) {
        const at = device();
        this.out.moveTo(at, at.size);
      }
      this.out.push(shown.text);
      const advance =
        ((shown.width / 1000) * state.size +
          state.charSpacing * bytes.length +
          state.wordSpacing * shown.spaces) *
        state.scale;
      text = multiply([1, 0, 0, 1, advance, 0], text);
      this.out.endAt(device());
    };
    for (let token = lexer.token(); token !== undefined && !this.out.full; token = lexer.token()) {
      if (!(token instanceof Op)) {
        const value = parseValue(lexer, false, token);
        if (!(value instanceof Op) && value !== undefined) operands.push(value);
        continue;
      }
      switch (token.op) {
        case "q":
          saved.push({ ...state });
          break;
        case "Q":
          state = saved.pop() ?? state;
          break;
        case "cm":
          if (operands.length >= 6)
            state.ctm = multiply(
              operands.slice(-6).map((value) => (typeof value === "number" ? value : 0)) as Matrix,
              state.ctm,
            );
          break;
        case "BT":
          text = line = IDENTITY;
          break;
        case "Tf": {
          const fontName = operands[operands.length - 2];
          state.size = number(operands.length - 1);
          const fonts = doc.dict(doc.get(resources, "Font"));
          state.font =
            fontName instanceof Name ? this.font(fonts?.get(fontName.name)) : FALLBACK_FONT;
          break;
        }
        case "Tc":
          state.charSpacing = number(0);
          break;
        case "Tw":
          state.wordSpacing = number(0);
          break;
        case "Tz":
          state.scale = number(0) / 100;
          break;
        case "TL":
          state.leading = number(0);
          break;
        case "Td":
          moveLine(number(0), number(1));
          break;
        case "TD":
          state.leading = -number(1);
          moveLine(number(0), number(1));
          break;
        case "Tm":
          line = text = operands
            .slice(0, 6)
            .map((value) => (typeof value === "number" ? value : 0)) as Matrix;
          break;
        case "T*":
          moveLine(0, -state.leading);
          break;
        case "Tj": {
          const value = operands[0];
          if (value instanceof Str) show(value.bytes, true);
          break;
        }
        case "'":
        case '"': {
          if (token.op === '"') {
            state.wordSpacing = number(0);
            state.charSpacing = number(1);
          }
          moveLine(0, -state.leading);
          const value = operands[operands.length - 1];
          if (value instanceof Str) show(value.bytes, true);
          break;
        }
        case "TJ": {
          const items = operands[0];
          if (!Array.isArray(items)) break;
          let first = true;
          for (const item of items) {
            if (item instanceof Str) {
              show(item.bytes, first);
              first = false;
            } else if (typeof item === "number") {
              text = multiply([1, 0, 0, 1, (-item / 1000) * state.size * state.scale, 0], text);
              if (item < TJ_SPACE_THRESHOLD) this.out.push(" ");
            }
          }
          break;
        }
        case "Do": {
          // Text often sits in form XObjects (headers, stamped pages); follow one level.
          const name = operands[0];
          if (depth > 0 || !(name instanceof Name)) break;
          const xobject = doc.resolve(doc.dict(doc.get(resources, "XObject"))?.get(name.name));
          if (!(xobject instanceof Stream)) break;
          const subtype = xobject.dict.get("Subtype");
          if (!(subtype instanceof Name) || subtype.name !== "Form") break;
          const data = doc.decode(xobject);
          if (data)
            this.read(data, doc.dict(xobject.dict.get("Resources")) ?? resources, depth + 1);
          break;
        }
        case "ID": {
          // Inline image data is binary: skip to its `EI`.
          const bytes = lexer.bytes;
          let at = lexer.pos + 1;
          while (
            at + 2 < bytes.length &&
            !(
              isWhite(bytes[at - 1]!) &&
              bytes[at] === 0x45 &&
              bytes[at + 1] === 0x49 &&
              (isWhite(bytes[at + 2]!) || at + 2 === bytes.length)
            )
          )
            at++;
          lexer.pos = at + 2;
          break;
        }
      }
      operands.length = 0;
    }
  }

  private font(value: PdfValue | undefined): FontDecoder {
    if (value === undefined || value === null) return FALLBACK_FONT;
    const key = value instanceof Ref ? (this.doc.objects.get(value.num) ?? value) : value;
    let font = this.fonts.get(key);
    if (!font) {
      const dict = this.doc.dict(value);
      font = dict ? makeFont(this.doc, dict) : FALLBACK_FONT;
      this.fonts.set(key, font);
    }
    return font;
  }
}

/** The page dictionaries in order (up to `limit`), each with its inherited resources. */
function pageList(
  doc: PdfDocument,
  root: Dict | null,
  limit: number,
): Array<{ page: Dict; resources: Dict | null }> {
  const pages: Array<{ page: Dict; resources: Dict | null }> = [];
  const visited = new Set<Dict>();
  const walk = (node: Dict | null, resources: Dict | null, depth: number) => {
    if (!node || visited.has(node) || depth > MAX_DEPTH || pages.length >= limit) return;
    visited.add(node);
    const own = doc.dict(node.get("Resources")) ?? resources;
    const kids = doc.get(node, "Kids");
    if (Array.isArray(kids)) for (const kid of kids) walk(doc.dict(kid), own, depth + 1);
    else pages.push({ page: node, resources: own });
  };
  walk(doc.dict(doc.get(root, "Pages")), null, 0);
  return pages;
}

function contents(doc: PdfDocument, page: Dict): Uint8Array | null {
  const value = doc.resolve(page.get("Contents"));
  const streams = (Array.isArray(value) ? value.map((item) => doc.resolve(item)) : [value]).filter(
    (item): item is Stream => item instanceof Stream,
  );
  const parts = streams
    .map((stream) => doc.decode(stream))
    .filter((part): part is Uint8Array => !!part);
  if (!parts.length) return null;
  // Streams split mid-operator are joined with whitespace, as the spec requires.
  return Buffer.concat(parts.flatMap((part) => [part, Buffer.from("\n")]));
}

export function readPdf(
  bytes: Uint8Array,
  options: { maxTextChars?: number; maxPages?: number } = {},
): PdfInfo {
  if (!latin1(bytes.subarray(0, HEADER_WINDOW)).includes("%PDF-"))
    throw new Error("This file is not a PDF.");
  const doc = new PdfDocument(bytes);
  const encrypted = doc.encrypted;
  let root = doc.dict(doc.trailer.get("Root"));
  if (!root)
    for (const object of doc.objects.values()) {
      const type = isDict(object) ? object.get("Type") : null;
      if (type instanceof Name && type.name === "Catalog") {
        root = object as Dict;
        break;
      }
    }
  const info = doc.dict(doc.trailer.get("Info"));
  const field = (key: string) => {
    const value = doc.get(info, key);
    if (encrypted || !(value instanceof Str)) return null;
    return textString(value.bytes).replace(/\0/g, "").trim() || null;
  };
  const count = doc.get(doc.dict(doc.get(root, "Pages")), "Count");
  let pages = typeof count === "number" && count > 0 ? count : null;
  if (pages === null) {
    let found = 0;
    for (const object of doc.objects.values()) {
      const dict = object instanceof Stream ? null : isDict(object) ? object : null;
      const type = dict?.get("Type");
      if (type instanceof Name && type.name === "Page") found++;
    }
    pages = found || null;
  }
  const out = new TextCollector(options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS);
  if (!encrypted) {
    const reader = new PageReader(doc, out);
    for (const { page, resources } of pageList(doc, root, options.maxPages ?? DEFAULT_MAX_PAGES)) {
      if (out.full) break;
      const data = contents(doc, page);
      if (data) reader.read(data, resources);
      out.breakPage();
    }
  }
  const created = field("CreationDate");
  return {
    pages,
    title: field("Title"),
    author: field("Author"),
    subject: field("Subject"),
    creator: field("Creator"),
    producer: field("Producer"),
    created: created ? pdfDate(created) : null,
    encrypted,
    text: out.text(),
  };
}

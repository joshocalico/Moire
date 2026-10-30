/**
 * The Moire login protocol (version 1): greeter ↔ moire-dm.
 *
 * Binary, little-endian, one message per frame:
 *
 *   u32 length (of everything after it) | u8 version | u8 type | body
 *
 * Body fields have fixed order and kinds: u8, text (u16 length + UTF-8, no control
 * characters) and bytes (u16 length + raw bytes, used only for answers). A body must be
 * consumed exactly; a short, long, unknown or wrong-version message is a violation. Answers stay
 * bytes from the greeter's encoder to libpam, so no process on moire-dm's side ever turns a
 * password into a JS string.
 *
 * Requests (greeter → moire-dm)       Replies (moire-dm → greeter)
 *   0x01 begin    account:text          0x81 prompt     style:u8 text:text
 *   0x02 answer   0 | 1 bytes           0x82 authorized
 *   0x03 start    session:text          0x83 scheduled
 *   0x04 cancel                         0x84 cancelled
 *   0x05 sessions                       0x85 error      code:u8
 *                                       0x86 sessions   n:u8 (id:text label:text)×n
 */

export const PROTOCOL_VERSION = 1;
const LENGTH_BYTES = 4;
/** version + type */
const MIN_MESSAGE_BYTES = 2;
/** The largest message is a full session list; a password frame is a few hundred bytes. */
export const MAX_MESSAGE_BYTES = 4096;
/** Matches PAM_MAX_RESP_SIZE; libpam would refuse longer answers anyway. */
export const MAX_ANSWER_BYTES = 512;
/** systemd and shadow cap user names at 32 bytes. */
export const MAX_ACCOUNT_BYTES = 32;
const MAX_SESSION_ID_BYTES = 64;
const MAX_LABEL_BYTES = 128;
/** PAM_MAX_MSG_SIZE */
const MAX_PROMPT_BYTES = 512;
const MAX_SESSIONS = 16;

const BEGIN = 0x01;
const ANSWER = 0x02;
const START = 0x03;
const CANCEL = 0x04;
const SESSIONS = 0x05;
const PROMPT = 0x81;
const AUTHORIZED = 0x82;
const SCHEDULED = 0x83;
const CANCELLED = 0x84;
const ERROR = 0x85;
const SESSION_LIST = 0x86;

export type PromptStyle = "secret" | "visible" | "info" | "error";
const STYLES: readonly PromptStyle[] = ["secret", "visible", "info", "error"];

/** Typed failure codes; the greeter maps these to its own sentences. */
export type ErrorCode =
  | "denied"
  | "busy"
  | "bad-state"
  | "unknown-session"
  | "unavailable"
  | "protocol"
  | "version";
const ERRORS: readonly ErrorCode[] = [
  "denied",
  "busy",
  "bad-state",
  "unknown-session",
  "unavailable",
  "protocol",
  "version",
];

export type SessionEntry = Readonly<{ id: string; label: string }>;

export type GreeterRequest =
  | Readonly<{ type: "begin"; account: string }>
  /** Bytes for a secret or visible prompt; null acknowledges an info or error message. */
  | Readonly<{ type: "answer"; response: Uint8Array | null }>
  | Readonly<{ type: "start"; session: string }>
  | Readonly<{ type: "cancel" }>
  | Readonly<{ type: "sessions" }>;

export type GreeterReply =
  | Readonly<{ type: "prompt"; style: PromptStyle; text: string }>
  | Readonly<{ type: "authorized" }>
  | Readonly<{ type: "scheduled" }>
  | Readonly<{ type: "cancelled" }>
  | Readonly<{ type: "error"; code: ErrorCode }>
  | Readonly<{ type: "sessions"; sessions: readonly SessionEntry[] }>;

export type Violation = "frame-length" | "frame-overflow" | "version" | "shape";

export type ParseResult =
  | Readonly<{ ok: true; request: GreeterRequest }>
  | Readonly<{ ok: false; violation: Violation }>;

const utf8 = new TextDecoder("utf-8", { fatal: true });

function hasControl(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Strict cursor over one message body. Every read checks bounds; `end()` demands exactness. */
class Reader {
  private offset = 2;
  constructor(private readonly message: Uint8Array) {}
  get type(): number {
    return this.message[1]!;
  }
  get version(): number {
    return this.message[0]!;
  }
  u8(): number | null {
    return this.offset < this.message.length ? this.message[this.offset++]! : null;
  }
  private u16(): number | null {
    if (this.offset + 2 > this.message.length) return null;
    const value = this.message[this.offset]! | (this.message[this.offset + 1]! << 8);
    this.offset += 2;
    return value;
  }
  /** A fresh copy the caller owns (and wipes, for answers). */
  bytes(max: number): Uint8Array | null {
    const length = this.u16();
    if (length === null || length > max || this.offset + length > this.message.length) return null;
    // A plain Uint8Array copy whatever the input class, so callers own (and wipe) exactly this.
    const value = new Uint8Array(this.message.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }
  text(max: number): string | null {
    const raw = this.bytes(max);
    if (!raw) return null;
    try {
      const value = utf8.decode(raw);
      return hasControl(value) ? null : value;
    } catch {
      return null;
    }
  }
  end(): boolean {
    return this.offset === this.message.length;
  }
}

class Writer {
  private readonly parts: Uint8Array[] = [];
  constructor(type: number) {
    this.parts.push(Uint8Array.of(PROTOCOL_VERSION, type));
  }
  u8(value: number): this {
    this.parts.push(Uint8Array.of(value));
    return this;
  }
  bytes(value: Uint8Array): this {
    this.parts.push(Uint8Array.of(value.byteLength & 0xff, value.byteLength >> 8), value);
    return this;
  }
  text(value: string): this {
    return this.bytes(Buffer.from(value, "utf8"));
  }
  /** The message without its length prefix (what the front forwards to the broker). */
  message(): Buffer {
    return Buffer.concat(this.parts);
  }
  frame(): Buffer {
    const body = this.message();
    const out = Buffer.alloc(LENGTH_BYTES + body.length);
    out.writeUInt32LE(body.length, 0);
    body.copy(out, LENGTH_BYTES);
    body.fill(0);
    return out;
  }
}

/**
 * Decode one request message (version, type, body; no length prefix). The caller wipes
 * `message` afterwards; on success the only secret left is `request.response`, a fresh array.
 */
export function parseRequest(message: Uint8Array): ParseResult {
  if (message.length < MIN_MESSAGE_BYTES || message.length > MAX_MESSAGE_BYTES)
    return { ok: false, violation: "frame-length" };
  const reader = new Reader(message);
  if (reader.version !== PROTOCOL_VERSION) return { ok: false, violation: "version" };
  const shape: ParseResult = { ok: false, violation: "shape" };
  switch (reader.type) {
    case BEGIN: {
      const account = reader.text(MAX_ACCOUNT_BYTES);
      return account && reader.end() ? { ok: true, request: { type: "begin", account } } : shape;
    }
    case ANSWER: {
      const flag = reader.u8();
      if (flag === 0)
        return reader.end() ? { ok: true, request: { type: "answer", response: null } } : shape;
      if (flag !== 1) return shape;
      const response = reader.bytes(MAX_ANSWER_BYTES);
      if (response && reader.end() && !response.includes(0))
        return { ok: true, request: { type: "answer", response } };
      response?.fill(0);
      return shape;
    }
    case START: {
      const session = reader.text(MAX_SESSION_ID_BYTES);
      return session && reader.end() ? { ok: true, request: { type: "start", session } } : shape;
    }
    case CANCEL:
      return reader.end() ? { ok: true, request: { type: "cancel" } } : shape;
    case SESSIONS:
      return reader.end() ? { ok: true, request: { type: "sessions" } } : shape;
    default:
      return shape;
  }
}

function requestWriter(request: GreeterRequest): Writer {
  switch (request.type) {
    case "begin":
      return new Writer(BEGIN).text(request.account);
    case "answer":
      return request.response === null
        ? new Writer(ANSWER).u8(0)
        : new Writer(ANSWER).u8(1).bytes(request.response);
    case "start":
      return new Writer(START).text(request.session);
    case "cancel":
      return new Writer(CANCEL);
    case "sessions":
      return new Writer(SESSIONS);
  }
}

/** Greeter side: a full frame. The caller wipes it after writing if it carries an answer. */
export function encodeRequest(request: GreeterRequest): Buffer {
  return requestWriter(request).frame();
}

/** Front side: the validated request re-encoded from typed values, without a length prefix. */
export function encodeRequestMessage(request: GreeterRequest): Buffer {
  return requestWriter(request).message();
}

function replyWriter(reply: GreeterReply): Writer {
  switch (reply.type) {
    case "prompt":
      return new Writer(PROMPT)
        .u8(STYLES.indexOf(reply.style) + 1)
        .text(sanitize(reply.text, MAX_PROMPT_BYTES));
    case "authorized":
      return new Writer(AUTHORIZED);
    case "scheduled":
      return new Writer(SCHEDULED);
    case "cancelled":
      return new Writer(CANCELLED);
    case "error":
      return new Writer(ERROR).u8(ERRORS.indexOf(reply.code) + 1);
    case "sessions": {
      const writer = new Writer(SESSION_LIST).u8(Math.min(reply.sessions.length, MAX_SESSIONS));
      for (const entry of reply.sessions.slice(0, MAX_SESSIONS))
        writer.text(entry.id).text(sanitize(entry.label, MAX_LABEL_BYTES));
      return writer;
    }
  }
}

export function encodeReply(reply: GreeterReply): Buffer {
  return replyWriter(reply).frame();
}

export function encodeReplyMessage(reply: GreeterReply): Buffer {
  return replyWriter(reply).message();
}

/** PAM text can hold terminal escapes; replace controls and cut to the field's byte limit. */
function sanitize(text: string, maxBytes: number): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    const next = code < 0x20 || code === 0x7f ? " " : char;
    if (Buffer.byteLength(out + next) > maxBytes) break;
    out += next;
  }
  return out;
}

/** Decode one reply message (no length prefix); null for anything unexpected. */
export function decodeReply(message: Uint8Array): GreeterReply | null {
  if (message.length < MIN_MESSAGE_BYTES || message.length > MAX_MESSAGE_BYTES) return null;
  const reader = new Reader(message);
  if (reader.version !== PROTOCOL_VERSION) return null;
  const exact = (reply: GreeterReply) => (reader.end() ? reply : null);
  switch (reader.type) {
    case PROMPT: {
      const style = STYLES[(reader.u8() ?? 0) - 1];
      const text = reader.text(MAX_PROMPT_BYTES);
      return style && text !== null ? exact({ type: "prompt", style, text }) : null;
    }
    case AUTHORIZED:
      return exact({ type: "authorized" });
    case SCHEDULED:
      return exact({ type: "scheduled" });
    case CANCELLED:
      return exact({ type: "cancelled" });
    case ERROR: {
      const code = ERRORS[(reader.u8() ?? 0) - 1];
      return code ? exact({ type: "error", code }) : null;
    }
    case SESSION_LIST: {
      const count = reader.u8();
      if (count === null || count > MAX_SESSIONS) return null;
      const sessions: SessionEntry[] = [];
      for (let index = 0; index < count; index++) {
        const id = reader.text(MAX_SESSION_ID_BYTES);
        const label = reader.text(MAX_LABEL_BYTES);
        if (!id || label === null) return null;
        sessions.push({ id, label });
      }
      return exact({ type: "sessions", sessions });
    }
    default:
      return null;
  }
}

export type FrameEvent =
  | Readonly<{ kind: "message"; message: Buffer }>
  | Readonly<{ kind: "violation"; violation: Violation }>;

/**
 * Reassembles length-prefixed messages into one fixed buffer, so a password never sits in a
 * chain of Buffer.concat copies. Incoming chunks are wiped once copied; the region a message
 * occupied is wiped once it is handed out. Used by the front (greeter side) and by clients.
 */
export class FrameReader {
  private readonly buffer: Buffer;
  private used = 0;
  constructor(private readonly maxMessageBytes = MAX_MESSAGE_BYTES) {
    this.buffer = Buffer.alloc(LENGTH_BYTES + maxMessageBytes);
  }

  push(chunk: Buffer): FrameEvent[] {
    const events: FrameEvent[] = [];
    try {
      if (this.used + chunk.length > this.buffer.length) {
        events.push({ kind: "violation", violation: "frame-overflow" });
        return events;
      }
      chunk.copy(this.buffer, this.used);
      this.used += chunk.length;
      while (this.used >= LENGTH_BYTES) {
        const length = this.buffer.readUInt32LE(0);
        if (length < MIN_MESSAGE_BYTES || length > this.maxMessageBytes) {
          events.push({ kind: "violation", violation: "frame-length" });
          return events;
        }
        if (this.used < LENGTH_BYTES + length) break;
        const message = Buffer.alloc(length);
        this.buffer.copy(message, 0, LENGTH_BYTES, LENGTH_BYTES + length);
        const rest = this.used - LENGTH_BYTES - length;
        this.buffer.copy(this.buffer, 0, LENGTH_BYTES + length, this.used);
        this.buffer.fill(0, rest, this.used);
        this.used = rest;
        events.push({ kind: "message", message });
      }
      return events;
    } finally {
      chunk.fill(0);
    }
  }

  wipe(): void {
    this.buffer.fill(0);
    this.used = 0;
  }
}

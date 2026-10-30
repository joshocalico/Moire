/**
 * Front (unprivileged, greeter-facing) ↔ broker (root) messages over the front's fd 3.
 *
 * The front never forwards greeter bytes. It parses each greeter frame itself, then sends the
 * broker a request it re-encoded from typed values (`encodeRequestMessage`). The broker decodes
 * that with the same strict parser, as a second check, so a compromised front can still only
 * hand root a well-formed request.
 *
 * Frame: u32 LE length (of everything after it) | u8 kind | u32 LE connection | message
 */

const LENGTH_BYTES = 4;
const HEADER_BYTES = LENGTH_BYTES + 1 + 4;
/** A protocol message plus the kind and connection id. */
const MAX_FRAME_BYTES = 5 + 4096;

export type FrontEvent =
  /** The greeter socket is listening (connection is 0). */
  | Readonly<{ kind: "ready"; connection: number }>
  | Readonly<{ kind: "connected"; connection: number }>
  | Readonly<{ kind: "disconnected"; connection: number }>
  | Readonly<{ kind: "violation"; connection: number }>
  /** `message` is a protocol message (version, type, body) the broker must parse itself. */
  | Readonly<{ kind: "request"; connection: number; message: Buffer }>;

export type BrokerCommand =
  | Readonly<{ kind: "reply"; connection: number; message: Buffer }>
  | Readonly<{ kind: "close"; connection: number }>;

const CONNECTED = 1;
const DISCONNECTED = 2;
const VIOLATION = 3;
const REQUEST = 4;
const REPLY = 5;
const CLOSE = 6;
const READY = 7;

function frame(kind: number, connection: number, message?: Uint8Array): Buffer {
  const length = 1 + 4 + (message?.byteLength ?? 0);
  const out = Buffer.alloc(LENGTH_BYTES + length);
  out.writeUInt32LE(length, 0);
  out[4] = kind;
  out.writeUInt32LE(connection >>> 0, 5);
  if (message) out.set(message, HEADER_BYTES);
  return out;
}

export function encodeFrontEvent(event: FrontEvent): Buffer {
  switch (event.kind) {
    case "ready":
      return frame(READY, 0);
    case "connected":
      return frame(CONNECTED, event.connection);
    case "disconnected":
      return frame(DISCONNECTED, event.connection);
    case "violation":
      return frame(VIOLATION, event.connection);
    case "request":
      return frame(REQUEST, event.connection, event.message);
  }
}

export function encodeBrokerCommand(command: BrokerCommand): Buffer {
  return command.kind === "reply"
    ? frame(REPLY, command.connection, command.message)
    : frame(CLOSE, command.connection);
}

type Raw = Readonly<{ kind: number; connection: number; message: Buffer }>;

/**
 * Bounded reassembly for either direction. Consumed bytes are wiped (requests carry answers).
 * Returns null on a framing violation; the reader of a broken channel kills the other side.
 */
export class ChannelReader {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer): Raw[] | null {
    const joined = Buffer.concat([this.buffer, chunk]);
    this.buffer.fill(0);
    chunk.fill(0);
    this.buffer = joined;
    const out: Raw[] = [];
    let offset = 0;
    while (this.buffer.length - offset >= LENGTH_BYTES) {
      const length = this.buffer.readUInt32LE(offset);
      if (length < 5 || length > MAX_FRAME_BYTES) return null;
      if (this.buffer.length - offset < LENGTH_BYTES + length) break;
      const start = offset + LENGTH_BYTES;
      out.push({
        kind: this.buffer[start]!,
        connection: this.buffer.readUInt32LE(start + 1),
        message: Buffer.from(this.buffer.subarray(start + 5, start + length)),
      });
      offset += LENGTH_BYTES + length;
    }
    const rest = Buffer.from(this.buffer.subarray(offset));
    this.buffer.fill(0);
    this.buffer = rest;
    return out;
  }
  wipe(): void {
    this.buffer.fill(0);
    this.buffer = Buffer.alloc(0);
  }
}

export function decodeFrontEvent(raw: Raw): FrontEvent | null {
  const empty = raw.message.length === 0;
  if (raw.kind === READY && empty && raw.connection === 0) return { kind: "ready", connection: 0 };
  if (raw.kind === CONNECTED && empty) return { kind: "connected", connection: raw.connection };
  if (raw.kind === DISCONNECTED && empty)
    return { kind: "disconnected", connection: raw.connection };
  if (raw.kind === VIOLATION && empty) return { kind: "violation", connection: raw.connection };
  if (raw.kind === REQUEST && !empty)
    return { kind: "request", connection: raw.connection, message: raw.message };
  return null;
}

export function decodeBrokerCommand(raw: Raw): BrokerCommand | null {
  if (raw.kind === REPLY && raw.message.length > 0)
    return { kind: "reply", connection: raw.connection, message: raw.message };
  if (raw.kind === CLOSE && raw.message.length === 0)
    return { kind: "close", connection: raw.connection };
  return null;
}

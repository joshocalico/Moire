/**
 * Daemon ↔ session worker messages over the worker's fd 3 (a socketpair from spawn).
 *
 * Both ends are moire-dm's own root processes, but frames are still bounded and validated: a
 * worker runs PAM modules, and a confused worker must not be able to wedge the daemon. Answers
 * travel as raw bytes in their own frame type so no password becomes a JS string or JSON text.
 *
 * Frame: u32 little-endian length (type byte + payload), u8 type, payload.
 */
import fs from "node:fs";
import type { PromptStyle } from "./protocol";

const HEADER_BYTES = 5;
const MAX_PAYLOAD_BYTES = 64 * 1024;
/** Poll interval when the worker's blocking read meets a non-blocking descriptor. */
const RETRY_SLEEP_MS = 10;

export type SessionSpec = Readonly<{
  id: string;
  /** What the greeter shows; also the catalog's order is the greeter's default choice. */
  label: string;
  argv: readonly [string, ...string[]];
  /** XDG_SESSION_DESKTOP / XDG_CURRENT_DESKTOP. */
  desktop: string;
}>;

export type WorkerJob = Readonly<{
  /** PAM service: moire-dm, moire-dm-autologin or moire-dm-greeter. */
  service: string;
  user: string;
  /** "authenticate" runs pam_authenticate through the greeter; "trusted" never prompts. */
  mode: "authenticate" | "trusted";
  sessionClass: "user" | "greeter";
  /** Started without asking the daemon (greeter and automatic login). */
  session: SessionSpec | null;
  vt: number;
  /** Greeter jobs only: the socket the greeter connects back to. */
  greeterSocket: string | null;
}>;

export type WorkerCommand =
  | Readonly<{ kind: "answer"; response: Uint8Array | null }>
  | Readonly<{ kind: "start"; session: SessionSpec }>
  | Readonly<{ kind: "cancel" }>;

/** Reasons are fixed codes; PAM's own error strings never cross this boundary. */
export type WorkerFailure =
  | "pam-start"
  | "account"
  | "credentials"
  | "session"
  | "launch"
  | "protocol";

export type WorkerEvent =
  | Readonly<{ kind: "prompt"; style: PromptStyle; text: string }>
  | Readonly<{ kind: "authorized"; user: string }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "failed"; reason: WorkerFailure }>
  | Readonly<{ kind: "started"; pid: number }>
  | Readonly<{ kind: "ended"; status: number | null }>;

const TYPE_JSON = 1;
const TYPE_ANSWER = 2;
const TYPE_NULL_ANSWER = 3;

function frame(type: number, payload: Uint8Array): Buffer {
  const out = Buffer.alloc(HEADER_BYTES + payload.byteLength);
  out.writeUInt32LE(1 + payload.byteLength, 0);
  out[4] = type;
  out.set(payload, HEADER_BYTES);
  return out;
}

function json(value: object): Buffer {
  return frame(TYPE_JSON, Buffer.from(JSON.stringify(value), "utf8"));
}

/** The caller wipes the returned frame after writing it if it carries an answer. */
export function encodeCommand(command: WorkerCommand | WorkerJob): Buffer {
  if ("kind" in command && command.kind === "answer")
    return command.response === null
      ? frame(TYPE_NULL_ANSWER, new Uint8Array(0))
      : frame(TYPE_ANSWER, command.response);
  return json(command);
}

export function encodeEvent(event: WorkerEvent): Buffer {
  return json(event);
}

const STYLES: readonly PromptStyle[] = ["visible", "secret", "info", "error"];
const FAILURES: readonly WorkerFailure[] = [
  "pam-start",
  "account",
  "credentials",
  "session",
  "launch",
  "protocol",
];

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !value.includes("\0");
}

export function validSession(value: unknown): value is SessionSpec {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return (
    isText(session.id, 64) &&
    /^[a-z0-9][a-z0-9._-]*$/.test(session.id) &&
    isText(session.label, 128) &&
    isText(session.desktop, 64) &&
    Array.isArray(session.argv) &&
    session.argv.length >= 1 &&
    session.argv.length <= 32 &&
    session.argv.every((arg) => isText(arg, 4096)) &&
    typeof session.argv[0] === "string" &&
    session.argv[0].startsWith("/")
  );
}

function parseJson(payload: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function decodeEvent(type: number, payload: Uint8Array): WorkerEvent | null {
  if (type !== TYPE_JSON) return null;
  const event = parseJson(payload);
  if (!event) return null;
  switch (event.kind) {
    case "prompt":
      return STYLES.includes(event.style as PromptStyle) && isText(event.text, 512)
        ? { kind: "prompt", style: event.style as PromptStyle, text: event.text }
        : null;
    case "authorized":
      return isText(event.user, 32) ? { kind: "authorized", user: event.user } : null;
    case "denied":
    case "cancelled":
      return { kind: event.kind };
    case "failed":
      return FAILURES.includes(event.reason as WorkerFailure)
        ? { kind: "failed", reason: event.reason as WorkerFailure }
        : null;
    case "started":
      return Number.isSafeInteger(event.pid) && (event.pid as number) > 0
        ? { kind: "started", pid: event.pid as number }
        : null;
    case "ended":
      return event.status === null || Number.isSafeInteger(event.status)
        ? { kind: "ended", status: event.status as number | null }
        : null;
    default:
      return null;
  }
}

function validJob(value: Record<string, unknown>): value is WorkerJob & Record<string, unknown> {
  return (
    isText(value.service, 64) &&
    /^[a-z0-9-]+$/.test(value.service) &&
    isText(value.user, 32) &&
    (value.mode === "authenticate" || value.mode === "trusted") &&
    (value.sessionClass === "user" || value.sessionClass === "greeter") &&
    (value.session === null || validSession(value.session)) &&
    Number.isSafeInteger(value.vt) &&
    (value.vt as number) >= 1 &&
    (value.vt as number) <= 63 &&
    (value.greeterSocket === null ||
      (isText(value.greeterSocket, 107) && value.greeterSocket.startsWith("/")))
  );
}

export function decodeJob(type: number, payload: Uint8Array): WorkerJob | null {
  if (type !== TYPE_JSON) return null;
  const job = parseJson(payload);
  return job && validJob(job) ? job : null;
}

export function decodeCommand(type: number, payload: Uint8Array): WorkerCommand | null {
  if (type === TYPE_NULL_ANSWER)
    return payload.byteLength === 0 ? { kind: "answer", response: null } : null;
  // The payload is a fresh copy owned by the caller from here; it becomes the answer itself.
  if (type === TYPE_ANSWER) return { kind: "answer", response: payload };
  if (type !== TYPE_JSON) return null;
  const command = parseJson(payload);
  if (!command) return null;
  if (command.kind === "cancel") return { kind: "cancel" };
  if (command.kind === "start" && validSession(command.session))
    return { kind: "start", session: command.session };
  return null;
}

export type RawFrame = Readonly<{ type: number; payload: Buffer }>;

/** Daemon side: incremental, bounded reassembly of worker frames from an async stream. */
export class FrameAssembler {
  private pending = Buffer.alloc(0);
  push(chunk: Buffer): RawFrame[] | null {
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: RawFrame[] = [];
    while (this.pending.length >= HEADER_BYTES) {
      const length = this.pending.readUInt32LE(0);
      if (length < 1 || length - 1 > MAX_PAYLOAD_BYTES) return null;
      if (this.pending.length < 4 + length) break;
      frames.push({
        type: this.pending[4]!,
        payload: Buffer.from(this.pending.subarray(HEADER_BYTES, 4 + length)),
      });
      this.pending = this.pending.subarray(4 + length);
    }
    return frames;
  }
}

function readExactly(fd: number, target: Buffer): boolean {
  let offset = 0;
  while (offset < target.length) {
    let count: number;
    try {
      count = fs.readSync(fd, target, offset, target.length - offset, null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EAGAIN") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_SLEEP_MS);
        continue;
      }
      return false;
    }
    if (count === 0) return false;
    offset += count;
  }
  return true;
}

/**
 * Worker side: block until one frame arrives. Blocking is the point: PAM's conversation is
 * synchronous, so the worker waits inside it for the greeter's answer. Null on EOF or a bad
 * frame; the worker then fails closed.
 */
export function readFrameSync(fd: number): RawFrame | null {
  const header = Buffer.alloc(HEADER_BYTES);
  if (!readExactly(fd, header)) return null;
  const length = header.readUInt32LE(0);
  if (length < 1 || length - 1 > MAX_PAYLOAD_BYTES) return null;
  const payload = Buffer.alloc(length - 1);
  if (!readExactly(fd, payload)) {
    payload.fill(0);
    return null;
  }
  return { type: header[4]!, payload };
}

export function writeFrameSync(fd: number, data: Buffer): boolean {
  let offset = 0;
  while (offset < data.length) {
    try {
      offset += fs.writeSync(fd, data, offset, data.length - offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EAGAIN") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_SLEEP_MS);
        continue;
      }
      return false;
    }
  }
  return true;
}

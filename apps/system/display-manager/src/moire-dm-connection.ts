import net from "node:net";
import path from "node:path";
import {
  FrameReader,
  decodeReply,
  encodeRequest,
  type GreeterReply,
  type GreeterRequest,
} from "@moire/moire-dm/protocol";

/**
 * One greeter connection to moire-dm speaking the Moire login protocol: one request at a time,
 * strict reply decoding, a timeout per request. Answers are encoded from bytes and the frame
 * carrying them is wiped once written. Both greeter-facing adapters build on this:
 * `moire-dm-client.ts` (the greeter's client) and `moire-dm-broker.ts` (`LoginBroker`).
 */
export type MoireDmConnection = {
  exchange(request: GreeterRequest): Promise<GreeterReply>;
  readonly closed: boolean;
  close(): void;
};

/** moire-dm holds a locked-out attempt for 20 s before replying; leave room for that. */
export const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 10;
const MAX_TIMEOUT_MS = 60_000;
const MAX_SOCKET_PATH_BYTES = 107;

function hasControl(value: string): boolean {
  return Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

export async function connectMoireDmSocket(
  socketPath: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<MoireDmConnection> {
  if (
    typeof socketPath !== "string" ||
    !path.isAbsolute(socketPath) ||
    path.normalize(socketPath) !== socketPath ||
    Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES ||
    hasControl(socketPath) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  )
    throw new Error("Invalid moire-dm connection options");

  const socket = net.connect(socketPath);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(fail, timeoutMs);
    function fail() {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error("moire-dm is unavailable"));
    }
    socket.once("error", fail);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeListener("error", fail);
      resolve();
    });
  });

  const reader = new FrameReader();
  let closed = false;
  let waiter: {
    resolve: (reply: GreeterReply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  function close(): void {
    if (closed) return;
    closed = true;
    reader.wipe();
    const current = waiter;
    waiter = null;
    if (current) {
      clearTimeout(current.timer);
      current.reject(new Error("moire-dm connection closed"));
    }
    socket.destroy();
  }
  socket.on("error", close);
  socket.on("close", close);
  socket.on("data", (chunk: Buffer) => {
    for (const event of reader.push(chunk)) {
      const current = waiter;
      const reply = event.kind === "message" ? decodeReply(event.message) : null;
      // A reply nobody asked for, or one that doesn't decode, ends the connection.
      if (!current || !reply) return close();
      waiter = null;
      clearTimeout(current.timer);
      current.resolve(reply);
    }
  });

  return {
    get closed() {
      return closed;
    },
    exchange(request) {
      if (closed || waiter) return Promise.reject(new Error("moire-dm request is unavailable"));
      const frame = encodeRequest(request);
      const reply = new Promise<GreeterReply>((resolve, reject) => {
        waiter = { resolve, reject, timer: setTimeout(close, timeoutMs) };
      });
      socket.write(frame, () => frame.fill(0));
      return reply;
    },
    close,
  };
}

/** UTF-8 bytes for an answer; the caller's string can't be wiped, but every copy we make is. */
export function answerBytes(response: string): Uint8Array {
  return new TextEncoder().encode(response);
}

/**
 * The byte stream under the protocol. On Linux it is the recvmsg/sendmsg + SCM_RIGHTS connection
 * the Wayland code uses (`WaylandClientConn` from `@moire/sys`), so fds that arrive with a message
 * are seen and closed. Elsewhere (and when a test asks) a plain `net.Socket` carries the bytes;
 * the kernel discards fds sent to a socket read without ancillary data.
 */
import net from "node:net";
import path from "node:path";

export type TransportHandlers = {
  onData(data: Uint8Array, fds: readonly number[]): void;
  onClose(error?: Error): void;
};

export type Transport = {
  /** Whether fds can be sent and are received; without it received fds are dropped. */
  readonly fdPassing: boolean;
  send(data: Uint8Array, fds?: readonly number[]): boolean;
  closeFd(fd: number): void;
  close(): void;
};

export type TransportFactory = (
  socketPath: string,
  handlers: TransportHandlers,
) => Promise<Transport>;

/** Connecting failed in a way that means PipeWire isn't there (no socket, refused, no access). */
export class TransportUnavailable extends Error {}

/** Where `pw_context_connect` looks: `PIPEWIRE_REMOTE`, then the runtime dir's `pipewire-0`. */
export function pipewireSocketPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const remote = env.PIPEWIRE_REMOTE;
  const name = remote && !remote.startsWith("[") ? remote : "pipewire-0";
  if (path.isAbsolute(name)) return name;
  const dir = env.PIPEWIRE_RUNTIME_DIR || env.XDG_RUNTIME_DIR || env.USERPROFILE;
  return dir ? path.join(dir, name) : null;
}

const UNAVAILABLE = new Set(["ENOENT", "ECONNREFUSED", "EACCES", "ENOTSOCK", "ENOTDIR"]);

function connectSocket(socketPath: string, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Connecting to PipeWire timed out"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        error.code && UNAVAILABLE.has(error.code)
          ? new TransportUnavailable(`PipeWire isn't running (${error.code}).`)
          : error,
      );
    });
  });
}

/** Bytes only, over libuv: for tests and non-Linux hosts. */
export function socketTransport(timeoutMs = 1500): TransportFactory {
  return async (socketPath, handlers) => {
    const socket = await connectSocket(socketPath, timeoutMs);
    let closed = false;
    const finish = (error?: Error) => {
      if (closed) return;
      closed = true;
      handlers.onClose(error);
    };
    socket.on("data", (chunk: Buffer) => handlers.onData(chunk, []));
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish());
    return {
      fdPassing: false,
      send(data, fds = []) {
        if (closed || fds.length) return false;
        // A false return is backpressure, not loss: the bytes are queued.
        socket.write(data);
        return true;
      },
      closeFd() {},
      close() {
        socket.destroy();
        finish();
      },
    };
  };
}

/** recvmsg/sendmsg with SCM_RIGHTS on Linux, through `@moire/sys`. */
export function unixFdTransport(timeoutMs = 1500): TransportFactory {
  return async (socketPath, handlers) => {
    const sys = await import("@moire/sys");
    const socket = await connectSocket(socketPath, timeoutMs);
    const conn = new sys.WaylandClientConn(socket);
    let closed = false;
    const finish = (error?: Error) => {
      if (closed) return;
      closed = true;
      handlers.onClose(error);
    };
    conn.on("message", (chunk: { data: Buffer; fds: number[] }) =>
      handlers.onData(chunk.data, chunk.fds),
    );
    conn.on("error", (error: Error) => finish(error));
    conn.on("close", () => finish());
    return {
      fdPassing: true,
      send(data, fds = []) {
        return (
          !closed && conn.send(Buffer.from(data.buffer, data.byteOffset, data.length), [...fds])
        );
      },
      closeFd(fd) {
        if (fd >= 0) sys.closeFd(fd);
      },
      close() {
        conn.close();
        finish();
      },
    };
  };
}

export const defaultTransport: TransportFactory = (socketPath, handlers) =>
  (process.platform === "linux" ? unixFdTransport() : socketTransport())(socketPath, handlers);

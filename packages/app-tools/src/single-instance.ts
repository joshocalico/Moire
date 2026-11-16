/**
 * Single-instance apps (`SingleMainWindow=true`): the first process owns a socket in the user's
 * runtime directory; a later start of the same app hands its launch request (a deep link, say)
 * to that process and exits, so the app keeps one main window.
 *
 * The shell raises the open window itself when it launches the app; this lock covers every other
 * start (a second launch racing the first window, other apps, a terminal). A start that was given
 * an xdg-activation token (`XDG_ACTIVATION_TOKEN`, set by whoever launched it) passes the token
 * along with the request, so the running window can ask the compositor to come to the front.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Requests are a few hundred bytes; anything larger is not one of ours. */
const MAX_REQUEST_BYTES = 64 * 1024;
/** How long a second start waits for the running instance before starting its own window. */
const FORWARD_TIMEOUT_MS = 2000;

/** A later start's request, and the activation token it was launched with (or null). */
export type RequestListener<Request> = (request: Request, activationToken: string | null) => void;

export type SingleInstance<Request> =
  | {
      kind: "primary";
      /**
       * Receive requests from later starts; returns the unsubscribe. Queued until a listener.
       * Pass a non-null token to the window's `activate` to raise it.
       */
      onRequest(listener: RequestListener<Request>): () => void;
      /** Stop accepting requests and remove the socket. */
      close(): void;
    }
  /** Another process holds the app; the request was delivered and this process should exit. */
  | { kind: "forwarded" };

export type SingleInstanceOptions<Request> = {
  /** Where sockets live; `$XDG_RUNTIME_DIR/moire-apps` by default. */
  directory?: string;
  /** Validate a received request; return null to drop it. */
  parse(value: unknown): Request | null;
  /**
   * The token this start was launched with; `XDG_ACTIVATION_TOKEN` by default, which is then
   * removed from the environment so it is not handed on to anything this process starts.
   */
  activationToken?: string | null;
};

/** Tokens are compositor-chosen strings well under this; anything longer is dropped. */
const MAX_TOKEN_LENGTH = 256;

/** What crosses the socket: the app's request plus the start's activation token. */
type Envelope = { request: unknown; activationToken: string | null };

function takeEnvironmentToken(): string | null {
  const token = process.env.XDG_ACTIVATION_TOKEN;
  delete process.env.XDG_ACTIVATION_TOKEN;
  return token || null;
}

function parseToken(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_LENGTH
    ? value
    : null;
}

function defaultDirectory(): string {
  const runtime =
    process.env.XDG_RUNTIME_DIR || path.join(os.tmpdir(), `moire-${os.userInfo().uid}`);
  return path.join(runtime, "moire-apps");
}

/** The socket path for `appId` (a reverse-DNS id such as `org.moire.Settings`). */
export function singleInstanceSocket(appId: string, directory = defaultDirectory()): string {
  if (!/^[A-Za-z0-9._-]+$/.test(appId)) throw new Error(`Invalid app id: ${appId}`);
  return path.join(directory, `${appId}.sock`);
}

/** Send `envelope` to the running instance; resolves true once it acknowledged. */
function forward(socket: string, envelope: Envelope): Promise<boolean> {
  return new Promise((resolve) => {
    const client = net.createConnection(socket);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), FORWARD_TIMEOUT_MS);
    client.once("connect", () => client.write(`${JSON.stringify(envelope)}\n`));
    client.on("data", (chunk) => {
      if (chunk.toString("utf8").includes("ok")) finish(true);
    });
    client.once("error", () => finish(false));
    client.once("close", () => finish(false));
  });
}

function listen(socket: string): Promise<net.Server | null> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve(null);
      else reject(error);
    });
    server.listen(socket, () => {
      server.removeAllListeners("error");
      resolve(server);
    });
  });
}

/**
 * Become `appId`'s running instance, or hand `request` to the one already running.
 *
 * A socket left by a crashed instance refuses connections; it is removed and claimed. If the
 * runtime directory is unusable the app runs unlocked as the primary rather than not at all.
 */
export async function claimSingleInstance<Request>(
  appId: string,
  request: Request,
  options: SingleInstanceOptions<Request>,
): Promise<SingleInstance<Request>> {
  const directory = options.directory ?? defaultDirectory();
  const socket = singleInstanceSocket(appId, directory);
  const activationToken =
    options.activationToken !== undefined
      ? parseToken(options.activationToken)
      : parseToken(takeEnvironmentToken());
  let server: net.Server | null = null;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 3 && !server; attempt++) {
      if (fs.existsSync(socket)) {
        if (await forward(socket, { request, activationToken })) return { kind: "forwarded" };
        // Nobody answered: a stale socket from an instance that died.
        fs.rmSync(socket, { force: true });
      }
      // Two starts at once: the loser sees EADDRINUSE and forwards on the next attempt.
      server = await listen(socket);
    }
  } catch (error) {
    console.warn(`[single-instance] ${appId}: running without the lock:`, error);
  }

  const queued: [Request, string | null][] = [];
  let listener: RequestListener<Request> | null = null;
  const deliver = (value: unknown) => {
    if (!value || typeof value !== "object" || !("request" in value)) return;
    const parsed = options.parse(value.request);
    if (parsed === null) return;
    const token = "activationToken" in value ? parseToken(value.activationToken) : null;
    if (listener) listener(parsed, token);
    else queued.push([parsed, token]);
  };
  server?.on("connection", (connection) => {
    let buffer = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        connection.destroy();
        return;
      }
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = "";
      try {
        deliver(JSON.parse(line));
        connection.end("ok\n");
      } catch {
        connection.destroy();
      }
    });
    connection.on("error", () => {});
  });
  // The lock must not keep an otherwise finished app alive.
  server?.unref();
  let closed = false;
  const close = () => {
    if (closed || !server) return;
    closed = true;
    server.close();
    fs.rmSync(socket, { force: true });
  };
  process.once("exit", close);
  return {
    kind: "primary",
    onRequest(next) {
      listener = next;
      for (const [pending, token] of queued.splice(0)) next(pending, token);
      return () => {
        if (listener === next) listener = null;
      };
    },
    close,
  };
}

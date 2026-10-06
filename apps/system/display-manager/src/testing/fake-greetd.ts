import { connect, createServer, type Socket } from "node:net";
import { endianness } from "node:os";
import { chmod, lstat, unlink } from "node:fs/promises";
import { join } from "node:path";

/** Scripted private test transport. It performs no credential verification. */
export type FixtureReply =
  | Readonly<{ type: "success" }>
  | Readonly<{
      type: "auth_message";
      auth_message_type: "visible" | "secret" | "info" | "error";
      auth_message: string;
    }>
  | Readonly<{ type: "error"; error_type: "auth_error" | "error"; description: string }>;

export type FakeGreetdOptions = Readonly<{
  qualification: "fixture";
  directory: string;
  conversations: readonly (readonly FixtureReply[])[];
  onStart?: (
    request: Readonly<{ cmd: readonly string[]; env: readonly string[] }>,
  ) => Promise<void>;
}>;

function frame(reply: FixtureReply): Buffer {
  const body = Buffer.from(JSON.stringify(reply), "utf8");
  const header = Buffer.alloc(4);
  if (endianness() === "LE") header.writeUInt32LE(body.length);
  else header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid fixture request");
  return value as Record<string, unknown>;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error("Invalid fixture launch request");
  return value;
}

export async function startFakeGreetd(options: FakeGreetdOptions) {
  if (options.qualification !== "fixture") throw new Error("Fixture qualification required");
  const directory = await lstat(options.directory);
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0)
    throw new Error("Private fixture directory required");
  const path = join(options.directory, "broker.sock");
  const sockets = new Set<Socket>();
  const pending = new Set<Promise<void>>();
  const counters = {
    connections: 0,
    authenticationBegins: 0,
    answers: 0,
    schedules: 0,
    cancels: 0,
  };
  let conversationIndex = 0;
  let closed = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    counters.connections++;
    let buffer = Buffer.alloc(0);
    let busy = false;
    let phase: "idle" | "prompt" | "authorized" | "scheduled" = "idle";
    let script: readonly FixtureReply[] = [];
    let next = 0;
    const respond = (reply: FixtureReply) => {
      if (!socket.destroyed) socket.write(frame(reply));
    };
    const nextReply = () => {
      const reply = script[next++];
      if (!reply) throw new Error("Fixture conversation exhausted");
      phase =
        reply.type === "success" ? "authorized" : reply.type === "auth_message" ? "prompt" : "idle";
      respond(reply);
    };
    const handle = async (value: unknown) => {
      const request = record(value);
      switch (request.type) {
        case "create_session":
          if (phase !== "idle" || typeof request.username !== "string" || !request.username)
            throw new Error("Invalid fixture begin");
          counters.authenticationBegins++;
          script = options.conversations[conversationIndex++] ?? [];
          next = 0;
          nextReply();
          return;
        case "post_auth_message_response":
          if (
            phase !== "prompt" ||
            !(
              request.response === null ||
              typeof request.response === "string" ||
              request.response === undefined
            )
          )
            throw new Error("Invalid fixture answer");
          // A synthetic response is consumed only by framing. It is never recorded.
          counters.answers++;
          nextReply();
          return;
        case "start_session": {
          if (phase !== "authorized") throw new Error("Unowned fixture launch");
          const cmd = strings(request.cmd);
          const env = strings(request.env);
          phase = "scheduled";
          await options.onStart?.({ cmd, env });
          counters.schedules++;
          respond({ type: "success" });
          return;
        }
        case "cancel_session":
          counters.cancels++;
          phase = "idle";
          respond({ type: "success" });
          return;
        default:
          throw new Error("Unsupported fixture request");
      }
    };
    socket.on("data", (data: Buffer) => {
      if (busy || closed) {
        socket.destroy();
        return;
      }
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length < 4) return;
      const length = endianness() === "LE" ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
      if (length === 0 || length > 65_536 || buffer.length > length + 4) {
        socket.destroy();
        return;
      }
      if (buffer.length < length + 4) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(buffer.subarray(4).toString("utf8"));
      } catch {
        socket.destroy();
        return;
      }
      buffer = Buffer.alloc(0);
      busy = true;
      const operation = handle(parsed)
        .catch(() => {
          phase = "idle";
          respond({ type: "error", error_type: "error", description: "Fixture request failed" });
        })
        .finally(() => {
          busy = false;
          pending.delete(operation);
        });
      pending.add(operation);
    });
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  await chmod(path, 0o600);
  return {
    qualification: "fixture" as const,
    counters,
    async createConnection(): Promise<Socket> {
      if (closed) throw new Error("Fixture broker closed");
      return new Promise((resolve, reject) => {
        const socket = connect(path);
        socket.once("error", reject);
        socket.once("connect", () => {
          socket.removeListener("error", reject);
          resolve(socket);
        });
      });
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled(pending);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await unlink(path).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      });
    },
  };
}

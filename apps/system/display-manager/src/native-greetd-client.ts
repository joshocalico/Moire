import { Socket } from "node:net";
import { endianness } from "node:os";
import path from "node:path";

export type AuthReply =
  | { kind: "prompt"; style: "visible" | "secret" | "info" | "error"; message: string }
  | { kind: "authorized" }
  | { kind: "denied" };
export type CancelReply = { kind: "cancelled" } | { kind: "unavailable" };
export type StartReply = { kind: "committed" } | { kind: "failed" } | { kind: "unavailable" };
export interface NativeGreetdClient {
  authenticate(username: string): Promise<AuthReply>;
  respond(response: string | null): Promise<AuthReply>;
  cancel(): Promise<CancelReply>;
  start(): Promise<StartReply>;
  close(): void;
}

const commandBrand: unique symbol = Symbol("FixedSessionCommand");
export type FixedSessionCommand = { readonly [commandBrand]: true };
const commands = new WeakMap<FixedSessionCommand, string>();

/**
 * Checks shell-safe syntax only. The caller must supply a build-time trusted,
 * packaged executable, never a UI, CLI or environment override. No filesystem
 * ownership, existence or package-content qualification happens here.
 * greetd joins cmd with spaces before invoking a shell, so every accepted byte
 * must be literal shell syntax. The single immutable store path needs no quoting.
 */
export function fixedSessionCommand(executable: string): FixedSessionCommand {
  if (
    typeof executable !== "string" ||
    executable.length > 4096 ||
    !/^\/nix\/store\/[0123456789abcdfghijklmnpqrsvwxyz]{32}-[A-Za-z0-9][A-Za-z0-9+._-]*\/bin\/[A-Za-z0-9+._/-]+$/.test(
      executable,
    ) ||
    executable
      .split("/")
      .some((part, index) => index > 0 && (!part || part === "." || part === ".."))
  )
    throw new Error("Invalid fixed session command");
  const command: FixedSessionCommand = Object.freeze({ [commandBrand]: true });
  commands.set(command, executable);
  return command;
}

export type NativeGreetdOptions = {
  session: FixedSessionCommand;
  socketPath: string;
  timeoutMs?: number;
  maxFrameBytes?: number;
};
type Prompt = Extract<AuthReply, { kind: "prompt" }>;
type WireReply = { kind: "success" } | Prompt | { kind: "denied" } | { kind: "error" };
type Phase =
  | { kind: "idle" }
  | { kind: "prompt"; style: Prompt["style"] }
  | { kind: "authorized" }
  | { kind: "failed"; reason: "denied" | "error" }
  | { kind: "launching" }
  | { kind: "committed" }
  | { kind: "closed" };
type Request =
  | { type: "create_session"; username: string }
  | { type: "post_auth_message_response"; response: string | null }
  | { type: "cancel_session" }
  | { type: "start_session"; cmd: [string]; env: [] };
const littleEndian = endianness() === "LE";

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !value.includes("\0");
}
function hasControl(value: string): boolean {
  return Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}
function decodeReply(payload: Buffer): WireReply {
  const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid authentication reply");
  const reply = Object.fromEntries(Object.entries(raw));
  const keys = Object.keys(reply).length;
  if (keys === 1 && reply.type === "success") return { kind: "success" };
  if (keys === 3 && reply.type === "error" && validText(reply.description, 4096)) {
    if (reply.error_type === "auth_error") return { kind: "denied" };
    if (reply.error_type === "error") return { kind: "error" };
  }
  if (
    keys === 3 &&
    reply.type === "auth_message" &&
    validText(reply.auth_message, 4096) &&
    (reply.auth_message_type === "visible" ||
      reply.auth_message_type === "secret" ||
      reply.auth_message_type === "info" ||
      reply.auth_message_type === "error")
  )
    return {
      kind: "prompt",
      style: reply.auth_message_type,
      // PAM/broker text can echo a response. Never publish it, even for visible prompts.
      message:
        reply.auth_message_type === "secret"
          ? "Enter the requested secret"
          : reply.auth_message_type === "visible"
            ? "Enter the requested response"
            : "Acknowledge the authentication message",
    };
  throw new Error("Invalid authentication reply");
}

/** Explicit connection only. Importing this module performs no socket discovery. */
export async function connectNativeGreetd(
  options: NativeGreetdOptions,
): Promise<NativeGreetdClient> {
  const executable = commands.get(options.session);
  const socketPath = options.socketPath;
  const timeoutMs = options.timeoutMs ?? 1000;
  const max = options.maxFrameBytes ?? 65536;
  if (
    !executable ||
    typeof socketPath !== "string" ||
    !path.isAbsolute(socketPath) ||
    socketPath.length < 2 ||
    path.normalize(socketPath) !== socketPath ||
    Buffer.byteLength(socketPath) > 103 ||
    hasControl(socketPath) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 30000 ||
    !Number.isSafeInteger(max) ||
    max < 256 ||
    max > 65536
  )
    throw new Error("Invalid authentication connection configuration");

  const socket = new Socket();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(failed, timeoutMs);
    function failed() {
      clearTimeout(timer);
      socket.removeListener("connect", connected);
      socket.destroy();
      reject(new Error("Authentication connection unavailable"));
    }
    function connected() {
      clearTimeout(timer);
      socket.removeListener("error", failed);
      resolve();
    }
    socket.once("error", failed);
    socket.once("connect", connected);
    try {
      socket.connect(socketPath);
    } catch {
      failed();
    }
  });

  let phase: Phase = { kind: "idle" };
  let epoch = 0;
  let buffered = Buffer.alloc(0);
  let pending: Promise<WireReply> | null = null;
  let canceling: Promise<CancelReply> | null = null;
  let waiter: {
    resolve: (reply: WireReply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  function fail() {
    epoch++;
    phase = { kind: "closed" };
    buffered.fill(0);
    buffered = Buffer.alloc(0);
    const current = waiter;
    waiter = null;
    if (current) {
      clearTimeout(current.timer);
      current.reject(new Error("Authentication connection unavailable"));
    }
    socket.destroy();
  }
  socket.on("error", fail);
  socket.on("end", fail);
  socket.on("close", fail);
  socket.on("data", (chunk: Buffer) => {
    if (!waiter || phase.kind === "closed" || buffered.length + chunk.length > max + 4) {
      fail();
      return;
    }
    buffered = Buffer.concat([buffered, chunk]);
    if (buffered.length < 4) return;
    const length = littleEndian ? buffered.readUInt32LE(0) : buffered.readUInt32BE(0);
    if (length < 2 || length > max) {
      fail();
      return;
    }
    if (buffered.length < length + 4) return;
    if (buffered.length !== length + 4) {
      fail();
      return;
    }
    let reply: WireReply;
    try {
      reply = decodeReply(buffered.subarray(4));
    } catch {
      fail();
      return;
    }
    buffered.fill(0);
    buffered = Buffer.alloc(0);
    const current = waiter;
    waiter = null;
    clearTimeout(current.timer);
    current.resolve(reply);
  });

  async function exchange(request: Request): Promise<WireReply> {
    if (phase.kind === "closed" || pending) throw new Error("Authentication request unavailable");
    const body = Buffer.from(JSON.stringify(request));
    if (body.length > max) {
      body.fill(0);
      throw new Error("Authentication request exceeds bounds");
    }
    const frame = Buffer.alloc(4 + body.length);
    if (littleEndian) frame.writeUInt32LE(body.length);
    else frame.writeUInt32BE(body.length);
    body.copy(frame, 4);
    const version = epoch;
    if (request.type === "start_session") phase = { kind: "launching" };
    const operation = new Promise<WireReply>((resolve, reject) => {
      waiter = { resolve, reject, timer: setTimeout(fail, timeoutMs) };
      try {
        socket.write(frame, (error) => {
          if (error) fail();
        });
      } catch {
        fail();
      }
    });
    pending = operation;
    try {
      const reply = await operation;
      if (version !== epoch) throw new Error("Authentication connection unavailable");
      const auth =
        request.type === "create_session" || request.type === "post_auth_message_response";
      if (!auth && reply.kind === "prompt") {
        fail();
        throw new Error("Authentication connection unavailable");
      }
      if (auth && reply.kind === "error") {
        fail();
        throw new Error("Authentication request failed");
      }
      if (reply.kind === "success")
        phase = {
          kind:
            request.type === "start_session"
              ? "committed"
              : request.type === "cancel_session"
                ? "idle"
                : "authorized",
        };
      else if (reply.kind === "prompt") phase = { kind: "prompt", style: reply.style };
      else phase = { kind: "failed", reason: reply.kind === "denied" ? "denied" : "error" };
      return reply;
    } finally {
      if (pending === operation) pending = null;
      body.fill(0);
      frame.fill(0);
    }
  }
  function authentication(reply: WireReply): AuthReply {
    if (reply.kind === "success") return { kind: "authorized" };
    if (reply.kind === "prompt" || reply.kind === "denied") return reply;
    throw new Error("Authentication request failed");
  }
  return {
    async authenticate(username) {
      if (phase.kind !== "idle" || pending || canceling)
        throw new Error("Authentication request unavailable");
      if (!validText(username, 64) || !username || hasControl(username))
        throw new Error("Invalid authentication account");
      return authentication(await exchange({ type: "create_session", username }));
    },
    async respond(response) {
      if (phase.kind !== "prompt" || pending || canceling)
        throw new Error("Authentication response unavailable");
      if (phase.style === "info" || phase.style === "error") {
        if (response !== null) throw new Error("Authentication acknowledgement required");
      } else if (!validText(response, 4096)) throw new Error("Invalid authentication response");
      // A blank answer is sent to greetd for denial/acceptance by its authority.
      return authentication(await exchange({ type: "post_auth_message_response", response }));
    },
    async start() {
      if (phase.kind !== "authorized" || pending || canceling) return { kind: "unavailable" };
      try {
        const reply = await exchange({ type: "start_session", cmd: [executable], env: [] });
        // Success commits scheduling, not desktop readiness or greeter resource release.
        return reply.kind === "success" ? { kind: "committed" } : { kind: "failed" };
      } catch {
        fail();
        return { kind: "unavailable" };
      }
    },
    async cancel() {
      if (canceling) return canceling;
      canceling = (async (): Promise<CancelReply> => {
        if (pending) await pending.catch(() => {});
        if (phase.kind === "closed" || phase.kind === "committed" || phase.kind === "launching")
          return { kind: "unavailable" };
        if (phase.kind === "idle") return { kind: "cancelled" };
        const afterDenial = phase.kind === "failed" && phase.reason === "denied";
        try {
          const reply = await exchange({ type: "cancel_session" });
          if (reply.kind === "success") return { kind: "cancelled" };
          // greetd removes the failed session before cancelling its worker. An
          // exited PAM worker can make that first cancellation return an error.
          // Ask once more and require success, never infer ready from the error.
          if (afterDenial && reply.kind === "error") {
            const confirmation = await exchange({ type: "cancel_session" });
            if (confirmation.kind === "success") return { kind: "cancelled" };
          }
        } catch {
          // Unknown cancellation never authorizes a fresh attempt.
        }
        fail();
        return { kind: "unavailable" };
      })().finally(() => {
        canceling = null;
      });
      return canceling;
    },
    close: fail,
  };
}

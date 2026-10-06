import { endianness } from "node:os";
import type { Socket } from "node:net";
import type { BrokerLaunch, BrokerReply, LoginBroker } from "./types";

export type FixtureGreetdOptions = {
  qualification: "fixture";
  connect: () => Promise<Socket>;
  timeoutMs?: number;
  maxFrameBytes?: number;
};
type Phase = "idle" | "prompt" | "authorized" | "scheduled" | "failed" | "closed";
const nativeLittleEndian = endianness() === "LE";
function text(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error("Invalid broker text");
  return value;
}
function parseReply(payload: Buffer): BrokerReply {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  } catch {
    throw new Error("Invalid broker frame");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid broker reply");
  const r = Object.fromEntries(Object.entries(raw));
  if (r.type === "success" && Object.keys(r).length === 1) return { kind: "success" };
  if (
    r.type === "error" &&
    Object.keys(r).length === 3 &&
    (r.error_type === "auth_error" || r.error_type === "error")
  ) {
    text(r.description);
    return {
      kind: r.error_type === "auth_error" ? "denied" : "error",
      message: "Broker rejected the request",
    };
  }
  if (
    r.type === "auth_message" &&
    Object.keys(r).length === 3 &&
    (r.auth_message_type === "visible" ||
      r.auth_message_type === "secret" ||
      r.auth_message_type === "info" ||
      r.auth_message_type === "error")
  ) {
    text(r.auth_message);
    // Broker-controlled text can echo credentials. It is never copied into observed state/errors.
    return {
      kind: "prompt",
      style: r.auth_message_type,
      message:
        r.auth_message_type === "secret"
          ? "Enter the requested secret"
          : r.auth_message_type === "visible"
            ? "Enter the requested response"
            : "Acknowledge the authentication message",
    };
  }
  throw new Error("Invalid broker reply");
}
/** Explicitly injected private-fixture transport. Never discovers or connects a production greetd socket. */
export async function createFixtureGreetdClient(
  options: FixtureGreetdOptions,
): Promise<LoginBroker> {
  const timeoutMs = options.timeoutMs ?? 1000,
    max = options.maxFrameBytes ?? 65536;
  if (
    options.qualification !== "fixture" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 30000 ||
    !Number.isSafeInteger(max) ||
    max < 256 ||
    max > 65536
  )
    throw new Error("Invalid fixture broker bounds");
  let connectExpired = false;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  const connection = options.connect().then((socket) => {
    if (connectExpired) socket.destroy();
    return socket;
  });
  let socket: Socket;
  try {
    socket = await Promise.race([
      connection,
      new Promise<never>((_, reject) => {
        connectTimer = setTimeout(() => {
          connectExpired = true;
          reject(new Error("Fixture broker connection timed out"));
        }, timeoutMs);
      }),
    ]);
  } catch {
    throw new Error("Fixture broker connection unavailable");
  } finally {
    clearTimeout(connectTimer);
  }
  let epoch = 0;
  let phase: Phase = "idle",
    style: "visible" | "secret" | "info" | "error" | null = null;
  let buffered = Buffer.alloc(0),
    pending: Promise<BrokerReply> | null = null;
  let waiter: {
    resolve: (reply: BrokerReply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  let canceling: Promise<BrokerReply> | null = null;
  function fail(message: string) {
    epoch++;
    phase = "closed";
    buffered = Buffer.alloc(0);
    const current = waiter;
    waiter = null;
    if (current) {
      clearTimeout(current.timer);
      current.reject(new Error(message));
    }
    socket.destroy();
  }
  socket.on("error", () => fail("Fixture broker connection failed"));
  socket.on("end", () => fail("Fixture broker closed before a complete reply"));
  socket.on("close", () => fail("Fixture broker connection closed"));
  socket.on("data", (chunk: Buffer) => {
    if (!waiter || phase === "closed" || buffered.length + chunk.length > max + 4) {
      fail("Unexpected or oversized broker frame");
      return;
    }
    buffered = Buffer.concat([buffered, chunk]);
    if (buffered.length < 4) return;
    const length = nativeLittleEndian ? buffered.readUInt32LE(0) : buffered.readUInt32BE(0);
    if (length < 2 || length > max) {
      fail("Invalid broker frame length");
      return;
    }
    if (buffered.length < length + 4) return;
    if (buffered.length !== length + 4) {
      fail("Unexpected extra broker frame");
      return;
    }
    let reply: BrokerReply;
    try {
      reply = parseReply(buffered.subarray(4));
    } catch {
      fail("Invalid broker reply");
      return;
    }
    buffered = Buffer.alloc(0);
    const current = waiter;
    waiter = null;
    clearTimeout(current.timer);
    current.resolve(reply);
  });
  async function exchange(
    request: object,
    expected: "authentication" | "start" | "cancel",
  ): Promise<BrokerReply> {
    if (phase === "closed" || pending) throw new Error("Broker request is unavailable");
    const version = epoch;
    const body = Buffer.from(JSON.stringify(request), "utf8");
    if (body.length > max) throw new Error("Broker request exceeds bounds");
    const frame = Buffer.alloc(4 + body.length);
    if (nativeLittleEndian) frame.writeUInt32LE(body.length, 0);
    else frame.writeUInt32BE(body.length, 0);
    body.copy(frame, 4);
    const operation = new Promise<BrokerReply>((resolve, reject) => {
      waiter = {
        resolve,
        reject,
        timer: setTimeout(() => fail("Fixture broker reply timed out"), timeoutMs),
      };
      socket.write(frame, (error) => {
        if (error) fail("Fixture broker write failed");
      });
    });
    pending = operation;
    try {
      const reply = await operation;
      if (epoch !== version) throw new Error("Fixture broker reply belongs to a closed connection");
      if (expected !== "authentication" && reply.kind === "prompt") {
        fail("Broker reply is invalid for this phase");
        throw new Error("Broker reply is invalid for this phase");
      }
      if (reply.kind === "success") {
        phase = expected === "cancel" ? "idle" : expected === "start" ? "scheduled" : "authorized";
        style = null;
      } else if (reply.kind === "prompt") {
        phase = "prompt";
        style = reply.style;
      } else {
        phase = "failed";
        style = null;
      }
      return reply;
    } finally {
      if (pending === operation) pending = null;
      frame.fill(0);
      body.fill(0);
    }
  }
  const broker: LoginBroker = {
    qualification: "fixture",
    async begin(account) {
      if (phase !== "idle" || pending || canceling)
        throw new Error("Broker authentication phase changed");
      const username = text(account, 64);
      if (
        !username ||
        Array.from(username).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        throw new Error("Invalid fixture account");
      return exchange({ type: "create_session", username }, "authentication");
    },
    async answer(response) {
      if (phase !== "prompt" || pending || canceling)
        throw new Error("Broker prompt phase changed");
      if (style === "info" || style === "error") {
        if (response !== null) throw new Error("Informational prompt requires acknowledgement");
      } else {
        if (response === null) throw new Error("Authentication prompt requires a response");
        text(response);
      }
      return exchange({ type: "post_auth_message_response", response }, "authentication");
    },
    async start(request: BrokerLaunch) {
      if (phase !== "authorized" || pending || canceling)
        throw new Error("Broker launch phase changed");
      if (
        !Array.isArray(request.command) ||
        request.command.length < 1 ||
        request.command.length > 64 ||
        !Array.isArray(request.environment) ||
        request.environment.length > 64
      )
        throw new Error("Invalid broker launch request");
      const cmd = request.command.map((v) => text(v)),
        env = request.environment.map((v) => text(v));
      if (cmd.some((v) => !v)) throw new Error("Invalid broker launch command");
      return exchange({ type: "start_session", cmd, env }, "start");
    },
    async cancel() {
      if (canceling) return canceling;
      canceling = (async (): Promise<BrokerReply> => {
        if (pending) await pending.catch(() => {});
        if (phase === "closed") throw new Error("Broker cancellation outcome is unknown");
        if (phase === "idle") return { kind: "success" };
        return exchange({ type: "cancel_session" }, "cancel");
      })().finally(() => {
        canceling = null;
      });
      return canceling;
    },
    close() {
      fail("Fixture broker client closed");
    },
  };
  return broker;
}

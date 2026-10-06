import net from "node:net";
import {
  decodeMessage,
  encodeMessage,
  messageByteLength,
  splitSignature,
  type DbusMessage,
  type DbusVariant,
} from "./codec";

export type { DbusMessage, DbusVariant } from "./codec";

export type DbusMethodResult = {
  body?: unknown[];
};

export type DbusMethodContext = {
  message: DbusMessage;
  body: unknown[];
};

export type DbusMethod = {
  inSignature: string;
  outSignature: string;
  handler: (context: DbusMethodContext) => DbusMethodResult | Promise<DbusMethodResult>;
};

export type DbusInterface = {
  name: string;
  methods: Record<string, DbusMethod>;
};

export type DbusOperationOptions = { signal?: AbortSignal; timeoutMs?: number };
export type DbusSignalMatch = {
  sender: string;
  path: string;
  interface: string;
  member: string;
  arg0?: string;
};
export type DbusDisposer = () => Promise<void>;
export class DbusRemoteError extends Error {
  constructor(
    readonly errorName: string,
    detail: string,
  ) {
    super(`${errorName}: ${detail}`);
  }
}
type PendingCall = {
  resolve: (message: DbusMessage) => void;
  reject: (error: Error) => void;
};
type SignalSubscription = {
  match: DbusSignalMatch;
  sender: string | null;
  listener: (message: DbusMessage) => void;
  delivery: { kind: "installing"; buffered: DbusMessage[]; bytes: number } | { kind: "active" };
};
const BUS = "org.freedesktop.DBus";
const BUS_PATH = "/org/freedesktop/DBus";
const DEFAULT_TIMEOUT = 10_000;
const MAX_PENDING = 1024;
const MAX_SUBSCRIPTIONS = 128;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_SETUP_BYTES = 64 * 1024 * 1024;
function timeoutMs(options: DbusOperationOptions): number {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120_000)
    throw new Error("D-Bus timeoutMs must be between 1 and 120000 milliseconds");
  return timeout;
}
function cancelled(): Error {
  return new Error("D-Bus operation cancelled");
}
function validName(name: string): boolean {
  return (
    name.length <= 255 &&
    (name.startsWith(":")
      ? /^:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(name)
      : /^[A-Za-z_-][A-Za-z0-9_-]*(?:\.[A-Za-z_-][A-Za-z0-9_-]*)+$/.test(name))
  );
}
function matchRule(match: DbusSignalMatch): string {
  if (
    !validName(match.sender) ||
    !/^\/(?:[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*)?$/.test(match.path) ||
    !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(match.interface) ||
    match.interface.length > 255 ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(match.member) ||
    match.member.length > 255 ||
    (match.arg0 !== undefined && (typeof match.arg0 !== "string" || match.arg0.includes("\0")))
  )
    throw new Error("Invalid exact D-Bus signal match");
  return [
    "type='signal'",
    ...(["sender", "path", "interface", "member", "arg0"] as const).flatMap((key) =>
      match[key] === undefined ? [] : [`${key}='${match[key].replaceAll("'", "'\\''")}'`],
    ),
  ].join(",");
}

function busSocketPath(address: string): string {
  for (const candidate of address.split(";")) {
    if (!candidate.startsWith("unix:")) continue;
    const values = new Map(
      candidate
        .slice(5)
        .split(",")
        .map((part) => {
          const equals = part.indexOf("=");
          return [part.slice(0, equals), decodeURIComponent(part.slice(equals + 1))] as const;
        }),
    );
    const path = values.get("path");
    if (path) return path;
    const abstract = values.get("abstract");
    if (abstract) return `\0${abstract}`;
  }
  throw new Error(`Unsupported D-Bus address: ${address}`);
}

function authenticate(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const identity = Buffer.from(String(process.getuid?.() ?? 0), "ascii")
      .toString("hex")
      .toUpperCase();
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => onError(new Error("D-Bus disconnected during authentication"));
    const onData = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > 65536) {
        onError(new Error("D-Bus authentication response exceeds 64 KiB"));
        return;
      }
      for (;;) {
        const end = pending.indexOf("\r\n");
        if (end < 0) return;
        const line = pending.subarray(0, end).toString("ascii");
        pending = pending.subarray(end + 2);
        if (line.startsWith("OK ")) {
          cleanup();
          socket.write("BEGIN\r\n");
          resolve(pending);
          return;
        }
        if (line.startsWith("REJECTED") || line.startsWith("ERROR")) {
          onError(new Error(`D-Bus authentication rejected: ${line}`));
          return;
        }
      }
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.write(`\0AUTH EXTERNAL ${identity}\r\n`);
  });
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function signatureArgs(signature: string, direction: "in" | "out"): string {
  return splitSignature(signature)
    .map((type) => `<arg type="${xmlEscape(type)}" direction="${direction}"/>`)
    .join("");
}

export class SessionBus {
  private serial = 1;
  private input = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingCall>();
  private readonly objects = new Map<string, Map<string, DbusInterface>>();
  private readonly subscriptions = new Set<SignalSubscription>();
  private readonly disconnectListeners = new Set<(error: Error) => void>();
  private readonly lifetimeDisposers = new Set<() => void>();
  private disconnected: Error | null = null;
  private uniqueName: string | null = null;
  private setupBytes = 0;

  get name(): string | null {
    return this.uniqueName;
  }

  private constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", (error) => this.disconnect(error));
    socket.on("close", () => this.disconnect(new Error("D-Bus disconnected")));
  }

  static async connect(
    address = process.env.DBUS_SESSION_BUS_ADDRESS,
    options: DbusOperationOptions = {},
  ): Promise<SessionBus> {
    if (!address) throw new Error("DBUS_SESSION_BUS_ADDRESS is not set");
    options.signal?.throwIfAborted();
    const timeout = timeoutMs(options);
    const socket = net.createConnection({ path: busSocketPath(address) });
    // Retain the caller's connection-lifetime cancellation after Hello, as existing callers expect.
    const abort = () => socket.destroy(cancelled());
    const timer = setTimeout(
      () => socket.destroy(new Error("D-Bus connection timed out")),
      timeout,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    socket.once("close", () => options.signal?.removeEventListener("abort", abort));
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          socket.off("connect", connected);
          socket.off("error", failed);
          socket.off("close", closed);
        };
        const connected = () => {
          cleanup();
          resolve();
        };
        const failed = (error: Error) => {
          cleanup();
          reject(error);
        };
        const closed = () => failed(new Error("D-Bus disconnected while connecting"));
        socket.once("connect", connected);
        socket.once("error", failed);
        socket.once("close", closed);
      });
      const initial = await authenticate(socket);
      const bus = new SessionBus(socket);
      if (initial.length > 0) bus.receive(initial);
      const reply = await bus.call(
        { destination: BUS, path: BUS_PATH, interface: BUS, member: "Hello" },
        options,
      );
      const name = reply.body?.[0];
      if (typeof name !== "string" || !name.startsWith(":") || !validName(name))
        throw new Error("D-Bus Hello returned an invalid unique name");
      bus.uniqueName = name;
      return bus;
    } catch (error) {
      socket.destroy();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async requestName(name: string, flags = 0): Promise<number> {
    const reply = await this.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus",
      member: "RequestName",
      signature: "su",
      body: [name, flags],
    });
    return Number(reply.body?.[0] ?? 0);
  }

  exportObject(path: string, descriptor: DbusInterface): () => void {
    if (this.disconnected) throw this.disconnected;
    const interfaces = this.objects.get(path) ?? new Map<string, DbusInterface>();
    interfaces.set(descriptor.name, descriptor);
    this.objects.set(path, interfaces);
    return () => {
      const current = this.objects.get(path);
      current?.delete(descriptor.name);
      if (current?.size === 0) this.objects.delete(path);
    };
  }

  call(
    input: {
      destination: string;
      path: string;
      interface?: string;
      member: string;
      signature?: string;
      body?: unknown[];
    },
    options: DbusOperationOptions = {},
  ): Promise<DbusMessage> {
    if (this.disconnected) return Promise.reject(this.disconnected);
    if (options.signal?.aborted) return Promise.reject(cancelled());
    let bytes: Buffer;
    let timeout: number;
    const serial = this.nextSerial();
    try {
      timeout = timeoutMs(options);
      bytes = encodeMessage({ type: 1, serial, ...input });
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.pending.size >= MAX_PENDING)
      return Promise.reject(new Error("Too many pending D-Bus calls"));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        this.pending.delete(serial);
      };
      const abort = () => {
        cleanup();
        reject(cancelled());
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`D-Bus call ${input.member} timed out`));
      }, timeout);
      this.pending.set(serial, {
        resolve: (message) => {
          cleanup();
          resolve(message);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        this.socket.write(bytes);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  onDisconnect(listener: (error: Error) => void): () => void {
    if (this.disconnected) {
      listener(this.disconnected);
      return () => {};
    }
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  async subscribeSignal(
    match: DbusSignalMatch,
    listener: (message: DbusMessage) => void,
    options: DbusOperationOptions = {},
  ): Promise<DbusDisposer> {
    const rule = matchRule(match);
    timeoutMs(options);
    options.signal?.throwIfAborted();
    if (this.disconnected) throw this.disconnected;
    if (this.subscriptions.size >= MAX_SUBSCRIPTIONS)
      throw new Error("Too many D-Bus signal subscriptions");
    const subscription: SignalSubscription = {
      match: { ...match },
      sender: null,
      listener,
      delivery: { kind: "installing", buffered: [], bytes: 0 },
    };
    this.subscriptions.add(subscription);
    let ownerDisposer: DbusDisposer | null = null;
    let addStarted = false;
    let stopped = false;
    let disposal: Promise<void> | null = null;
    const dispose: DbusDisposer = () => {
      if (disposal) return disposal;
      stopped = true;
      this.subscriptions.delete(subscription);
      if (subscription.delivery.kind === "installing") {
        this.setupBytes -= subscription.delivery.bytes;
        subscription.delivery = { kind: "active" };
      }
      options.signal?.removeEventListener("abort", abort);
      this.lifetimeDisposers.delete(abort);
      disposal = (async () => {
        try {
          await ownerDisposer?.();
          if (addStarted && !this.disconnected) {
            try {
              await this.call(
                {
                  destination: BUS,
                  path: BUS_PATH,
                  interface: BUS,
                  member: "RemoveMatch",
                  signature: "s",
                  body: [rule],
                },
                { timeoutMs: options.timeoutMs },
              );
            } catch (error) {
              // A rejected/cancelled AddMatch may never have installed a rule.
              if (
                !(
                  error instanceof DbusRemoteError &&
                  error.errorName === "org.freedesktop.DBus.Error.MatchRuleNotFound"
                )
              )
                throw error;
            }
          }
        } catch (error) {
          // Retiring local listeners alone must not leave unbounded daemon match rules.
          this.disconnect(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
      })();
      return disposal;
    };
    const abort = () => {
      void dispose().catch(() => {});
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    this.lifetimeDisposers.add(abort);
    try {
      if (match.sender === BUS || match.sender.startsWith(":")) subscription.sender = match.sender;
      else
        ownerDisposer = await this.watchName(
          match.sender,
          (owner) => {
            subscription.sender = owner;
          },
          options,
        );
      if (stopped) {
        await ownerDisposer?.();
        throw cancelled();
      }
      addStarted = true;
      await this.call(
        {
          destination: BUS,
          path: BUS_PATH,
          interface: BUS,
          member: "AddMatch",
          signature: "s",
          body: [rule],
        },
        options,
      );
      if (stopped) throw cancelled();
      const buffered =
        subscription.delivery.kind === "installing" ? subscription.delivery.buffered : [];
      if (subscription.delivery.kind === "installing")
        this.setupBytes -= subscription.delivery.bytes;
      subscription.delivery = { kind: "active" };
      for (const message of buffered) {
        if (this.subscriptions.has(subscription)) listener(message);
      }
      return dispose;
    } catch (error) {
      await dispose().catch(() => {});
      throw error;
    }
  }

  async watchName(
    name: string,
    listener: (owner: string | null) => void,
    options: DbusOperationOptions = {},
  ): Promise<DbusDisposer> {
    if (!validName(name)) throw new Error("Invalid D-Bus name");
    let stopped = false,
      generation = 0,
      initialized = false;
    let owner: string | null = null;
    const publish = (next: string | null) => {
      if (stopped || (initialized && owner === next)) return;
      initialized = true;
      owner = next;
      listener(next);
    };
    const signalDisposer = await this.subscribeSignal(
      { sender: BUS, path: BUS_PATH, interface: BUS, member: "NameOwnerChanged", arg0: name },
      (message) => {
        if (message.signature !== "sss" || message.body?.length !== 3 || message.body[0] !== name)
          return;
        const oldOwner = message.body[1],
          newOwner = message.body[2];
        if (
          typeof oldOwner !== "string" ||
          typeof newOwner !== "string" ||
          (oldOwner !== "" && !validName(oldOwner)) ||
          (newOwner !== "" && !validName(newOwner)) ||
          (oldOwner !== "" && oldOwner !== BUS && !oldOwner.startsWith(":")) ||
          (newOwner !== "" && newOwner !== BUS && !newOwner.startsWith(":"))
        )
          return;
        generation++;
        publish(newOwner || null);
      },
      options,
    );
    const removeDisconnect = this.onDisconnect(() => publish(null));
    const abort = () => {
      stopped = true;
      removeDisconnect();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const dispose: DbusDisposer = async () => {
      stopped = true;
      options.signal?.removeEventListener("abort", abort);
      removeDisconnect();
      await signalDisposer();
    };
    try {
      const before = generation;
      let initialOwner: string | null;
      try {
        const reply = await this.call(
          {
            destination: BUS,
            path: BUS_PATH,
            interface: BUS,
            member: "GetNameOwner",
            signature: "s",
            body: [name],
          },
          options,
        );
        const value = reply.body?.[0];
        if (
          typeof value !== "string" ||
          !validName(value) ||
          (value !== BUS && !value.startsWith(":"))
        )
          throw new Error("D-Bus GetNameOwner returned an invalid owner");
        initialOwner = value;
      } catch (error) {
        if (
          !(
            error instanceof DbusRemoteError &&
            error.errorName === "org.freedesktop.DBus.Error.NameHasNoOwner"
          )
        )
          throw error;
        initialOwner = null;
      }
      if (generation === before) publish(initialOwner);
      if (stopped) throw cancelled();
      return dispose;
    } catch (error) {
      await dispose().catch(() => {});
      throw error;
    }
  }

  emitSignal(input: {
    path: string;
    interface: string;
    member: string;
    destination?: string;
    signature?: string;
    body?: unknown[];
  }): void {
    if (this.disconnected) throw this.disconnected;
    this.socket.write(encodeMessage({ type: 4, serial: this.nextSerial(), ...input }));
  }

  close(): void {
    this.disconnect(new Error("D-Bus closed"), "flush");
  }

  private nextSerial(): number {
    for (;;) {
      const value = this.serial++;
      if (this.serial > 0xffff_fffe) this.serial = 1;
      if (!this.pending.has(value)) return value;
    }
  }

  private receive(chunk: Buffer): void {
    if (this.disconnected) return;
    this.input = Buffer.concat([this.input, chunk]);
    for (;;) {
      let length: number | null;
      try {
        length = messageByteLength(this.input);
      } catch (error) {
        this.disconnect(error instanceof Error ? error : new Error(String(error)));
        this.socket.destroy();
        return;
      }
      if (
        this.input.length > MAX_MESSAGE_BYTES ||
        (length !== null && length > MAX_MESSAGE_BYTES)
      ) {
        this.disconnect(new Error("D-Bus message exceeds 16 MiB"));
        this.socket.destroy();
        return;
      }
      if (length == null || this.input.length < length) return;
      const frame = this.input.subarray(0, length);
      this.input = this.input.subarray(length);
      let message: DbusMessage;
      try {
        message = decodeMessage(frame);
      } catch (error) {
        this.disconnect(error instanceof Error ? error : new Error(String(error)));
        this.socket.destroy();
        return;
      }
      if (message.type === 2 || message.type === 3) {
        const pending = this.pending.get(message.replySerial ?? 0);
        if (!pending) continue;
        this.pending.delete(message.replySerial ?? 0);
        if (message.type === 3) {
          pending.reject(
            new DbusRemoteError(
              message.errorName ?? "D-Bus error",
              String(message.body?.[0] ?? ""),
            ),
          );
        } else pending.resolve(message);
      } else if (message.type === 4) {
        for (const subscription of [...this.subscriptions]) {
          const match = subscription.match;
          if (
            this.subscriptions.has(subscription) &&
            subscription.sender !== null &&
            message.sender === subscription.sender &&
            message.path === match.path &&
            message.interface === match.interface &&
            message.member === match.member &&
            (match.arg0 === undefined || message.body?.[0] === match.arg0)
          )
            if (subscription.delivery.kind === "installing") {
              if (
                subscription.delivery.buffered.length >= 64 ||
                this.setupBytes + length > MAX_SETUP_BYTES
              ) {
                this.disconnect(
                  new Error(
                    "D-Bus signal setup buffer exceeds 64 messages or 64 MiB per connection",
                  ),
                );
                return;
              }
              subscription.delivery.buffered.push(message);
              subscription.delivery.bytes += length;
              this.setupBytes += length;
            } else subscription.listener(message);
        }
      } else if (message.type === 1) {
        void this.dispatchMethod(message);
      }
    }
  }

  private async dispatchMethod(message: DbusMessage): Promise<void> {
    if (message.interface === "org.freedesktop.DBus.Peer" && message.member === "Ping") {
      this.reply(message, "", []);
      return;
    }
    if (
      message.interface === "org.freedesktop.DBus.Introspectable" &&
      message.member === "Introspect"
    ) {
      this.reply(message, "s", [this.introspectionXml(message.path ?? "/")]);
      return;
    }
    const descriptor = this.objects.get(message.path ?? "")?.get(message.interface ?? "");
    const method = descriptor?.methods[message.member ?? ""];
    if (!method) {
      this.error(
        message,
        "org.freedesktop.DBus.Error.UnknownMethod",
        `Unknown method ${message.interface}.${message.member}`,
      );
      return;
    }
    try {
      const result = await method.handler({
        message,
        body: message.body ?? [],
      });
      if (!((message.flags ?? 0) & 1)) {
        this.reply(message, method.outSignature, result.body ?? []);
      }
    } catch (error) {
      const name =
        error instanceof DbusRemoteError &&
        error.errorName.length <= 255 &&
        /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(error.errorName)
          ? error.errorName
          : "org.freedesktop.DBus.Error.Failed";
      this.error(message, name, error instanceof Error ? error.message : String(error));
    }
  }

  private reply(call: DbusMessage, signature: string, body: unknown[]): void {
    if (this.disconnected) return;
    this.socket.write(
      encodeMessage({
        type: 2,
        serial: this.nextSerial(),
        replySerial: call.serial,
        destination: call.sender,
        signature,
        body,
      }),
    );
  }

  private error(call: DbusMessage, name: string, detail: string): void {
    if (this.disconnected) return;
    this.socket.write(
      encodeMessage({
        type: 3,
        serial: this.nextSerial(),
        replySerial: call.serial,
        destination: call.sender,
        errorName: name,
        signature: "s",
        body: [detail],
      }),
    );
  }

  private introspectionXml(path: string): string {
    const interfaces = this.objects.get(path);
    const described = [...(interfaces?.values() ?? [])]
      .map((descriptor) => {
        const methods = Object.entries(descriptor.methods)
          .map(
            ([name, method]) =>
              `<method name="${xmlEscape(name)}">${signatureArgs(method.inSignature, "in")}${signatureArgs(method.outSignature, "out")}</method>`,
          )
          .join("");
        return `<interface name="${xmlEscape(descriptor.name)}">${methods}</interface>`;
      })
      .join("");
    return `<node>${described}<interface name="org.freedesktop.DBus.Introspectable"><method name="Introspect"><arg type="s" direction="out"/></method></interface><interface name="org.freedesktop.DBus.Peer"><method name="Ping"/></interface></node>`;
  }

  private disconnect(error: Error, output: "discard" | "flush" = "discard"): void {
    if (this.disconnected) return;
    this.disconnected = error;
    if (output === "flush") {
      // Preserve end()'s existing queued-write semantics, while bounding fd retirement.
      const deadline = setTimeout(() => this.socket.destroy(), 1000);
      deadline.unref();
      this.socket.once("close", () => clearTimeout(deadline));
      this.socket.end();
    } else this.socket.destroy();
    this.input = Buffer.alloc(0);
    for (const pending of [...this.pending.values()]) pending.reject(error);
    this.pending.clear();
    // Owner listeners revoke before local subscription retirement.
    const errors: unknown[] = [];
    for (const listener of [...this.disconnectListeners]) {
      if (!this.disconnectListeners.has(listener)) continue;
      try {
        listener(error);
      } catch (failure) {
        errors.push(failure);
      }
    }
    this.disconnectListeners.clear();
    for (const dispose of [...this.lifetimeDisposers]) dispose();
    this.lifetimeDisposers.clear();
    this.subscriptions.clear();
    this.setupBytes = 0;
    this.objects.clear();
    if (errors.length)
      queueMicrotask(() => {
        throw new AggregateError(errors, "D-Bus disconnect listener failed");
      });
  }
}

export function variant(signature: string, value: unknown): DbusVariant {
  return { signature, value };
}

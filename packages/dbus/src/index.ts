import net from "node:net";
import {
  decodeMessage,
  encodeMessage,
  messageByteLength,
  splitSignature,
  type DbusMessage,
  type DbusVariant,
} from "./codec.js";

export type { DbusMessage, DbusVariant } from "./codec.js";

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
  handler: (
    context: DbusMethodContext,
  ) => DbusMethodResult | Promise<DbusMethodResult>;
};

export type DbusInterface = {
  name: string;
  methods: Record<string, DbusMethod>;
};

type PendingCall = {
  resolve: (message: DbusMessage) => void;
  reject: (error: Error) => void;
};

function busSocketPath(address: string): string {
  for (const candidate of address.split(";")) {
    if (!candidate.startsWith("unix:")) continue;
    const values = new Map(
      candidate
        .slice(5)
        .split(",")
        .map((part) => {
          const equals = part.indexOf("=");
          return [
            part.slice(0, equals),
            decodeURIComponent(part.slice(equals + 1)),
          ] as const;
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
    const onError = (error: Error) => {
      socket.off("data", onData);
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        const end = pending.indexOf("\r\n");
        if (end < 0) return;
        const line = pending.subarray(0, end).toString("ascii");
        pending = pending.subarray(end + 2);
        if (line.startsWith("OK ")) {
          socket.off("data", onData);
          socket.off("error", onError);
          socket.write("BEGIN\r\n");
          resolve(pending);
          return;
        }
        if (line.startsWith("REJECTED")) {
          socket.off("data", onData);
          socket.off("error", onError);
          reject(new Error(`D-Bus authentication rejected: ${line}`));
          return;
        }
        if (line.startsWith("ERROR")) {
          socket.off("data", onData);
          socket.off("error", onError);
          reject(new Error(`D-Bus authentication error: ${line}`));
          return;
        }
      }
    };
    socket.on("data", onData);
    socket.on("error", onError);
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
    .map(
      (type) =>
        `<arg type="${xmlEscape(type)}" direction="${direction}"/>`,
    )
    .join("");
}

export class SessionBus {
  private serial = 1;
  private input = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingCall>();
  private readonly objects = new Map<string, Map<string, DbusInterface>>();

  private constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", (error) => this.failPending(error));
    socket.on("close", () => this.failPending(new Error("D-Bus disconnected")));
  }

  static async connect(
    address = process.env.DBUS_SESSION_BUS_ADDRESS,
  ): Promise<SessionBus> {
    if (!address) throw new Error("DBUS_SESSION_BUS_ADDRESS is not set");
    const socket = net.createConnection({ path: busSocketPath(address) });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const initial = await authenticate(socket);
    const bus = new SessionBus(socket);
    if (initial.length > 0) bus.receive(initial);
    await bus.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus",
      member: "Hello",
    });
    return bus;
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
    const interfaces = this.objects.get(path) ?? new Map<string, DbusInterface>();
    interfaces.set(descriptor.name, descriptor);
    this.objects.set(path, interfaces);
    return () => {
      const current = this.objects.get(path);
      current?.delete(descriptor.name);
      if (current?.size === 0) this.objects.delete(path);
    };
  }

  call(input: {
    destination: string;
    path: string;
    interface?: string;
    member: string;
    signature?: string;
    body?: unknown[];
  }): Promise<DbusMessage> {
    const serial = this.nextSerial();
    const message: DbusMessage = {
      type: 1,
      serial,
      ...input,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(serial, { resolve, reject });
      this.socket.write(encodeMessage(message));
    });
  }

  emitSignal(input: {
    path: string;
    interface: string;
    member: string;
    destination?: string;
    signature?: string;
    body?: unknown[];
  }): void {
    this.socket.write(
      encodeMessage({ type: 4, serial: this.nextSerial(), ...input }),
    );
  }

  close(): void {
    this.socket.end();
  }

  private nextSerial(): number {
    const value = this.serial++;
    if (this.serial > 0xffff_fffe) this.serial = 1;
    return value;
  }

  private receive(chunk: Buffer): void {
    this.input = Buffer.concat([this.input, chunk]);
    for (;;) {
      const length = messageByteLength(this.input);
      if (length == null || this.input.length < length) return;
      const frame = this.input.subarray(0, length);
      this.input = this.input.subarray(length);
      const message = decodeMessage(frame);
      if (message.type === 2 || message.type === 3) {
        const pending = this.pending.get(message.replySerial ?? 0);
        if (!pending) continue;
        this.pending.delete(message.replySerial ?? 0);
        if (message.type === 3) {
          pending.reject(
            new Error(
              `${message.errorName ?? "D-Bus error"}: ${String(message.body?.[0] ?? "")}`,
            ),
          );
        } else pending.resolve(message);
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
    const descriptor = this.objects
      .get(message.path ?? "")
      ?.get(message.interface ?? "");
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
      this.error(
        message,
        "org.freedesktop.DBus.Error.Failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private reply(call: DbusMessage, signature: string, body: unknown[]): void {
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

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export function variant(signature: string, value: unknown): DbusVariant {
  return { signature, value };
}

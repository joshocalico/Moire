/**
 * One connection to PipeWire: the handshake `pw_context_connect` does (Core `hello`, Client
 * `update_properties`, `get_registry`), proxy ids, `sync`/`done` roundtrips, ping/pong, the live
 * registry, and per-proxy event dispatch. It knows nothing about audio.
 *
 * Proxy ids follow PipeWire's rule: the server maps them densely, so a new id is the lowest one
 * freed by `remove_id`, else the next unused one, never a gap.
 */
import type { Pod } from "./pod";
import {
  ClientMethod,
  CoreEvent,
  CoreMethod,
  decode,
  encodeMessage,
  MessageReader,
  messageArgs,
  methods,
  ProtocolError,
  RegistryEvent,
  RegistryMethod,
  argInt,
  argString,
  type CoreInfo,
  type GlobalInfo,
  type RawMessage,
} from "./protocol";
import { PW_ID_CLIENT, PW_ID_CORE, PwVersion } from "./spa";
import {
  defaultTransport,
  pipewireSocketPath,
  TransportUnavailable,
  type Transport,
  type TransportFactory,
} from "./transport";

export type PipeWireErrorKind = "unavailable" | "error" | "timeout" | "cancelled";

/** Every failure this package reports, with a kind the adapters map to their states. */
export class PipeWireError extends Error {
  constructor(
    readonly kind: PipeWireErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export type ServerError = { readonly seq: number; readonly res: number; readonly message: string };

export type ProxyHandler = (args: readonly Pod[], message: RawMessage) => void;

export class Proxy {
  /** Errors the server reported for this proxy, newest last; callers check after a roundtrip. */
  readonly errors: ServerError[] = [];
  globalId: number | null = null;
  /** The server dropped this id (its global went away, or a bind failed). */
  removed = false;
  constructor(
    readonly id: number,
    readonly type: string,
    readonly handlers: Readonly<Record<number, ProxyHandler>>,
  ) {}
}

export type ConnectionOptions = {
  /** Defaults to `$PIPEWIRE_REMOTE` or `$XDG_RUNTIME_DIR/pipewire-0`. */
  socketPath?: string;
  transport?: TransportFactory;
  /** `application.name` the server shows for this client. */
  name?: string;
  /** Deadline for each roundtrip. */
  timeoutMs?: number;
  /** Abandons the handshake (closing the socket) when aborted. */
  signal?: AbortSignal;
};

export const DEFAULT_TIMEOUT_MS = 1500;
const MAX_ERRORS_PER_PROXY = 8;

type PendingSync = {
  resolve: () => void;
  reject: (error: PipeWireError) => void;
};

export class PipeWireConnection {
  readonly globals = new Map<number, GlobalInfo>();
  serverInfo: CoreInfo | null = null;
  /** Called after the registry changes (a global added or removed). */
  onRegistryChange: (() => void) | null = null;
  onClose: ((error: PipeWireError) => void) | null = null;

  private readonly proxies = new Map<number, Proxy>();
  private readonly freeIds: number[] = [];
  private nextId = 3;
  private readonly registryId = 2;
  private readonly reader: MessageReader;
  private readonly syncs = new Map<number, PendingSync>();
  private messageSeq = 0;
  private syncSeq = 0;
  private closedWith: PipeWireError | null = null;

  private constructor(
    private readonly transport: Transport,
    readonly timeoutMs: number,
  ) {
    this.reader = new MessageReader(transport.fdPassing);
  }

  static async open(options: ConnectionOptions = {}): Promise<PipeWireConnection> {
    const socketPath = options.socketPath ?? pipewireSocketPath();
    if (!socketPath)
      throw new PipeWireError("unavailable", "PipeWire isn't running (no runtime directory).");
    let connection: PipeWireConnection | null = null;
    const pending: { data: Uint8Array; fds: readonly number[] }[] = [];
    let early: Error | undefined | null = null;
    let transport: Transport;
    try {
      transport = await (options.transport ?? defaultTransport)(socketPath, {
        onData: (data, fds) =>
          connection ? connection.receive(data, fds) : pending.push({ data, fds }),
        onClose: (error) => (connection ? connection.closed(error) : (early = error)),
      });
    } catch (error) {
      if (error instanceof TransportUnavailable)
        throw new PipeWireError("unavailable", error.message);
      throw new PipeWireError(
        "error",
        `Can't connect to PipeWire: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    connection = new PipeWireConnection(transport, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (early !== null) connection.closed(early);
    for (const chunk of pending) connection.receive(chunk.data, chunk.fds);
    connection.send(PW_ID_CORE, CoreMethod.hello, methods.hello(PwVersion.Core));
    connection.send(
      PW_ID_CLIENT,
      ClientMethod.updateProperties,
      methods.updateProperties({
        "application.name": options.name ?? "Moire",
        "application.process.id": String(process.pid),
        "application.process.binary": "moire",
      }),
    );
    connection.send(
      PW_ID_CORE,
      CoreMethod.getRegistry,
      methods.getRegistry(PwVersion.Registry, connection.registryId),
    );
    try {
      await connection.sync(options.signal);
    } catch (error) {
      connection.close();
      throw error;
    }
    return connection;
  }

  get isClosed(): boolean {
    return this.closedWith !== null;
  }

  /** Bind a global; the proxy lives until the server removes it or the connection closes. */
  bind(global: GlobalInfo, version: number, handlers: Record<number, ProxyHandler>): Proxy {
    const id = this.freeIds.length ? this.freeIds.shift()! : this.nextId++;
    const proxy = new Proxy(id, global.type, handlers);
    this.proxies.set(id, proxy);
    this.send(
      this.registryId,
      RegistryMethod.bind,
      methods.bind(global.id, global.type, Math.min(version, global.version), id),
    );
    return proxy;
  }

  call(proxy: Proxy, opcode: number, args: readonly Pod[]): void {
    if (proxy.removed) throw new PipeWireError("error", "That object is gone.");
    this.send(proxy.id, opcode, args);
  }

  /** Resolves once the server has handled everything sent before it. */
  sync(signal?: AbortSignal, timeoutMs = this.timeoutMs): Promise<void> {
    if (this.closedWith) return Promise.reject(this.closedWith);
    if (signal?.aborted) return Promise.reject(cancelled());
    const seq = (this.syncSeq = (this.syncSeq + 1) & 0x3fffffff);
    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.syncs.delete(seq);
      };
      const abort = () => {
        finish();
        reject(cancelled());
      };
      const timer = setTimeout(() => {
        finish();
        reject(new PipeWireError("timeout", "PipeWire didn't answer in time."));
      }, timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      this.syncs.set(seq, {
        resolve: () => {
          finish();
          resolve();
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      });
      try {
        this.send(PW_ID_CORE, CoreMethod.sync, methods.sync(PW_ID_CORE, seq));
      } catch (error) {
        finish();
        reject(error);
      }
    });
  }

  close(): void {
    if (this.closedWith) return;
    this.transport.close();
    this.closed();
  }

  private send(id: number, opcode: number, args: readonly Pod[]): void {
    if (this.closedWith) throw this.closedWith;
    this.messageSeq = (this.messageSeq + 1) >>> 0;
    if (!this.transport.send(encodeMessage(id, opcode, this.messageSeq, args)))
      throw new PipeWireError("error", "PipeWire connection closed.");
  }

  private closed(error?: Error): void {
    if (this.closedWith) return;
    const reason = new PipeWireError(
      "error",
      error ? `PipeWire connection lost: ${error.message}` : "PipeWire connection closed.",
    );
    this.closedWith = reason;
    for (const pending of this.syncs.values()) pending.reject(reason);
    for (const proxy of this.proxies.values()) proxy.removed = true;
    for (const fd of this.reader.drainFds()) this.transport.closeFd(fd);
    this.onClose?.(reason);
  }

  private receive(data: Uint8Array, fds: readonly number[]): void {
    if (this.closedWith) {
      for (const fd of fds) this.transport.closeFd(fd);
      return;
    }
    this.reader.push(data, fds);
    try {
      for (let message = this.reader.next(); message; message = this.reader.next()) {
        this.dispatch(message);
        if (this.closedWith) return;
      }
    } catch (error) {
      this.transport.close();
      this.closed(
        new Error(error instanceof ProtocolError ? error.message : `bad message: ${String(error)}`),
      );
    }
  }

  private dispatch(message: RawMessage): void {
    try {
      const args = messageArgs(message);
      if (message.id === PW_ID_CORE) this.coreEvent(message.opcode, args);
      else if (message.id === this.registryId) this.registryEvent(message.opcode, args);
      else if (message.id !== PW_ID_CLIENT) {
        const proxy = this.proxies.get(message.id);
        proxy?.handlers[message.opcode]?.(args, message);
      }
    } finally {
      // Moire never keeps an fd from the control plane (add_mem is for client nodes).
      for (const fd of message.fds) this.transport.closeFd(fd);
    }
  }

  private coreEvent(opcode: number, args: readonly Pod[]): void {
    switch (opcode) {
      case CoreEvent.info:
        this.serverInfo = decode.coreInfo(args);
        return;
      case CoreEvent.done: {
        this.syncs.get(argInt(args, 1))?.resolve();
        return;
      }
      case CoreEvent.ping:
        this.send(PW_ID_CORE, CoreMethod.pong, methods.pong(argInt(args, 0), argInt(args, 1)));
        return;
      case CoreEvent.error: {
        const id = argInt(args, 0);
        const error = {
          seq: argInt(args, 1),
          res: argInt(args, 2),
          message: (argString(args, 3) ?? "").slice(0, 512),
        };
        const proxy = this.proxies.get(id);
        if (proxy) {
          proxy.errors.push(error);
          proxy.errors.splice(0, proxy.errors.length - MAX_ERRORS_PER_PROXY);
        } else if (id === PW_ID_CORE) {
          this.syncs
            .get(error.seq)
            ?.reject(new PipeWireError("error", `PipeWire: ${error.message}`));
        }
        return;
      }
      case CoreEvent.removeId: {
        const id = argInt(args, 0);
        const proxy = this.proxies.get(id);
        if (!proxy) return;
        proxy.removed = true;
        this.proxies.delete(id);
        this.freeIds.push(id);
        this.freeIds.sort((a, b) => a - b);
        return;
      }
      case CoreEvent.boundId: {
        const proxy = this.proxies.get(argInt(args, 0));
        if (proxy) proxy.globalId = argInt(args, 1);
        return;
      }
      default:
      // add_mem, remove_mem, bound_props: nothing for a control client to do.
    }
  }

  private registryEvent(opcode: number, args: readonly Pod[]): void {
    if (opcode === RegistryEvent.global) {
      const global = decode.global(args);
      this.globals.set(global.id, global);
    } else if (opcode === RegistryEvent.globalRemove) {
      this.globals.delete(argInt(args, 0));
    } else return;
    this.onRegistryChange?.();
  }
}

function cancelled(): PipeWireError {
  return new PipeWireError("cancelled", "Audio request cancelled.");
}

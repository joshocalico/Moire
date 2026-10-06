import { DbusRemoteError, SessionBus } from "@moire/dbus";

export const STORAGE_BUS = "org.moire.SystemManagement1";
export const STORAGE_PATH = "/org/moire/Storage1";
export const STORAGE_INTERFACE = "org.moire.Storage1";

declare const volumeIdentity: unique symbol;
export type StorageVolumeId = string & { readonly [volumeIdentity]: true };
export type StorageAction = "mount" | "unmount" | "eject";
export type StorageErrorCode =
  | "permission"
  | "busy"
  | "gone"
  | "unsupported"
  | "readonly"
  | "failed"
  | "unknown";
export class StorageControlError extends Error {
  readonly errorName: string;
  constructor(
    readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StorageControlError";
    this.errorName = `${STORAGE_INTERFACE}.Error.${code}`;
  }
}
export type StorageVolume = {
  id: StorageVolumeId;
  label: string;
  device: string;
  sizeBytes: number | null;
  filesystem: string;
  mount:
    | { kind: "unmounted" }
    | { kind: "mounted"; paths: readonly [string, ...string[]] }
    | { kind: "unsupported"; message: string };
  canEject: boolean;
};
export type StorageOperation =
  | { kind: "idle" }
  | { kind: "pending"; id: StorageVolumeId; action: StorageAction }
  | {
      kind: "error" | "unknown";
      id: StorageVolumeId;
      action: StorageAction;
      code: StorageErrorCode;
      message: string;
    };
export type StorageDiscovery =
  | { kind: "loading" | "unavailable" | "error"; message: string }
  | { kind: "ready"; policy: "readonly" | "interactive"; volumes: readonly StorageVolume[] };
export type StorageState = { status: StorageDiscovery; operation: StorageOperation };
export type StorageSnapshot = StorageState & { revision: number };
export type StorageAdapter = {
  readonly state: StorageState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  mount(id: StorageVolumeId): Promise<void>;
  unmount(id: StorageVolumeId): Promise<void>;
  eject(id: StorageVolumeId): Promise<void>;
  dispose(): Promise<void>;
};
export type StorageClientState =
  | { kind: "loading" | "unavailable" | "error"; message: string }
  | { kind: "ready"; owner: string; snapshot: StorageSnapshot };
export type StorageActionRequest = { owner: string; id: StorageVolumeId; revision: number };
export type StorageClient = {
  readonly state: StorageClientState;
  subscribe(listener: (state: StorageClientState) => void): () => void;
  refresh(): Promise<void>;
  mount(request: StorageActionRequest): Promise<void>;
  unmount(request: StorageActionRequest): Promise<void>;
  eject(request: StorageActionRequest): Promise<void>;
  dispose(): Promise<void>;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid storage object");
  return value as Record<string, unknown>;
}
function boundedText(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error("Invalid storage text");
  return value;
}
export function parseStorageVolumeId(value: unknown): StorageVolumeId {
  const id = boundedText(value, 1024);
  if (!id.length) throw new Error("Invalid storage identity");
  return id as StorageVolumeId;
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new Error("Invalid storage revision");
  return value;
}
function action(value: unknown): StorageAction {
  if (value !== "mount" && value !== "unmount" && value !== "eject")
    throw new Error("Invalid storage action");
  return value;
}
function errorCode(value: unknown): StorageErrorCode {
  if (
    value !== "permission" &&
    value !== "busy" &&
    value !== "gone" &&
    value !== "unsupported" &&
    value !== "readonly" &&
    value !== "failed" &&
    value !== "unknown"
  )
    throw new Error("Invalid storage error");
  return value;
}
function parseVolume(value: unknown): StorageVolume {
  const raw = record(value),
    mounted = record(raw.mount);
  let mount: StorageVolume["mount"];
  if (mounted.kind === "unmounted") mount = { kind: "unmounted" };
  else if (mounted.kind === "unsupported")
    mount = { kind: "unsupported", message: boundedText(mounted.message) };
  else if (mounted.kind === "mounted") {
    if (!Array.isArray(mounted.paths) || !mounted.paths.length || mounted.paths.length > 8)
      throw new Error("Invalid storage mount paths");
    const paths = mounted.paths.map((value) => {
      const path = boundedText(value);
      if (!path.startsWith("/")) throw new Error("Invalid storage mount path");
      return path;
    });
    const first = paths[0];
    if (first === undefined) throw new Error("Invalid storage mount paths");
    mount = { kind: "mounted", paths: [first, ...paths.slice(1)] };
  } else throw new Error("Invalid storage mount state");
  if (
    raw.sizeBytes !== null &&
    (typeof raw.sizeBytes !== "number" || !Number.isSafeInteger(raw.sizeBytes) || raw.sizeBytes < 0)
  )
    throw new Error("Invalid storage size");
  if (typeof raw.canEject !== "boolean") throw new Error("Invalid storage capability");
  return {
    id: parseStorageVolumeId(raw.id),
    label: boundedText(raw.label, 512),
    device: boundedText(raw.device),
    sizeBytes: raw.sizeBytes,
    filesystem: boundedText(raw.filesystem, 128),
    mount,
    canEject: raw.canEject,
  };
}
/** Validate daemon/service data once, before it reaches the Files UI. */
export function parseStorageState(value: unknown): StorageState {
  const raw = record(value),
    discovery = record(raw.status),
    operation = record(raw.operation);
  let status: StorageDiscovery;
  if (discovery.kind === "ready") {
    if (discovery.policy !== "readonly" && discovery.policy !== "interactive")
      throw new Error("Invalid storage policy");
    if (!Array.isArray(discovery.volumes) || discovery.volumes.length > 64)
      throw new Error("Invalid storage volumes");
    const volumes = discovery.volumes.map(parseVolume);
    if (new Set(volumes.map((item) => item.id)).size !== volumes.length)
      throw new Error("Duplicate storage identity");
    status = { kind: "ready", policy: discovery.policy, volumes };
  } else if (
    discovery.kind === "loading" ||
    discovery.kind === "unavailable" ||
    discovery.kind === "error"
  )
    status = { kind: discovery.kind, message: boundedText(discovery.message) };
  else throw new Error("Invalid storage discovery");
  let parsedOperation: StorageOperation;
  if (operation.kind === "idle") parsedOperation = { kind: "idle" };
  else {
    const id = parseStorageVolumeId(operation.id),
      parsedAction = action(operation.action);
    if (operation.kind === "pending")
      parsedOperation = { kind: "pending", id, action: parsedAction };
    else if (operation.kind === "error" || operation.kind === "unknown")
      parsedOperation = {
        kind: operation.kind,
        id,
        action: parsedAction,
        code: errorCode(operation.code),
        message: boundedText(operation.message),
      };
    else throw new Error("Invalid storage operation");
  }
  return { status, operation: parsedOperation };
}
export function parseStorageSnapshot(value: unknown): StorageSnapshot {
  const raw = record(JSON.parse(boundedText(value, 8 * 1024 * 1024)));
  return { revision: revision(raw.revision), ...parseStorageState(raw) };
}

const failureMessages: Record<StorageErrorCode, string> = {
  permission: "Existing permissions do not allow this drive action.",
  busy: "The drive or another storage action is busy.",
  gone: "The drive or storage service changed. Refresh before trying again.",
  unsupported: "This drive action is unsupported.",
  readonly: "Drive actions are disabled by system policy.",
  failed: "The drive action failed.",
  unknown: "The drive action outcome is unknown. Check its current status before retrying.",
};
function remoteFailure(error: unknown): StorageControlError {
  if (error instanceof StorageControlError) return error;
  if (error instanceof DbusRemoteError) {
    const prefix = `${STORAGE_INTERFACE}.Error.`;
    if (error.errorName.startsWith(prefix)) {
      try {
        const code = errorCode(error.errorName.slice(prefix.length));
        return new StorageControlError(code, failureMessages[code]);
      } catch {
        /* Unknown remote errors remain uncertain. */
      }
    }
  }
  return new StorageControlError("unknown", failureMessages.unknown);
}

/** Observe the session service without owning the supplied bus or activating UDisks. */
export async function observeStorageStatus(
  bus: SessionBus,
  changed: (state: StorageClientState) => void,
  options: { actionTimeoutMs?: number; readTimeoutMs?: number } = {},
): Promise<StorageClient> {
  const actionTimeoutMs = options.actionTimeoutMs ?? 20000,
    readTimeoutMs = options.readTimeoutMs ?? 3000;
  for (const timeout of [actionTimeoutMs, readTimeoutMs])
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120000)
      throw new Error("Invalid storage timeout");
  let state: StorageClientState = { kind: "loading", message: "Connecting to drives" };
  let generation = 0,
    disposed = false,
    inFlight = false;
  let currentOwner: string | null = null;
  let removeSignals: (() => Promise<void>) | null = null;
  let disposal: Promise<void> | null = null;
  const listeners = new Set<(state: StorageClientState) => void>();
  const cancellations = new Set<AbortController>();
  const setups = new Set<Promise<void>>();
  const publish = (next: StorageClientState) => {
    if (disposed) return;
    state = next;
    changed(next);
    for (const listener of listeners) listener(next);
  };
  const revoke = () => {
    for (const controller of cancellations) controller.abort();
  };
  const load = async (owner: string, ticket: number) => {
    const controller = new AbortController();
    cancellations.add(controller);
    try {
      const reply = await bus.call(
        {
          destination: owner,
          path: STORAGE_PATH,
          interface: STORAGE_INTERFACE,
          member: "GetStatus",
        },
        { timeoutMs: readTimeoutMs, signal: controller.signal },
      );
      if (ticket !== generation || disposed)
        throw new StorageControlError("unknown", failureMessages.unknown);
      if (reply.signature !== "s" || reply.body?.length !== 1)
        throw new Error("Invalid storage reply");
      const snapshot = parseStorageSnapshot(reply.body[0]);
      if (
        state.kind !== "ready" ||
        state.owner !== owner ||
        snapshot.revision >= state.snapshot.revision
      )
        publish({ kind: "ready", owner, snapshot });
    } finally {
      cancellations.delete(controller);
    }
  };
  const removeDisconnect = bus.onDisconnect(() => {
    ++generation;
    currentOwner = null;
    revoke();
    publish({
      kind: "unavailable",
      message: "Drive service disconnected; any pending outcome is unknown",
    });
  });
  let removeOwner: () => Promise<void>;
  try {
    removeOwner = await bus.watchName(
      STORAGE_BUS,
      (owner) => {
        const ticket = ++generation;
        currentOwner = owner;
        revoke();
        const previous = removeSignals;
        removeSignals = null;
        publish({
          kind: owner ? "loading" : "unavailable",
          message: owner
            ? "Reading drives"
            : "Drive service unavailable; any pending outcome is unknown",
        });
        const setup = (async () => {
          await previous?.();
          if (!owner || ticket !== generation || disposed) return;
          const remove = await bus.subscribeSignal(
            { sender: owner, path: STORAGE_PATH, interface: STORAGE_INTERFACE, member: "Changed" },
            (message) => {
              if (ticket !== generation || disposed) return;
              try {
                if (message.signature !== "s" || message.body?.length !== 1)
                  throw new Error("Invalid storage signal");
                const snapshot = parseStorageSnapshot(message.body[0]);
                if (
                  state.kind === "ready" &&
                  state.owner === owner &&
                  snapshot.revision < state.snapshot.revision
                )
                  return;
                publish({ kind: "ready", owner, snapshot });
              } catch {
                publish({ kind: "error", message: "Invalid drive status; refresh to reconnect" });
              }
            },
            { timeoutMs: readTimeoutMs },
          );
          if (ticket !== generation || disposed) {
            await remove();
            return;
          }
          removeSignals = remove;
          await load(owner, ticket);
        })().catch(() => {
          if (ticket === generation)
            publish({ kind: "error", message: "Unable to read drive status" });
        });
        setups.add(setup);
        void setup.finally(() => setups.delete(setup));
      },
      { timeoutMs: readTimeoutMs },
    );
  } catch (error) {
    removeDisconnect();
    throw error;
  }
  const invoke = async (member: string, request?: StorageActionRequest) => {
    if (disposed || state.kind !== "ready")
      throw new StorageControlError("gone", failureMessages.gone);
    if (inFlight || (request && state.snapshot.operation.kind === "pending"))
      throw new StorageControlError("busy", failureMessages.busy);
    const expected = state,
      ticket = generation;
    if (request) {
      parseStorageVolumeId(request.id);
      revision(request.revision);
      if (request.owner !== expected.owner || request.revision !== expected.snapshot.revision)
        throw new StorageControlError("gone", failureMessages.gone);
    }
    const controller = new AbortController();
    cancellations.add(controller);
    inFlight = true;
    try {
      const reply = await bus.call(
        {
          destination: expected.owner,
          path: STORAGE_PATH,
          interface: STORAGE_INTERFACE,
          member,
          signature: request ? "su" : "",
          body: request ? [request.id, request.revision] : [],
        },
        { timeoutMs: actionTimeoutMs, signal: controller.signal },
      );
      if (ticket !== generation || disposed)
        throw new StorageControlError("unknown", failureMessages.unknown);
      if ((reply.signature ?? "") !== "" || (reply.body?.length ?? 0) !== 0)
        throw new Error("Invalid storage action reply");
      await load(expected.owner, ticket);
    } catch (error) {
      const failure = remoteFailure(error);
      if (ticket === generation && !disposed) {
        try {
          await load(expected.owner, ticket);
        } catch {
          publish({ kind: "error", message: failureMessages.unknown });
        }
      }
      throw failure;
    } finally {
      cancellations.delete(controller);
      inFlight = false;
    }
  };
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh() {
      if (state.kind !== "ready" && currentOwner && !disposed) await load(currentOwner, generation);
      await invoke("Refresh");
    },
    mount: (request) => invoke("Mount", request),
    unmount: (request) => invoke("Unmount", request),
    eject: (request) => invoke("Eject", request),
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      ++generation;
      revoke();
      listeners.clear();
      removeDisconnect();
      const remove = removeSignals;
      removeSignals = null;
      disposal = (async () => {
        await Promise.allSettled([removeOwner(), remove?.(), ...setups]);
      })();
      return disposal;
    },
  };
}

/** Files owns this session-bus connection; UDisks remains behind the shared service. */
export async function connectStorageStatus(): Promise<StorageClient> {
  const bus = await SessionBus.connect();
  try {
    const client = await observeStorageStatus(bus, () => {});
    let disposal: Promise<void> | null = null;
    return {
      get state() {
        return client.state;
      },
      subscribe: client.subscribe,
      refresh: client.refresh,
      mount: client.mount,
      unmount: client.unmount,
      eject: client.eject,
      dispose() {
        disposal ??= client.dispose().finally(() => bus.close());
        return disposal;
      },
    };
  } catch (error) {
    bus.close();
    throw error;
  }
}

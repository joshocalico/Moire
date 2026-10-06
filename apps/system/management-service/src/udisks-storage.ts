import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { SessionBus, DbusRemoteError, variant, type DbusDisposer } from "@moire/dbus";
import {
  parseStorageVolumeId,
  StorageControlError,
  type StorageAdapter,
  type StorageState,
  type StorageVolume,
  type StorageVolumeId,
  type StorageAction,
  type StorageErrorCode,
  type StorageOperation,
} from "@moire/system-management/storage-status";

const UDISKS = "org.freedesktop.UDisks2",
  ROOT = "/org/freedesktop/UDisks2";
const MANAGER = "org.freedesktop.DBus.ObjectManager",
  PROPERTIES = "org.freedesktop.DBus.Properties";
const DRIVE = UDISKS + ".Drive",
  BLOCK = UDISKS + ".Block",
  FILESYSTEM = UDISKS + ".Filesystem";
const MAX_OBJECTS = 96;
export type UDisksStorageOptions = {
  connect?: () => Promise<SessionBus>;
  policy?: "readonly" | "interactive";
  callTimeoutMs?: number;
  pollMs?: number;
};
type Drive = {
  path: string;
  physicalId: string;
  mediaId: string;
  label: string;
  external: boolean;
  media: boolean;
  usb: boolean;
  powerOff: boolean;
  ejectable: boolean;
  sibling: string;
};
type Block = {
  path: string;
  drive: string;
  backing: string;
  system: boolean;
  ignore: boolean;
  fingerprint: string;
  device: string;
  label: string;
  filesystem: string;
  sizeBytes: number | null;
  mount: StorageVolume["mount"] | null;
};
type Candidate = {
  volume: StorageVolume;
  block: Block;
  drive: Drive;
  method: "PowerOff" | "Eject" | null;
  busy: boolean;
};
type Snapshot = {
  drives: Map<string, Drive>;
  blocks: Map<string, Block>;
  candidates: Map<StorageVolumeId, Candidate>;
  paths: string[];
};
type Attempt = {
  id: StorageVolumeId;
  action: StorageAction;
  owner: string;
  blockPath: string;
  drivePath: string;
  driveId: string;
  method: "Mount" | "Unmount" | "Eject" | "PowerOff";
  settled: boolean;
};
function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
  );
}
function dictionary(value: unknown, limit: number): Record<string, unknown> {
  if (!record(value) || Object.keys(value).length > limit)
    throw new Error("Invalid storage dictionary");
  return value;
}
function property(raw: Record<string, unknown>, key: string, signature: string): unknown {
  const v = raw[key];
  if (!record(v) || v.signature !== signature || !("value" in v))
    throw new Error("Invalid storage property");
  return v.value;
}
function text(value: unknown, limit = 512): string {
  if (typeof value !== "string" || value.length > limit || value.includes("\0"))
    throw new Error("Invalid storage text");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid storage boolean");
  return value;
}
function uint64(value: unknown): bigint {
  if (typeof value !== "bigint" || value < 0n || value > 0xffff_ffff_ffff_ffffn)
    throw new Error("Invalid storage size");
  return value;
}
function objectPath(value: unknown): string {
  const p = text(value, 512);
  if (!/^\/(?:[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*)?$/.test(p))
    throw new Error("Invalid storage object path");
  return p;
}
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function nulBytes(value: unknown): Buffer {
  if (
    !(value instanceof Uint8Array) ||
    value.length < 2 ||
    value.length > 4096 ||
    value[value.length - 1] !== 0 ||
    value.subarray(0, value.length - 1).includes(0)
  )
    throw new Error("Invalid storage path bytes");
  return Buffer.from(value.subarray(0, value.length - 1));
}
function decodePath(bytes: Buffer): string {
  const p = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!p.startsWith("/") || p.includes("\0")) throw new Error("Unsupported storage path");
  return p;
}
function mountPoints(value: unknown): StorageVolume["mount"] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("Invalid storage mount points");
  const paths: string[] = [];
  for (const raw of value) {
    const bytes = nulBytes(raw);
    try {
      paths.push(decodePath(bytes));
    } catch {
      return { kind: "unsupported", message: "Mount path encoding is unsupported" };
    }
  }
  const [first, ...rest] = Array.from(new Set(paths)).sort();
  return first === undefined ? { kind: "unmounted" } : { kind: "mounted", paths: [first, ...rest] };
}
function error(code: StorageErrorCode): StorageControlError {
  const messages: Record<StorageErrorCode, string> = {
    permission: "Storage operation denied without authentication",
    busy: "Drive or filesystem is busy",
    gone: "The selected drive or filesystem changed",
    unsupported: "This storage operation is unsupported",
    readonly: "Storage controls are read-only",
    failed: "UDisks storage operation failed",
    unknown: "Storage operation outcome is unknown; do not retry automatically",
  };
  return new StorageControlError(code, messages[code]);
}
function classify(cause: unknown, sent: boolean): StorageErrorCode {
  if (cause instanceof StorageControlError)
    return sent && cause.code === "gone" ? "unknown" : cause.code;
  if (cause instanceof DbusRemoteError) {
    if (/NotAuthorized|AccessDenied|PermissionDenied/.test(cause.errorName)) return "permission";
    if (cause.errorName === UDISKS + ".Error.DeviceBusy") return "busy";
    if (/UnknownObject|UnknownInterface/.test(cause.errorName)) return "gone";
    if (cause.errorName === UDISKS + ".Error.NotSupported") return "unsupported";
    if (!/NoReply|Timeout|Disconnected|NameHasNoOwner|ServiceUnknown/.test(cause.errorName))
      return "failed";
  }
  return sent ? "unknown" : "failed";
}

/** Existing UDisks owner only; interactive writes never request authentication. */
export async function createUDisksStorageAdapter(
  options: UDisksStorageOptions = {},
): Promise<StorageAdapter> {
  const policy = options.policy ?? process.env.MOIRE_STORAGE_CONTROL ?? "readonly",
    timeout = options.callTimeoutMs ?? 2500,
    pollMs = options.pollMs ?? 0;
  let state: StorageState = {
    status: { kind: "loading", message: "Reading removable drives" },
    operation: { kind: "idle" },
  };
  let bus: SessionBus | null = null,
    owner: string | null = null,
    disposed = false,
    epoch = 0;
  let scope = new AbortController(),
    refreshing: Promise<void> | null = null,
    refreshAgain = false,
    mutating = false,
    topologyOverflow = false;
  let snapshot: Snapshot | null = null;
  const attempts = new Map<StorageVolumeId, Attempt>();
  let disposal: Promise<void> | null = null;
  let watcher: DbusDisposer | null = null,
    disconnect = () => {},
    poll: ReturnType<typeof setInterval> | null = null;
  const subscriptions = new Map<string, DbusDisposer>(),
    generations = new Map<string, number>(),
    listeners = new Set<() => void>();
  const publish = (next: StorageState) => {
    if (disposed || isDeepStrictEqual(next, state)) return;
    state = next;
    for (const listener of Array.from(listeners)) listener();
  };
  const operation = (next: StorageOperation) => publish({ ...state, operation: next });
  const current = (expected: string, version: number) => {
    if (disposed || owner !== expected || epoch !== version || scope.signal.aborted)
      throw error("gone");
  };
  const callOptions = (deadline: number) => {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining < 1) throw new Error("Storage deadline expired");
    return { signal: scope.signal, timeoutMs: Math.min(timeout, remaining) };
  };
  async function call(
    expected: string,
    version: number,
    p: string,
    iface: string,
    member: string,
    signature: string,
    body: unknown[],
    deadline: number,
  ) {
    current(expected, version);
    if (!bus) throw error("gone");
    const result = await bus.call(
      { destination: expected, path: p, interface: iface, member, signature, body },
      callOptions(deadline),
    );
    current(expected, version);
    return result;
  }
  function parse(raw: unknown, expected: string): Snapshot {
    if (topologyOverflow) throw new Error("Storage topology history limit reached");
    // The existing codec decodes object-path-keyed dictionaries as entry tuples.
    if (!Array.isArray(raw) || raw.length > MAX_OBJECTS)
      throw new Error("Invalid managed storage objects");
    const objects: [string, unknown][] = [];
    const identities = new Set<string>();
    for (const pair of raw) {
      if (!Array.isArray(pair) || pair.length !== 2)
        throw new Error("Invalid managed storage entry");
      const p = objectPath(pair[0]);
      if (identities.has(p)) throw new Error("Duplicate managed storage object");
      identities.add(p);
      objects.push([p, pair[1]]);
    }
    const drives = new Map<string, Drive>(),
      blocks = new Map<string, Block>(),
      paths: string[] = [];
    for (const [p, unknownInterfaces] of objects) {
      objectPath(p);
      if (!p.startsWith(ROOT + "/")) throw new Error("Invalid managed storage path");
      const interfaces = dictionary(unknownInterfaces, 16);
      for (const properties of Object.values(interfaces)) dictionary(properties, 128);
      if (FILESYSTEM in interfaces && !(BLOCK in interfaces))
        throw new Error("Filesystem block relationship missing");
      if (DRIVE in interfaces) {
        const d = dictionary(interfaces[DRIVE], 128),
          usb = text(property(d, "ConnectionBus", "s")) === "usb",
          removable = boolean(property(d, "Removable", "b")),
          mediaRemovable = boolean(property(d, "MediaRemovable", "b"));
        const physicalId = hash([
          expected,
          p,
          generations.get(p) ?? 0,
          text(property(d, "Id", "s")),
          text(property(d, "Serial", "s")),
          uint64(property(d, "TimeDetected", "t")).toString(),
        ]);
        drives.set(p, {
          path: p,
          physicalId,
          mediaId: hash([physicalId, uint64(property(d, "TimeMediaDetected", "t")).toString()]),
          label: [text(property(d, "Vendor", "s"), 128), text(property(d, "Model", "s"), 256)]
            .filter(Boolean)
            .join(" "),
          external: usb || removable || mediaRemovable,
          media: boolean(property(d, "MediaAvailable", "b")),
          usb,
          powerOff: boolean(property(d, "CanPowerOff", "b")),
          ejectable: boolean(property(d, "Ejectable", "b")),
          sibling: text(property(d, "SiblingId", "s")),
        });
      }
      if (BLOCK in interfaces) {
        const b = dictionary(interfaces[BLOCK], 128),
          rawDevice = nulBytes(property(b, "Device", "ay")),
          size = uint64(property(b, "Size", "t"));
        const device = decodePath(rawDevice);
        blocks.set(p, {
          path: p,
          drive: objectPath(property(b, "Drive", "o")),
          backing: objectPath(property(b, "CryptoBackingDevice", "o")),
          system: boolean(property(b, "HintSystem", "b")),
          ignore: boolean(property(b, "HintIgnore", "b")),
          fingerprint: hash([
            p,
            generations.get(p) ?? 0,
            text(property(b, "Id", "s")),
            text(property(b, "IdUUID", "s")),
            uint64(property(b, "DeviceNumber", "t")).toString(),
            rawDevice.toString("hex"),
            size.toString(),
          ]),
          device,
          label: text(property(b, "IdLabel", "s")),
          filesystem: text(property(b, "IdType", "s"), 128),
          sizeBytes: size === 0n || size > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(size),
          mount:
            FILESYSTEM in interfaces
              ? mountPoints(property(dictionary(interfaces[FILESYSTEM], 128), "MountPoints", "aay"))
              : null,
        });
      }
      if (DRIVE in interfaces || BLOCK in interfaces) paths.push(p);
    }
    let unresolved = false;
    const relatedDrive = (block: Block): Drive | undefined => {
      const seen = new Set<string>();
      let next: Block | undefined = block;
      let resolved: Drive | undefined;
      while (next) {
        if (seen.has(next.path)) {
          unresolved = true;
          return;
        }
        seen.add(next.path);
        if (next.drive !== "/") {
          const d = drives.get(next.drive);
          if (!d || (resolved && resolved.path !== d.path)) {
            unresolved = true;
            return;
          }
          resolved = d;
        }
        if (next.backing === "/") return resolved;
        next = blocks.get(next.backing);
        if (!next) unresolved = true;
      }
    };
    const relations = new Map<string, Drive>();
    for (const b of blocks.values()) {
      const d = relatedDrive(b);
      if (d) relations.set(b.path, d);
    }
    const candidates = new Map<StorageVolumeId, Candidate>();
    for (const b of blocks.values()) {
      const d = relations.get(b.path);
      if (!d || !d.external || !d.media || b.system || b.ignore || b.mount === null) continue;
      const related = Array.from(blocks.values()).filter(
        (other) => relations.get(other.path)?.path === d.path,
      );
      const busy = related.some(
        (other) => other.mount !== null && other.mount.kind !== "unmounted",
      );
      const protectedDrive = related.some((other) => other.system);
      const siblings =
        d.sibling !== "" &&
        Array.from(drives.values()).some(
          (other) => other.path !== d.path && other.sibling === d.sibling,
        );
      const method =
        !unresolved && !busy && !protectedDrive
          ? d.usb && d.powerOff && !siblings
            ? "PowerOff"
            : d.ejectable
              ? "Eject"
              : null
          : null;
      const id = parseStorageVolumeId("udisks:" + hash([expected, b.fingerprint, d.mediaId]));
      const volume: StorageVolume = {
        id,
        label: b.label || d.label || b.device,
        device: b.device,
        sizeBytes: b.sizeBytes,
        filesystem: b.filesystem,
        mount: b.mount,
        canEject: method !== null,
      };
      candidates.set(id, { volume, block: b, drive: d, method, busy });
    }
    if (candidates.size > 64) throw new Error("Too many removable filesystems");
    return { drives, blocks, candidates, paths: paths.sort() };
  }
  async function read(expected: string, version: number, deadline: number): Promise<Snapshot> {
    const result = await call(
      expected,
      version,
      ROOT,
      MANAGER,
      "GetManagedObjects",
      "",
      [],
      deadline,
    );
    if (result.signature !== "a{oa{sa{sv}}}" || result.body?.length !== 1)
      throw new Error("Invalid managed storage reply");
    return parse(result.body[0], expected);
  }
  async function subscribe(
    expected: string,
    version: number,
    p: string,
    iface: string,
    member: string,
    deadline: number,
  ) {
    const key = `${p}|${iface}|${member}`;
    if (subscriptions.has(key)) return false;
    current(expected, version);
    if (!bus) throw error("gone");
    const stop = await bus.subscribeSignal(
      { sender: expected, path: p, interface: iface, member },
      (message) => {
        if (owner !== expected || epoch !== version) return;
        if (iface === MANAGER) {
          if (
            (member === "InterfacesAdded" && message.signature !== "oa{sa{sv}}") ||
            (member === "InterfacesRemoved" && message.signature !== "oas")
          )
            return;
          const path = message.body?.[0];
          if (typeof path !== "string" || path.length > 512 || !path.startsWith(ROOT + "/")) return;
          const changed = message.body?.[1];
          const interfaces =
            member === "InterfacesAdded" && record(changed)
              ? Object.keys(changed)
              : member === "InterfacesRemoved" && Array.isArray(changed)
                ? changed
                : [];
          if (
            interfaces.length > 16 ||
            !interfaces.some((iface) => [DRIVE, BLOCK, FILESYSTEM].includes(String(iface)))
          )
            return;
          if (!generations.has(path) && generations.size >= 192) topologyOverflow = true;
          else generations.set(path, (generations.get(path) ?? 0) + 1);
        } else {
          if (
            message.signature !== "sa{sv}as" ||
            ![DRIVE, BLOCK, FILESYSTEM].includes(String(message.body?.[0]))
          )
            return;
        }
        void refresh();
      },
      callOptions(deadline),
    );
    try {
      current(expected, version);
      subscriptions.set(key, stop);
    } catch (cause) {
      await stop();
      throw cause;
    }
    return true;
  }
  async function sync(expected: string, version: number, next: Snapshot, deadline: number) {
    const wanted = new Set(next.paths.map((p) => `${p}|${PROPERTIES}|PropertiesChanged`));
    const retired: Promise<void>[] = [];
    for (const [key, stop] of subscriptions)
      if (key.includes(`|${PROPERTIES}|`) && !wanted.has(key)) {
        subscriptions.delete(key);
        retired.push(stop());
      }
    await Promise.allSettled(retired);
    current(expected, version);
    let added = false;
    for (const p of next.paths)
      added =
        (await subscribe(expected, version, p, PROPERTIES, "PropertiesChanged", deadline)) || added;
    return added;
  }
  function reconcile(next: Snapshot) {
    for (const saved of attempts.values()) {
      if (saved.owner !== owner) continue;
      const selected = next.candidates.get(saved.id),
        drive = next.drives.get(saved.drivePath);
      let complete = false;
      if (saved.method === "Mount") complete = selected?.volume.mount.kind === "mounted";
      else if (saved.method === "Unmount") complete = selected?.volume.mount.kind === "unmounted";
      else if (saved.method === "PowerOff") complete = !drive;
      else complete = !drive || (drive.physicalId === saved.driveId && !drive.media);
      const displayed = state.operation.kind !== "idle" && state.operation.id === saved.id;
      if (complete) {
        saved.settled = true;
        attempts.delete(saved.id);
        if (displayed) operation({ kind: "idle" });
      } else if (
        displayed &&
        ((drive && drive.physicalId !== saved.driveId) ||
          ((saved.method === "Mount" || saved.method === "Unmount") && !selected))
      ) {
        operation({
          kind: "unknown",
          id: saved.id,
          action: saved.action,
          code: "unknown",
          message: error("unknown").message,
        });
      }
    }
  }
  async function refresh(deadline = performance.now() + 8000): Promise<void> {
    if (disposed || !owner) return;
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    const expected = owner,
      version = epoch;
    refreshing = (async () => {
      try {
        await subscribe(expected, version, ROOT, MANAGER, "InterfacesAdded", deadline);
        await subscribe(expected, version, ROOT, MANAGER, "InterfacesRemoved", deadline);
        let next = await read(expected, version, deadline);
        if (await sync(expected, version, next, deadline))
          next = await read(expected, version, deadline);
        current(expected, version);
        snapshot = next;
        reconcile(next);
        publish({
          status: {
            kind: "ready",
            policy: policy === "interactive" ? "interactive" : "readonly",
            volumes: Array.from(next.candidates.values(), (c) => c.volume).sort((a, b) =>
              a.id.localeCompare(b.id),
            ),
          },
          operation: state.operation,
        });
      } catch {
        if (!disposed && owner === expected && epoch === version) {
          snapshot = null;
          publish({
            status: { kind: "error", message: "Unable to read removable drives" },
            operation: state.operation,
          });
        }
      }
    })();
    try {
      await refreshing;
    } finally {
      refreshing = null;
      if (refreshAgain) {
        refreshAgain = false;
        if (owner && !disposed) void refresh();
      }
    }
  }
  async function assertOwner(expected: string, version: number, deadline: number) {
    current(expected, version);
    if (!bus) throw error("gone");
    const result = await bus.call(
      {
        destination: "org.freedesktop.DBus",
        path: "/org/freedesktop/DBus",
        interface: "org.freedesktop.DBus",
        member: "GetNameOwner",
        signature: "s",
        body: [UDISKS],
      },
      callOptions(deadline),
    );
    current(expected, version);
    if (result.signature !== "s" || result.body?.[0] !== expected) throw error("gone");
  }
  async function act(id: StorageVolumeId, action: StorageAction): Promise<void> {
    const expected = owner,
      version = epoch;
    let sent = false,
      ownsMutation = false,
      saved: Attempt | null = null;
    try {
      if (policy !== "interactive") throw error("readonly");
      if (disposed || !expected || state.status.kind !== "ready" || !snapshot?.candidates.has(id))
        throw error("gone");
      if (mutating || state.operation.kind === "pending") throw error("busy");
      if (attempts.has(id) || (state.operation.kind === "unknown" && state.operation.id === id))
        throw error("unknown");
      if (attempts.size >= 64) throw error("busy");
      mutating = true;
      ownsMutation = true;
      const deadline = performance.now() + 12000;
      await assertOwner(expected, version, deadline);
      const fresh = await read(expected, version, deadline);
      const selected = fresh.candidates.get(id);
      if (!selected) throw error("gone");
      if (selected.volume.mount.kind === "unsupported") throw error("unsupported");
      if (action === "mount" && selected.volume.mount.kind !== "unmounted") throw error("busy");
      if (action === "unmount" && selected.volume.mount.kind !== "mounted")
        throw error("unsupported");
      if (action === "eject" && !selected.method) {
        if (selected.busy) throw error("busy");
        throw error("unsupported");
      }
      await assertOwner(expected, version, deadline);
      const method =
        action === "mount" ? "Mount" : action === "unmount" ? "Unmount" : selected.method;
      if (!method) throw error("unsupported");
      saved = {
        id,
        action,
        owner: expected,
        blockPath: selected.block.path,
        drivePath: selected.drive.path,
        driveId: selected.drive.physicalId,
        method,
        settled: false,
      };
      attempts.set(id, saved);
      operation({ kind: "pending", id, action });
      sent = true;
      const result = await call(
        expected,
        version,
        action === "eject" ? selected.drive.path : selected.block.path,
        action === "eject" ? DRIVE : FILESYSTEM,
        method,
        "a{sv}",
        [{ "auth.no_user_interaction": variant("b", true) }],
        deadline,
      );
      if (method === "Mount") {
        if (result.signature !== "s" || result.body?.length !== 1)
          throw new Error("Invalid mount reply");
        decodePath(Buffer.from(text(result.body[0], 4096)));
      } else if ((result.signature ?? "") !== "" || (result.body?.length ?? 0) !== 0)
        throw new Error("Invalid storage reply");
      await refresh(deadline);
    } catch (cause) {
      if (saved?.settled) return;
      const code = classify(cause, sent),
        failure = error(code);
      if (
        !disposed &&
        owner === expected &&
        epoch === version &&
        (ownsMutation ||
          (!mutating && state.operation.kind !== "pending" && state.operation.kind !== "unknown"))
      ) {
        if (code !== "unknown" && saved) attempts.delete(saved.id);
        operation({
          kind: code === "unknown" ? "unknown" : "error",
          id,
          action,
          code,
          message: failure.message,
        });
      }
      throw failure;
    } finally {
      if (ownsMutation) mutating = false;
    }
  }
  const adapter: StorageAdapter = {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    mount: (id) => act(id, "mount"),
    unmount: (id) => act(id, "unmount"),
    eject: (id) => act(id, "eject"),
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      scope.abort();
      if (poll) clearInterval(poll);
      disconnect();
      listeners.clear();
      disposal = (async () => {
        await watcher?.().catch(() => {});
        await Promise.allSettled(Array.from(subscriptions.values(), (stop) => stop()));
        subscriptions.clear();
        attempts.clear();
        bus?.close();
        bus = null;
      })();
      return disposal;
    },
  };
  const unavailable = (message: string) =>
    publish({ status: { kind: "unavailable", message }, operation: state.operation });
  const lose = () => {
    epoch++;
    scope.abort();
    owner = null;
    snapshot = null;
    if (state.operation.kind === "pending") {
      operation({
        kind: "unknown",
        id: state.operation.id,
        action: state.operation.action,
        code: "unknown",
        message: error("unknown").message,
      });
    }
    attempts.clear();
  };
  if (
    (policy !== "readonly" && policy !== "interactive") ||
    !Number.isInteger(timeout) ||
    timeout < 10 ||
    timeout > 5000 ||
    !Number.isInteger(pollMs) ||
    pollMs < 0 ||
    pollMs > 60000
  ) {
    publish({
      status: { kind: "error", message: "Invalid storage control policy or timing" },
      operation: { kind: "idle" },
    });
    return adapter;
  }
  if (!options.connect && process.platform !== "linux") {
    unavailable("UDisks storage backend unavailable");
    return adapter;
  }
  try {
    bus = await (options.connect
      ? options.connect()
      : SessionBus.connect("unix:path=/run/dbus/system_bus_socket", { timeoutMs: timeout }));
    disconnect = bus.onDisconnect(() => {
      lose();
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      unavailable("UDisks bus disconnected");
    });
    watcher = await bus.watchName(
      UDISKS,
      (next) => {
        lose();
        scope = new AbortController();
        owner = next;
        generations.clear();
        topologyOverflow = false;
        const old = Array.from(subscriptions.values());
        subscriptions.clear();
        void Promise.allSettled(old.map((stop) => stop()));
        publish({
          status: next
            ? { kind: "loading", message: "Reading removable drives" }
            : { kind: "unavailable", message: "UDisks storage backend unavailable" },
          operation: state.operation,
        });
        if (next) void refresh();
      },
      { timeoutMs: timeout },
    );
    if (pollMs) {
      poll = setInterval(() => {
        void refresh();
      }, pollMs);
      poll.unref();
    }
    await refresh();
  } catch {
    bus?.close();
    unavailable("UDisks system bus unavailable");
  }
  return adapter;
}

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  StorageControlError,
  parseStorageVolumeId,
  parseStorageState,
  type StorageAdapter,
  type StorageState,
  type StorageVolume,
} from "@moire/system-management/storage-status";
import { createUDisksStorageAdapter } from "./udisks-storage";
import { SessionBus, DbusRemoteError, variant, type DbusVariant } from "@moire/dbus";

const UDISKS = "org.freedesktop.UDisks2",
  ROOT = "/org/freedesktop/UDisks2";
const MANAGER = "org.freedesktop.DBus.ObjectManager",
  PROPERTIES = "org.freedesktop.DBus.Properties";
const DRIVE = UDISKS + ".Drive",
  BLOCK = UDISKS + ".Block",
  FILESYSTEM = UDISKS + ".Filesystem";
const USB = ROOT + "/drives/UsbFixture",
  INTERNAL = ROOT + "/drives/InternalFixture";
const VOLUME = ROOT + "/block_devices/fixture1",
  HIDDEN = ROOT + "/block_devices/fixture2";
const SYSTEM = ROOT + "/block_devices/internal1",
  CRYPTO = ROOT + "/block_devices/cleartext";
const mountedPath = "/run/media/fixture/Drive folder";
const bytes = (value: string) => Buffer.from(value + "\0");
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
class StorageFixture {
  readonly objects: Record<string, Record<string, Record<string, DbusVariant>>> = {};
  readonly reads: string[] = [];
  readonly mutations: { path: string; member: string; body: unknown[] }[] = [];
  holdReads = false;
  holdMutation = false;
  denied = false;
  busy = false;
  failed = false;
  releases: (() => void)[] = [];
  constructor(readonly bus: SessionBus) {
    this.drive(USB, "usb");
    this.drive(INTERNAL, "ata");
    this.block(VOLUME, USB, "fixture-one");
    this.block(HIDDEN, USB, "fixture-hidden");
    this.set(HIDDEN, BLOCK, "HintIgnore", "b", true);
    this.block(SYSTEM, INTERNAL, "fixture-internal");
    this.set(SYSTEM, BLOCK, "HintSystem", "b", true);
    bus.exportObject(ROOT, {
      name: MANAGER,
      methods: {
        GetManagedObjects: {
          inSignature: "",
          outSignature: "a{oa{sa{sv}}}",
          handler: async () => {
            this.reads.push("GetManagedObjects");
            if (this.holdReads) await new Promise<void>((resolve) => this.releases.push(resolve));
            return { body: [this.objects] };
          },
        },
      },
    });
  }
  drive(p: string, connectionBus: string) {
    this.objects[p] = {
      [DRIVE]: {
        Id: variant("s", p.split("/").at(-1) ?? "fixture"),
        Vendor: variant("s", "Fixture producer"),
        Model: variant("s", "Disposable USB fixture"),
        Serial: variant("s", "fixture-serial"),
        ConnectionBus: variant("s", connectionBus),
        Removable: variant("b", connectionBus === "usb"),
        MediaRemovable: variant("b", false),
        MediaAvailable: variant("b", true),
        Ejectable: variant("b", false),
        CanPowerOff: variant("b", true),
        SiblingId: variant("s", ""),
        TimeDetected: variant("t", 10n),
        TimeMediaDetected: variant("t", 11n),
        Size: variant("t", 1024n),
      },
    };
    this.methods(p, DRIVE, ["Eject", "PowerOff"]);
  }
  block(p: string, drive: string, uuid: string) {
    this.objects[p] = {
      [BLOCK]: {
        Drive: variant("o", drive),
        Device: variant("ay", bytes("/dev/disposable-fixture")),
        DeviceNumber: variant("t", BigInt(Object.keys(this.objects).length + 100)),
        Id: variant("s", uuid),
        IdUUID: variant("s", uuid),
        IdLabel: variant("s", "Fixture volume"),
        IdType: variant("s", "ext4"),
        IdUsage: variant("s", "filesystem"),
        Size: variant("t", 1024n),
        HintIgnore: variant("b", false),
        HintSystem: variant("b", false),
        ReadOnly: variant("b", false),
        CryptoBackingDevice: variant("o", "/"),
      },
      [FILESYSTEM]: { MountPoints: variant("aay", []) },
    };
    this.methods(p, FILESYSTEM, ["Mount", "Unmount"]);
  }
  methods(p: string, iface: string, members: string[]) {
    const methods: Parameters<SessionBus["exportObject"]>[1]["methods"] = {};
    for (const member of members)
      methods[member] = {
        inSignature: "a{sv}",
        outSignature: member === "Mount" ? "s" : "",
        handler: async ({ body }) => {
          this.mutations.push({ path: p, member, body });
          assert.equal(body.length, 1);
          assert(isRecord(body[0]));
          assert.deepEqual(Object.keys(body[0]), ["auth.no_user_interaction"]);
          assert.deepEqual(body[0]["auth.no_user_interaction"], variant("b", true));
          if (this.holdMutation) await new Promise<void>((resolve) => this.releases.push(resolve));
          if (this.denied)
            throw new DbusRemoteError(
              "org.freedesktop.UDisks2.Error.NotAuthorized",
              "fixture sensitive error must not escape",
            );
          if (this.failed)
            throw new DbusRemoteError(
              "org.freedesktop.UDisks2.Error.Failed",
              "fixture raw failure not public",
            );
          if (this.busy)
            throw new DbusRemoteError(
              "org.freedesktop.UDisks2.Error.DeviceBusy",
              "fixture busy raw detail",
            );
          return { body: member === "Mount" ? [mountedPath] : [] };
        },
      };
    this.bus.exportObject(p, { name: iface, methods });
  }
  props(p: string, iface: string) {
    const raw = this.objects[p]?.[iface];
    assert(raw);
    return raw;
  }
  set(p: string, iface: string, key: string, signature: string, value: unknown) {
    this.props(p, iface)[key] = variant(signature, value);
  }
  mount(p = VOLUME) {
    this.set(p, FILESYSTEM, "MountPoints", "aay", [bytes(mountedPath)]);
    this.changed(p, FILESYSTEM);
  }
  unmount(p = VOLUME) {
    this.set(p, FILESYSTEM, "MountPoints", "aay", []);
    this.changed(p, FILESYSTEM);
  }
  changed(p: string, iface: string) {
    this.bus.emitSignal({
      path: p,
      interface: PROPERTIES,
      member: "PropertiesChanged",
      signature: "sa{sv}as",
      body: [iface, {}, []],
    });
  }
  removed(p: string) {
    const old = this.objects[p];
    assert(old);
    delete this.objects[p];
    this.bus.emitSignal({
      path: ROOT,
      interface: MANAGER,
      member: "InterfacesRemoved",
      signature: "oas",
      body: [p, Object.keys(old)],
    });
  }
  added(p: string) {
    const raw = this.objects[p];
    assert(raw);
    this.bus.emitSignal({
      path: ROOT,
      interface: MANAGER,
      member: "InterfacesAdded",
      signature: "oa{sa{sv}}",
      body: [p, raw],
    });
  }
  release() {
    this.holdReads = false;
    this.holdMutation = false;
    for (const resolve of this.releases.splice(0)) resolve();
  }
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const end = performance.now() + 4000;
  while (!check()) {
    if (performance.now() > end) throw new Error("Timeout: " + label);
    await delay(5);
  }
}
function ready(a: StorageAdapter): Extract<StorageState["status"], { kind: "ready" }> {
  const s = a.state.status;
  assert.equal(s.kind, "ready");
  if (s.kind !== "ready") throw new Error("Expected ready drives");
  return s;
}
function operationKind(a: StorageAdapter) {
  return a.state.operation.kind;
}
function volume(a: StorageAdapter): StorageVolume {
  const v = ready(a).volumes.find((v) => v.label === "Fixture volume");
  assert(v);
  return v;
}
async function rejectsCode(work: () => Promise<void>, code: string) {
  await assert.rejects(
    work,
    (cause) => cause instanceof StorageControlError && cause.code === code,
  );
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-udisks-smoke-"));
const daemon = spawn(
  process.env.MOIRE_TEST_DBUS_DAEMON ?? "dbus-daemon",
  [
    process.env.MOIRE_TEST_DBUS_CONFIG
      ? "--config-file=" + process.env.MOIRE_TEST_DBUS_CONFIG
      : "--session",
    "--nofork",
    "--nopidfile",
    `--address=unix:path=${path.join(directory, "bus")}`,
    "--print-address=1",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let address = "",
  stderr = "",
  daemonError: Error | null = null;
daemon.stdout.on("data", (b) => {
  address += b.toString();
});
daemon.stderr.on("data", (b) => {
  stderr += b.toString();
});
const daemonExit = new Promise<void>((resolve) => {
  daemon.once("exit", () => resolve());
  daemon.once("error", (error) => {
    daemonError = error;
    resolve();
  });
});
const buses: SessionBus[] = [],
  adapters: StorageAdapter[] = [],
  fixtures: StorageFixture[] = [];
let cases = 0;
async function bus() {
  const b = await SessionBus.connect(address.trim());
  buses.push(b);
  return b;
}
async function adapter(
  policy: "readonly" | "interactive" = "interactive",
  timeout = 500,
  pollMs = 0,
) {
  const a = await createUDisksStorageAdapter({
    connect: bus,
    policy,
    callTimeoutMs: timeout,
    pollMs,
  });
  adapters.push(a);
  return a;
}
async function releaseName(b: SessionBus) {
  const r = await b.call({
    destination: "org.freedesktop.DBus",
    path: "/org/freedesktop/DBus",
    interface: "org.freedesktop.DBus",
    member: "ReleaseName",
    signature: "s",
    body: [UDISKS],
  });
  assert.equal(r.body?.[0], 1);
}
try {
  await until(
    () => address.includes("\n") || daemon.exitCode !== null || daemonError !== null,
    "private daemon",
  );
  if (daemonError) throw daemonError;
  assert(address.startsWith("unix:"), stderr);
  const absent = await adapter();
  assert.equal(absent.state.status.kind, "unavailable");
  assert.equal(absent.state.operation.kind, "idle");
  cases++;
  let invalidConnect = false;
  const previousPolicy = process.env.MOIRE_STORAGE_CONTROL;
  process.env.MOIRE_STORAGE_CONTROL = "unsupported";
  try {
    const invalid = await createUDisksStorageAdapter({
      connect: async () => {
        invalidConnect = true;
        return bus();
      },
    });
    adapters.push(invalid);
    assert.equal(invalid.state.status.kind, "error");
    assert.equal(invalidConnect, false);
    cases++;
  } finally {
    if (previousPolicy === undefined) delete process.env.MOIRE_STORAGE_CONTROL;
    else process.env.MOIRE_STORAGE_CONTROL = previousPolicy;
  }
  const broken = await createUDisksStorageAdapter({
    connect: async () => {
      throw new Error("private fixture missing bus");
    },
  });
  adapters.push(broken);
  assert.equal(broken.state.status.kind, "unavailable");
  cases++;
  const server = await bus(),
    f = new StorageFixture(server);
  fixtures.push(f);
  assert.equal(await server.requestName(UDISKS, 4), 1);
  await until(() => absent.state.status.kind === "ready", "owner appears");
  assert.equal(ready(absent).volumes.length, 1);
  assert.equal(volume(absent).device, "/dev/disposable-fixture");
  assert.equal(volume(absent).sizeBytes, 1024);
  assert.equal(volume(absent).mount.kind, "unmounted");
  assert.equal(volume(absent).canEject, true);
  parseStorageState(absent.state);
  cases++;
  delete process.env.MOIRE_STORAGE_CONTROL;
  try {
    const def = await createUDisksStorageAdapter({ connect: bus, pollMs: 0 });
    adapters.push(def);
    assert.equal(ready(def).policy, "readonly");
    const id = volume(def).id;
    for (const method of [def.mount, def.unmount, def.eject])
      await rejectsCode(() => method(id), "readonly");
    assert.equal(f.mutations.length, 0);
    cases++;
  } finally {
    if (previousPolicy === undefined) delete process.env.MOIRE_STORAGE_CONTROL;
    else process.env.MOIRE_STORAGE_CONTROL = previousPolicy;
  }
  const readonly = await adapter("readonly");
  await rejectsCode(() => readonly.mount(volume(readonly).id), "readonly");
  assert.equal(f.mutations.length, 0);
  cases++;
  const a = await adapter();
  let changes = 0;
  const stop = a.subscribe(() => {
    changes++;
  });
  const stable = a.state;
  await a.refresh();
  await a.refresh();
  assert.equal(a.state, stable);
  assert.equal(changes, 0);
  cases++;
  const reordered = Object.entries(f.objects).reverse();
  for (const key of Object.keys(f.objects)) delete f.objects[key];
  for (const [key, entry] of reordered) f.objects[key] = entry;
  await a.refresh();
  assert.equal(a.state, stable, "dictionary ordering does not create semantic revisions");
  cases++;
  f.set(VOLUME, BLOCK, "IdUsage", "s", "unknown probe hint");
  await a.refresh();
  assert.equal(
    ready(a).volumes.length,
    1,
    "Filesystem interface is authoritative, not IdUsage text",
  );
  cases++;
  f.denied = true;
  await rejectsCode(() => a.mount(volume(a).id), "permission");
  assert.equal(operationKind(a), "error");
  assert(!JSON.stringify(a.state).includes("sensitive"));
  f.denied = false;
  cases++;
  f.busy = true;
  await rejectsCode(() => a.mount(volume(a).id), "busy");
  f.busy = false;
  cases++;
  f.failed = true;
  await rejectsCode(() => a.mount(volume(a).id), "failed");
  assert(!JSON.stringify(a.state).includes("raw failure"));
  f.failed = false;
  cases++;

  const initialId = volume(a).id;
  f.set(VOLUME, BLOCK, "IdUUID", "s", "replacement-volume");
  const beforeStale = f.mutations.length;
  await rejectsCode(() => a.mount(initialId), "gone");
  assert.equal(f.mutations.length, beforeStale);
  await a.refresh();
  assert.notEqual(volume(a).id, initialId);
  cases++;
  const beforeGone = f.mutations.length;
  await rejectsCode(() => a.mount(parseStorageVolumeId("unknown-fixture-id")), "gone");
  assert.equal(f.mutations.length, beforeGone);
  cases++;
  await a.mount(volume(a).id);
  assert.equal(operationKind(a), "pending");
  assert.equal(volume(a).mount.kind, "unmounted", "returned path is not an observed mount");
  assert.equal(f.mutations.at(-1)?.member, "Mount");
  cases++;
  const pendingIdentity = a.state.operation;
  const countPending = f.mutations.length;
  await rejectsCode(() => a.eject(volume(a).id), "busy");
  assert.equal(f.mutations.length, countPending);
  assert.equal(
    a.state.operation,
    pendingIdentity,
    "blocked overlapping action preserves current pending operation",
  );
  cases++;
  f.mount();
  await until(() => operationKind(a) === "idle", "mount observed");
  const mounted = volume(a).mount;
  assert.equal(mounted.kind, "mounted");
  if (mounted.kind === "mounted") assert.deepEqual(mounted.paths, [mountedPath]);
  parseStorageState(a.state);
  cases++;
  await rejectsCode(() => a.mount(volume(a).id), "busy");
  assert.equal(f.mutations.length, countPending);
  cases++;
  await rejectsCode(() => a.eject(volume(a).id), "busy");
  assert.equal(f.mutations.length, countPending);
  cases++;
  await a.unmount(volume(a).id);
  assert.equal(operationKind(a), "pending");
  assert.equal(volume(a).mount.kind, "mounted");
  f.unmount();
  await until(() => operationKind(a) === "idle", "unmount observed");
  cases++;
  await rejectsCode(() => a.unmount(volume(a).id), "unsupported");
  cases++;
  f.mount(HIDDEN);
  await a.refresh();
  assert.equal(ready(a).volumes.length, 1);
  assert.equal(volume(a).canEject, false);
  const hiddenCount = f.mutations.length;
  await rejectsCode(() => a.eject(volume(a).id), "busy");
  assert.equal(f.mutations.length, hiddenCount);
  f.unmount(HIDDEN);
  await a.refresh();
  cases++;
  f.block(CRYPTO, "/", "decrypted");
  f.set(CRYPTO, BLOCK, "IdLabel", "s", "Decrypted fixture");
  f.set(CRYPTO, BLOCK, "CryptoBackingDevice", "o", VOLUME);
  f.set(CRYPTO, BLOCK, "HintIgnore", "b", true);
  f.mount(CRYPTO);
  f.added(CRYPTO);
  await a.refresh();
  assert.equal(volume(a).canEject, false);
  await rejectsCode(() => a.eject(volume(a).id), "busy");
  f.unmount(CRYPTO);
  await a.refresh();
  cases++;
  f.set(CRYPTO, BLOCK, "CryptoBackingDevice", "o", CRYPTO);
  await a.refresh();
  assert.equal(volume(a).canEject, false);
  await rejectsCode(() => a.eject(volume(a).id), "unsupported");
  f.set(CRYPTO, BLOCK, "CryptoBackingDevice", "o", VOLUME);
  await a.refresh();
  cases++;
  f.set(CRYPTO, BLOCK, "Drive", "o", USB);
  f.set(CRYPTO, BLOCK, "CryptoBackingDevice", "o", CRYPTO);
  await a.refresh();
  assert.equal(volume(a).canEject, false, "a direct Drive cannot hide a cyclic backing relation");
  await rejectsCode(() => a.eject(volume(a).id), "unsupported");
  f.set(CRYPTO, BLOCK, "Drive", "o", "/");
  f.set(CRYPTO, BLOCK, "CryptoBackingDevice", "o", VOLUME);
  await a.refresh();
  cases++;
  f.set(CRYPTO, BLOCK, "CryptoBackingDevice", "o", ROOT + "/block_devices/missing");
  await a.refresh();
  assert.equal(volume(a).canEject, false);
  f.set(CRYPTO, BLOCK, "CryptoBackingDevice", "o", VOLUME);
  await a.refresh();
  cases++;
  const sibling = ROOT + "/drives/Sibling";
  f.drive(sibling, "usb");
  f.set(sibling, DRIVE, "SiblingId", "s", "shared-hub");
  f.set(USB, DRIVE, "SiblingId", "s", "shared-hub");
  f.added(sibling);
  await a.refresh();
  assert.equal(volume(a).canEject, false);
  await rejectsCode(() => a.eject(volume(a).id), "unsupported");
  cases++;
  f.set(USB, DRIVE, "Ejectable", "b", true);
  await a.refresh();
  assert.equal(volume(a).canEject, true);
  await a.eject(volume(a).id);
  assert.equal(
    f.mutations.at(-1)?.member,
    "Eject",
    "sibling forbids PowerOff; safe fallback is ejectable media only",
  );
  assert.equal(operationKind(a), "pending");
  f.set(USB, DRIVE, "MediaAvailable", "b", false);
  f.changed(USB, DRIVE);
  await until(() => operationKind(a) === "idle", "media absent observed");
  assert.equal(ready(a).volumes.length, 0);
  cases++;
  f.set(USB, DRIVE, "MediaAvailable", "b", true);
  f.set(USB, DRIVE, "TimeMediaDetected", "t", 12n);
  f.set(USB, DRIVE, "SiblingId", "s", "");
  f.set(USB, DRIVE, "Ejectable", "b", false);
  await a.refresh();
  const oldMedia = volume(a).id;
  f.set(USB, DRIVE, "TimeMediaDetected", "t", 13n);
  await rejectsCode(() => a.eject(oldMedia), "gone");
  await a.refresh();
  cases++;
  const oldIncarnation = volume(a).id;
  const source = f.objects[VOLUME];
  assert(source);
  f.removed(VOLUME);
  await until(() => ready(a).volumes.length === 0, "volume removed");
  f.objects[VOLUME] = source;
  f.added(VOLUME);
  await until(() => ready(a).volumes.length === 1, "same-path volume added");
  assert.notEqual(volume(a).id, oldIncarnation);
  await rejectsCode(() => a.mount(oldIncarnation), "gone");
  cases++;
  const rawMounts = f.props(VOLUME, FILESYSTEM).MountPoints;
  assert(rawMounts);
  f.set(VOLUME, FILESYSTEM, "MountPoints", "aay", [Buffer.from([47, 255, 0])]);
  await a.refresh();
  assert.equal(volume(a).mount.kind, "unsupported");
  await rejectsCode(() => a.mount(volume(a).id), "unsupported");
  assert.equal(volume(a).canEject, false);
  f.props(VOLUME, FILESYSTEM).MountPoints = rawMounts;
  await a.refresh();
  cases++;
  for (const value of [
    [Buffer.from("/missing-nul")],
    [Buffer.from([47, 0, 97, 0])],
    Array.from({ length: 9 }, () => bytes("/fixture")),
  ]) {
    f.set(VOLUME, FILESYSTEM, "MountPoints", "aay", value);
    await a.refresh();
    assert.equal(a.state.status.kind, "error");
    assert(!("volumes" in a.state.status));
    f.props(VOLUME, FILESYSTEM).MountPoints = rawMounts;
    await a.refresh();
    cases++;
  }
  const originalSize = f.props(VOLUME, BLOCK).Size;
  assert(originalSize);
  f.set(VOLUME, BLOCK, "Size", "t", 0xffff_ffff_ffff_ffffn);
  await a.refresh();
  assert.equal(volume(a).sizeBytes, null);
  f.props(VOLUME, BLOCK).Size = originalSize;
  await a.refresh();
  cases++;
  const deviceBytes = f.props(VOLUME, BLOCK).Device;
  assert(deviceBytes);
  f.set(VOLUME, BLOCK, "Device", "ay", Buffer.from([47, 255, 0]));
  await a.refresh();
  assert.equal(a.state.status.kind, "error");
  f.props(VOLUME, BLOCK).Device = deviceBytes;
  await a.refresh();
  cases++;
  const removable = f.props(USB, DRIVE).Removable;
  assert(removable);
  f.set(USB, DRIVE, "Removable", "s", "true");
  await a.refresh();
  assert.equal(a.state.status.kind, "error");
  f.props(USB, DRIVE).Removable = removable;
  await a.refresh();
  cases++;
  const orphan = ROOT + "/block_devices/orphan";
  f.objects[orphan] = { [FILESYSTEM]: { MountPoints: variant("aay", []) } };
  await a.refresh();
  assert.equal(a.state.status.kind, "error");
  delete f.objects[orphan];
  await a.refresh();
  cases++;
  const readCount = f.reads.length;
  f.changed(VOLUME, "org.example.Unrelated");
  const foreign = await bus();
  foreign.emitSignal({
    path: VOLUME,
    interface: PROPERTIES,
    member: "PropertiesChanged",
    signature: "sa{sv}as",
    body: [FILESYSTEM, {}, []],
  });
  await delay(30);
  assert.equal(f.reads.length, readCount);
  cases++;
  await a.eject(volume(a).id);
  assert.equal(f.mutations.at(-1)?.member, "PowerOff");
  assert.equal(operationKind(a), "pending");
  f.removed(USB);
  await until(() => operationKind(a) === "idle", "poweroff observed drive absence");
  assert.equal(ready(a).volumes.length, 0);
  cases++;
  f.drive(USB, "usb");
  f.added(USB);
  await until(() => ready(a).volumes.length === 1, "USB drive reappears");
  const timed = await adapter("interactive", 60);
  f.holdMutation = true;
  await rejectsCode(() => timed.mount(volume(timed).id), "unknown");
  assert.equal(timed.state.operation.kind, "unknown");
  f.release();
  await delay(10);
  assert.equal(timed.state.operation.kind, "unknown");
  const beforeRetry = f.mutations.length;
  await rejectsCode(() => timed.mount(volume(timed).id), "unknown");
  assert.equal(f.mutations.length, beforeRetry);
  // Explicit different-volume work is permitted while the first identity is unknown.
  const another = ROOT + "/block_devices/another";
  f.block(another, USB, "another-fixture");
  f.set(another, BLOCK, "IdLabel", "s", "Another fixture");
  f.added(another);
  await timed.refresh();
  const otherVolume = ready(timed).volumes.find((v) => v.label === "Another fixture");
  assert(otherVolume);
  await timed.mount(otherVolume.id);
  assert.equal(operationKind(timed), "pending");
  f.set(another, FILESYSTEM, "MountPoints", "aay", [bytes("/run/media/fixture/Another")]);
  f.changed(another, FILESYSTEM);
  await until(() => operationKind(timed) === "idle", "different identity mount readback");
  await rejectsCode(() => timed.mount(volume(timed).id), "unknown");
  f.unmount(another);
  f.set(another, BLOCK, "HintIgnore", "b", true);
  await timed.refresh();
  cases++;
  f.mount();
  await until(
    () => timed.state.operation.kind === "idle",
    "timeout resolves only by mount observation",
  );
  f.unmount();
  await timed.refresh();
  cases++;
  const readonlyTimeout = await adapter("readonly", 50);
  f.holdReads = true;
  const begun = performance.now();
  await readonlyTimeout.refresh();
  assert.equal(readonlyTimeout.state.status.kind, "error");
  assert(performance.now() - begun < 1000);
  f.release();
  await readonlyTimeout.refresh();
  assert.equal(readonlyTimeout.state.status.kind, "ready");
  cases++;
  // Exact old-owner delayed mutation cannot overwrite new discovery or target it.
  const ownership = await adapter();
  f.holdMutation = true;
  const late = ownership.mount(volume(ownership).id).then(
    () => null,
    (cause) => cause,
  );
  await until(() => f.releases.length > 0, "held old mutation");
  await releaseName(server);
  const replacementBus = await bus(),
    replacement = new StorageFixture(replacementBus);
  fixtures.push(replacement);
  replacement.set(VOLUME, BLOCK, "IdLabel", "s", "Replacement fixture");
  assert.equal(await replacementBus.requestName(UDISKS, 4), 1);
  await until(
    () =>
      ownership.state.status.kind === "ready" &&
      ownership.state.status.volumes[0]?.label === "Replacement fixture",
    "new owner observed",
  );
  assert.equal(ownership.state.operation.kind, "unknown");
  f.release();
  const lateFailure = await late;
  assert(lateFailure instanceof StorageControlError);
  assert.equal(ownership.state.operation.kind, "unknown");
  assert.equal(ready(ownership).volumes[0]?.label, "Replacement fixture");
  assert.equal(replacement.mutations.length, 0);
  cases++;
  const replacementVolume = ready(ownership).volumes[0];
  assert(replacementVolume);
  await ownership.mount(replacementVolume.id);
  assert.equal(operationKind(ownership), "pending");
  assert.equal(
    replacement.mutations.length,
    1,
    "explicit new-owner identity is actionable; no automatic retarget",
  );
  cases++;

  const duringRead = await adapter();
  replacement.holdReads = true;
  const reading = duringRead.refresh();
  await until(() => replacement.releases.length > 0, "dispose held read");
  let afterDispose = 0;
  duringRead.subscribe(() => {
    afterDispose++;
  });
  const disposal = duringRead.dispose();
  assert.equal(duringRead.dispose(), disposal, "dispose shares one completion promise");
  await disposal;
  const beforeDispose = afterDispose;
  replacement.release();
  await reading;
  replacement.changed(VOLUME, FILESYSTEM);
  await delay(20);
  assert.equal(afterDispose, beforeDispose);
  await duringRead.dispose();
  cases++;
  const disconnected = await adapter();
  const client = buses.at(-1);
  assert(client);
  client.close();
  await until(() => disconnected.state.status.kind === "unavailable", "bus disconnect");
  await disconnected.dispose();
  cases++;
  const bounds = await adapter();
  const extraKeys = Array.from({ length: 97 }, (_, i) => ROOT + "/jobs/fixture" + i);
  for (const key of extraKeys) replacement.objects[key] = {};
  await bounds.refresh();
  assert.equal(bounds.state.status.kind, "error");
  for (const key of extraKeys) delete replacement.objects[key];
  await bounds.refresh();
  assert.equal(bounds.state.status.kind, "ready");
  cases++;
  const polled = await adapter("readonly", 500, 15);
  replacement.set(VOLUME, BLOCK, "IdLabel", "s", "Polled fixture");
  await until(
    () =>
      polled.state.status.kind === "ready" &&
      polled.state.status.volumes[0]?.label === "Polled fixture",
    "optional poll",
  );
  await polled.dispose();
  cases++;
  await releaseName(replacementBus);
  await until(() => ownership.state.status.kind === "unavailable", "owner disappears");
  assert.equal(ownership.state.operation.kind, "unknown");
  assert(!("volumes" in ownership.state.status));
  cases++;
  stop();
  await a.dispose();
  const final = changes;
  await a.refresh();
  assert.equal(changes, final);
  cases++;
  for (const fixture of fixtures)
    assert(
      fixture.mutations.every((m) => ["Mount", "Unmount", "Eject", "PowerOff"].includes(m.member)),
      "no formatting/repair/unlock/configuration operations",
    );
  console.log(
    JSON.stringify({
      scope: "actual private dbus-daemon UDisks fixture; no real disks opened or operated on",
      cases,
      actualExitCode: 0,
    }),
  );
} finally {
  for (const f of fixtures) f.release();
  await Promise.allSettled(adapters.map((a) => a.dispose()));
  for (const b of buses) b.close();
  if (daemon.exitCode === null && !daemonError) daemon.kill("SIGTERM");
  await daemonExit;
  await fs.rm(directory, { recursive: true, force: true });
}

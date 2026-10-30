import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SessionBus, DbusRemoteError, variant, type DbusVariant } from "@moire/dbus";
import {
  parseBluetoothId,
  type BluetoothAdapter,
  type DesktopBluetooth,
} from "@moire/system-management/bluetooth-status";
import { createBluezBluetoothAdapter } from "./bluez-bluetooth";
const BLUEZ = "org.bluez",
  MANAGER = "org.freedesktop.DBus.ObjectManager",
  PROPS = "org.freedesktop.DBus.Properties";
const ADAPTER = BLUEZ + ".Adapter1",
  DEVICE = BLUEZ + ".Device1",
  BATTERY = BLUEZ + ".Battery1";
const HCI = "/org/bluez/hci0",
  FIRST = HCI + "/dev_00_11_22_33_44_55",
  SECOND = HCI + "/dev_00_11_22_33_44_66";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const end = performance.now() + 4000;
  while (!check()) {
    if (performance.now() > end) throw new Error("Timeout: " + label);
    await delay(5);
  }
}
function snapshot(a: BluetoothAdapter): DesktopBluetooth {
  return a.state;
}
function ready(a: BluetoothAdapter): Extract<DesktopBluetooth["status"], { kind: "ready" }> {
  const s = snapshot(a).status;
  assert.equal(s.kind, "ready");
  if (s.kind !== "ready") throw new Error("Expected ready Bluetooth");
  return s;
}
class BluezFixture {
  objects: Record<string, Record<string, Record<string, DbusVariant>>> = {};
  writes: { path: string; member: string }[] = [];
  reads = 0;
  holdReads = false;
  heldReads: (() => void)[] = [];
  holdActions = false;
  holdReadsAfterAction = false;
  heldActions: (() => void)[] = [];
  actionError: string | null = null;
  delayedTarget = false;
  pendingTarget: { p: string; value: boolean } | null = null;
  trustWrites: { path: string; desired: boolean }[] = [];
  delayedTrust = false;
  pendingTrust: { p: string; value: boolean } | null = null;
  ignoreTrust = false;
  /** Radio power and device removal, kept apart from the Connect/Disconnect log. */
  adapterWrites: { member: string; value: unknown }[] = [];
  aliasWrites: { path: string; value: unknown }[] = [];
  constructor(readonly bus: SessionBus) {
    this.reset();
    bus.exportObject(HCI, {
      name: PROPS,
      methods: {
        Set: {
          inSignature: "ssv",
          outSignature: "",
          handler: ({ body }) => {
            assert.equal(body[0], ADAPTER);
            assert.equal(body[1], "Powered");
            const desired = body[2];
            assert(desired && typeof desired === "object" && "value" in desired);
            assert.equal(typeof desired.value, "boolean");
            this.adapterWrites.push({ member: "Powered", value: desired.value });
            this.set(HCI, "Powered", "b", desired.value);
            this.changed(HCI);
            return { body: [] };
          },
        },
      },
    });
    bus.exportObject(HCI, {
      name: ADAPTER,
      methods: {
        RemoveDevice: {
          inSignature: "o",
          outSignature: "",
          handler: ({ body }) => {
            assert.equal(typeof body[0], "string");
            if (typeof body[0] !== "string" || !this.objects[body[0]])
              throw new DbusRemoteError("org.bluez.Error.DoesNotExist", "fixture");
            this.adapterWrites.push({ member: "RemoveDevice", value: body[0] });
            this.removed(body[0]);
            return { body: [] };
          },
        },
      },
    });
    bus.exportObject("/", {
      name: MANAGER,
      methods: {
        GetManagedObjects: {
          inSignature: "",
          outSignature: "a{oa{sa{sv}}}",
          handler: async () => {
            this.reads++;
            // Capture actual read time; releasing an old request must not inject new owner's data.
            const value = structuredClone(this.objects);
            if (this.holdReads) await new Promise<void>((resolve) => this.heldReads.push(resolve));
            return { body: [value] };
          },
        },
      },
    });
  }
  reset() {
    this.objects = {
      [HCI]: {
        [ADAPTER]: {
          Alias: variant("s", "Fixture radio"),
          Address: variant("s", "AA:BB:CC:DD:EE:FF"),
          Powered: variant("b", true),
        },
      },
    };
    this.device(FIRST, "00:11:22:33:44:55");
    this.device(SECOND, "00:11:22:33:44:66");
    this.actionError = null;
    this.delayedTarget = false;
    this.pendingTarget = null;
  }
  device(p: string, mac: string) {
    this.objects[p] = {
      [DEVICE]: {
        Alias: variant("s", "Same name"),
        Address: variant("s", mac),
        Adapter: variant("o", HCI),
        Paired: variant("b", true),
        Trusted: variant("b", true),
        Connected: variant("b", false),
      },
    };
    this.bus.exportObject(p, {
      name: PROPS,
      methods: {
        Set: {
          inSignature: "ssv",
          outSignature: "",
          handler: async ({ body }) => {
            assert.equal(body[0], DEVICE);
            if (body[1] === "Alias") {
              const alias = body[2];
              assert(alias && typeof alias === "object" && "value" in alias);
              this.aliasWrites.push({ path: p, value: alias.value });
              this.set(p, "Alias", "s", alias.value);
              this.changed(p);
              return { body: [] };
            }
            assert.equal(body[1], "Trusted");
            const desired = body[2];
            assert(
              desired &&
                typeof desired === "object" &&
                "signature" in desired &&
                "value" in desired,
            );
            assert.equal(desired.signature, "b");
            assert.equal(typeof desired.value, "boolean");
            if (typeof desired.value !== "boolean") throw new Error("Invalid trust variant");
            this.trustWrites.push({ path: p, desired: desired.value });
            if (this.holdActions)
              await new Promise<void>((resolve) => this.heldActions.push(resolve));
            if (this.actionError)
              throw new DbusRemoteError(this.actionError, "private raw error must never leak");
            if (this.delayedTrust) this.pendingTrust = { p, value: desired.value };
            else if (!this.ignoreTrust) this.set(p, "Trusted", "b", desired.value);
            if (this.holdReadsAfterAction) this.holdReads = true;
            return { body: [] };
          },
        },
      },
    });
    this.bus.exportObject(p, {
      name: DEVICE,
      methods: Object.fromEntries(
        ["Connect", "Disconnect"].map((member) => [
          member,
          {
            inSignature: "",
            outSignature: "",
            handler: async () => {
              this.writes.push({ path: p, member });
              if (this.holdActions)
                await new Promise<void>((resolve) => this.heldActions.push(resolve));
              if (this.actionError)
                throw new DbusRemoteError(this.actionError, "private raw error must never leak");
              if (this.delayedTarget) this.pendingTarget = { p, value: member === "Connect" };
              else this.set(p, "Connected", "b", member === "Connect");
              if (this.holdReadsAfterAction) this.holdReads = true;
              return { body: [] };
            },
          },
        ]),
      ),
    });
  }
  set(p: string, key: string, signature: string, value: unknown) {
    // Device properties live under Device1, the adapter's under Adapter1.
    const props = this.objects[p]?.[p === HCI ? ADAPTER : DEVICE];
    assert(props);
    props[key] = variant(signature, value);
  }
  changed(p = FIRST, changed: Record<string, DbusVariant> = {}) {
    this.bus.emitSignal({
      path: p,
      interface: PROPS,
      member: "PropertiesChanged",
      signature: "sa{sv}as",
      body: [p === HCI ? ADAPTER : DEVICE, changed, []],
    });
  }
  removed(p: string) {
    delete this.objects[p];
    this.bus.emitSignal({
      path: "/",
      interface: MANAGER,
      member: "InterfacesRemoved",
      signature: "oas",
      body: [p, [DEVICE]],
    });
  }
  added(p: string) {
    this.bus.emitSignal({
      path: "/",
      interface: MANAGER,
      member: "InterfacesAdded",
      signature: "oa{sa{sv}}",
      body: [p, this.objects[p]],
    });
  }
  settle() {
    const target = this.pendingTarget;
    assert(target);
    this.set(target.p, "Connected", "b", target.value);
    this.changed(target.p);
    this.pendingTarget = null;
  }
  release() {
    this.holdReads = false;
    this.holdActions = false;
    for (const fn of [...this.heldReads.splice(0), ...this.heldActions.splice(0)]) fn();
  }
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-bluez-smoke-"));
const daemon = spawn(
  process.env.MOIRE_TEST_DBUS_DAEMON ?? "dbus-daemon",
  [
    process.env.MOIRE_TEST_DBUS_CONFIG
      ? "--config-file=" + process.env.MOIRE_TEST_DBUS_CONFIG
      : "--session",
    "--nofork",
    "--nopidfile",
    "--address=unix:path=" + path.join(directory, "bus"),
    "--print-address=1",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let address = "",
  stderr = "",
  daemonError: Error | null = null;
daemon.stdout.on("data", (chunk) => {
  address += chunk.toString();
});
daemon.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
const daemonExit = new Promise<void>((resolve) => {
  daemon.once("exit", () => resolve());
  daemon.once("error", (error) => {
    daemonError = error;
    resolve();
  });
});
const buses: SessionBus[] = [],
  adapters: BluetoothAdapter[] = [],
  fixtures: BluezFixture[] = [];
let cases = 0;
async function bus() {
  const b = await SessionBus.connect(address.trim());
  buses.push(b);
  return b;
}
async function adapter(
  policy: "readonly" | "interactive" = "interactive",
  operationTimeoutMs = 500,
  callTimeoutMs = 300,
  trustPolicy: "readonly" | "interactive" = "readonly",
  consentTimeoutMs = 1000,
) {
  const a = await createBluezBluetoothAdapter({
    connect: bus,
    policy,
    trustPolicy,
    consentTimeoutMs,
    pollMs: 0,
    operationTimeoutMs,
    callTimeoutMs,
  });
  adapters.push(a);
  return a;
}
async function releaseName(b: SessionBus) {
  const reply = await b.call({
    destination: "org.freedesktop.DBus",
    path: "/org/freedesktop/DBus",
    interface: "org.freedesktop.DBus",
    member: "ReleaseName",
    signature: "s",
    body: [BLUEZ],
  });
  assert.equal(reply.body?.[0], 1);
}
try {
  await until(
    () => address.includes("\n") || daemonError !== null || daemon.exitCode !== null,
    "daemon",
  );
  if (daemonError) throw daemonError;
  assert(address.startsWith("unix:"), stderr);
  const a = await adapter();
  assert.equal(snapshot(a).status.kind, "unavailable");
  cases++;
  let connected = false;
  const invalid = await createBluezBluetoothAdapter({
    callTimeoutMs: 0,
    connect: async () => {
      connected = true;
      return bus();
    },
  });
  adapters.push(invalid);
  assert.equal(connected, false);
  assert.equal(snapshot(invalid).status.kind, "error");
  cases++;
  const missing = await createBluezBluetoothAdapter({
    connect: async () => {
      throw new Error("private");
    },
  });
  adapters.push(missing);
  assert.equal(snapshot(missing).status.kind, "unavailable");
  cases++;
  const server = await bus(),
    f = new BluezFixture(server);
  fixtures.push(f);
  assert.equal(await server.requestName(BLUEZ, 4), 1);
  await until(() => snapshot(a).status.kind === "ready", "known devices");
  const first = ready(a).devices[0],
    second = ready(a).devices[1];
  assert(first && second);
  assert.notEqual(first.id, second.id);
  assert.equal(first.name, second.name);
  cases++;
  const same = snapshot(a);
  await a.refresh();
  assert.equal(snapshot(a), same);
  cases++;
  const readonly = await createBluezBluetoothAdapter({ connect: bus });
  adapters.push(readonly);
  await until(() => snapshot(readonly).status.kind === "ready", "readonly");
  await assert.rejects(
    () => readonly.setConnected({ id: ready(readonly).devices[0]!.id, connected: true }),
    /read-only/,
  );
  assert.equal(f.writes.length, 0);
  cases++;
  await assert.rejects(
    () => readonly.setPowered!({ adapterId: ready(readonly).adapters[0]!.id, powered: false }),
    /read-only/,
  );
  await assert.rejects(
    () => readonly.forgetDevice!({ id: ready(readonly).devices[0]!.id }),
    /read-only/,
  );
  assert.equal(f.adapterWrites.length, 0);
  cases++;
  const radio = ready(a).adapters[0]!.id;
  await a.setPowered!({ adapterId: radio, powered: false });
  assert.equal(ready(a).adapters[0]!.powered, false);
  await a.setPowered!({ adapterId: radio, powered: true });
  assert.equal(ready(a).adapters[0]!.powered, true);
  await a.setPowered!({ adapterId: radio, powered: true });
  assert.deepEqual(
    f.adapterWrites.map((write) => write.value),
    [false, true],
    "already powered sends nothing",
  );
  assert.equal(snapshot(a).operation.kind, "idle");
  cases++;
  await assert.rejects(
    () => a.setPowered!({ adapterId: parseBluetoothId("bluez_missing"), powered: false }),
    /no longer available/,
  );
  await assert.rejects(
    () => a.forgetDevice!({ id: parseBluetoothId("bluez_missing") }),
    /no longer available/,
  );
  assert.equal(f.adapterWrites.length, 2);
  cases++;
  await a.forgetDevice!({ id: second.id });
  assert.deepEqual(f.adapterWrites.at(-1), { member: "RemoveDevice", value: SECOND });
  assert.deepEqual(
    ready(a).devices.map((device) => device.id),
    [first.id],
  );
  f.device(SECOND, "00:11:22:33:44:66");
  f.added(SECOND);
  await until(() => ready(a).devices.length === 2, "forgotten device paired again");
  assert.equal(f.writes.length, 0);
  cases++;
  const byAddress = (mac: string) => ready(a).devices.find((device) => device.address === mac)!;
  assert.equal(byAddress("00:11:22:33:44:55").kind, "other", "no Icon or Class");
  assert.equal(byAddress("00:11:22:33:44:55").battery, undefined, "no Battery1");
  f.set(FIRST, "Icon", "s", "input-mouse");
  // Class of Device 0x240404: audio/video, wearable headset.
  f.set(SECOND, "Class", "u", 0x240404);
  const beforeBattery = byAddress("00:11:22:33:44:55").id;
  f.objects[FIRST]![BATTERY] = { Percentage: variant("y", 64) };
  f.bus.emitSignal({
    path: "/",
    interface: MANAGER,
    member: "InterfacesAdded",
    signature: "oa{sa{sv}}",
    body: [FIRST, { [BATTERY]: f.objects[FIRST]![BATTERY] }],
  });
  await until(() => byAddress("00:11:22:33:44:55").battery === 64, "battery appears");
  assert.equal(byAddress("00:11:22:33:44:55").id, beforeBattery, "a battery keeps the identity");
  assert.equal(byAddress("00:11:22:33:44:55").kind, "mouse");
  assert.equal(byAddress("00:11:22:33:44:66").kind, "headset");
  f.objects[FIRST]![BATTERY]!.Percentage = variant("y", 12);
  f.bus.emitSignal({
    path: FIRST,
    interface: PROPS,
    member: "PropertiesChanged",
    signature: "sa{sv}as",
    body: [BATTERY, { Percentage: variant("y", 12) }, []],
  });
  await until(() => byAddress("00:11:22:33:44:55").battery === 12, "battery change signal");
  f.objects[FIRST]![BATTERY]!.Percentage = variant("y", 101);
  await a.refresh();
  assert.equal(snapshot(a).status.kind, "error", "out-of-range battery is rejected");
  f.objects[FIRST]![BATTERY]!.Percentage = variant("y", 12);
  await a.refresh();
  assert.equal(byAddress("00:11:22:33:44:55").battery, 12);
  cases++;
  const mouse = byAddress("00:11:22:33:44:55");
  await assert.rejects(
    () => readonly.renameDevice!({ id: ready(readonly).devices[0]!.id, name: "Desk mouse" }),
    /read-only/,
  );
  await assert.rejects(() => a.renameDevice!({ id: mouse.id, name: "  " }), /1 to 64/);
  await assert.rejects(() => a.renameDevice!({ id: mouse.id, name: "bad\nname" }), /1 to 64/);
  assert.equal(f.aliasWrites.length, 0);
  await a.renameDevice!({ id: mouse.id, name: "  Desk mouse " });
  assert.deepEqual(f.aliasWrites, [{ path: FIRST, value: "Desk mouse" }]);
  assert.equal(byAddress("00:11:22:33:44:55").name, "Desk mouse");
  assert.equal(byAddress("00:11:22:33:44:55").id, mouse.id, "renaming keeps the identity");
  await a.renameDevice!({ id: mouse.id, name: "Desk mouse" });
  assert.equal(f.aliasWrites.length, 1, "same name sends nothing");
  assert.equal(snapshot(a).operation.kind, "idle");
  assert.equal(f.writes.length, 0);
  cases++;
  f.set(HCI, "Powered", "b", false);
  await a.refresh();
  await assert.rejects(() => a.setConnected({ id: first.id, connected: true }), /trusted.*powered/);
  assert.equal(f.writes.length, 0);
  cases++;
  f.set(HCI, "Powered", "b", true);
  f.set(FIRST, "Trusted", "b", false);
  await a.refresh();
  await assert.rejects(() => a.setConnected({ id: first.id, connected: true }), /trusted.*powered/);
  assert.equal(f.writes.length, 0);
  cases++;
  f.set(FIRST, "Trusted", "b", true);
  f.set(FIRST, "Paired", "b", false);
  await a.refresh();
  assert.equal(ready(a).devices.length, 1);
  await assert.rejects(() => a.setConnected({ id: first.id, connected: true }));
  assert.equal(f.writes.length, 0);
  cases++;
  f.set(FIRST, "Paired", "b", true);
  f.changed();
  await until(
    () => snapshot(a).status.kind === "ready" && ready(a).devices.length === 2,
    "unpaired device PropertiesChanged observed",
  );
  let id = ready(a).devices[0]!.id;
  assert.notEqual(id, first.id);
  cases++;
  f.set(FIRST, "Trusted", "s", "bad");
  await a.refresh();
  assert.equal(snapshot(a).status.kind, "error");
  assert.equal(f.writes.length, 0);
  cases++;
  f.set(FIRST, "Trusted", "b", true);
  await a.refresh();
  id = ready(a).devices[0]!.id;
  // A stale UI eligibility observation must be rechecked immediately before Connect.
  f.set(FIRST, "Trusted", "b", false);
  await assert.rejects(() => a.setConnected({ id, connected: true }), /trusted.*powered/);
  assert.equal(f.writes.length, 0);
  f.set(FIRST, "Trusted", "b", true);
  cases++;
  f.delayedTarget = true;
  const request = a.setConnected({ id, connected: true });
  await until(() => f.pendingTarget !== null, "command acknowledged");
  assert.equal(snapshot(a).operation.kind, "pending");
  assert.equal(ready(a).devices[0]!.connected, false);
  await assert.rejects(() => a.setConnected({ id, connected: false }), /pending/);
  cases++;
  f.settle();
  await request;
  assert.equal(ready(a).devices[0]!.connected, true);
  assert.equal(snapshot(a).operation.kind, "idle");
  cases++;
  f.delayedTarget = false;
  await a.setConnected({ id, connected: false });
  assert.equal(ready(a).devices[0]!.connected, false);
  assert.equal(f.writes.at(-1)?.member, "Disconnect");
  cases++;
  const before = f.writes.length;
  await a.setConnected({ id, connected: false });
  assert.equal(f.writes.length, before);
  cases++;
  f.actionError = "org.bluez.Error.NotAuthorized";
  await assert.rejects(() => a.setConnected({ id, connected: true }), /denied/);
  assert.equal(snapshot(a).operation.kind, "error");
  assert(!JSON.stringify(snapshot(a)).includes("private raw"));
  cases++;
  f.actionError = "org.bluez.Error.Failed";
  await assert.rejects(() => a.setConnected({ id, connected: true }), /could not complete/);
  assert.equal(snapshot(a).operation.kind, "error");
  f.actionError = null;
  cases++;
  const timed = await adapter("interactive", 100, 80);
  await until(() => snapshot(timed).status.kind === "ready", "timed adapter");
  const timedId = ready(timed).devices[0]!.id;
  f.delayedTarget = true;
  await assert.rejects(() => timed.setConnected({ id: timedId, connected: true }), /unknown/);
  assert.equal(snapshot(timed).operation.kind, "unknown");
  const writes = f.writes.length;
  await assert.rejects(() => timed.setConnected({ id: timedId, connected: false }), /unknown/);
  assert.equal(f.writes.length, writes);
  cases++;
  f.settle();
  await timed.refresh();
  await until(() => snapshot(timed).operation.kind === "idle", "verified late target readback");
  assert.equal(snapshot(timed).operation.kind, "idle");
  assert.equal(ready(timed).devices[0]!.connected, true);
  await timed.dispose();
  cases++;
  f.delayedTarget = false;
  f.set(FIRST, "Connected", "b", false);
  await a.refresh();
  id = ready(a).devices[0]!.id;
  f.removed(FIRST);
  await until(
    () => snapshot(a).status.kind === "ready" && ready(a).devices.length === 1,
    "removed",
  );
  f.device(FIRST, "00:11:22:33:44:55");
  f.added(FIRST);
  await until(
    () => snapshot(a).status.kind === "ready" && ready(a).devices.length === 2,
    "readded",
  );
  assert.notEqual(ready(a).devices[0]!.id, id);
  const count = f.writes.length;
  await assert.rejects(() => a.setConnected({ id, connected: true }));
  assert.equal(f.writes.length, count);
  cases++;
  // No adapters is a supported unavailable observation with zero write RPCs.
  const previousObjects = f.objects;
  f.objects = {};
  await a.refresh();
  assert.equal(snapshot(a).status.kind, "unavailable");
  const noAdapterWrites = f.writes.length;
  await assert.rejects(() => a.setConnected({ id, connected: true }));
  assert.equal(f.writes.length, noAdapterWrites);
  f.objects = previousObjects;
  await a.refresh();
  cases++;
  // Enforce bounded enumeration without exposing a partial positive snapshot.
  for (let i = 1; i <= 8; i++) f.objects["/org/bluez/hci" + i] = structuredClone(f.objects[HCI]!);
  await a.refresh();
  assert.equal(snapshot(a).status.kind, "error");
  cases++;
  for (let i = 1; i <= 8; i++) delete f.objects["/org/bluez/hci" + i];
  await a.refresh();
  for (let i = 0; i < 63; i++) f.objects[HCI + "/extra_" + i] = structuredClone(f.objects[FIRST]!);
  await a.refresh();
  assert.equal(snapshot(a).status.kind, "error");
  cases++;
  for (let i = 0; i < 63; i++) delete f.objects[HCI + "/extra_" + i];
  await a.refresh();
  // Actual post-ack read RPC timeout is unknown, not a rejected connection command.
  const readTimeout = await adapter("interactive", 300, 60);
  await until(() => snapshot(readTimeout).status.kind === "ready", "read-timeout adapter");
  const readTimeoutId = ready(readTimeout).devices[0]!.id;
  f.delayedTarget = true;
  f.holdReadsAfterAction = true;
  await assert.rejects(
    () => readTimeout.setConnected({ id: readTimeoutId, connected: true }),
    /unknown/,
  );
  assert.equal(snapshot(readTimeout).operation.kind, "unknown");
  cases++;
  f.settle();
  f.holdReadsAfterAction = false;
  f.release();
  await readTimeout.refresh();
  await until(
    () => snapshot(readTimeout).operation.kind === "idle",
    "timed read recovers verified target",
  );
  assert.equal(ready(readTimeout).devices[0]!.connected, true);
  await readTimeout.dispose();
  cases++;
  f.delayedTarget = false;
  f.set(FIRST, "Connected", "b", false);
  await a.refresh();
  // Trust is independent from Connect policy and never implicit in connection/pairing.
  const requester = await bus(),
    foreign = await bus();
  assert(requester.name && foreign.name);
  const caller = requester.name,
    otherCaller = foreign.name;
  function trustState(target: BluetoothAdapter) {
    const trust = target.state.trust;
    assert(trust && trust.kind === "ready");
    return trust.operation;
  }
  function challenge(target: BluetoothAdapter) {
    const operation = trustState(target);
    assert.equal(operation.kind, "confirmation");
    if (operation.kind !== "confirmation") throw new Error("Expected confirmation");
    return operation.challengeId;
  }
  async function requestTrust(target: BluetoothAdapter, trusted: boolean, who = caller) {
    assert(target.requestTrust);
    await target.requestTrust({ caller: who, id: ready(target).devices[0]!.id, trusted });
  }
  async function confirm(target: BluetoothAdapter, challengeId = challenge(target), who = caller) {
    assert(target.confirmTrust);
    await target.confirmTrust({ caller: who, challengeId });
  }
  async function cancel(target: BluetoothAdapter, challengeId = challenge(target), who = caller) {
    assert(target.cancelTrust);
    await target.cancelTrust({ caller: who, challengeId });
  }
  assert(readonly.requestTrust);
  await assert.rejects(
    () => readonly.requestTrust!({ caller, id: ready(readonly).devices[0]!.id, trusted: false }),
    /read-only/,
  );
  assert.equal(readonly.state.trust?.kind, "disabled");
  assert.equal(a.state.trust?.kind, "disabled");
  assert.equal(f.trustWrites.length, 0);
  cases++;
  const trustOnly = await adapter("readonly", 250, 100, "interactive");
  await until(() => trustOnly.state.status.kind === "ready", "trust-only policy");
  await requestTrust(trustOnly, false);
  const foreignChallenge = challenge(trustOnly);
  await assert.rejects(() => confirm(trustOnly, foreignChallenge, otherCaller), /caller/);
  await assert.rejects(() => cancel(trustOnly, foreignChallenge, otherCaller), /caller/);
  assert.equal(challenge(trustOnly), foreignChallenge);
  await assert.rejects(
    () => trustOnly.setConnected({ id: ready(trustOnly).devices[0]!.id, connected: true }),
    /read-only/,
  );
  await cancel(trustOnly);
  await assert.rejects(() => confirm(trustOnly, foreignChallenge), /caller/);
  assert.equal(f.trustWrites.length, 0);
  cases++;
  await requestTrust(trustOnly, false);
  const lostChallenge = challenge(trustOnly);
  assert(trustOnly.trustCallerLost);
  await trustOnly.trustCallerLost(otherCaller);
  assert.equal(challenge(trustOnly), lostChallenge);
  await trustOnly.trustCallerLost(caller);
  await assert.rejects(() => confirm(trustOnly, lostChallenge), /caller/);
  cases++;
  await requestTrust(trustOnly, false);
  const expired = challenge(trustOnly);
  await until(() => trustState(trustOnly).kind === "idle", "consent expiry");
  await assert.rejects(() => confirm(trustOnly, expired), /caller/);
  assert.equal(f.trustWrites.length, 0);
  cases++;
  await requestTrust(trustOnly, false);
  const externallyChanged = challenge(trustOnly);
  f.set(FIRST, "Trusted", "b", false);
  await trustOnly.refresh();
  await assert.rejects(() => confirm(trustOnly, externallyChanged), /caller/);
  assert.equal(f.trustWrites.length, 0);
  cases++;
  f.set(FIRST, "Trusted", "b", true);
  await trustOnly.refresh();
  await requestTrust(trustOnly, false);
  const coalesced = challenge(trustOnly);
  f.changed(FIRST, { Trusted: variant("b", false) });
  f.changed(FIRST, { Trusted: variant("b", true) });
  await until(
    () => trustState(trustOnly).kind === "idle",
    "Trusted change retires coalesced consent",
  );
  assert.equal(ready(trustOnly).devices[0]!.trusted, true);
  await assert.rejects(() => confirm(trustOnly, coalesced), /caller/);
  assert.equal(f.trustWrites.length, 0);
  f.set(FIRST, "Trusted", "b", false);
  await trustOnly.refresh();
  cases++;
  // Caller loss while the prerequisite read is held cannot issue a future consent.
  f.set(FIRST, "Trusted", "b", true);
  await trustOnly.refresh();
  f.holdReads = true;
  const issuing = requestTrust(trustOnly, false);
  const deadCaller = assert.rejects(() => issuing);
  await until(() => f.heldReads.length > 0, "trust prerequisite held");
  await trustOnly.trustCallerLost(caller);
  f.release();
  await deadCaller;
  assert.equal(trustState(trustOnly).kind, "idle");
  assert.equal(f.trustWrites.length, 0);
  cases++;
  // Confirmation rechecks actual Trusted even without a preceding refresh signal.
  await requestTrust(trustOnly, false);
  const unseenChange = challenge(trustOnly);
  f.set(FIRST, "Trusted", "b", false);
  await assert.rejects(() => confirm(trustOnly, unseenChange), /changed/);
  assert.equal(f.trustWrites.length, 0);
  cases++;
  // Confirm is the sole Set; a read-only Connect policy still permits separately admitted trust.
  await requestTrust(trustOnly, true);
  const once = challenge(trustOnly);
  await confirm(trustOnly, once);
  assert.equal(f.trustWrites.length, 1);
  assert.deepEqual(f.trustWrites.at(-1), { path: FIRST, desired: true });
  assert.equal(ready(trustOnly).devices[0]!.trusted, true);
  await assert.rejects(() => confirm(trustOnly, once), /caller/);
  cases++;
  const ta = await adapter("interactive", 250, 100, "interactive");
  await until(() => ta.state.status.kind === "ready", "full policies");
  f.delayedTarget = true;
  const connecting = ta.setConnected({ id: ready(ta).devices[0]!.id, connected: true });
  await until(() => f.pendingTarget !== null, "Connect excludes trust");
  await assert.rejects(() => requestTrust(ta, false), /pending/);
  f.settle();
  await connecting;
  f.delayedTarget = false;
  cases++;
  await requestTrust(ta, false);
  await assert.rejects(
    () => ta.setConnected({ id: ready(ta).devices[0]!.id, connected: false }),
    /pending/,
  );
  const beforeRevoke = f.writes.length;
  await confirm(ta);
  assert.equal(ready(ta).devices[0]!.trusted, false);
  assert.equal(ready(ta).devices[0]!.connected, true);
  assert.equal(f.writes.length, beforeRevoke); // Revoke must not disconnect.
  await ta.setConnected({ id: ready(ta).devices[0]!.id, connected: false });
  assert.equal(f.writes.at(-1)?.member, "Disconnect");
  await assert.rejects(
    () => ta.setConnected({ id: ready(ta).devices[0]!.id, connected: true }),
    /trusted/,
  );
  cases++;
  // A held Set acknowledgement cannot publish trust optimistically or accept another request.
  await requestTrust(ta, true);
  f.holdActions = true;
  const heldConfirm = confirm(ta);
  await until(() => f.heldActions.length > 0, "held trust Set");
  assert.equal(trustState(ta).kind, "pending");
  assert.equal(ready(ta).devices[0]!.trusted, false);
  await assert.rejects(() => requestTrust(ta, true), /pending/);
  await assert.rejects(
    () => ta.setConnected({ id: ready(ta).devices[0]!.id, connected: true }),
    /pending/,
  );
  f.release();
  await heldConfirm;
  assert.equal(ready(ta).devices[0]!.trusted, true);
  cases++;
  f.actionError = "org.bluez.Error.NotAuthorized";
  await requestTrust(ta, false);
  await assert.rejects(() => confirm(ta), /denied/);
  assert.equal(trustState(ta).kind, "error");
  assert.equal(ready(ta).devices[0]!.trusted, true);
  assert(!JSON.stringify(ta.state).includes("private raw"));
  f.actionError = null;
  cases++;
  f.ignoreTrust = true;
  await requestTrust(ta, false);
  const uncertain = challenge(ta);
  await assert.rejects(() => confirm(ta, uncertain), /unknown/);
  assert.equal(trustState(ta).kind, "unknown");
  assert.equal(ready(ta).devices[0]!.trusted, true);
  const unchangedWrites = f.trustWrites.length;
  await assert.rejects(() => confirm(ta, uncertain), /caller/);
  await assert.rejects(() => requestTrust(ta, false), /pending/);
  await assert.rejects(
    () => ta.setConnected({ id: ready(ta).devices[0]!.id, connected: true }),
    /pending/,
  );
  assert.equal(f.trustWrites.length, unchangedWrites);
  f.ignoreTrust = false;
  f.set(FIRST, "Trusted", "b", false);
  await ta.refresh();
  assert.equal(trustState(ta).kind, "idle"); // Exact same-owner late observation, no retry.
  cases++;
  await requestTrust(ta, true);
  const removedConsent = challenge(ta);
  f.removed(FIRST);
  await until(
    () => ta.state.status.kind === "ready" && ready(ta).devices.length === 1,
    "trust target removed",
  );
  await assert.rejects(() => confirm(ta, removedConsent), /caller/);
  f.device(FIRST, "00:11:22:33:44:55");
  f.added(FIRST);
  await until(
    () => ta.state.status.kind === "ready" && ready(ta).devices.length === 2,
    "trust target readded",
  );
  await ta.dispose();
  await trustOnly.dispose();
  cases++;
  // Pending trust belongs to the old owner even if a replacement reports matching Trusted.
  const ownerTrust = await adapter("interactive", 500, 300, "interactive");
  await until(() => ownerTrust.state.status.kind === "ready", "owner trust");
  await requestTrust(ownerTrust, false);
  f.holdActions = true;
  const ownerConfirm = confirm(ownerTrust);
  const ownerRejected = assert.rejects(() => ownerConfirm, /unknown/);
  await until(() => f.heldActions.length > 0, "owner trust held");
  // In-flight old read cannot populate replacement owner's state.
  const oldId = ready(a).devices[0]!.id;
  f.holdReads = true;
  const oldRead = a.refresh();
  await until(() => f.heldReads.length > 0, "held read");
  await releaseName(server);
  const replacementBus = await bus(),
    replacement = new BluezFixture(replacementBus);
  fixtures.push(replacement);
  replacement.set(HCI, "Alias", "s", "Replacement radio");
  assert.equal(await replacementBus.requestName(BLUEZ, 4), 1);
  f.release();
  await oldRead;
  await ownerRejected;
  assert.equal(trustState(ownerTrust).kind, "unknown");
  await until(
    () => snapshot(a).status.kind === "ready" && ready(a).adapters[0]!.name === "Replacement radio",
    "replacement",
  );
  assert.notEqual(ready(a).devices[0]!.id, oldId);
  await until(() => ownerTrust.state.status.kind === "ready", "replacement trust observation");
  replacement.set(FIRST, "Trusted", "b", false);
  await ownerTrust.refresh();
  assert.equal(trustState(ownerTrust).kind, "unknown");
  await assert.rejects(() => requestTrust(ownerTrust, true), /pending/);
  await ownerTrust.dispose();
  replacement.set(FIRST, "Trusted", "b", true);
  cases++;
  cases++;
  let changedCount = 0;
  const stop = a.subscribe(() => changedCount++);
  replacement.holdActions = true;
  const target = ready(a).devices[0]!.id;
  const late = a.setConnected({ id: target, connected: true });
  const rejected = assert.rejects(() => late, /unknown/);
  await until(() => replacement.heldActions.length > 0, "held action");
  await releaseName(replacementBus);
  replacement.release();
  await rejected;
  assert.equal(snapshot(a).operation.kind, "unknown");
  cases++;
  const thirdBus = await bus(),
    third = new BluezFixture(thirdBus);
  fixtures.push(third);
  assert.equal(await thirdBus.requestName(BLUEZ, 4), 1);
  await until(() => snapshot(a).status.kind === "ready", "third owner");
  assert.equal(snapshot(a).operation.kind, "unknown");
  const thirdWrites = third.writes.length;
  await assert.rejects(
    () => a.setConnected({ id: ready(a).devices[0]!.id, connected: true }),
    /unknown/,
  );
  assert.equal(third.writes.length, thirdWrites);
  cases++;
  stop();
  await a.dispose();
  const n = changedCount;
  third.changed();
  await a.refresh();
  await a.dispose();
  assert.equal(changedCount, n);
  cases++;
  const disposing = await adapter();
  await until(() => snapshot(disposing).status.kind === "ready", "dispose adapter");
  third.holdActions = true;
  const inFlight = disposing.setConnected({ id: ready(disposing).devices[0]!.id, connected: true });
  const aborted = assert.rejects(() => inFlight, /unknown/);
  await until(() => third.heldActions.length > 0, "dispose action");
  await disposing.dispose();
  third.release();
  await aborted;
  cases++;
  const loss = await adapter();
  await until(() => snapshot(loss).status.kind === "ready", "bus loss adapter");
  daemon.kill("SIGTERM");
  await daemonExit;
  await until(() => snapshot(loss).status.kind === "unavailable", "bus loss");
  cases++;
  assert(
    fixtures.every((fixture) =>
      fixture.writes.every((write) => write.member === "Connect" || write.member === "Disconnect"),
    ),
  );
  console.log(
    JSON.stringify({
      scope:
        "actual private dbus-daemon fake BlueZ connection, adapter power, device removal, rename, kind, battery and explicit trust; no radio, discovery, pairing or audio-route claims",
      cases,
      actualExitCode: 0,
    }),
  );
} finally {
  for (const fixture of fixtures) fixture.release();
  await Promise.allSettled(adapters.map((a) => a.dispose()));
  for (const b of buses) b.close();
  if (daemon.exitCode === null && !daemonError) daemon.kill("SIGTERM");
  await daemonExit;
  await fs.rm(directory, { recursive: true, force: true });
}

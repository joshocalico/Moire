import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SessionBus, DbusRemoteError, variant, type DbusVariant } from "@moire/dbus";
import {
  batterySupported,
  type BatteryAdapter,
  type DesktopBattery,
} from "@moire/system-management/battery-status";
import { createUPowerBatteryAdapter } from "./upower-battery";

const UPOWER = "org.freedesktop.UPower",
  ROOT = "/org/freedesktop/UPower";
const DEVICE = UPOWER + ".Device",
  PROPS = "org.freedesktop.DBus.Properties";
const DISPLAY = ROOT + "/devices/DisplayDevice",
  OTHER = ROOT + "/devices/OtherDisplay";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 4000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("Timeout: " + label);
    await delay(5);
  }
}
function ready(adapter: BatteryAdapter): Extract<DesktopBattery, { kind: "ready" }> {
  const state = adapter.state;
  assert.equal(state.kind, "ready");
  if (state.kind !== "ready") throw new Error("Expected ready battery");
  return state;
}
class UPowerFixture {
  readonly calls: { path: string; interface: string; member: string }[] = [];
  readonly devices = new Map<string, Record<string, DbusVariant>>();
  onBattery = true;
  display = DISPLAY;
  hold = false;
  releases: (() => void)[] = [];
  fail = false;
  manager: Record<string, DbusVariant> = { OnBattery: variant("b", true) };
  constructor(readonly bus: SessionBus) {
    this.device(DISPLAY);
    this.device(OTHER);
    bus.exportObject(ROOT, {
      name: UPOWER,
      methods: {
        GetDisplayDevice: {
          inSignature: "",
          outSignature: "o",
          handler: () => {
            this.calls.push({ path: ROOT, interface: UPOWER, member: "GetDisplayDevice" });
            return { body: [this.display] };
          },
        },
        // These routes must never be called by the adapter.
        GetCriticalAction: {
          inSignature: "",
          outSignature: "s",
          handler: () => {
            throw new Error("Power action probe called");
          },
        },
      },
    });
    this.properties(ROOT, UPOWER);
  }
  device(p: string) {
    this.devices.set(p, {
      Type: variant("u", 2),
      IsPresent: variant("b", true),
      Percentage: variant("d", 52.5),
      State: variant("u", 2),
      WarningLevel: variant("u", 1),
      TimeToEmpty: variant("x", 3600n),
      TimeToFull: variant("x", 0n),
      // Deliberately absent PowerSupply: aggregate docs do not require it.
    });
    this.properties(p, DEVICE);
    this.bus.exportObject(p, {
      name: DEVICE,
      methods: {
        Refresh: {
          inSignature: "",
          outSignature: "",
          handler: () => {
            this.calls.push({ path: p, interface: DEVICE, member: "Refresh" });
            throw new Error("Forbidden battery mutation");
          },
        },
      },
    });
  }
  properties(p: string, iface: string) {
    this.bus.exportObject(p, {
      name: PROPS,
      methods: {
        GetAll: {
          inSignature: "s",
          outSignature: "a{sv}",
          handler: async ({ body }) => {
            this.calls.push({ path: p, interface: PROPS, member: "GetAll" });
            assert.equal(body[0], iface);
            if (this.hold && p === ROOT)
              await new Promise<void>((resolve) => this.releases.push(resolve));
            if (this.fail)
              throw new DbusRemoteError(
                "org.freedesktop.DBus.Error.Failed",
                "fixture raw error detail must not escape",
              );
            const raw = p === ROOT ? this.manager : this.devices.get(p);
            if (!raw)
              throw new DbusRemoteError(
                "org.freedesktop.DBus.Error.UnknownObject",
                "fixture display removed",
              );
            return { body: [raw] };
          },
        },
      },
    });
  }
  set(key: string, signature: string, value: unknown, p = DISPLAY) {
    const raw = this.devices.get(p);
    assert(raw);
    raw[key] = variant(signature, value);
  }
  release() {
    this.hold = false;
    for (const fn of this.releases.splice(0)) fn();
  }
  changed(p = DISPLAY, iface = DEVICE) {
    this.bus.emitSignal({
      path: p,
      interface: PROPS,
      member: "PropertiesChanged",
      signature: "sa{sv}as",
      body: [iface, {}, []],
    });
  }
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-upower-smoke-"));
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
  adapters: BatteryAdapter[] = [],
  fixtures: UPowerFixture[] = [];
let cases = 0;
async function bus() {
  const b = await SessionBus.connect(address.trim());
  buses.push(b);
  return b;
}
async function releaseName(b: SessionBus) {
  const reply = await b.call({
    destination: "org.freedesktop.DBus",
    path: "/org/freedesktop/DBus",
    interface: "org.freedesktop.DBus",
    member: "ReleaseName",
    signature: "s",
    body: [UPOWER],
  });
  assert.equal(reply.body?.[0], 1);
}
async function adapter(timeout = 500, pollMs = 0) {
  const a = await createUPowerBatteryAdapter({ connect: bus, callTimeoutMs: timeout, pollMs });
  adapters.push(a);
  return a;
}
try {
  await until(
    () => address.includes("\n") || daemon.exitCode !== null || daemonError !== null,
    "private daemon",
  );
  if (daemonError) throw daemonError;
  assert(address.startsWith("unix:"), stderr);
  const a = await adapter();
  assert.equal(a.state.kind, "unavailable");
  assert.equal(batterySupported(a.state), false);
  cases++;
  let invalidConnect = false;
  const invalid = await createUPowerBatteryAdapter({
    connect: async () => {
      invalidConnect = true;
      return bus();
    },
    callTimeoutMs: 0,
  });
  adapters.push(invalid);
  assert.equal(invalid.state.kind, "error");
  assert.equal(invalidConnect, false);
  assert.equal(batterySupported(invalid.state), false);
  cases++;
  const broken = await createUPowerBatteryAdapter({
    connect: async () => {
      throw new Error("fixture unavailable");
    },
  });
  adapters.push(broken);
  assert.equal(broken.state.kind, "unavailable");
  cases++;
  const server = await bus(),
    f = new UPowerFixture(server);
  fixtures.push(f);
  assert.equal(await server.requestName(UPOWER, 4), 1);
  await until(() => a.state.kind === "ready", "owner appears");
  assert.deepEqual(ready(a), {
    kind: "ready",
    source: "battery",
    percentage: 52.5,
    chargeState: "discharging",
    onBattery: true,
    warningLevel: "none",
    timeToEmptySeconds: 3600,
    timeToFullSeconds: null,
  });
  cases++;
  let publications = 0;
  const stop = a.subscribe(() => {
    publications++;
  });
  const unchanged = a.state;
  await a.refresh();
  await a.refresh();
  assert.equal(a.state, unchanged);
  assert.equal(publications, 0);
  cases++;
  // Concurrent callers share the held read, followed by one requested fresh read.
  const beforeCoalescing = f.calls.length;
  f.hold = true;
  const firstRead = a.refresh();
  await until(() => f.releases.length > 0, "coalesced read held");
  const joined = Array.from({ length: 20 }, () => a.refresh());
  assert.equal(f.calls.length - beforeCoalescing, 2);
  f.release();
  await Promise.all([firstRead, ...joined]);
  await until(() => f.calls.length - beforeCoalescing === 6, "one coalesced follow-up");
  assert.equal(a.state, unchanged);
  cases++;
  f.set("State", "u", 1);
  f.set("TimeToEmpty", "x", 0n);
  f.set("TimeToFull", "x", 900n);
  f.manager.OnBattery = variant("b", false);
  f.changed(ROOT, UPOWER);
  await until(
    () => a.state.kind === "ready" && a.state.chargeState === "charging",
    "manager signal updates",
  );
  assert.equal(ready(a).onBattery, false);
  assert.equal(ready(a).timeToFullSeconds, 900);
  cases++;
  f.set("State", "u", 4);
  f.set("Percentage", "d", 100);
  f.changed();
  await until(
    () => a.state.kind === "ready" && a.state.chargeState === "fully-charged",
    "device signal",
  );
  cases++;
  for (const [n, label] of [
    [0, "unknown"],
    [3, "empty"],
    [5, "pending-charge"],
    [6, "pending-discharge"],
    [99, "unknown"],
  ] as const) {
    f.set("State", "u", n);
    await a.refresh();
    assert.equal(ready(a).chargeState, label);
    cases++;
  }
  for (const [n, label] of [
    [0, "unknown"],
    [1, "none"],
    [2, "discharging"],
    [3, "low"],
    [4, "critical"],
    [5, "action"],
    [99, "unknown"],
  ] as const) {
    f.set("WarningLevel", "u", n);
    await a.refresh();
    assert.equal(ready(a).warningLevel, label);
    cases++;
  }
  f.set("Type", "u", 3);
  await a.refresh();
  assert.equal(ready(a).source, "ups");
  cases++;
  f.set("IsPresent", "b", false);
  await a.refresh();
  assert.equal(a.state.kind, "unavailable");
  assert.equal(batterySupported(a.state), false);
  cases++;
  f.set("IsPresent", "b", true);
  f.set("Type", "u", 1);
  await a.refresh();
  assert.equal(a.state.kind, "unavailable");
  cases++;
  f.set("Type", "u", 2);
  await a.refresh();
  f.set("TimeToEmpty", "x", BigInt(Number.MAX_SAFE_INTEGER));
  await a.refresh();
  assert.equal(ready(a).timeToEmptySeconds, Number.MAX_SAFE_INTEGER);
  f.set("TimeToEmpty", "x", 0n);
  await a.refresh();
  assert.equal(ready(a).timeToEmptySeconds, null);
  cases++;
  f.fail = true;
  await a.refresh();
  assert.deepEqual(a.state, {
    kind: "error",
    supported: true,
    message: "Unable to read UPower battery status",
  });
  assert(!("percentage" in a.state));
  cases++;
  f.fail = false;
  await a.refresh();
  const raw = f.devices.get(DISPLAY);
  assert(raw);
  const savedState = raw.State;
  assert(savedState);
  delete raw.State;
  await a.refresh();
  assert.equal(a.state.kind, "error");
  raw.State = savedState;
  await a.refresh();
  cases++;
  const extraKeys = Array.from({ length: 129 }, (_, i) => "Extra" + i);
  for (const key of extraKeys) raw[key] = variant("u", 1);
  await a.refresh();
  assert.equal(a.state.kind, "error");
  for (const key of extraKeys) delete raw[key];
  await a.refresh();
  cases++;
  for (const [key, signature, value] of [
    ["Percentage", "d", NaN],
    ["Percentage", "d", Infinity],
    ["Percentage", "d", -1],
    ["Percentage", "d", 101],
    ["Percentage", "s", "50"],
    ["State", "s", "charging"],
    ["IsPresent", "u", 1],
    ["TimeToEmpty", "x", BigInt(Number.MAX_SAFE_INTEGER) + 1n],
    ["TimeToEmpty", "x", 0xffff_ffff_ffff_ffffn],
    ["TimeToFull", "u", 12],
  ] as const) {
    const previous = raw[key];
    assert(previous);
    f.set(key, signature, value);
    await a.refresh();
    assert.equal(a.state.kind, "error");
    assert.equal(batterySupported(a.state), true);
    assert(!("percentage" in a.state));
    raw[key] = previous;
    await a.refresh();
    cases++;
  }
  f.manager.OnBattery = variant("u", 1);
  await a.refresh();
  assert.equal(a.state.kind, "error");
  f.manager.OnBattery = variant("b", true);
  await a.refresh();
  cases++;
  const readCount = f.calls.length;
  f.set("Percentage", "d", 47);
  f.changed(DISPLAY, "org.example.WrongInterface");
  f.changed("/org/example/WrongPath");
  const stranger = await bus();
  stranger.emitSignal({
    path: DISPLAY,
    interface: PROPS,
    member: "PropertiesChanged",
    signature: "sa{sv}as",
    body: [DEVICE, {}, []],
  });
  await delay(30);
  assert.equal(f.calls.length, readCount);
  assert.equal(ready(a).percentage, 100);
  cases++;
  f.changed();
  await until(() => a.state.kind === "ready" && a.state.percentage === 47, "filtered valid signal");
  cases++;
  f.display = OTHER;
  f.set("Percentage", "d", 21, OTHER);
  await a.refresh();
  assert.equal(ready(a).percentage, 21);
  const swapped = f.calls.length;
  f.changed(DISPLAY);
  await delay(30);
  assert.equal(f.calls.length, swapped);
  cases++;
  f.display = "/";
  await a.refresh();
  assert.equal(a.state.kind, "unavailable");
  cases++;
  f.display = OTHER;
  await a.refresh();
  f.set("IsPresent", "b", false, OTHER);
  server.emitSignal({
    path: ROOT,
    interface: UPOWER,
    member: "DeviceRemoved",
    signature: "o",
    body: [OTHER],
  });
  await until(() => a.state.kind === "unavailable", "display presentation removed");
  assert.equal(batterySupported(a.state), false);
  f.set("IsPresent", "b", true, OTHER);
  await a.refresh();
  cases++;
  f.devices.delete(OTHER);
  server.emitSignal({
    path: ROOT,
    interface: UPOWER,
    member: "DeviceRemoved",
    signature: "o",
    body: [OTHER],
  });
  await until(() => a.state.kind === "error", "present object removed");
  assert(!("percentage" in a.state));
  cases++;
  // Replace owner while its actual property RPC is in flight; old reply cannot publish.
  f.display = DISPLAY;
  f.hold = true;
  const pending = a.refresh();
  await until(() => f.releases.length > 0, "held old read");
  await releaseName(server);
  const replacementBus = await bus(),
    replacement = new UPowerFixture(replacementBus);
  fixtures.push(replacement);
  replacement.set("Percentage", "d", 8);
  assert.equal(await replacementBus.requestName(UPOWER, 4), 1);
  await until(() => a.state.kind === "ready" && a.state.percentage === 8, "new owner read");
  f.release();
  await pending;
  await delay(20);
  assert.equal(ready(a).percentage, 8);
  cases++;
  const timed = await adapter(50);
  replacement.hold = true;
  const start = performance.now();
  await timed.refresh();
  assert.equal(timed.state.kind, "error");
  assert.equal(batterySupported(timed.state), true);
  assert(performance.now() - start < 1000);
  replacement.release();
  await timed.refresh();
  assert.equal(timed.state.kind, "ready");
  cases++;
  replacement.fail = true;
  const neverSupported = await adapter();
  assert.equal(neverSupported.state.kind, "error");
  assert.equal(batterySupported(neverSupported.state), false);
  replacement.fail = false;
  await neverSupported.refresh();
  assert.equal(neverSupported.state.kind, "ready");
  cases++;
  const disposed = await adapter();
  let late = 0;
  disposed.subscribe(() => {
    late++;
  });
  replacement.hold = true;
  const interrupted = disposed.refresh();
  await until(() => replacement.releases.length > 0, "dispose held read");
  await disposed.dispose();
  const before = late;
  replacement.release();
  await interrupted;
  replacement.changed();
  await delay(20);
  assert.equal(late, before);
  await disposed.dispose();
  cases++;
  const disconnected = await adapter();
  const client = buses.at(-1);
  assert(client);
  client.close();
  await until(() => disconnected.state.kind === "unavailable", "disconnect");
  assert.equal(batterySupported(disconnected.state), false);
  await disconnected.dispose();
  cases++;
  const polled = await adapter(500, 15);
  replacement.set("Percentage", "d", 19);
  await until(
    () => polled.state.kind === "ready" && polled.state.percentage === 19,
    "optional poll",
  );
  await polled.dispose();
  cases++;
  await releaseName(replacementBus);
  await until(() => a.state.kind === "unavailable", "owner lost");
  assert.equal(batterySupported(a.state), false);
  cases++;
  stop();
  await a.dispose();
  const final = publications;
  await a.refresh();
  assert.equal(publications, final);
  cases++;
  for (const fixture of fixtures) {
    assert(
      fixture.calls.every((call) => call.member === "GetAll" || call.member === "GetDisplayDevice"),
      "only read RPCs; never Device.Refresh/power writes",
    );
  }
  console.log(
    JSON.stringify({
      scope:
        "actual private dbus-daemon UPower fixture; read RPCs only, no hardware or power actions",
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

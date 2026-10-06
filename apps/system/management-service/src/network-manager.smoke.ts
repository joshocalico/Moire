import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SessionBus, DbusRemoteError, variant, type DbusVariant } from "@moire/dbus";
import type { WifiAdapter, DesktopWifi } from "@moire/system-management/network-status";
import { createNetworkManagerAdapter } from "./network-manager";

const NM = "org.freedesktop.NetworkManager",
  ROOT = "/org/freedesktop/NetworkManager",
  PROPS = "org.freedesktop.DBus.Properties",
  DEVICE = NM + ".Device",
  WIRELESS = DEVICE + ".Wireless",
  ACCESS = NM + ".AccessPoint",
  ACTIVE = NM + ".Connection.Active";
const D = ROOT + "/Devices/1",
  WIRED = ROOT + "/Devices/2",
  OPEN = ROOT + "/AccessPoint/1",
  PSK = ROOT + "/AccessPoint/2",
  EAP = ROOT + "/AccessPoint/3",
  INVALID = ROOT + "/AccessPoint/4",
  OTHER = ROOT + "/ActiveConnection/1";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const end = performance.now() + 4000;
  while (!check()) {
    if (performance.now() > end) throw new Error("Timeout: " + label);
    await delay(5);
  }
}
function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function value(v: unknown): unknown {
  assert(record(v));
  assert("value" in v);
  return v.value;
}
function ready(adapter: WifiAdapter): Extract<DesktopWifi, { kind: "ready" }> {
  const v = adapter.state;
  assert.equal(v.kind, "ready");
  if (v.kind !== "ready") throw new Error("Expected ready network");
  return v;
}
class NetworkFixture {
  readonly properties = new Map<string, Map<string, Record<string, DbusVariant>>>();
  readonly mutations: { member: string; body: unknown[] }[] = [];
  readonly additions: { path: string; uuid: string }[] = [];
  permissions: Record<string, string> = {
    [NM + ".network-control"]: "yes",
    [NM + ".settings.modify.own"]: "yes",
    [NM + ".wifi.scan"]: "yes",
  };
  removeOnDeactivate = false;
  propertyReads: string[] = [];
  holdAdd = false;
  releaseAdd: (() => void) | null = null;
  secretError = false;
  denyAdd = false;
  holdRead = false;
  releaseRead: (() => void) | null = null;
  activeNumber = 10;
  constructor(readonly bus: SessionBus) {
    this.object(ROOT, NM, {
      Devices: variant("ao", [D, WIRED]),
      NetworkingEnabled: variant("b", true),
      WirelessEnabled: variant("b", true),
      WirelessHardwareEnabled: variant("b", true),
      ActiveConnections: variant("ao", [OTHER]),
      PrimaryConnection: variant("o", OTHER),
      Connectivity: variant("u", 4),
    });
    this.object(D, DEVICE, {
      DeviceType: variant("u", 2),
      Managed: variant("b", true),
      Interface: variant("s", "wlan-fixture"),
      HwAddress: variant("s", "02:00:00:00:00:01"),
    });
    this.object(D, WIRELESS, {
      AccessPoints: variant("ao", [OPEN, PSK, EAP, INVALID]),
      ActiveAccessPoint: variant("o", "/"),
    });
    this.object(WIRED, DEVICE, { DeviceType: variant("u", 1), Managed: variant("b", true) });
    this.ap(OPEN, Buffer.from("Open fixture"), 0, 0);
    this.ap(PSK, Buffer.from("Password fixture"), 1, 256 | 8 | 128);
    this.ap(EAP, Buffer.from("Enterprise fixture"), 1, 512 | 8 | 128);
    this.ap(INVALID, Buffer.from([0xff, 0, 0x61]), 0, 0);
    this.connection(
      OTHER,
      "external-uuid",
      "External wired fixture",
      2,
      "/",
      WIRED,
      "/profile/external",
      "802-3-ethernet",
    );
    bus.exportObject(ROOT, {
      name: NM,
      methods: {
        GetPermissions: {
          inSignature: "",
          outSignature: "a{ss}",
          handler: () => ({ body: [this.permissions] }),
        },
        AddAndActivateConnection2: {
          inSignature: "a{sa{sv}}ooa{sv}",
          outSignature: "ooa{sv}",
          handler: async ({ body }) => {
            this.mutations.push({ member: "AddAndActivateConnection2", body });
            if (this.denyAdd)
              throw new DbusRemoteError(
                "org.freedesktop.NetworkManager.PermissionDenied",
                "fixture-pass-12 must not leak",
              );
            if (this.secretError) throw new Error("backend detail must not leak fixture-pass-12");
            const settings = body[0];
            assert(record(settings));
            const profile = settings.connection;
            assert(record(profile));
            const uuid = value(profile.uuid);
            assert.equal(typeof uuid, "string");
            if (typeof uuid !== "string") throw new Error("uuid");
            const ap = body[2];
            assert.equal(typeof ap, "string");
            if (typeof ap !== "string") throw new Error("ap");
            const p = ROOT + "/ActiveConnection/" + this.activeNumber++,
              connection = ROOT + "/Settings/" + this.activeNumber;
            this.connection(p, uuid, "Owned fixture", 1, ap, D, connection);
            this.additions.push({ path: p, uuid });
            this.set(ROOT, NM, "ActiveConnections", "ao", [OTHER, p]);
            if (this.holdAdd)
              await new Promise<void>((resolve) => {
                this.releaseAdd = resolve;
              });
            return { body: [connection, p, {}] };
          },
        },
        DeactivateConnection: {
          inSignature: "o",
          outSignature: "",
          handler: ({ body }) => {
            this.mutations.push({ member: "DeactivateConnection", body });
            assert.equal(typeof body[0], "string");
            if (typeof body[0] !== "string") throw new Error("path");
            if (this.removeOnDeactivate) {
              this.properties.delete(body[0]);
              const current = value(this.properties.get(ROOT)?.get(NM)?.ActiveConnections);
              assert(Array.isArray(current));
              this.set(
                ROOT,
                NM,
                "ActiveConnections",
                "ao",
                current.filter((p) => p !== body[0]),
              );
            } else this.set(body[0], ACTIVE, "State", "u", 4);
            return { body: [] };
          },
        },
      },
    });
    bus.exportObject(D, {
      name: WIRELESS,
      methods: {
        RequestScan: {
          inSignature: "a{sv}",
          outSignature: "",
          handler: ({ body }) => {
            this.mutations.push({ member: "RequestScan", body });
            return { body: [] };
          },
        },
      },
    });
  }
  object(p: string, iface: string, props: Record<string, DbusVariant>) {
    let interfaces = this.properties.get(p);
    if (!interfaces) {
      interfaces = new Map();
      this.properties.set(p, interfaces);
      this.bus.exportObject(p, {
        name: PROPS,
        methods: {
          GetAll: {
            inSignature: "s",
            outSignature: "a{sv}",
            handler: async ({ body }) => {
              assert.equal(typeof body[0], "string");
              this.propertyReads.push(p + "|" + String(body[0]));
              if (this.holdRead && p === ROOT)
                await new Promise<void>((resolve) => {
                  this.releaseRead = resolve;
                });
              const found =
                typeof body[0] === "string" ? this.properties.get(p)?.get(body[0]) : undefined;
              if (!found)
                throw new DbusRemoteError(
                  "org.freedesktop.DBus.Error.UnknownObject",
                  "fixture object removed",
                );
              return { body: [found] };
            },
          },
        },
      });
    }
    interfaces.set(iface, props);
  }
  set(p: string, iface: string, key: string, signature: string, v: unknown) {
    const props = this.properties.get(p)?.get(iface);
    assert(props);
    props[key] = variant(signature, v);
  }
  ap(p: string, ssid: Buffer, flags: number, rsn: number) {
    this.object(p, ACCESS, {
      Ssid: variant("ay", ssid),
      Flags: variant("u", flags),
      WpaFlags: variant("u", 0),
      RsnFlags: variant("u", rsn),
      Mode: variant("u", 2),
      HwAddress: variant("s", "02:00:00:00:01:" + p.slice(-1)),
      Strength: variant("y", 75),
    });
  }
  connection(
    p: string,
    uuid: string,
    id: string,
    state: number,
    specific: string,
    device: string,
    connection: string,
    type = "802-11-wireless",
  ) {
    this.object(p, ACTIVE, {
      Uuid: variant("s", uuid),
      Id: variant("s", id),
      State: variant("u", state),
      SpecificObject: variant("o", specific),
      Devices: variant("ao", [device]),
      Connection: variant("o", connection),
      Type: variant("s", type),
    });
  }
  finishAdd() {
    const complete = this.releaseAdd;
    assert(complete);
    this.releaseAdd = null;
    complete();
  }
  changed(p = ROOT, iface = NM) {
    this.bus.emitSignal({
      path: p,
      interface: PROPS,
      member: "PropertiesChanged",
      signature: "sa{sv}as",
      body: [iface, {}, []],
    });
  }
  stateChanged(p: string, state: number) {
    this.set(p, ACTIVE, "State", "u", state);
    this.bus.emitSignal({
      path: p,
      interface: ACTIVE,
      member: "StateChanged",
      signature: "uu",
      body: [state, 0],
    });
  }
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-nm-private-"));
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
  stderr = "";
daemon.stdout.on("data", (b) => {
  address += b.toString();
});
daemon.stderr.on("data", (b) => {
  stderr += b.toString();
});
let daemonError: Error | null = null;
const exits = new Promise<void>((resolve) => {
  daemon.once("exit", () => resolve());
  daemon.once("error", (error) => {
    daemonError = error;
    resolve();
  });
});
const buses: SessionBus[] = [],
  adapters: WifiAdapter[] = [];
let cases = 0;
async function bus() {
  const b = await SessionBus.connect(address.trim());
  buses.push(b);
  return b;
}
async function adapter(policy: "readonly" | "interactive" = "interactive", timeout = 500) {
  const a = await createNetworkManagerAdapter({
    connect: bus,
    policy,
    callTimeoutMs: timeout,
    pollMs: 0,
  });
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
  const absent = await adapter();
  assert.equal(absent.state.kind, "unavailable");
  cases++;
  let invalidConnected = false;
  const previousPolicy = process.env.MOIRE_NETWORK_CONTROL;
  process.env.MOIRE_NETWORK_CONTROL = "bad-policy";
  try {
    const invalid = await createNetworkManagerAdapter({
      connect: async () => {
        invalidConnected = true;
        return bus();
      },
    });
    adapters.push(invalid);
    assert.equal(invalid.state.kind, "error");
    assert.equal(invalidConnected, false);
    cases++;
  } finally {
    if (previousPolicy === undefined) delete process.env.MOIRE_NETWORK_CONTROL;
    else process.env.MOIRE_NETWORK_CONTROL = previousPolicy;
  }
  const server = await bus();
  const fixture = new NetworkFixture(server);
  assert.equal(await server.requestName(NM, 4), 1);
  await until(() => absent.state.kind === "ready", "owner appears without activation");
  cases++;
  const readOnly = await adapter("readonly");
  assert.equal(ready(readOnly).canConnect, false);
  assert.equal(ready(readOnly).canScan, false);
  await assert.rejects(() => readOnly.scan(), /read-only/);
  await assert.rejects(
    () => readOnly.connect({ id: ready(readOnly).accessPoints[0]?.id ?? "", password: "" }),
    /read-only/,
  );
  assert.equal(fixture.mutations.length, 0);
  cases++;
  delete process.env.MOIRE_NETWORK_CONTROL;
  try {
    const defaultReadOnly = await createNetworkManagerAdapter({ connect: bus, pollMs: 0 });
    adapters.push(defaultReadOnly);
    assert.equal(ready(defaultReadOnly).policy, "readonly");
    assert.equal(ready(defaultReadOnly).canConnect, false);
    assert.equal(ready(defaultReadOnly).canScan, false);
    await assert.rejects(() => defaultReadOnly.scan(), /read-only/);
    await assert.rejects(
      () =>
        defaultReadOnly.connect({
          id: ready(defaultReadOnly).accessPoints[0]?.id ?? "",
          password: "",
        }),
      /read-only/,
    );
    assert.equal(fixture.mutations.length, 0);
    cases++;
  } finally {
    if (previousPolicy === undefined) delete process.env.MOIRE_NETWORK_CONTROL;
    else process.env.MOIRE_NETWORK_CONTROL = previousPolicy;
  }
  const broken = await createNetworkManagerAdapter({
    connect: async () => {
      throw new Error("fixed unavailable private-bus fixture");
    },
    policy: "readonly",
    pollMs: 0,
  });
  adapters.push(broken);
  assert.equal(broken.state.kind, "unavailable");
  await broken.dispose();
  cases++;
  const a = await adapter();
  assert.equal(ready(a).connectivity, "full");
  assert.deepEqual(ready(a).connection, {
    kind: "active",
    name: "External wired fixture",
    transport: "wired",
  });
  assert.equal(
    ready(a).accessPoints.find((p) => p.ssid === "Enterprise fixture")?.security,
    "unsupported",
  );
  cases++;
  const first = a.state;
  let publishes = 0;
  const stop = a.subscribe(() => {
    publishes++;
  });
  await a.refresh();
  await a.refresh();
  assert.equal(a.state, first);
  assert.equal(publishes, 0);
  cases++;
  const open = () => ready(a).accessPoints.find((p) => p.ssid === "Open fixture")?.id ?? "";
  const psk = () => ready(a).accessPoints.find((p) => p.ssid === "Password fixture")?.id ?? "";
  fixture.permissions[NM + ".network-control"] = "auth";
  await a.refresh();
  assert.equal(ready(a).canConnect, false);
  await assert.rejects(() => a.connect({ id: open(), password: "" }));
  assert.equal(fixture.mutations.length, 0);
  cases++;
  fixture.permissions[NM + ".network-control"] = "yes";
  fixture.set(ROOT, NM, "WirelessHardwareEnabled", "b", false);
  await a.refresh();
  await assert.rejects(() => a.scan());
  assert.equal(fixture.mutations.length, 0);
  cases++;
  fixture.set(ROOT, NM, "WirelessHardwareEnabled", "b", true);
  await a.refresh();
  await a.scan();
  assert.equal(fixture.mutations.at(-1)?.member, "RequestScan");
  cases++;
  const rejected = ready(a).accessPoints.find((p) => p.security === "unsupported");
  assert(rejected);
  await assert.rejects(
    () => a.connect({ id: rejected.id, password: "fixture-pass-12" }),
    /unsupported/,
  );
  await assert.rejects(() => a.connect({ id: psk(), password: "short" }), /passphrase/);
  cases++;
  const beforeInvalidPassword = fixture.mutations.length;
  await assert.rejects(() => a.connect({ id: psk(), password: "é12345678" }), /passphrase/);
  await assert.rejects(() => a.connect({ id: psk(), password: "abc\n123456" }), /passphrase/);
  assert.equal(fixture.mutations.length, beforeInvalidPassword);
  cases++;
  const stale = open();
  fixture.set(OPEN, ACCESS, "Ssid", "ay", Buffer.from("Changed fixture"));
  await assert.rejects(() => a.connect({ id: stale, password: "" }));
  assert.equal(fixture.mutations.filter((m) => m.member === "AddAndActivateConnection2").length, 0);
  fixture.set(OPEN, ACCESS, "Ssid", "ay", Buffer.from("Open fixture"));
  await a.refresh();
  cases++;
  fixture.set(D, WIRELESS, "ActiveAccessPoint", "o", OPEN);
  const beforeConnected = fixture.mutations.length;
  await assert.rejects(() => a.connect({ id: open(), password: "" }));
  assert.equal(fixture.mutations.length, beforeConnected);
  fixture.set(D, WIRELESS, "ActiveAccessPoint", "o", "/");
  await a.refresh();
  cases++;
  const deviceId = open();
  fixture.set(D, DEVICE, "Interface", "s", "replacement-device");
  await assert.rejects(() => a.connect({ id: deviceId, password: "" }));
  assert.equal(fixture.mutations.length, beforeConnected);
  fixture.set(D, DEVICE, "Interface", "s", "wlan-fixture");
  await a.refresh();
  cases++;
  await a.connect({ id: open(), password: "" });
  assert.equal(ready(a).operation.kind, "connecting");
  const own = fixture.additions.at(-1);
  assert(own);
  assert.equal(ready(a).accessPoints.find((p) => p.id === open())?.connected, false);
  cases++;
  const addition = fixture.mutations.find((m) => m.member === "AddAndActivateConnection2");
  assert(addition);
  assert(record(addition.body[0]));
  assert(record(addition.body[0].connection));
  assert.equal(value(addition.body[0].connection.autoconnect), false);
  assert(!("802-11-wireless-security" in addition.body[0]));
  assert(record(addition.body[3]));
  assert.equal(value(addition.body[3].persist), "volatile");
  assert.equal(value(addition.body[3]["bind-activation"]), "dbus-client");
  cases++;
  fixture.set(ROOT, NM, "PrimaryConnection", "o", own.path);
  fixture.set(D, WIRELESS, "ActiveAccessPoint", "o", OPEN);
  fixture.stateChanged(own.path, 2);
  await until(() => ready(a).operation.kind === "idle", "observed connection activated");
  assert.deepEqual(ready(a).connection, {
    kind: "active",
    name: "Owned fixture",
    transport: "wifi",
  });
  assert.equal(ready(a).accessPoints.find((p) => p.ssid === "Open fixture")?.connected, true);
  fixture.set(ROOT, NM, "PrimaryConnection", "o", OTHER);
  fixture.set(D, WIRELESS, "ActiveAccessPoint", "o", "/");
  cases++;
  const cancelWrites = fixture.mutations.length;
  fixture.set(own.path, ACTIVE, "Uuid", "s", "unrelated-replacement");
  await assert.rejects(() => a.cancel());
  assert.equal(fixture.mutations.length, cancelWrites);
  assert.equal(value(fixture.properties.get(OTHER)?.get(ACTIVE)?.State), 2);
  fixture.set(own.path, ACTIVE, "Uuid", "s", own.uuid);
  await a.refresh();
  cases++;
  await a.cancel();
  assert.equal(ready(a).operation.kind, "idle");
  assert.deepEqual(fixture.mutations.at(-1)?.body, [own.path]);
  assert.equal(value(fixture.properties.get(OTHER)?.get(ACTIVE)?.State), 2);
  cases++;
  await a.connect({ id: open(), password: "" });
  const removed = fixture.additions.at(-1);
  assert(removed);
  fixture.removeOnDeactivate = true;
  await a.cancel();
  fixture.removeOnDeactivate = false;
  assert.equal(ready(a).operation.kind, "idle");
  assert.equal(fixture.properties.has(removed.path), false);
  const probe = await bus();
  await assert.rejects(
    () =>
      probe.call({
        destination: server.name ?? "",
        path: removed.path,
        interface: PROPS,
        member: "GetAll",
        signature: "s",
        body: [ACTIVE],
      }),
    (error: unknown) =>
      error instanceof DbusRemoteError &&
      error.errorName === "org.freedesktop.DBus.Error.UnknownObject",
  );
  cases++;
  await a.connect({ id: psk(), password: "fixture-pass-12" });
  const secure = fixture.mutations.at(-1);
  assert(secure && record(secure.body[0]) && record(secure.body[0]["802-11-wireless-security"]));
  assert.equal(value(secure.body[0]["802-11-wireless-security"].psk), "fixture-pass-12");
  assert(!JSON.stringify(a.state).includes("fixture-pass-12"));
  const pending = fixture.additions.at(-1);
  assert(pending);
  fixture.stateChanged(pending.path, 4);
  await until(() => ready(a).operation.kind === "error", "activation failure readback");
  cases++;
  const binaryId = ready(a).accessPoints.find((p) => p.id.includes("|" + INVALID + "|"))?.id;
  assert(binaryId);
  await a.connect({ id: binaryId, password: "" });
  const binary = fixture.mutations.at(-1);
  assert(binary && record(binary.body[0]) && record(binary.body[0]["802-11-wireless"]));
  assert.deepEqual(value(binary.body[0]["802-11-wireless"].ssid), Buffer.from([0xff, 0, 0x61]));
  await a.cancel();
  cases++;
  for (const [numeric, meaning] of [
    [0, "unknown"],
    [1, "none"],
    [2, "portal"],
    [3, "limited"],
    [4, "full"],
  ]) {
    fixture.set(ROOT, NM, "Connectivity", "u", numeric);
    await a.refresh();
    assert.equal(ready(a).connectivity, meaning);
  }
  cases++;
  fixture.denyAdd = true;
  await assert.rejects(
    () => a.connect({ id: psk(), password: "fixture-pass-12" }),
    /NetworkManager denied this operation/,
  );
  assert.equal(ready(a).operation.kind, "error");
  assert(!JSON.stringify(a.state).includes("fixture-pass-12"));
  fixture.denyAdd = false;
  cases++;
  fixture.secretError = true;
  await assert.rejects(
    () => a.connect({ id: psk(), password: "fixture-pass-12" }),
    /NetworkManager operation failed/,
  );
  assert(!JSON.stringify(a.state).includes("fixture-pass-12"));
  fixture.secretError = false;
  cases++;
  const timed = await adapter("interactive", 80);
  fixture.holdAdd = true;
  await assert.rejects(
    () =>
      timed.connect({
        id: ready(timed).accessPoints.find((p) => p.ssid === "Open fixture")?.id ?? "",
        password: "",
      }),
    /unknown/,
  );
  assert.equal(ready(timed).operation.kind, "unknown");
  assert(fixture.releaseAdd);
  fixture.finishAdd();
  fixture.holdAdd = false;
  await delay(20);
  assert.equal(ready(timed).operation.kind, "unknown", "late reply alone cannot assert connected");
  await timed.refresh();
  assert.equal(ready(timed).operation.kind, "connecting", "readback recovers only owned uuid");
  await timed.cancel();
  cases++;
  const beforeReplace = await adapter();
  fixture.holdAdd = true;
  const held = beforeReplace.connect({
    id: ready(beforeReplace).accessPoints.find((p) => p.ssid === "Open fixture")?.id ?? "",
    password: "",
  });
  const caught = held.catch((error: unknown) => error);
  await until(() => fixture.releaseAdd !== null, "held add");
  server.close();
  const replacement = await bus();
  const newer = new NetworkFixture(replacement);
  assert.equal(await replacement.requestName(NM, 4), 1);
  fixture.finishAdd();
  fixture.holdAdd = false;
  await caught;
  await until(() => beforeReplace.state.kind === "ready", "replacement observed");
  assert.equal(ready(beforeReplace).operation.kind, "unknown");
  await assert.rejects(() => beforeReplace.cancel(), /No owned/);
  assert.equal(newer.mutations.length, 0);
  cases++;
  const disposedPending = await adapter();
  newer.holdAdd = true;
  const disposalCall = disposedPending.connect({
    id: ready(disposedPending).accessPoints.find((p) => p.ssid === "Open fixture")?.id ?? "",
    password: "",
  });
  const disposalResult = disposalCall.catch((error: unknown) => error);
  await until(() => newer.releaseAdd !== null, "dispose during add");
  await disposedPending.dispose();
  const frozenAfterDispose = disposedPending.state;
  newer.finishAdd();
  newer.holdAdd = false;
  await disposalResult;
  assert.equal(disposedPending.state, frozenAfterDispose);
  cases++;
  const disconnected = await adapter();
  const client = buses.at(-1);
  assert(client);
  client.close();
  await until(() => disconnected.state.kind === "unavailable", "bus disconnect");
  await disconnected.dispose();
  await disconnected.dispose();
  cases++;
  const readTimeout = await adapter("readonly", 60);
  newer.holdRead = true;
  const started = performance.now();
  await readTimeout.refresh();
  assert.equal(readTimeout.state.kind, "error");
  assert(performance.now() - started < 1500, "bounded private-daemon read timeout");
  assert(newer.releaseRead);
  newer.releaseRead();
  newer.releaseRead = null;
  newer.holdRead = false;
  await readTimeout.refresh();
  assert.equal(readTimeout.state.kind, "ready");
  cases++;
  const fanout = await adapter();
  const extra = ROOT + "/Devices/3";
  newer.object(extra, DEVICE, {
    DeviceType: variant("u", 2),
    Managed: variant("b", true),
    Interface: variant("s", "wlan-second"),
    HwAddress: variant("s", "02:00:00:00:00:03"),
  });
  newer.object(extra, WIRELESS, {
    AccessPoints: variant(
      "ao",
      Array.from({ length: 40 }, (_, i) => ROOT + "/AccessPoint/" + (i + 100)),
    ),
    ActiveAccessPoint: variant("o", "/"),
  });
  newer.set(ROOT, NM, "Devices", "ao", [D, extra]);
  newer.set(
    D,
    WIRELESS,
    "AccessPoints",
    "ao",
    Array.from({ length: 40 }, (_, i) => ROOT + "/AccessPoint/" + (i + 10)),
  );
  const apReads = newer.propertyReads.filter((r) => r.endsWith("|" + ACCESS)).length;
  await fanout.refresh();
  assert.equal(fanout.state.kind, "error");
  assert.equal(
    newer.propertyReads.filter((r) => r.endsWith("|" + ACCESS)).length,
    apReads,
    "combined bound applies before AP fan-out",
  );
  newer.set(ROOT, NM, "Devices", "ao", [D, WIRED]);
  newer.set(D, WIRELESS, "AccessPoints", "ao", [OPEN, PSK, EAP, INVALID]);
  cases++;
  const over = await adapter();
  newer.set(
    D,
    WIRELESS,
    "AccessPoints",
    "ao",
    Array.from({ length: 65 }, (_, i) => ROOT + "/AccessPoint/" + (i + 10)),
  );
  await over.refresh();
  assert.equal(over.state.kind, "error");
  cases++;
  stop();
  await a.dispose();
  const notifications = publishes;
  await a.refresh();
  assert.equal(publishes, notifications);
  cases++;
  console.log(
    JSON.stringify({
      scope:
        "actual disposable dbus-daemon with NetworkManager interface fixture; no network/device/permission changes",
      cases,
      actualExitCode: 0,
    }),
  );
} finally {
  await Promise.allSettled(adapters.map((a) => a.dispose()));
  for (const b of buses) b.close();
  daemon.kill("SIGTERM");
  await exits;
  await fs.rm(directory, { recursive: true, force: true });
}

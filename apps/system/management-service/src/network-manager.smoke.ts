import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SessionBus, DbusRemoteError, variant, type DbusVariant } from "@moire/dbus";
import type { WifiAdapter, DesktopWifi } from "@moire/system-management/network-status";
import { COPY_KEY, createNetworkManagerAdapter } from "./network-manager";
import { ipv4Integer, ipv6Bytes } from "./network-vpn";

const NM = "org.freedesktop.NetworkManager",
  ROOT = "/org/freedesktop/NetworkManager",
  PROPS = "org.freedesktop.DBus.Properties",
  DEVICE = NM + ".Device",
  WIRELESS = DEVICE + ".Wireless",
  ACCESS = NM + ".AccessPoint",
  ACTIVE = NM + ".Connection.Active",
  SETTINGS = NM + ".Settings",
  PROFILE = SETTINGS + ".Connection",
  SETTINGS_PATH = ROOT + "/Settings";
const D = ROOT + "/Devices/1",
  WIRED = ROOT + "/Devices/2",
  OPEN = ROOT + "/AccessPoint/1",
  PSK = ROOT + "/AccessPoint/2",
  EAP = ROOT + "/AccessPoint/3",
  INVALID = ROOT + "/AccessPoint/4",
  OTHER = ROOT + "/ActiveConnection/1";
/** The session user the adapter makes profiles for. */
const ME = os.userInfo().username;
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
/** JSON for settings dictionaries, which hold bigints. */
function replacer(_key: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}
/** An AddConnection that carries the Moire copy marker. */
function proxyCopy(m: { body: unknown[] }): boolean {
  const settings = m.body[0];
  return record(settings) && record(settings.user);
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
    [NM + ".enable-disable-wifi"]: "yes",
  };
  readonly profiles = new Set<string>();
  /** Profiles by path, as GetSettings returns them. */
  readonly profileSettings = new Map<string, Record<string, Record<string, DbusVariant>>>();
  readonly updates: { path: string; settings: Record<string, unknown> }[] = [];
  readonly reapplied: unknown[][] = [];
  failReapply = false;
  denyAddConnection = false;
  profileNumber = 100;
  removeOnDeactivate = false;
  propertyReads: string[] = [];
  holdAdd = false;
  releaseAdd: (() => void) | null = null;
  secretError = false;
  denyAdd = false;
  holdRead = false;
  releaseRead: (() => void) | null = null;
  /** Profiles another user owns: NetworkManager refuses to show them to this one. */
  readonly hiddenProfiles = new Set<string>();
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
        ActivateConnection: {
          inSignature: "ooo",
          outSignature: "o",
          handler: ({ body }) => {
            this.mutations.push({ member: "ActivateConnection", body });
            const profile = String(body[0]);
            const settings = this.profileSettings.get(profile);
            assert(settings);
            const p = ROOT + "/ActiveConnection/" + this.activeNumber++;
            this.connection(
              p,
              String(value(settings.connection!.uuid)),
              String(value(settings.connection!.id)),
              1,
              String(body[2]),
              String(body[1]),
              profile,
              String(value(settings.connection!.type)),
            );
            const current = value(this.properties.get(ROOT)?.get(NM)?.ActiveConnections);
            assert(Array.isArray(current));
            this.set(ROOT, NM, "ActiveConnections", "ao", [...current, p]);
            return { body: [p] };
          },
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
    bus.exportObject(SETTINGS_PATH, {
      name: SETTINGS,
      methods: {
        ListConnections: {
          inSignature: "",
          outSignature: "ao",
          handler: () => ({ body: [[...this.profiles]] }),
        },
        AddConnection: {
          inSignature: "a{sa{sv}}",
          outSignature: "o",
          handler: ({ body }) => {
            this.mutations.push({ member: "AddConnection", body });
            if (this.denyAddConnection)
              throw new DbusRemoteError(
                "org.freedesktop.NetworkManager.Settings.InvalidConnection",
                "fixture refusal",
              );
            const settings = body[0] as Record<string, Record<string, DbusVariant>>;
            const p = SETTINGS_PATH + "/" + this.profileNumber++;
            this.exportProfile(p, settings);
            return { body: [p] };
          },
        },
      },
    });
    bus.exportObject(WIRED, {
      name: DEVICE,
      methods: {
        Reapply: {
          inSignature: "a{sa{sv}}tu",
          outSignature: "",
          handler: ({ body }) => {
            this.reapplied.push(body);
            if (this.failReapply)
              throw new DbusRemoteError(
                "org.freedesktop.NetworkManager.Device.IncompatibleConnection",
                "fixture",
              );
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
          Set: {
            inSignature: "ssv",
            outSignature: "",
            handler: ({ body }) => {
              this.mutations.push({ member: "Set", body });
              const props =
                typeof body[0] === "string" ? this.properties.get(p)?.get(body[0]) : undefined;
              const desired = body[2];
              assert(props && typeof body[1] === "string" && body[1] in props);
              assert(record(desired) && typeof desired.signature === "string");
              props[body[1]] = variant(desired.signature, desired.value);
              return { body: [] };
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
  /** A saved profile, shared by everyone unless `owner` names the user it belongs to. */
  profile(p: string, ssid: Buffer | null, owner?: string) {
    const connection = {
      uuid: variant("s", "00000000-0000-4000-8000-" + p.replace(/\D/g, "").padStart(12, "0")),
      id: variant("s", ssid ? ssid.toString() : "Wired fixture profile"),
      ...(owner ? { permissions: variant("as", [`user:${owner}:`]) } : {}),
    };
    this.exportProfile(
      p,
      ssid
        ? {
            connection: { ...connection, type: variant("s", "802-11-wireless") },
            "802-11-wireless": { ssid: variant("ay", ssid) },
          }
        : { connection: { ...connection, type: variant("s", "802-3-ethernet") } },
    );
  }
  exportProfile(p: string, settings: Record<string, Record<string, DbusVariant>>) {
    this.profiles.add(p);
    this.profileSettings.set(p, settings);
    this.bus.exportObject(p, {
      name: PROFILE,
      methods: {
        GetSettings: {
          inSignature: "",
          outSignature: "a{sa{sv}}",
          // Secrets never come back from GetSettings.
          handler: () => {
            if (this.hiddenProfiles.has(p))
              throw new DbusRemoteError(
                "org.freedesktop.NetworkManager.Settings.PermissionDenied",
                "fixture: another user's profile",
              );
            const current = structuredClone(this.profileSettings.get(p) ?? {});
            if (current.vpn) delete current.vpn.secrets;
            if (current.wireguard) delete current.wireguard["private-key"];
            if (current["802-11-wireless-security"]) delete current["802-11-wireless-security"].psk;
            return { body: [current] };
          },
        },
        Update: {
          inSignature: "a{sa{sv}}",
          outSignature: "",
          handler: ({ body }) => {
            this.mutations.push({ member: "Update", body: [p] });
            const settings = body[0] as Record<string, Record<string, DbusVariant>>;
            this.updates.push({ path: p, settings });
            this.profileSettings.set(p, settings);
            return { body: [] };
          },
        },
        Delete: {
          inSignature: "",
          outSignature: "",
          handler: () => {
            this.mutations.push({ member: "Delete", body: [p] });
            this.profiles.delete(p);
            return { body: [] };
          },
        },
      },
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
  assert.equal(ready(readOnly).canToggle, false);
  assert(ready(readOnly).accessPoints.every((p) => p.saved === undefined));
  await assert.rejects(() => readOnly.setEnabled!(false), /read-only/);
  await assert.rejects(() => readOnly.disconnect!(), /read-only/);
  await assert.rejects(() => readOnly.forget!(ready(readOnly).accessPoints[0]!.id), /read-only/);
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
  assert.equal(ready(a).canToggle, true);
  assert(ready(a).accessPoints.every((p) => p.saved === false));
  fixture.profile(SETTINGS_PATH + "/1", Buffer.from("Password fixture"), ME);
  fixture.profile(SETTINGS_PATH + "/2", null);
  fixture.profile(SETTINGS_PATH + "/3", Buffer.from("Password fixture"), ME);
  // Another user's own profile isn't visible to this one and doesn't hide the rest.
  fixture.profile(SETTINGS_PATH + "/40", Buffer.from("Open fixture"), "someone-else");
  fixture.hiddenProfiles.add(SETTINGS_PATH + "/40");
  await a.refresh();
  assert.equal(ready(a).accessPoints.find((p) => p.id === psk())?.saved, true);
  assert.equal(ready(a).accessPoints.find((p) => p.id === psk())?.ownership, "user");
  assert.equal(ready(a).accessPoints.find((p) => p.id === psk())?.canForget, true);
  fixture.profiles.delete(SETTINGS_PATH + "/40");
  assert.equal(ready(a).accessPoints.find((p) => p.id === open())?.saved, false);
  cases++;
  await a.setEnabled!(false);
  assert.equal(fixture.mutations.at(-1)?.member, "Set");
  assert.deepEqual(fixture.mutations.at(-1)?.body.slice(0, 2), [NM, "WirelessEnabled"]);
  assert.equal(ready(a).enabled, false);
  assert.equal(ready(a).operation.kind, "idle");
  await a.setEnabled!(true);
  assert.equal(ready(a).enabled, true);
  const afterToggle = fixture.mutations.length;
  await a.setEnabled!(true);
  assert.equal(fixture.mutations.length, afterToggle, "already enabled sends nothing");
  cases++;
  fixture.permissions[NM + ".enable-disable-wifi"] = "auth";
  await a.refresh();
  assert.equal(ready(a).canToggle, false);
  await assert.rejects(() => a.setEnabled!(false), /not permitted/);
  assert.equal(fixture.mutations.length, afterToggle);
  fixture.permissions[NM + ".enable-disable-wifi"] = "yes";
  fixture.set(ROOT, NM, "WirelessHardwareEnabled", "b", false);
  await a.refresh();
  assert.equal(ready(a).canToggle, false);
  await assert.rejects(() => a.setEnabled!(false), /not permitted/);
  assert.equal(fixture.mutations.length, afterToggle);
  fixture.set(ROOT, NM, "WirelessHardwareEnabled", "b", true);
  await a.refresh();
  cases++;
  await assert.rejects(() => a.disconnect!(), /No Wi-Fi connection is active/);
  assert.equal(fixture.mutations.length, afterToggle);
  const external = ROOT + "/ActiveConnection/90";
  fixture.connection(external, "external-wifi", "External Wi-Fi", 2, PSK, D, "/profile/wifi");
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [OTHER, external]);
  await a.refresh();
  await a.disconnect!();
  assert.deepEqual(fixture.mutations.at(-1), { member: "DeactivateConnection", body: [external] });
  assert.equal(value(fixture.properties.get(OTHER)?.get(ACTIVE)?.State), 2, "wired untouched");
  assert.equal(ready(a).operation.kind, "idle");
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [OTHER]);
  await a.refresh();
  cases++;
  await a.connect({ id: open(), password: "" });
  const ownedWifi = fixture.additions.at(-1);
  assert(ownedWifi);
  fixture.stateChanged(ownedWifi.path, 2);
  await until(() => ready(a).operation.kind === "idle", "owned activation connected");
  await a.disconnect!();
  assert.deepEqual(fixture.mutations.at(-1)?.body, [ownedWifi.path]);
  assert.equal(ready(a).operation.kind, "idle", "own disconnect is not an unknown outcome");
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [OTHER]);
  await a.refresh();
  assert.equal(ready(a).operation.kind, "idle");
  cases++;
  await assert.rejects(() => a.forget!(open()), /No saved profile/);
  await assert.rejects(() => a.forget!("unknown-access-point"), /changed/);
  const beforeForget = fixture.mutations.length;
  await a.forget!(psk());
  assert.deepEqual(
    fixture.mutations.slice(beforeForget),
    [SETTINGS_PATH + "/1", SETTINGS_PATH + "/3"].map((p) => ({ member: "Delete", body: [p] })),
  );
  assert.deepEqual([...fixture.profiles], [SETTINGS_PATH + "/2"], "wired profile kept");
  assert.equal(ready(a).accessPoints.find((p) => p.id === psk())?.saved, false);
  assert.equal(ready(a).operation.kind, "idle");
  cases++;
  // Forget on Wi‑Fi saved for everyone: NetworkManager has no per-user way to stop a shared
  // profile connecting, so it's not offered, and the service refuses without sending anything.
  const SHARED_WIFI = SETTINGS_PATH + "/4",
    MY_WIFI = SETTINGS_PATH + "/5";
  fixture.profile(SHARED_WIFI, Buffer.from("Password fixture"));
  await a.refresh();
  const sharedPoint = () => ready(a).accessPoints.find((p) => p.id === psk());
  assert.equal(sharedPoint()?.saved, true);
  assert.equal(sharedPoint()?.ownership, "system");
  assert.equal(sharedPoint()?.canForget, false);
  const beforeShared = fixture.mutations.length;
  await assert.rejects(() => a.forget!(psk()), /saved for everyone on this computer/);
  assert.equal(fixture.mutations.length, beforeShared);
  assert(fixture.profiles.has(SHARED_WIFI));
  // With the user's own profile beside it, Forget removes only that one; it stays saved.
  fixture.profile(MY_WIFI, Buffer.from("Password fixture"), ME);
  await a.refresh();
  assert.equal(sharedPoint()?.ownership, "system");
  assert.equal(sharedPoint()?.canForget, true);
  await a.forget!(psk());
  assert.deepEqual(fixture.mutations.slice(beforeShared), [{ member: "Delete", body: [MY_WIFI] }]);
  assert.equal(sharedPoint()?.saved, true);
  assert.equal(sharedPoint()?.canForget, false);
  // An administrator's grant of modify.system makes the shared profile removable.
  fixture.permissions[NM + ".settings.modify.system"] = "yes";
  await a.refresh();
  assert.equal(sharedPoint()?.canForget, true);
  await a.forget!(psk());
  assert.deepEqual(fixture.mutations.at(-1), { member: "Delete", body: [SHARED_WIFI] });
  delete fixture.permissions[NM + ".settings.modify.system"];
  assert.deepEqual([...fixture.profiles], [SETTINGS_PATH + "/2"]);
  cases++;
  // Hidden networks: a temporary profile marked hidden, on the Wi‑Fi device with no access point.
  assert.equal(readOnly.state.kind === "ready" && "vpn" in readOnly.state, false);
  const beforeHidden = fixture.mutations.length;
  await assert.rejects(
    () => a.connectHidden!({ ssid: "", security: "open", password: "" }),
    /network name/,
  );
  await assert.rejects(
    () => a.connectHidden!({ ssid: "Attic", security: "wpa-psk", password: "short" }),
    /WPA passphrase/,
  );
  assert.equal(fixture.mutations.length, beforeHidden);
  await a.connectHidden!({ ssid: "Attic", security: "wpa-psk", password: "fixture-pass-12" });
  const hiddenAdd = fixture.mutations.at(-1);
  assert(hiddenAdd && hiddenAdd.member === "AddAndActivateConnection2");
  const hiddenSettings = hiddenAdd.body[0];
  assert(record(hiddenSettings) && record(hiddenSettings["802-11-wireless"]));
  assert.equal(value(hiddenSettings["802-11-wireless"].hidden), true);
  assert.deepEqual(value(hiddenSettings["802-11-wireless"].ssid), Buffer.from("Attic"));
  assert(record(hiddenSettings["802-11-wireless-security"]));
  assert.equal(value(hiddenSettings["802-11-wireless-security"]["key-mgmt"]), "wpa-psk");
  assert.deepEqual(hiddenAdd.body.slice(1, 3), [D, "/"]);
  assert.deepEqual(ready(a).operation, { kind: "connecting", ssid: "Attic", cancellable: true });
  assert(!JSON.stringify(a.state).includes("fixture-pass-12"));
  const hiddenActive = fixture.additions.at(-1)!;
  // NetworkManager finds the access point itself; the attempt follows its uuid.
  fixture.set(hiddenActive.path, ACTIVE, "SpecificObject", "o", PSK);
  fixture.stateChanged(hiddenActive.path, 2);
  await until(() => ready(a).operation.kind === "idle", "hidden network connected");
  await a.disconnect!();
  assert.deepEqual(fixture.mutations.at(-1), {
    member: "DeactivateConnection",
    body: [hiddenActive.path],
  });
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [OTHER]);
  await a.refresh();
  await a.connectHidden!({ ssid: "Loft", security: "sae", password: "a wpa3 password" });
  const saeAdd = fixture.mutations.at(-1)!;
  assert(record(saeAdd.body[0]) && record(saeAdd.body[0]["802-11-wireless-security"]));
  assert.equal(value(saeAdd.body[0]["802-11-wireless-security"]["key-mgmt"]), "sae");
  await a.cancel();
  assert.equal(ready(a).operation.kind, "idle", "a hidden attempt can be cancelled");
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [OTHER]);
  await a.refresh();
  cases++;

  // Radios: Wi‑Fi and mobile broadband switches for airplane mode.
  assert.equal(ready(a).wwan, undefined, "no WWAN properties, no WWAN radio");
  assert.equal(ready(a).adapters, 1, "one managed Wi‑Fi device; the wired one isn't counted");
  fixture.set(ROOT, NM, "WwanEnabled", "b", true);
  fixture.set(ROOT, NM, "WwanHardwareEnabled", "b", true);
  await a.refresh();
  assert.deepEqual(ready(a).wwan, {
    enabled: true,
    hardwareEnabled: true,
    canToggle: false,
    modems: 0,
  });
  // A wired-only computer: no Wi‑Fi device, though the radio switch still reads as on.
  fixture.set(ROOT, NM, "Devices", "ao", [WIRED]);
  await a.refresh();
  assert.equal(ready(a).adapters, 0, "no Wi‑Fi device");
  assert.equal(ready(a).enabled, true, "the radio switch is separate from the hardware");
  assert.equal(ready(a).accessPoints.length, 0);
  fixture.set(ROOT, NM, "Devices", "ao", [D, WIRED]);
  await a.refresh();
  await assert.rejects(() => a.setRadios!({ wwan: false }), /Mobile broadband control/);
  fixture.permissions[NM + ".enable-disable-wwan"] = "yes";
  await a.refresh();
  assert.equal(ready(a).wwan?.canToggle, true);
  const beforeRadios = fixture.mutations.length;
  await a.setRadios!({ wifi: false, wwan: false });
  assert.deepEqual(
    fixture.mutations.slice(beforeRadios).map((m) => m.body.slice(0, 2)),
    [
      [NM, "WirelessEnabled"],
      [NM, "WwanEnabled"],
    ],
  );
  assert.equal(ready(a).enabled, false);
  assert.equal(ready(a).wwan?.enabled, false);
  await a.setRadios!({ wifi: true, wwan: true });
  assert.equal(ready(a).enabled, true);
  const afterRadios = fixture.mutations.length;
  await a.setRadios!({ wifi: true, wwan: true });
  assert.equal(fixture.mutations.length, afterRadios, "radios already on send nothing");
  fixture.set(ROOT, NM, "WwanHardwareEnabled", "b", false);
  await a.refresh();
  await a.setRadios!({ wwan: false });
  assert.equal(fixture.mutations.length, afterRadios, "a modem switched off in hardware is left");
  await assert.rejects(() => a.setRadios!({ wifi: "off" as unknown as boolean }), /Invalid radio/);
  cases++;

  // VPN connections: list, connect, disconnect, remove.
  const WG_PROFILE = SETTINGS_PATH + "/20",
    OVPN_PROFILE = SETTINGS_PATH + "/21";
  const WG_UUID = "6f1f8a3c-1111-4c3a-9a00-000000000001",
    OVPN_UUID = "6f1f8a3c-1111-4c3a-9a00-000000000002";
  fixture.exportProfile(WG_PROFILE, {
    connection: {
      uuid: variant("s", WG_UUID),
      id: variant("s", "Office"),
      type: variant("s", "wireguard"),
      "interface-name": variant("s", "wg-office"),
      permissions: variant("as", [`user:${ME}:`]),
    },
    wireguard: { "private-key": variant("s", "never-read") },
  });
  fixture.exportProfile(OVPN_PROFILE, {
    connection: {
      uuid: variant("s", OVPN_UUID),
      id: variant("s", "Home"),
      type: variant("s", "vpn"),
      permissions: variant("as", [`user:${ME}:`]),
    },
    vpn: { "service-type": variant("s", "org.freedesktop.NetworkManager.openvpn") },
  });
  await a.refresh();
  assert.deepEqual(ready(a).vpn, {
    connections: [
      {
        id: OVPN_UUID,
        name: "Home",
        kind: "openvpn",
        state: "disconnected",
        ownership: "user",
        canRemove: true,
      },
      {
        id: WG_UUID,
        name: "Office",
        kind: "wireguard",
        state: "disconnected",
        ownership: "user",
        canRemove: true,
      },
    ],
    canManage: true,
    importable: ["wireguard"],
  });
  // A VPN shared by everyone connects, but only an administrator can remove it.
  const SHARED_VPN = SETTINGS_PATH + "/22",
    SHARED_VPN_UUID = "6f1f8a3c-1111-4c3a-9a00-000000000003";
  fixture.exportProfile(SHARED_VPN, {
    connection: {
      uuid: variant("s", SHARED_VPN_UUID),
      id: variant("s", "Company"),
      type: variant("s", "wireguard"),
    },
  });
  await a.refresh();
  const sharedVpn = ready(a).vpn?.connections.find((c) => c.id === SHARED_VPN_UUID);
  assert.equal(sharedVpn?.ownership, "system");
  assert.equal(sharedVpn?.canRemove, false);
  const beforeSharedVpn = fixture.mutations.length;
  await assert.rejects(() => a.removeVpn!(SHARED_VPN_UUID), /shared by everyone/);
  assert.equal(fixture.mutations.length, beforeSharedVpn);
  fixture.profiles.delete(SHARED_VPN);
  await a.refresh();
  const vpnState = (id: string) => ready(a).vpn?.connections.find((c) => c.id === id)?.state;
  await a.activateVpn!(WG_UUID);
  assert.deepEqual(fixture.mutations.at(-1), {
    member: "ActivateConnection",
    body: [WG_PROFILE, "/", "/"],
  });
  assert.equal(vpnState(WG_UUID), "connecting");
  const wgActive = ROOT + "/ActiveConnection/" + (fixture.activeNumber - 1);
  fixture.stateChanged(wgActive, 2);
  await until(() => vpnState(WG_UUID) === "connected", "VPN connected");
  const afterActivate = fixture.mutations.length;
  await a.activateVpn!(WG_UUID);
  assert.equal(fixture.mutations.length, afterActivate, "an active VPN isn't activated again");
  await a.deactivateVpn!(WG_UUID);
  assert.deepEqual(fixture.mutations.at(-1), { member: "DeactivateConnection", body: [wgActive] });
  assert.equal(vpnState(WG_UUID), "disconnected");
  const afterDeactivate = fixture.mutations.length;
  await a.deactivateVpn!(WG_UUID);
  assert.equal(fixture.mutations.length, afterDeactivate, "an inactive VPN isn't deactivated");
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [OTHER]);
  await assert.rejects(() => a.activateVpn!(WG_PROFILE), /VPN identity/);
  await assert.rejects(
    () => a.activateVpn!("6f1f8a3c-1111-4c3a-9a00-0000000000ff"),
    /no longer exists/,
  );
  fixture.permissions[NM + ".settings.modify.own"] = "auth";
  await a.refresh();
  assert.equal(ready(a).vpn?.canManage, false);
  await assert.rejects(() => a.activateVpn!(WG_UUID), /not permitted/);
  fixture.permissions[NM + ".settings.modify.own"] = "yes";
  await a.refresh();
  assert.equal(fixture.mutations.length, afterDeactivate);
  await a.removeVpn!(OVPN_UUID);
  assert.deepEqual(fixture.mutations.at(-1), { member: "Delete", body: [OVPN_PROFILE] });
  assert.deepEqual(
    ready(a).vpn?.connections.map((c) => c.name),
    ["Office"],
  );
  cases++;

  // Importing WireGuard: a profile NetworkManager stores, with its own interface name.
  const wgKey = (byte: number) => Buffer.alloc(32, byte).toString("base64");
  const wgConfig = `[Interface]\nPrivateKey = ${wgKey(7)}\nAddress = 10.9.0.2/32, fd09::2/128\nDNS = 10.9.0.1, fd09::1, lab.example\n\n[Peer]\nPublicKey = ${wgKey(8)}\nAllowedIPs = 0.0.0.0/0\nEndpoint = lab.example.com:51820\n`;
  await assert.rejects(
    () =>
      a.importVpn!({
        kind: "wireguard",
        name: "Broken",
        config: "[Interface]\n",
        username: "",
        password: "",
      }),
    /no PrivateKey/,
  );
  await a.importVpn!({
    kind: "wireguard",
    name: "Office",
    config: wgConfig,
    username: "",
    password: "",
  });
  const wgAdd = fixture.mutations.at(-1)!;
  assert.equal(wgAdd.member, "AddConnection");
  const wgSettings = wgAdd.body[0] as Record<string, Record<string, unknown>>;
  assert.equal(value(wgSettings.connection!.type), "wireguard");
  assert.equal(value(wgSettings.connection!["interface-name"]), "wg-office1", "name kept unique");
  assert.equal(value(wgSettings.connection!.autoconnect), false);
  assert.equal(value(wgSettings.wireguard!["private-key"]), wgKey(7));
  const peers = value(wgSettings.wireguard!.peers);
  assert(Array.isArray(peers) && record(peers[0]));
  assert.equal(value(peers[0]["public-key"]), wgKey(8));
  assert.deepEqual(value(peers[0]["allowed-ips"]), ["0.0.0.0/0"]);
  assert.equal(value(peers[0].endpoint), "lab.example.com:51820");
  assert.equal(value(wgSettings.ipv4!.method), "manual");
  const v4 = value(wgSettings.ipv4!["address-data"]);
  assert(Array.isArray(v4) && record(v4[0]));
  assert.equal(value(v4[0].address), "10.9.0.2");
  assert.equal(value(v4[0].prefix), 32);
  assert.deepEqual(value(wgSettings.ipv4!.dns), [ipv4Integer("10.9.0.1")]);
  assert.equal(ipv4Integer("10.9.0.1"), 0x0100090a, "network byte order");
  assert.deepEqual(value(wgSettings.ipv4!["dns-search"]), ["lab.example"]);
  assert.deepEqual(value(wgSettings.ipv6!.dns), [ipv6Bytes("fd09::1")]);
  assert.equal(ipv6Bytes("fd09::1").toString("hex"), "fd090000000000000000000000000001");
  assert.equal(ipv6Bytes("::ffff:1.2.3.4").toString("hex"), "00000000000000000000ffff01020304");
  assert.deepEqual(
    ready(a)
      .vpn?.connections.map((c) => c.name)
      .sort(),
    ["Office", "Office"],
  );
  assert(!JSON.stringify(a.state).includes(wgKey(7)), "the private key stays out of status");
  cases++;

  // OpenVPN needs its plugin; certificates are written for NetworkManager to read.
  const pem = `-----BEGIN CERTIFICATE-----\nMIIBfixture\n-----END CERTIFICATE-----`;
  const ovpnConfig = `client\ndev tun\nremote vpn.example.com 1194 udp\nauth-user-pass\ncipher AES-256-GCM\n<ca>\n${pem}\n</ca>\n`;
  await assert.rejects(
    () =>
      a.importVpn!({
        kind: "openvpn",
        name: "Home",
        config: ovpnConfig,
        username: "josh",
        password: "pw-fixture",
      }),
    /OpenVPN isn't installed/,
  );
  const vpnData = await fs.mkdtemp(path.join(os.tmpdir(), "moire-vpn-data-"));
  try {
    const plugged = await createNetworkManagerAdapter({
      connect: bus,
      policy: "interactive",
      callTimeoutMs: 500,
      pollMs: 0,
      vpnPlugins: () => ["openvpn"],
      vpnDataDir: vpnData,
    });
    adapters.push(plugged);
    assert.deepEqual(ready(plugged).vpn?.importable, ["wireguard", "openvpn"]);
    const ovpnRequest = {
      kind: "openvpn" as const,
      name: "Home",
      config: ovpnConfig,
      username: "josh",
      password: "pw-fixture",
    };
    await assert.rejects(
      () => plugged.importVpn!({ ...ovpnRequest, password: "" }),
      /user name and password/,
    );
    assert.deepEqual(await fs.readdir(vpnData), [], "nothing written for a refused import");
    fixture.denyAddConnection = true;
    await assert.rejects(() => plugged.importVpn!(ovpnRequest), /NetworkManager operation failed/);
    fixture.denyAddConnection = false;
    assert.deepEqual(await fs.readdir(vpnData), [], "certificates of a refused profile removed");
    await plugged.importVpn!(ovpnRequest);
    const ovpnSettings = fixture.mutations.at(-1)!.body[0] as Record<
      string,
      Record<string, unknown>
    >;
    assert.equal(value(ovpnSettings.connection!.type), "vpn");
    const vpnSection = ovpnSettings.vpn!;
    assert.equal(value(vpnSection["service-type"]), "org.freedesktop.NetworkManager.openvpn");
    const data = value(vpnSection.data) as Record<string, string>;
    assert.equal(data.remote, "vpn.example.com:1194:udp");
    assert.equal(data["connection-type"], "password");
    assert.equal(data.username, "josh");
    assert.equal(data["password-flags"], "0");
    assert.equal(data.cipher, "AES-256-GCM");
    assert.deepEqual(value(vpnSection.secrets), { password: "pw-fixture" });
    const [profileDir] = await fs.readdir(vpnData);
    assert(profileDir);
    assert.equal(data.ca, path.join(vpnData, profileDir, "ca.crt"));
    assert.equal((await fs.readFile(data.ca, "utf8")).trim(), pem);
    assert.equal((await fs.stat(data.ca)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(vpnData, profileDir))).mode & 0o777, 0o700);
    assert(!JSON.stringify(plugged.state).includes("pw-fixture"));
    const imported = ready(plugged).vpn?.connections.find((c) => c.kind === "openvpn");
    assert(imported && imported.id === profileDir);
    await plugged.removeVpn!(imported.id);
    assert.deepEqual(await fs.readdir(vpnData), [], "removing a VPN removes its certificates");
  } finally {
    await fs.rm(vpnData, { recursive: true, force: true });
  }
  cases++;

  // Proxy: the primary connection's profile, updated and reapplied.
  assert.equal(ready(a).proxy, undefined, "no profile for the primary connection yet");
  // A profile the user owns is changed in place.
  fixture.exportProfile("/profile/external", {
    connection: {
      uuid: variant("s", "external-uuid"),
      id: variant("s", "Wired connection 1"),
      type: variant("s", "802-3-ethernet"),
      permissions: variant("as", [`user:${ME}:`]),
    },
    ipv4: { method: variant("s", "auto") },
  });
  await a.refresh();
  assert.deepEqual(ready(a).proxy, {
    connection: "Wired connection 1",
    method: "none",
    pacUrl: "",
    canChange: true,
    ownership: "user",
  });
  await a.setProxy!({ method: "auto", pacUrl: "http://wpad.example/wpad.dat" });
  const update = fixture.updates.at(-1)!;
  assert.equal(update.path, "/profile/external");
  const proxySection = update.settings.proxy as Record<string, unknown>;
  assert.equal(value(proxySection.method), 1);
  assert.equal(value(proxySection["pac-url"]), "http://wpad.example/wpad.dat");
  assert.equal(
    value((update.settings.ipv4 as Record<string, unknown>).method),
    "auto",
    "the rest of the profile is kept",
  );
  assert.deepEqual(fixture.reapplied.at(-1), [{}, 0n, 0]);
  assert.deepEqual(ready(a).proxy, {
    connection: "Wired connection 1",
    method: "auto",
    pacUrl: "http://wpad.example/wpad.dat",
    canChange: true,
    ownership: "user",
  });
  assert(
    !fixture.mutations.some((m) => m.member === "AddConnection" && proxyCopy(m)),
    "no copy of a profile the user owns",
  );
  fixture.failReapply = true;
  await a.setProxy!({ method: "none", pacUrl: "" });
  fixture.failReapply = false;
  assert.equal(ready(a).proxy?.method, "none", "a device that can't reapply isn't a failure");
  const beforeBadProxy = fixture.mutations.length;
  await assert.rejects(() => a.setProxy!({ method: "auto", pacUrl: "gopher://x" }), /http, https/);
  fixture.permissions[NM + ".settings.modify.own"] = "auth";
  await a.refresh();
  await assert.rejects(() => a.setProxy!({ method: "auto", pacUrl: "" }), /not permitted/);
  fixture.permissions[NM + ".settings.modify.own"] = "yes";
  assert.equal(fixture.mutations.length, beforeBadProxy);
  cases++;

  // A shared wired profile (NetworkManager's own "Wired connection 1"): the change goes to the
  // user's own copy, which connects on the same device; the shared profile is left alone.
  const sharedWired = () => ({
    connection: {
      uuid: variant("s", "external-uuid"),
      id: variant("s", "Wired connection 1"),
      type: variant("s", "802-3-ethernet"),
      "autoconnect-priority": variant("i", -10),
      timestamp: variant("t", 1700000000n),
    },
    ipv4: { method: variant("s", "auto") },
    proxy: { method: variant("i", 0) },
  });
  fixture.profileSettings.set("/profile/external", sharedWired());
  await a.refresh();
  assert.deepEqual(ready(a).proxy, {
    connection: "Wired connection 1",
    method: "none",
    pacUrl: "",
    canChange: true,
    ownership: "system",
    copy: true,
    needsPassword: false,
  });
  const sharedBefore = JSON.stringify(fixture.profileSettings.get("/profile/external"), replacer);
  const beforeCopy = fixture.mutations.length,
    updatesBeforeCopy = fixture.updates.length;
  await a.setProxy!({ method: "auto", pacUrl: "http://wpad.example/wpad.dat" });
  const copyCalls = fixture.mutations.slice(beforeCopy);
  assert.deepEqual(
    copyCalls.map((m) => m.member),
    ["AddConnection", "ActivateConnection"],
  );
  const made = copyCalls[0]!.body[0] as Record<string, Record<string, unknown>>;
  assert.deepEqual(value(made.connection!.permissions), [`user:${ME}:`]);
  assert.equal(value(made.connection!.autoconnect), true);
  assert.equal(value(made.connection!["autoconnect-priority"]), -9, "wins over the shared one");
  assert.equal(value(made.connection!.id), `Wired connection 1 (${ME})`);
  assert.notEqual(value(made.connection!.uuid), "external-uuid");
  assert(!("timestamp" in made.connection!));
  assert.deepEqual(value(made.user!.data), { [COPY_KEY]: "external-uuid" });
  assert.equal(value(made.proxy!.method), 1);
  assert.equal(value(made.proxy!["pac-url"]), "http://wpad.example/wpad.dat");
  assert.equal(value(made.ipv4!.method), "auto", "the rest of the profile is copied");
  const copyPath = String(copyCalls[1]!.body[0]);
  assert(fixture.profiles.has(copyPath));
  assert.deepEqual(copyCalls[1]!.body.slice(1), [WIRED, "/"], "activated on the same device");
  assert.equal(
    JSON.stringify(fixture.profileSettings.get("/profile/external"), replacer),
    sharedBefore,
    "the shared profile is untouched",
  );
  assert.equal(fixture.updates.length, updatesBeforeCopy, "nothing updated in place");
  const copyActive = ROOT + "/ActiveConnection/" + (fixture.activeNumber - 1);
  cases++;

  // The copy now carries the connection, so the next change edits it in place.
  fixture.stateChanged(copyActive, 2);
  fixture.set(ROOT, NM, "PrimaryConnection", "o", copyActive);
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [copyActive]);
  await a.refresh();
  assert.deepEqual(ready(a).proxy, {
    connection: `Wired connection 1 (${ME})`,
    method: "auto",
    pacUrl: "http://wpad.example/wpad.dat",
    canChange: true,
    ownership: "user",
  });
  const beforeEdit = fixture.mutations.length;
  await a.setProxy!({ method: "auto", pacUrl: "http://other.example/proxy.pac" });
  assert.deepEqual(fixture.mutations.slice(beforeEdit), [{ member: "Update", body: [copyPath] }]);
  // When the shared profile is up again (the copy failed, or before login), a change updates
  // the same copy and activates it; no second copy is made.
  fixture.set(ROOT, NM, "PrimaryConnection", "o", OTHER);
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [OTHER]);
  await a.refresh();
  assert.equal(ready(a).proxy?.copy, true);
  const profileCount = fixture.profiles.size,
    beforeAgain = fixture.mutations.length;
  await a.setProxy!({ method: "none", pacUrl: "" });
  assert.deepEqual(
    fixture.mutations.slice(beforeAgain).map((m) => m.member + ":" + String(m.body[0])),
    ["Update:" + copyPath, "ActivateConnection:" + copyPath],
  );
  assert.equal(fixture.profiles.size, profileCount, "no duplicate copy");
  const again = fixture.profileSettings.get(copyPath)!;
  assert.equal(value(again.proxy!.method), 0);
  assert.equal(value(again.connection!.uuid), value(made.connection!.uuid), "same copy");
  assert.equal(
    JSON.stringify(fixture.profileSettings.get("/profile/external"), replacer),
    sharedBefore,
  );
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [OTHER]);
  cases++;

  // At login the shared profile is usually already up; a new session switches to the copy.
  const login = await adapter();
  await until(
    () =>
      fixture.mutations.filter((m) => m.member === "ActivateConnection" && m.body[0] === copyPath)
        .length === 2,
    "copy preferred at login",
  );
  assert.deepEqual(fixture.mutations.at(-1)?.body, [copyPath, WIRED, "/"]);
  await login.dispose();
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [OTHER]);
  cases++;

  // An administrator's modify.system grant changes the shared profile itself.
  fixture.permissions[NM + ".settings.modify.system"] = "yes";
  await a.refresh();
  assert.equal(ready(a).proxy?.copy, undefined);
  assert.equal(ready(a).proxy?.canChange, true);
  const beforeSystem = fixture.mutations.length;
  await a.setProxy!({ method: "auto", pacUrl: "" });
  assert.deepEqual(fixture.mutations.slice(beforeSystem), [
    { member: "Update", body: ["/profile/external"] },
  ]);
  delete fixture.permissions[NM + ".settings.modify.system"];
  // Enterprise (802.1X) sign-in can't be copied: its secrets can't be read or typed here.
  fixture.profileSettings.set("/profile/external", {
    ...sharedWired(),
    "802-1x": { eap: variant("as", ["peap"]) },
  });
  await a.refresh();
  assert.equal(ready(a).proxy?.canChange, false);
  assert.equal(ready(a).proxy?.ownership, "system");
  await assert.rejects(() => a.setProxy!({ method: "auto", pacUrl: "" }), /not permitted/);
  assert.equal(fixture.mutations.length, beforeSystem + 1);
  fixture.profileSettings.set("/profile/external", sharedWired());
  fixture.profiles.delete(copyPath);
  cases++;

  // Secured Wi‑Fi saved for everyone: its password can't be read, so Settings asks for it.
  const SHARED_PSK = SETTINGS_PATH + "/30",
    pskActive = ROOT + "/ActiveConnection/91";
  fixture.exportProfile(SHARED_PSK, {
    connection: {
      uuid: variant("s", "shared-psk-uuid"),
      id: variant("s", "Password fixture"),
      type: variant("s", "802-11-wireless"),
    },
    "802-11-wireless": { ssid: variant("ay", Buffer.from("Password fixture")) },
    "802-11-wireless-security": {
      "key-mgmt": variant("s", "wpa-psk"),
      psk: variant("s", "unreadable-shared"),
    },
  });
  fixture.connection(pskActive, "shared-psk-uuid", "Password fixture", 2, PSK, D, SHARED_PSK);
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [OTHER, pskActive]);
  fixture.set(ROOT, NM, "PrimaryConnection", "o", pskActive);
  await a.refresh();
  assert.deepEqual(ready(a).proxy, {
    connection: "Password fixture",
    method: "none",
    pacUrl: "",
    canChange: true,
    ownership: "system",
    copy: true,
    needsPassword: true,
  });
  const beforePsk = fixture.mutations.length;
  await assert.rejects(
    () => a.setProxy!({ method: "auto", pacUrl: "" }),
    /Enter the Wi‑Fi password for Password fixture/,
  );
  await assert.rejects(
    () => a.setProxy!({ method: "auto", pacUrl: "", password: "short" }),
    /Wi‑Fi password/,
  );
  assert.equal(fixture.mutations.length, beforePsk, "nothing sent without a usable password");
  await a.setProxy!({ method: "auto", pacUrl: "", password: "fixture-pass-12" });
  const pskCalls = fixture.mutations.slice(beforePsk);
  assert.deepEqual(
    pskCalls.map((m) => m.member),
    ["AddConnection", "ActivateConnection"],
  );
  const pskCopy = pskCalls[0]!.body[0] as Record<string, Record<string, unknown>>;
  assert.equal(value(pskCopy["802-11-wireless-security"]!.psk), "fixture-pass-12");
  assert.equal(value(pskCopy["802-11-wireless-security"]!["psk-flags"]), 0);
  assert.equal(value(pskCopy["802-11-wireless-security"]!["key-mgmt"]), "wpa-psk");
  assert.deepEqual(value(pskCopy.connection!.permissions), [`user:${ME}:`]);
  assert.deepEqual(pskCalls[1]!.body.slice(1), [D, PSK]);
  assert(!JSON.stringify(a.state).includes("fixture-pass-12"));
  assert.equal(
    value(fixture.profileSettings.get(SHARED_PSK)!["802-11-wireless-security"]!.psk),
    "unreadable-shared",
    "the shared profile keeps its own password",
  );
  // The network is now saved twice: Forget would remove only the copy.
  const pskPoint = ready(a).accessPoints.find((p) => p.id === psk());
  assert.equal(pskPoint?.ownership, "system");
  assert.equal(pskPoint?.canForget, true);
  fixture.profiles.delete(SHARED_PSK);
  fixture.profiles.delete(String(pskCalls[1]!.body[0]));
  fixture.set(ROOT, NM, "ActiveConnections", "ao", [OTHER]);
  fixture.set(ROOT, NM, "PrimaryConnection", "o", OTHER);
  await a.refresh();
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

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { SessionBus, DbusRemoteError, variant, type DbusVariant } from "@moire/dbus";
import { createBluezPairingAdapter } from "./bluez-pairing";
import { attachDesktopControls } from "./desktop-controls";
import { createBluezBluetoothAdapter } from "./bluez-bluetooth";
import { DESKTOP_STATUS_BUS, observeDesktopStatus } from "@moire/system-management/desktop-status";
import {
  parseBluetoothId,
  type BluetoothAdapter,
  type DesktopBluetooth,
} from "@moire/system-management/bluetooth-status";
import { type AudioStatusAdapter } from "@moire/audio";
import { WIFI_UNAVAILABLE, type WifiAdapter } from "@moire/system-management/network-status";
import { BATTERY_UNAVAILABLE, type BatteryAdapter } from "@moire/system-management/battery-status";

const BLUEZ = "org.bluez",
  MANAGER = "org.freedesktop.DBus.ObjectManager";
const ADAPTER = BLUEZ + ".Adapter1",
  DEVICE = BLUEZ + ".Device1";
const HCI = "/org/bluez/hci0",
  DEVICE_PATH = HCI + "/dev_00_11_22_33_44_55";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const end = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > end) throw new Error("Timeout: " + label);
    await delay(5);
  }
}
class Fixture {
  objects: Record<string, Record<string, Record<string, DbusVariant>>> = {
    [HCI]: {
      [ADAPTER]: {
        Alias: variant("s", "Fixture radio"),
        Address: variant("s", "AA:BB:CC:DD:EE:FF"),
        Powered: variant("b", true),
      },
    },
    [DEVICE_PATH]: {
      [DEVICE]: {
        Alias: variant("s", "Headphones"),
        Address: variant("s", "00:11:22:33:44:55"),
        Adapter: variant("o", HCI),
        Paired: variant("b", false),
        Trusted: variant("b", false),
        Connected: variant("b", false),
      },
    },
  };
  writes: string[] = [];
  discoveryOwners = new Set<string>();
  allowTrust = false;
  allowConnect = false;
  holdTrust = false;
  heldTrust: (() => void) | null = null;
  cancelError = false;
  holdCancel = false;
  cancelCallback = false;
  heldCancel: (() => void) | null = null;
  agent: { destination: string; path: string } | null = null;
  action = "confirm";
  held: (() => void) | null = null;
  registrationError = false;
  startError = false;
  stopError = false;
  pairReadback = true;
  lastPairError: string | null = null;
  agentCapability: string | null = null;
  inputReply: { signature?: string; body?: unknown[] } | null = null;
  constructor(readonly bus: SessionBus) {
    bus.exportObject("/", {
      name: MANAGER,
      methods: {
        GetManagedObjects: {
          inSignature: "",
          outSignature: "a{oa{sa{sv}}}",
          handler: () => ({ body: [this.objects] }),
        },
      },
    });
    bus.exportObject("/org/bluez", {
      name: BLUEZ + ".AgentManager1",
      methods: {
        RegisterAgent: {
          inSignature: "os",
          outSignature: "",
          handler: ({ message, body }) => {
            this.writes.push("RegisterAgent");
            if (this.registrationError)
              throw new DbusRemoteError("org.bluez.Error.Failed", "registration failed");
            assert(body[1] === "DisplayYesNo" || body[1] === "KeyboardDisplay");
            this.agentCapability = body[1];
            assert(message.sender);
            this.agent = { destination: message.sender, path: String(body[0]) };
            return { body: [] };
          },
        },
        UnregisterAgent: {
          inSignature: "o",
          outSignature: "",
          handler: () => {
            this.writes.push("UnregisterAgent");
            this.agent = null;
            return { body: [] };
          },
        },
        RequestDefaultAgent: {
          inSignature: "o",
          outSignature: "",
          handler: () => {
            this.writes.push("RequestDefaultAgent");
            throw new Error("Forbidden");
          },
        },
      },
    });
    bus.exportObject(HCI, {
      name: ADAPTER,
      methods: Object.fromEntries(
        ["StartDiscovery", "StopDiscovery"].map((member) => [
          member,
          {
            inSignature: "",
            outSignature: "",
            handler: async ({ message }) => {
              this.writes.push(member);
              assert(message.sender);
              if (member === "StartDiscovery") this.discoveryOwners.add(message.sender);
              else this.discoveryOwners.delete(message.sender);
              if (
                (member === "StartDiscovery" && this.startError) ||
                (member === "StopDiscovery" && this.stopError)
              )
                await new Promise<void>((resolve) => {
                  this.held = resolve;
                });
              return { body: [] };
            },
          },
        ]),
      ),
    });
    bus.exportObject(DEVICE_PATH, {
      name: DEVICE,
      methods: {
        Pair: {
          inSignature: "",
          outSignature: "",
          handler: async () => {
            this.writes.push("Pair");
            try {
              if (this.action === "hold")
                await new Promise<void>((resolve) => {
                  this.held = resolve;
                });
              else if (this.action === "confirm")
                await this.callback("RequestConfirmation", "ou", [DEVICE_PATH, 123456]);
              else if (this.action === "authorize")
                await this.callback("RequestAuthorization", "o", [DEVICE_PATH]);
              else if (this.action === "pin")
                this.inputReply = await this.callback("RequestPinCode", "o", [DEVICE_PATH]);
              else if (this.action === "passkey")
                this.inputReply = await this.callback("RequestPasskey", "o", [DEVICE_PATH]);
              else if (this.action === "service")
                await this.callback("AuthorizeService", "os", [
                  DEVICE_PATH,
                  "0000110b-0000-1000-8000-00805f9b34fb",
                ]);
              else if (this.action === "display") {
                await this.callback("DisplayPasskey", "ouq", [DEVICE_PATH, 123, 2]);
                await new Promise<void>((resolve) => {
                  this.held = resolve;
                });
              }
              if (this.pairReadback)
                this.objects[DEVICE_PATH]![DEVICE]!.Paired = variant("b", true);
              return { body: [] };
            } catch (e) {
              this.lastPairError = e instanceof DbusRemoteError ? e.errorName : "failed";
              throw e;
            }
          },
        },
        Connect: {
          inSignature: "",
          outSignature: "",
          handler: () => {
            this.writes.push("Connect");
            if (!this.allowConnect) throw new Error("Forbidden fixture Connect write");
            this.objects[DEVICE_PATH]![DEVICE]!.Connected = variant("b", true);
            this.changed();
            return { body: [] };
          },
        },
        CancelPairing: {
          inSignature: "",
          outSignature: "",
          handler: async () => {
            this.writes.push("CancelPairing");
            if (this.cancelCallback) await this.callback("Cancel", "", []);
            if (this.holdCancel)
              await new Promise<void>((resolve) => {
                this.heldCancel = resolve;
              });
            if (this.cancelError)
              throw new DbusRemoteError("org.bluez.Error.Failed", "cancel failed");
            return { body: [] };
          },
        },
      },
    });
    bus.exportObject(DEVICE_PATH, {
      name: "org.freedesktop.DBus.Properties",
      methods: {
        Set: {
          inSignature: "ssv",
          outSignature: "",
          handler: async ({ body }) => {
            this.writes.push("Set");
            if (!this.allowTrust) throw new Error("Forbidden Trusted write");
            assert.equal(body[0], DEVICE);
            assert.equal(body[1], "Trusted");
            const input = body[2];
            assert(
              input &&
                typeof input === "object" &&
                "signature" in input &&
                "value" in input &&
                input.signature === "b" &&
                typeof input.value === "boolean",
            );
            if (this.holdTrust)
              await new Promise<void>((resolve) => {
                this.heldTrust = resolve;
              });
            this.objects[DEVICE_PATH]![DEVICE]!.Trusted = variant("b", input.value);
            this.changed();
            return { body: [] };
          },
        },
      },
    });
  }
  async callback(member: string, signature: string, body: unknown[], sender = this.bus) {
    assert(this.agent);
    return sender.call(
      { ...this.agent, interface: BLUEZ + ".Agent1", member, signature, body },
      { timeoutMs: 1000 },
    );
  }
  changed() {
    this.bus.emitSignal({
      path: DEVICE_PATH,
      interface: "org.freedesktop.DBus.Properties",
      member: "PropertiesChanged",
      signature: "sa{sv}as",
      body: [DEVICE, {}, []],
    });
  }
  release() {
    this.heldTrust?.();
    this.heldTrust = null;
    this.heldCancel?.();
    this.heldCancel = null;
    this.held?.();
    this.held = null;
  }
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-bluez-pairing-"));
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
let busAddress = "",
  stderr = "",
  daemonError: Error | null = null;
daemon.stdout.on("data", (chunk) => {
  busAddress += chunk.toString();
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
const connections: SessionBus[] = [],
  backends: Awaited<ReturnType<typeof createBluezPairingAdapter>>[] = [];
let cases = 0;
async function bus() {
  const b = await SessionBus.connect(busAddress.trim());
  connections.push(b);
  return b;
}
function ready(backend: Awaited<ReturnType<typeof createBluezPairingAdapter>>) {
  const s = backend.state;
  assert.equal(s.kind, "ready");
  if (s.kind !== "ready") throw new Error("Pairing not ready");
  return s;
}
async function context(options: Parameters<typeof createBluezPairingAdapter>[0] = {}) {
  const bluez = await bus();
  assert.equal(await bluez.requestName(BLUEZ), 1);
  const fixture = new Fixture(bluez),
    client = await bus();
  const backend = await createBluezPairingAdapter({
    enabled: true,
    connect: bus,
    callTimeoutMs: 80,
    discoveryMs: 1500,
    pairTimeoutMs: 1000,
    promptTimeoutMs: 700,
    pollMs: 15,
    ...options,
  });
  backends.push(backend);
  assert(client.name);
  const caller = client.name;
  async function start() {
    const adapterId = ready(backend).adapters[0]?.id;
    assert(adapterId);
    await backend.startDiscovery({ caller, adapterId });
  }
  function lease() {
    const leaseId = ready(backend).lease?.id;
    assert(leaseId);
    return { caller, leaseId };
  }
  async function pair() {
    const request = lease(),
      deviceId = ready(backend).devices[0]?.id;
    assert(deviceId);
    await backend.beginPair({ ...request, deviceId });
    const a = ready(backend).attempt;
    assert.equal(a.kind, "pending");
    return { ...request, attemptId: a.id };
  }
  async function consent(accepted: boolean) {
    await until(() => ready(backend).prompt !== null, "consent prompt");
    const p = ready(backend).prompt;
    assert(p);
    const a = ready(backend).attempt;
    if (a.kind === "idle") throw new Error("Missing attempt");
    await backend.respond({ ...lease(), attemptId: a.id, promptId: p.id, accepted });
  }
  async function close() {
    fixture.release();
    await backend.dispose();
    bluez.close();
    await delay(15);
    assert.equal(fixture.writes.includes("RequestDefaultAgent"), false);
    if (!fixture.allowTrust) assert.equal(fixture.writes.includes("Set"), false);
    if (!fixture.allowConnect) assert.equal(fixture.writes.includes("Connect"), false);
  }
  return { fixture, bluez, client, backend, caller, start, lease, pair, consent, close };
}
async function test(name: string, run: () => Promise<void>) {
  await run();
  cases++;
  console.log("ok " + name);
}
try {
  await until(() => busAddress.includes("\n") || daemonError !== null, "private daemon");
  if (daemonError) throw daemonError;
  await test("capability defaults off without connecting", async () => {
    let connected = false;
    const backend = await createBluezPairingAdapter({
      connect: async () => {
        connected = true;
        return bus();
      },
    });
    assert.deepEqual(backend.state, { kind: "disabled" });
    assert.equal(connected, false);
    await backend.dispose();
  });
  await test("numeric confirmation and observed Paired; no trust/default agent", async () => {
    const c = await context();
    await c.start();
    await c.pair();
    await c.consent(true);
    await until(() => ready(c.backend).attempt.kind === "complete", "paired evidence");
    const a = ready(c.backend).attempt;
    if (a.kind === "idle" || a.kind === "pending") throw new Error("Missing completed result");
    assert.match(a.message, /untrusted/);
    assert.equal(c.fixture.objects[DEVICE_PATH]![DEVICE]!.Trusted!.value, false);
    await c.close();
    assert.equal(c.fixture.writes.filter((x) => x === "StopDiscovery").length, 1);
  });
  await test("explicit rejection retires prompt and cancels", async () => {
    const c = await context();
    await c.start();
    await c.pair();
    await c.consent(false);
    assert.equal(ready(c.backend).prompt, null);
    assert.equal(ready(c.backend).attempt.kind, "canceled");
    await c.close();
    assert(c.fixture.writes.includes("CancelPairing"));
  });
  await test("local authorization requires consent", async () => {
    const c = await context();
    c.fixture.action = "authorize";
    await c.start();
    await c.pair();
    await until(() => ready(c.backend).prompt?.kind === "authorization", "authorization prompt");
    await c.consent(true);
    await until(() => ready(c.backend).attempt.kind === "complete", "authorized pairing");
    await c.close();
  });
  await test("spoofed sender and foreign device rejected", async () => {
    const c = await context();
    c.fixture.action = "hold";
    await c.start();
    await c.pair();
    const stranger = await bus();
    await assert.rejects(
      c.fixture.callback("RequestConfirmation", "ou", [DEVICE_PATH, 123456], stranger),
      (e) => e instanceof DbusRemoteError && e.errorName === "org.bluez.Error.Rejected",
    );
    await assert.rejects(
      c.fixture.callback("RequestConfirmation", "ou", [HCI + "/dev_other", 123456]),
      (e) => e instanceof DbusRemoteError && e.errorName === "org.bluez.Error.Rejected",
    );
    assert.equal(ready(c.backend).prompt, null);
    await c.close();
  });
  await test("prompt IDs and initiating caller prevent stale consent", async () => {
    const c = await context();
    await c.start();
    const req = await c.pair();
    await until(() => ready(c.backend).prompt !== null, "prompt");
    const p = ready(c.backend).prompt;
    assert(p);
    await assert.rejects(
      c.backend.respond({ ...req, caller: ":9.9", promptId: p.id, accepted: true }),
    );
    await assert.rejects(
      c.backend.respond({ ...req, promptId: ready(c.backend).lease!.id, accepted: true }),
    );
    await c.backend.respond({ ...req, promptId: p.id, accepted: true });
    await assert.rejects(c.backend.respond({ ...req, promptId: p.id, accepted: true }));
    await c.close();
  });
  await test("single discovery owner blocks second caller and wrong stop", async () => {
    const c = await context();
    await c.start();
    const adapterId = ready(c.backend).adapters[0]!.id;
    await assert.rejects(c.backend.startDiscovery({ caller: ":9.9", adapterId }));
    await assert.rejects(c.backend.stopDiscovery({ ...c.lease(), caller: ":9.9" }));
    await c.close();
  });
  await test("concurrent discovery starts acquire once", async () => {
    const c = await context();
    const req = { caller: c.caller, adapterId: ready(c.backend).adapters[0]!.id };
    const results = await Promise.allSettled([
      c.backend.startDiscovery(req),
      c.backend.startDiscovery(req),
    ]);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(c.fixture.writes.filter((x) => x === "StartDiscovery").length, 1);
    await c.close();
  });
  await test("caller/window close cancels and cleans acquired discovery", async () => {
    const c = await context();
    await c.start();
    await c.pair();
    await until(() => ready(c.backend).prompt !== null, "prompt");
    await c.backend.callerLost(c.caller);
    assert.equal(ready(c.backend).lease, null);
    assert.equal(ready(c.backend).prompt, null);
    assert.equal(ready(c.backend).attempt.kind, "canceled");
    await c.close();
    assert(c.fixture.writes.includes("CancelPairing"));
  });
  await test("closed caller cannot create new lease", async () => {
    const c = await context();
    await c.backend.callerLost(c.caller);
    await assert.rejects(c.start());
    assert.equal(c.fixture.writes.length, 0);
    await c.close();
  });
  await test("BlueZ Cancel retires prompt", async () => {
    const c = await context();
    await c.start();
    await c.pair();
    await until(() => ready(c.backend).prompt !== null, "prompt");
    await c.fixture.callback("Cancel", "", []);
    assert.equal(ready(c.backend).attempt.kind, "canceled");
    assert.equal(ready(c.backend).prompt, null);
    await c.close();
  });
  await test("BlueZ Release cleans owned discovery", async () => {
    const c = await context();
    await c.start();
    await c.pair();
    await until(() => ready(c.backend).prompt !== null, "prompt");
    await c.fixture.callback("Release", "", []);
    await until(() => ready(c.backend).lease === null, "release cleanup");
    assert.equal(ready(c.backend).prompt, null);
    assert(c.fixture.writes.includes("StopDiscovery"));
    await c.close();
  });
  await test("confirmation deadline cancels", async () => {
    const c = await context({ promptTimeoutMs: 40 });
    await c.start();
    await c.pair();
    await until(() => ready(c.backend).attempt.kind === "canceled", "prompt deadline");
    assert.equal(ready(c.backend).prompt, null);
    await c.close();
  });
  await test("pair deadline cancels while Pair remains pending", async () => {
    const c = await context({ pairTimeoutMs: 60 });
    c.fixture.action = "hold";
    await c.start();
    await c.pair();
    await until(
      () =>
        ready(c.backend).attempt.kind === "canceled" && c.fixture.writes.includes("CancelPairing"),
      "pair deadline with acknowledged wire cancellation",
    );
    assert(c.fixture.writes.includes("CancelPairing"));
    await c.close();
  });
  await test("discovery deadline cleans pending Pair and owned scan", async () => {
    const c = await context({ discoveryMs: 80 });
    c.fixture.action = "hold";
    c.fixture.cancelCallback = true;
    await c.start();
    await c.pair();
    await until(
      () =>
        ready(c.backend).lease === null &&
        ready(c.backend).attempt.kind === "canceled" &&
        c.fixture.writes.includes("CancelPairing"),
      "discovery expiry after acknowledged cancellation",
    );
    assert(c.fixture.writes.includes("CancelPairing"));
    assert(c.fixture.writes.includes("StopDiscovery"));
    await c.close();
  });
  await test("successful Pair reply without Paired evidence stays unknown", async () => {
    const c = await context();
    c.fixture.pairReadback = false;
    await c.start();
    await c.pair();
    await c.consent(true);
    await until(() => ready(c.backend).attempt.kind === "unknown", "unknown readback");
    await assert.rejects(c.pair());
    const adapterId = ready(c.backend).adapters[0]!.id;
    await c.backend.stopDiscovery(c.lease());
    await assert.rejects(c.backend.startDiscovery({ caller: c.caller, adapterId }));
    await c.close();
  });
  await test("same-attempt later Paired observation resolves uncertainty", async () => {
    const c = await context();
    c.fixture.pairReadback = false;
    await c.start();
    await c.pair();
    await c.consent(true);
    await until(() => ready(c.backend).attempt.kind === "unknown", "unknown readback");
    c.fixture.objects[DEVICE_PATH]![DEVICE]!.Paired = variant("b", true);
    await until(() => ready(c.backend).attempt.kind === "complete", "late exact readback");
    await c.close();
  });
  await test("registration failure never starts discovery", async () => {
    const c = await context();
    c.fixture.registrationError = true;
    await c.start();
    assert.equal(ready(c.backend).lease, null);
    assert.equal(ready(c.backend).discovery, "error");
    assert.equal(c.fixture.writes.includes("StartDiscovery"), false);
    assert.equal(c.fixture.writes.includes("StopDiscovery"), false);
    await c.close();
  });
  await test("uncertain discovery start closes connection without claiming acquisition", async () => {
    const c = await context();
    c.fixture.startError = true;
    await c.start();
    assert.equal(ready(c.backend).lease, null);
    assert.equal(ready(c.backend).discovery, "unknown");
    assert.equal(c.fixture.writes.includes("StopDiscovery"), false);
    await c.close();
  });
  await test("uncertain stop closes owned connection", async () => {
    const c = await context();
    await c.start();
    c.fixture.stopError = true;
    await c.backend.stopDiscovery(c.lease());
    assert.equal(ready(c.backend).lease, null);
    assert.equal(ready(c.backend).discovery, "unknown");
    await c.close();
  });
  for (const action of ["pin", "passkey", "service"])
    await test("unsupported " + action + " rejected", async () => {
      const c = await context();
      c.fixture.action = action;
      await c.start();
      await c.pair();
      await until(() => ready(c.backend).attempt.kind === "error", action + " rejection");
      assert.equal(c.fixture.lastPairError, "org.bluez.Error.Rejected");
      assert.equal(ready(c.backend).prompt, null);
      await c.close();
    });
  await test("display-only passkey cannot be accepted as consent", async () => {
    const c = await context();
    c.fixture.action = "display";
    await c.start();
    const req = await c.pair();
    await until(() => ready(c.backend).prompt?.kind === "display-code", "display code");
    const p = ready(c.backend).prompt;
    assert(p && p.kind === "display-code");
    assert.equal(p.code, "000123");
    assert.equal(p.entered, 2);
    await assert.rejects(c.backend.respond({ ...req, promptId: p.id, accepted: true }));
    await c.backend.cancel(req);
    await c.close();
  });
  await test("removed occurrence retires prompt; late completion cannot succeed", async () => {
    const c = await context();
    await c.start();
    const req = await c.pair();
    await until(() => ready(c.backend).prompt !== null, "prompt");
    const p = ready(c.backend).prompt;
    assert(p);
    delete c.fixture.objects[DEVICE_PATH];
    c.bluez.emitSignal({
      path: "/",
      interface: MANAGER,
      member: "InterfacesRemoved",
      signature: "oas",
      body: [DEVICE_PATH, [DEVICE]],
    });
    await until(() => ready(c.backend).lease === null, "removed occurrence");
    await assert.rejects(c.backend.respond({ ...req, promptId: p.id, accepted: true }));
    assert.equal(ready(c.backend).attempt.kind, "unknown");
    assert.equal(c.fixture.writes.includes("CancelPairing"), false);
    await c.close();
  });
  await test("BlueZ owner replacement never receives old writes or late success", async () => {
    const c = await context();
    c.fixture.action = "hold";
    await c.start();
    await c.pair();
    await c.bluez.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus",
      member: "ReleaseName",
      signature: "s",
      body: [BLUEZ],
    });
    const replacementBus = await bus();
    assert.equal(await replacementBus.requestName(BLUEZ), 1);
    const replacement = new Fixture(replacementBus);
    await until(() => ready(c.backend).lease === null, "owner replacement");
    c.fixture.release();
    await delay(50);
    assert.equal(ready(c.backend).attempt.kind, "unknown");
    assert.equal(ready(c.backend).prompt, null);
    assert.equal(replacement.writes.length, 0);
    await c.close();
    replacementBus.close();
    await delay(15);
  });
  await test("owned StopDiscovery preserves another caller scan", async () => {
    const c = await context(),
      other = await bus();
    assert(other.name);
    await other.call({
      destination: c.bluez.name ?? BLUEZ,
      path: HCI,
      interface: ADAPTER,
      member: "StartDiscovery",
      signature: "",
      body: [],
    });
    await c.start();
    assert.equal(c.fixture.discoveryOwners.size, 2);
    await c.backend.stopDiscovery(c.lease());
    assert.deepEqual(Array.from(c.fixture.discoveryOwners), [other.name]);
    await c.close();
  });
  await test("uncertain cancel stays blocked and closes owned scan", async () => {
    const c = await context();
    c.fixture.action = "hold";
    c.fixture.cancelError = true;
    await c.start();
    const req = await c.pair();
    await c.backend.cancel(req);
    await until(() => ready(c.backend).lease === null, "uncertain cancellation cleanup");
    assert.equal(ready(c.backend).attempt.kind, "unknown");
    assert(c.fixture.writes.includes("StopDiscovery"));
    await c.close();
  });
  await test("closing caller during pending Start never claims acquisition", async () => {
    const c = await context();
    c.fixture.startError = true;
    const starting = c.start();
    await until(() => c.fixture.writes.includes("StartDiscovery"), "held discovery start");
    await c.backend.callerLost(c.caller);
    await starting;
    assert.equal(ready(c.backend).lease, null);
    assert.equal(c.fixture.writes.includes("StopDiscovery"), false);
    await c.close();
  });
  await test("malformed and duplicate Agent1 prompts rejected", async () => {
    const c = await context();
    await c.start();
    await c.pair();
    await until(() => ready(c.backend).prompt !== null, "prompt");
    await assert.rejects(
      c.fixture.callback("RequestAuthorization", "", []),
      (e) => e instanceof DbusRemoteError && e.errorName === "org.bluez.Error.Rejected",
    );
    await assert.rejects(
      c.fixture.callback("RequestConfirmation", "ou", [DEVICE_PATH, 1000000]),
      (e) => e instanceof DbusRemoteError && e.errorName === "org.bluez.Error.Rejected",
    );
    await assert.rejects(
      c.fixture.callback("RequestConfirmation", "ou", [DEVICE_PATH, 123456]),
      (e) => e instanceof DbusRemoteError && e.errorName === "org.bluez.Error.Rejected",
    );
    await c.close();
  });
  await test("external Paired property cannot complete a pending local Pair", async () => {
    const c = await context();
    c.fixture.action = "hold";
    await c.start();
    const req = await c.pair();
    c.fixture.objects[DEVICE_PATH]![DEVICE]!.Paired = variant("b", true);
    await delay(60);
    assert.equal(ready(c.backend).attempt.kind, "pending");
    await c.backend.cancel(req);
    await c.close();
  });
  await test("fractional injected deadline is rejected", async () => {
    await assert.rejects(createBluezPairingAdapter({ discoveryMs: 30.5 }));
  });
  await test("actual fake BlueZ backend through desktop service and public client", async () => {
    const c = await context(),
      server = await bus();
    assert.equal(await server.requestName(DESKTOP_STATUS_BUS), 1);
    assert(server.name);
    const audio: AudioStatusAdapter = {
      state: { kind: "unavailable", message: "Private fixture has no audio" },
      subscribe: () => () => {},
      refresh: async () => audio.state,
      setVolume: async () => {
        throw new Error("Forbidden fixture audio write");
      },
      setMute: async () => {
        throw new Error("Forbidden fixture audio write");
      },
      dispose() {},
    };
    const wifi: WifiAdapter = {
      state: WIFI_UNAVAILABLE,
      subscribe: () => () => {},
      refresh: async () => {},
      scan: async () => {
        throw new Error("Forbidden fixture Wifi scan");
      },
      connect: async () => {
        throw new Error("Forbidden fixture Wifi write");
      },
      cancel: async () => {},
      dispose: async () => {},
    };
    const battery: BatteryAdapter = {
      state: BATTERY_UNAVAILABLE,
      subscribe: () => () => {},
      refresh: async () => {},
      dispose: async () => {},
    };
    const knownAdapter = parseBluetoothId("fixture_known_adapter"),
      knownDevice = parseBluetoothId("fixture_known_device");
    let known: DesktopBluetooth = {
      status: {
        kind: "ready",
        policy: "readonly",
        adapters: [{ id: knownAdapter, name: "Observed known adapter", powered: true }],
        devices: [],
      },
      operation: { kind: "idle" },
    };
    const knownListeners = new Set<() => void>();
    const bluetooth: BluetoothAdapter = {
      get state() {
        return known;
      },
      subscribe(listener) {
        knownListeners.add(listener);
        return () => knownListeners.delete(listener);
      },
      async refresh() {
        if (c.fixture.objects[DEVICE_PATH]![DEVICE]!.Paired!.value === true) {
          known = {
            status: {
              kind: "ready",
              policy: "readonly",
              adapters: [{ id: knownAdapter, name: "Observed known adapter", powered: true }],
              devices: [
                {
                  id: knownDevice,
                  adapterId: knownAdapter,
                  name: "Headphones",
                  address: "00:11:22:33:44:55",
                  paired: true,
                  trusted: false,
                  connected: false,
                },
              ],
            },
            operation: { kind: "idle" },
          };
          for (const listener of knownListeners) listener();
        }
      },
      setConnected: async () => {
        throw new Error("Forbidden fixture Connect write");
      },
      dispose: async () => {},
    };
    const controls = await attachDesktopControls(server, {
      alertSound: () => {},
      audio,
      wifi,
      battery,
      bluetooth,
      bluetoothPairing: c.backend,
      pollMs: 0,
      network: () => [],
      readDoNotDisturb: () => false,
      writeDoNotDisturb: () => {
        throw new Error("Forbidden fixture policy write");
      },
      capabilities: {
        audio: false,
        brightness: false,
        battery: false,
        bluetooth: false,
        power: false,
        notifications: false,
      },
    });
    const observer = await observeDesktopStatus(c.client, () => {});
    try {
      await until(() => observer.state.kind === "ready", "public desktop observation");
      const snapshot = () => {
        const observed = observer.state;
        assert(observed.kind === "ready");
        return observed.snapshot;
      };
      const pairing = () => {
        const p = snapshot().bluetooth.pairing;
        assert(p?.kind === "ready");
        return p;
      };
      const intent = () => ({ owner: server.name!, revision: snapshot().revision });
      const pairingAdapter = pairing().adapters[0]!.id;
      assert.notEqual(pairingAdapter, knownAdapter);
      await observer.startBluetoothDiscovery({ ...intent(), adapterId: pairingAdapter });
      const leaseId = pairing().lease!.id;
      await observer.beginBluetoothPair({
        ...intent(),
        leaseId,
        deviceId: pairing().devices[0]!.id,
      });
      await until(() => pairing().prompt !== null, "public numeric prompt");
      const first = pairing().prompt!;
      assert.equal(pairing().attempt.kind, "pending");
      await observer.respondBluetoothPrompt({
        ...intent(),
        leaseId,
        attemptId: first.attemptId,
        promptId: first.id,
        accepted: false,
      });
      await until(() => pairing().attempt.kind === "canceled", "public reject result");
      await observer.beginBluetoothPair({
        ...intent(),
        leaseId,
        deviceId: pairing().devices[0]!.id,
      });
      await until(() => pairing().prompt !== null, "second public prompt");
      const second = pairing().prompt!;
      assert.notEqual(second.id, first.id);
      await observer.respondBluetoothPrompt({
        ...intent(),
        leaseId,
        attemptId: second.attemptId,
        promptId: second.id,
        accepted: true,
      });
      await until(
        () => pairing().attempt.kind === "complete",
        "public observed pairing completion",
      );
      await until(() => {
        const status = snapshot().bluetooth.status;
        return status.kind === "ready" && status.devices.length === 1;
      }, "public known device refresh");
      const status = snapshot().bluetooth.status;
      assert(status.kind === "ready");
      assert.equal(status.policy, "readonly");
      assert.equal(status.devices[0]!.trusted, false);
      await observer.stopBluetoothDiscovery({ ...intent(), leaseId });
      assert.equal(pairing().lease, null);
      assert(c.fixture.writes.includes("StopDiscovery"));
    } finally {
      await observer.dispose();
      await controls.dispose();
      server.close();
      await c.close();
    }
  });
  await test("held CancelPairing keeps ownership pending and joins repeated cancellation", async () => {
    const c = await context({ callTimeoutMs: 500 });
    c.fixture.holdCancel = true;
    await c.start();
    const req = await c.pair();
    await until(() => ready(c.backend).prompt !== null, "held cancellation prompt");
    const p = ready(c.backend).prompt!;
    const cancellation = c.backend.cancel(req);
    await until(() => c.fixture.heldCancel !== null, "CancelPairing reached private daemon");
    assert.equal(ready(c.backend).attempt.kind, "pending");
    assert.equal(ready(c.backend).prompt, null);
    await assert.rejects(c.pair());
    await assert.rejects(c.backend.respond({ ...req, promptId: p.id, accepted: true }));
    await assert.rejects(
      c.fixture.callback("RequestConfirmation", "ou", [DEVICE_PATH, 123456]),
      (e) => e instanceof DbusRemoteError && e.errorName === "org.bluez.Error.Rejected",
    );
    const repeat = c.backend.cancel(req);
    await delay(30);
    assert.equal(c.fixture.writes.filter((member) => member === "CancelPairing").length, 1);
    assert.equal(ready(c.backend).attempt.kind, "pending");
    c.fixture.heldCancel!();
    c.fixture.heldCancel = null;
    await Promise.all([cancellation, repeat]);
    assert.equal(ready(c.backend).attempt.kind, "canceled");
    await c.close();
    const late = await context({ callTimeoutMs: 500 });
    late.fixture.holdCancel = true;
    late.fixture.cancelCallback = true;
    late.fixture.action = "hold";
    await late.start();
    const lateReq = await late.pair();
    const lateCancel = late.backend.cancel(lateReq);
    await until(() => late.fixture.heldCancel !== null, "late Pair cancellation dispatched");
    late.fixture.held!();
    late.fixture.held = null;
    await delay(40);
    assert.equal(
      ready(late.backend).attempt.kind,
      "pending",
      "successful late Pair and Paired readback cannot finish during cancellation",
    );
    late.fixture.heldCancel!();
    late.fixture.heldCancel = null;
    await lateCancel;
    assert.equal(ready(late.backend).attempt.kind, "canceled");
    await late.close();
  });
  for (const [index, entry] of [
    {
      action: "pin",
      kind: "pin-entry",
      value: "C54-PIN_secret!",
      expected: "C54-PIN_secret!",
      signature: "s",
    },
    {
      action: "pin",
      kind: "pin-entry",
      value: "0123456789ABCDEF",
      expected: "0123456789ABCDEF",
      signature: "s",
    },
    { action: "passkey", kind: "passkey-entry", value: "004207", expected: 4207, signature: "u" },
    { action: "passkey", kind: "passkey-entry", value: "000000", expected: 0, signature: "u" },
    { action: "passkey", kind: "passkey-entry", value: "999999", expected: 999999, signature: "u" },
  ].entries())
    await test("explicit typed entry private reply " + index, async () => {
      const c = await context({ inputEnabled: true });
      c.fixture.action = entry.action;
      const observed: string[] = [];
      const unsubscribe = c.backend.subscribe(() => observed.push(JSON.stringify(c.backend.state)));
      await c.start();
      assert.equal(c.fixture.agentCapability, "KeyboardDisplay");
      assert.equal(ready(c.backend).inputEnabled, true);
      const req = await c.pair();
      await until(() => ready(c.backend).prompt?.kind === entry.kind, "typed code prompt");
      const p = ready(c.backend).prompt!;
      assert(c.backend.respondInput);
      await assert.rejects(c.backend.respond({ ...req, promptId: p.id, accepted: true }));
      await assert.rejects(
        c.backend.respondInput({ ...req, caller: ":9.9", promptId: p.id, value: entry.value }),
      );
      await c.backend.respondInput({ ...req, promptId: p.id, value: entry.value });
      await assert.rejects(c.backend.respondInput({ ...req, promptId: p.id, value: entry.value }));
      await until(
        () => ready(c.backend).attempt.kind === "complete",
        "typed input Paired evidence",
      );
      assert.equal(c.fixture.inputReply?.signature, entry.signature);
      assert.deepEqual(c.fixture.inputReply?.body, [entry.expected]);
      for (const state of observed) {
        assert(
          !state.includes(JSON.stringify(entry.value)),
          "typed draft must not enter observed state",
        );
        assert(!state.includes('"value"'), "typed draft field must not enter observed state");
      }
      unsubscribe();
      await c.close();
    });
  await test("entry disabled independently of pairing and no connection when pairing disabled", async () => {
    const c = await context();
    c.fixture.action = "pin";
    await c.start();
    assert.equal(c.fixture.agentCapability, "DisplayYesNo");
    assert.equal(ready(c.backend).inputEnabled, false);
    const req = await c.pair();
    await until(() => ready(c.backend).attempt.kind === "error", "default code entry rejection");
    assert.equal(c.fixture.inputReply, null);
    assert(c.backend.respondInput);
    await assert.rejects(
      c.backend.respondInput({ ...req, promptId: req.attemptId, value: "C54-unused" }),
    );
    await c.close();
    let connected = false;
    const disabled = await createBluezPairingAdapter({
      inputEnabled: true,
      connect: async () => {
        connected = true;
        return bus();
      },
    });
    assert.equal(connected, false);
    assert.deepEqual(disabled.state, { kind: "disabled" });
    await disabled.dispose();
  });
  await test("typed input rejects confirmation kind and stale entry ID", async () => {
    const c = await context({ inputEnabled: true });
    await c.start();
    const req = await c.pair();
    await until(() => ready(c.backend).prompt?.kind === "confirmation", "confirmation prompt");
    const p = ready(c.backend).prompt!;
    assert(c.backend.respondInput);
    await assert.rejects(c.backend.respondInput({ ...req, promptId: p.id, value: "123456" }));
    await c.backend.cancel(req);
    c.fixture.action = "passkey";
    const next = await c.pair();
    await until(() => ready(c.backend).prompt?.kind === "passkey-entry", "entry prompt");
    await assert.rejects(c.backend.respondInput({ ...next, promptId: p.id, value: "123456" }));
    await c.backend.cancel(next);
    await c.close();
  });
  for (const action of ["pin", "passkey"])
    await test(
      "invalid " + action + " drafts remain private and prompt remains usable",
      async () => {
        const c = await context({ inputEnabled: true });
        c.fixture.action = action;
        await c.start();
        const req = await c.pair();
        await until(() => ready(c.backend).prompt !== null, "entry prompt");
        const p = ready(c.backend).prompt!;
        assert(c.backend.respondInput);
        const invalid =
          action === "pin"
            ? ["", "C54_overlong_code!!", "C54\ncode", "C54é"]
            : ["", "C54", "1234567", "-42", " 42", "4.2"];
        for (const value of invalid) {
          await assert.rejects(
            c.backend.respondInput({ ...req, promptId: p.id, value }),
            (error) => error instanceof Error && (!value || !error.message.includes(value)),
          );
          assert.equal(ready(c.backend).prompt?.id, p.id);
          assert(!JSON.stringify(c.backend.state).includes('"value"'));
          assert.equal(c.fixture.inputReply, null);
        }
        await c.backend.respondInput({
          ...req,
          promptId: p.id,
          value: action === "pin" ? "C54-valid" : "012345",
        });
        await until(
          () => ready(c.backend).attempt.kind === "complete",
          "valid reply after bad draft",
        );
        await c.close();
      },
    );
  await test("entry deadline cancels and rejects delayed draft", async () => {
    const c = await context({ inputEnabled: true, promptTimeoutMs: 60 });
    c.fixture.action = "pin";
    await c.start();
    const req = await c.pair();
    await until(() => ready(c.backend).prompt?.kind === "pin-entry", "entry prompt");
    const p = ready(c.backend).prompt!;
    await until(
      () =>
        ready(c.backend).attempt.kind === "canceled" && c.fixture.writes.includes("CancelPairing"),
      "entry deadline cancellation acknowledgement",
    );
    assert(c.backend.respondInput);
    await assert.rejects(c.backend.respondInput({ ...req, promptId: p.id, value: "C54-delayed" }));
    assert.equal(c.fixture.inputReply, null);
    assert.equal(ready(c.backend).prompt, null);
    await c.close();
  });
  await test("pending owned cancellation retires entry before acknowledgement", async () => {
    const c = await context({ inputEnabled: true, callTimeoutMs: 500 });
    c.fixture.action = "passkey";
    c.fixture.holdCancel = true;
    await c.start();
    const req = await c.pair();
    await until(() => ready(c.backend).prompt?.kind === "passkey-entry", "entry prompt");
    const p = ready(c.backend).prompt!;
    const cancellation = c.backend.cancel(req);
    await until(() => c.fixture.heldCancel !== null, "held input cancellation");
    assert.equal(ready(c.backend).attempt.kind, "pending");
    assert.equal(ready(c.backend).prompt, null);
    assert(c.backend.respondInput);
    await assert.rejects(c.backend.respondInput({ ...req, promptId: p.id, value: "004207" }));
    assert.equal(c.fixture.inputReply, null);
    c.fixture.heldCancel!();
    c.fixture.heldCancel = null;
    await cancellation;
    assert.equal(ready(c.backend).attempt.kind, "canceled");
    await c.close();
  });
  await test("typed prompts retire on caller loss, removed occurrence and owner replacement", async () => {
    for (const mode of ["caller", "device", "owner"]) {
      const c = await context({ inputEnabled: true });
      c.fixture.action = "pin";
      await c.start();
      const req = await c.pair();
      await until(() => ready(c.backend).prompt?.kind === "pin-entry", "owned entry prompt");
      const p = ready(c.backend).prompt!;
      let replacementBus: SessionBus | null = null,
        replacement: Fixture | null = null;
      if (mode === "caller") await c.backend.callerLost(c.caller);
      else if (mode === "device") {
        delete c.fixture.objects[DEVICE_PATH];
        c.bluez.emitSignal({
          path: "/",
          interface: MANAGER,
          member: "InterfacesRemoved",
          signature: "oas",
          body: [DEVICE_PATH, [DEVICE]],
        });
      } else {
        await c.bluez.call({
          destination: "org.freedesktop.DBus",
          path: "/org/freedesktop/DBus",
          interface: "org.freedesktop.DBus",
          member: "ReleaseName",
          signature: "s",
          body: [BLUEZ],
        });
        replacementBus = await bus();
        assert.equal(await replacementBus.requestName(BLUEZ), 1);
        replacement = new Fixture(replacementBus);
      }
      await until(() => ready(c.backend).lease === null, "retired typed lease");
      assert.equal(ready(c.backend).prompt, null);
      assert.equal(ready(c.backend).attempt.kind, mode === "caller" ? "canceled" : "unknown");
      assert(c.backend.respondInput);
      await assert.rejects(
        c.backend.respondInput({ ...req, promptId: p.id, value: "C54-retired" }),
      );
      assert.equal(c.fixture.inputReply, null);
      if (replacement) assert.equal(replacement.writes.length, 0);
      await c.close();
      replacementBus?.close();
      await delay(15);
    }
  });
  await test("KeyboardDisplay still rejects service authorization", async () => {
    const c = await context({ inputEnabled: true });
    c.fixture.action = "service";
    await c.start();
    await c.pair();
    await until(
      () => ready(c.backend).attempt.kind === "error",
      "unsupported service authorization",
    );
    assert.equal(c.fixture.lastPairError, "org.bluez.Error.Rejected");
    assert.equal(ready(c.backend).prompt, null);
    await c.close();
  });
  await test("actual PIN Pair then explicit Trust then manual Connect through public desktop client", async () => {
    const c = await context({ inputEnabled: true, discoveryMs: 30000 });
    c.fixture.action = "pin";
    c.fixture.allowTrust = true;
    c.fixture.allowConnect = true;
    const server = await bus();
    assert.equal(await server.requestName(DESKTOP_STATUS_BUS), 1);
    assert(server.name);
    const audio: AudioStatusAdapter = {
      state: { kind: "unavailable", message: "Private fixture has no audio" },
      subscribe: () => () => {},
      refresh: async () => audio.state,
      setVolume: async () => {
        throw new Error("Forbidden fixture audio write");
      },
      setMute: async () => {
        throw new Error("Forbidden fixture audio write");
      },
      dispose() {},
    };
    const wifi: WifiAdapter = {
      state: WIFI_UNAVAILABLE,
      subscribe: () => () => {},
      refresh: async () => {},
      scan: async () => {
        throw new Error("Forbidden fixture Wifi scan");
      },
      connect: async () => {
        throw new Error("Forbidden fixture Wifi write");
      },
      cancel: async () => {},
      dispose: async () => {},
    };
    const battery: BatteryAdapter = {
      state: BATTERY_UNAVAILABLE,
      subscribe: () => () => {},
      refresh: async () => {},
      dispose: async () => {},
    };
    const known = await createBluezBluetoothAdapter({
      connect: bus,
      policy: "interactive",
      trustPolicy: "interactive",
      callTimeoutMs: 500,
      operationTimeoutMs: 1500,
      consentTimeoutMs: 2000,
      pollMs: 15,
    });
    const controls = await attachDesktopControls(server, {
      alertSound: () => {},
      audio,
      wifi,
      battery,
      bluetooth: known,
      bluetoothPairing: c.backend,
      pollMs: 0,
      network: () => [],
      readDoNotDisturb: () => false,
      writeDoNotDisturb: () => {
        throw new Error("Forbidden fixture policy write");
      },
      capabilities: {
        audio: false,
        brightness: false,
        battery: false,
        bluetooth: false,
        power: false,
        notifications: false,
      },
    });
    const observed: string[] = [];
    const observer = await observeDesktopStatus(c.client, (state) =>
      observed.push(JSON.stringify(state)),
    );
    let stage = "observe";
    try {
      await until(() => observer.state.kind === "ready", "actual desktop status");
      const snapshot = () => {
        const observed = observer.state;
        assert(observed.kind === "ready");
        return observed.snapshot;
      };
      const pairing = () => {
        const p = snapshot().bluetooth.pairing;
        assert(p?.kind === "ready");
        return p;
      };
      const device = () => {
        const status = snapshot().bluetooth.status;
        assert(status.kind === "ready");
        const d = status.devices[0];
        assert(d);
        return d;
      };
      const intent = () => ({ owner: server.name!, revision: snapshot().revision });
      await until(
        () =>
          snapshot().bluetooth.status.kind === "ready" &&
          snapshot().revision === controls.snapshot().revision,
        "known backend and public status observations settle",
      );
      stage = "start discovery";
      await observer.startBluetoothDiscovery({ ...intent(), adapterId: pairing().adapters[0]!.id });
      const leaseId = pairing().lease!.id;
      stage = "begin Pair";
      await observer.beginBluetoothPair({
        ...intent(),
        leaseId,
        deviceId: pairing().devices[0]!.id,
      });
      await until(() => pairing().prompt?.kind === "pin-entry", "public PIN entry prompt");
      const p = pairing().prompt!;
      const pin = "C54-Bridge-PIN";
      stage = "reply PIN";
      await observer.respondBluetoothInput({
        ...intent(),
        leaseId,
        attemptId: p.attemptId,
        promptId: p.id,
        value: pin,
      });
      await until(
        () => pairing().attempt.kind === "complete",
        "successful local Pair and Paired readback",
      );
      await until(() => {
        const s = snapshot().bluetooth.status;
        return s.kind === "ready" && s.devices.length === 1;
      }, "known real adapter observes paired device");
      assert.equal(c.fixture.inputReply?.signature, "s");
      assert.deepEqual(c.fixture.inputReply?.body, [pin]);
      assert.equal(device().trusted, false);
      assert.equal(device().connected, false);
      assert.equal(
        c.fixture.writes.filter((write) => write === "Set").length,
        0,
        "Pair never enables trust",
      );
      assert.equal(
        c.fixture.writes.includes("Connect"),
        false,
        "Pair never connects automatically",
      );
      for (const state of observed)
        assert(
          !state.includes(JSON.stringify(pin)),
          "entry remains absent from actual public wire snapshots",
        );
      await until(
        () => snapshot().revision === controls.snapshot().revision,
        "paired observation reaches public client",
      );
      stage = "request Trust";
      await observer.requestBluetoothTrust({ ...intent(), id: device().id, trusted: true });
      const trust = snapshot().bluetooth.trust;
      assert(trust?.kind === "ready" && trust.operation.kind === "confirmation");
      const challengeId = trust.operation.challengeId;
      assert.equal(device().trusted, false);
      assert.equal(
        c.fixture.writes.filter((write) => write === "Set").length,
        0,
        "requesting trust does not dispatch Set",
      );
      c.fixture.holdTrust = true;
      stage = "confirm Trust";
      const confirm = observer.confirmBluetoothTrust({ ...intent(), challengeId });
      await until(() => {
        const trust = snapshot().bluetooth.trust;
        return (
          c.fixture.heldTrust !== null &&
          trust?.kind === "ready" &&
          trust.operation.kind === "pending"
        );
      }, "explicit trust confirmation observed pending at private BlueZ");
      assert.equal(device().trusted, false, "pending Set never fabricates trust");
      const pending = snapshot().bluetooth.trust;
      assert(pending?.kind === "ready" && pending.operation.kind === "pending");
      await assert.rejects(
        observer.setBluetoothConnected({ ...intent(), id: device().id, connected: true }),
      );
      c.fixture.heldTrust!();
      c.fixture.heldTrust = null;
      await confirm;
      await until(() => device().trusted, "observed Trusted readback");
      assert.equal(c.fixture.writes.filter((write) => write === "Set").length, 1);
      assert.equal(device().connected, false);
      await until(
        () => snapshot().revision === controls.snapshot().revision,
        "Trusted observation reaches public client",
      );
      stage = "manual Connect";
      await observer.setBluetoothConnected({ ...intent(), id: device().id, connected: true });
      await until(() => device().connected, "observed Connected readback");
      assert.equal(c.fixture.writes.filter((write) => write === "Connect").length, 1);
      stage = "stop owned discovery";
      await observer.stopBluetoothDiscovery({ ...intent(), leaseId });
      assert.equal(pairing().lease, null);
    } catch (error) {
      throw new Error(
        "Private Bluetooth bridge " +
          stage +
          ": " +
          (error instanceof Error ? error.message : "failed"),
      );
    } finally {
      await observer.dispose();
      await controls.dispose();
      server.close();
      await c.close();
    }
  });
  console.log(
    JSON.stringify({
      suite: "owned Bluetooth pairing private bus",
      cases,
      automaticTrustedWrites: 0,
      explicitFixtureTrustedWrites: 1,
      defaultAgentRequests: 0,
      realDeviceOperations: 0,
    }),
  );
} finally {
  for (const backend of backends) await backend.dispose();
  for (const connection of connections) connection.close();
  daemon.kill("SIGTERM");
  await daemonExit;
  await fs.rm(directory, { recursive: true, force: true });
  if (stderr.trim()) console.error(stderr.trim());
}

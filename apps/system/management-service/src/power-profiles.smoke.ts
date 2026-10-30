/**
 * Power profiles end to end on a private dbus-daemon: a fake power-profiles-daemon, the
 * org.moire.Power1 export and the Settings client (observePowerSettings) with an in-memory store.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DbusRemoteError, SessionBus, variant, type DbusVariant } from "@moire/dbus";
import { DEFAULT_POWER_SETTINGS, applyPowerPatch, type PowerSettings } from "@moire/prefs";
import { SETTINGS_SERVICE_BUS } from "@moire/system-management/settings-service";
import {
  observePowerSettings,
  type PowerSettingsClient,
  type PowerSettingsStore,
} from "@moire/system-management/power-settings";
import {
  PPD_BUS,
  PPD_INTERFACE,
  PPD_PATH,
  attachPowerControls,
  createPowerProfilesAdapter,
  type PowerProfilesAdapter,
} from "./power-profiles";

const PROPS = "org.freedesktop.DBus.Properties";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 4000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("Timeout: " + label);
    await delay(5);
  }
}

class PpdFixture {
  profiles = ["power-saver", "balanced"];
  active = "balanced";
  degraded = "";
  deny = false;
  readonly sets: string[] = [];
  constructor(readonly bus: SessionBus) {
    bus.exportObject(PPD_PATH, {
      name: PROPS,
      methods: {
        GetAll: {
          inSignature: "s",
          outSignature: "a{sv}",
          handler: ({ body }) => {
            assert.equal(body[0], PPD_INTERFACE);
            const values: Record<string, DbusVariant> = {
              Profiles: variant(
                "aa{sv}",
                this.profiles.map((profile) => ({
                  Profile: variant("s", profile),
                  Driver: variant("s", "placeholder"),
                })),
              ),
              ActiveProfile: variant("s", this.active),
              PerformanceDegraded: variant("s", this.degraded),
              Actions: variant("as", []),
            };
            return { body: [values] };
          },
        },
        Set: {
          inSignature: "ssv",
          outSignature: "",
          handler: ({ body }) => {
            assert.equal(body[0], PPD_INTERFACE);
            assert.equal(body[1], "ActiveProfile");
            const value = (body[2] as DbusVariant).value as string;
            this.sets.push(value);
            if (this.deny)
              throw new DbusRemoteError(
                "org.freedesktop.DBus.Error.AccessDenied",
                "fixture polkit detail must not escape",
              );
            if (!this.profiles.includes(value))
              throw new DbusRemoteError("org.freedesktop.DBus.Error.InvalidArgs", "no");
            this.active = value;
            this.changed();
            return {};
          },
        },
      },
    });
  }
  changed() {
    this.bus.emitSignal({
      path: PPD_PATH,
      interface: PROPS,
      member: "PropertiesChanged",
      signature: "sa{sv}as",
      body: [PPD_INTERFACE, { ActiveProfile: variant("s", this.active) }, []],
    });
  }
}

function memoryStore(initial: PowerSettings): PowerSettingsStore & { value: PowerSettings } {
  const store = {
    value: initial,
    load: () => store.value,
    update(patch: Parameters<PowerSettingsStore["update"]>[0]) {
      store.value = applyPowerPatch(store.value, patch);
      return store.value;
    },
  };
  return store;
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-ppd-smoke-"));
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
let address = "";
let daemonError: Error | null = null;
daemon.stdout.on("data", (chunk) => {
  address += chunk.toString();
});
daemon.once("error", (error) => {
  daemonError = error;
});
const buses: SessionBus[] = [];
const bus = async () => {
  const b = await SessionBus.connect(address.trim());
  buses.push(b);
  return b;
};
let adapter: PowerProfilesAdapter | null = null;
let client: PowerSettingsClient | null = null;
let controls: { dispose(): Promise<void> } | null = null;
let cases = 0;
try {
  await until(() => address.includes("\n") || daemonError !== null, "private daemon");
  if (daemonError) throw daemonError;

  // A failing system bus is unavailable, not an error.
  const broken = await createPowerProfilesAdapter({
    connect: async () => {
      throw new Error("no system bus");
    },
  });
  assert.equal(broken.status.kind, "unavailable");
  await broken.dispose();
  cases++;

  // Service with no daemon yet; the preference waits for it.
  const store = memoryStore(
    applyPowerPatch(DEFAULT_POWER_SETTINGS, { powerProfile: "power-saver" }),
  );
  const saved: string[] = [];
  const errors: unknown[] = [];
  adapter = await createPowerProfilesAdapter({ connect: bus, callTimeoutMs: 1000 });
  assert.equal(adapter.status.kind, "unavailable");
  const service = await bus();
  controls = attachPowerControls(service, {
    adapter,
    preferred: () => store.value.powerProfile,
    savePreferred: (profile) => {
      saved.push(profile);
      store.update({ powerProfile: profile });
    },
    onError: (error) => errors.push(error),
  });
  assert.equal(await service.requestName(SETTINGS_SERVICE_BUS, 4), 1);
  client = await observePowerSettings(await bus(), { store, readTimeoutMs: 1000 });
  const c = client;
  const profiles = () => c.state.profiles;
  const ready = () => {
    const state = profiles();
    return state.kind === "ready" && state.status.kind === "ready" ? state.status : null;
  };
  await until(() => profiles().kind === "ready", "service ready");
  const first = profiles();
  assert.equal(first.kind === "ready" && first.status.kind, "unavailable");
  assert.notEqual(c.state.idle.kind, "ready", "no compositor on this bus: idle is not ready");
  assert.equal(c.state.settings.powerProfile, "power-saver");
  cases++;

  // The daemon appears: the user's saved choice is applied once, without re-saving it.
  const ppdBus = await bus();
  const ppd = new PpdFixture(ppdBus);
  assert.equal(await ppdBus.requestName(PPD_BUS, 4), 1);
  await until(() => ready()?.active === "power-saver", "preferred applied");
  assert.deepEqual(ppd.sets, ["power-saver"]);
  assert.deepEqual(saved, []);
  assert.deepEqual(ready()?.profiles, ["power-saver", "balanced"]);
  assert.equal(ready()?.degraded, null);
  cases++;

  // Settings switches profile: applied, saved, reflected.
  assert.deepEqual(await c.setPowerProfile("balanced"), { ok: true, value: undefined });
  await until(() => ready()?.active === "balanced", "balanced");
  assert.deepEqual(saved, ["balanced"]);
  assert.equal(c.state.settings.powerProfile, "balanced");
  cases++;

  // Refusals come back as codes, with the daemon's text kept out.
  const missing = await c.setPowerProfile("performance");
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.code, "invalid");
  const bogus = await c.setPowerProfile("turbo" as never);
  assert.equal(!bogus.ok && bogus.code, "invalid");
  ppd.deny = true;
  const denied = await c.setPowerProfile("power-saver");
  assert.equal(!denied.ok && denied.code, "permission");
  assert.ok(!denied.ok && !denied.message.includes("fixture"));
  assert.equal(ready()?.active, "balanced");
  assert.deepEqual(saved, ["balanced"], "a refused change is not saved");
  ppd.deny = false;
  cases++;

  // Degraded performance and a new profile show up on the daemon's PropertiesChanged.
  ppd.profiles = ["power-saver", "balanced", "performance"];
  ppd.degraded = "lap-detected";
  ppd.changed();
  await until(() => ready()?.degraded === "lap-detected", "degraded");
  assert.deepEqual(ready()?.profiles, ["power-saver", "balanced", "performance"]);
  cases++;

  // The daemon leaving makes power modes unavailable again; returning re-applies nothing new.
  ppdBus.close();
  await until(() => {
    const state = profiles();
    return state.kind === "ready" && state.status.kind === "unavailable";
  }, "daemon gone");
  const failed = await c.setPowerProfile("balanced");
  assert.equal(!failed.ok && failed.code, "unavailable");
  assert.equal(errors.length, 0);
  cases++;

  // The fake client mirrors the live one for UI smokes.
  const { createFakePowerSettingsClient } = await import("@moire/system-management/power-settings");
  const fake = createFakePowerSettingsClient();
  const seen: string[] = [];
  fake.subscribe((state) => seen.push(state.settings.lidCloseAction));
  await fake.setLidCloseAction("nothing");
  await fake.setScreenOffAfter("battery", 900);
  assert.equal(fake.state.settings.screenOffAfterSeconds.battery, 900);
  assert.equal(fake.state.settings.screenOffAfterSeconds.ac, 600);
  assert.deepEqual(seen, ["suspend", "nothing", "nothing"]);
  assert.deepEqual(await fake.setPowerProfile("performance"), { ok: true, value: undefined });
  assert.equal(fake.state.settings.powerProfile, "performance");
  fake.failNext("permission");
  assert.equal(((await fake.setPowerProfile("balanced")) as { code?: string }).code, "permission");
  fake.setServiceState("idle", "unavailable");
  assert.equal(fake.state.idle.kind, "unavailable");
  cases++;
} finally {
  await client?.dispose().catch(() => {});
  await controls?.dispose().catch(() => {});
  for (const b of buses) b.close();
  daemon.kill("SIGTERM");
  await fs.rm(directory, { recursive: true, force: true });
}
console.log(`[power-profiles] ${cases} cases PASS`);

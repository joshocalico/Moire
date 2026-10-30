/**
 * The compositor's power session against a fake logind and UPower on a private dbus-daemon:
 * idle hints, idle suspend, power and sleep keys, the lid, PrepareForSleep and Lock signals,
 * org.moire.Idle1 read through the Settings client, app inhibitors and the sleep-blocking
 * allowlist (who may hold off a lid-close suspend), logind inhibitors (the descriptor itself
 * needs Linux; see packages/sys/test/dbus-fds.native.smoke.ts) and the ALSA playback probe.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DbusRemoteError, SessionBus, variant, type DbusVariant } from "@moire/dbus";
import { FakeIdleClock, IdleInhibitorRegistry, OutputPowerControl } from "@moire/core";
import { DEFAULT_POWER_SETTINGS, applyPowerPatch, type PowerSettings } from "@moire/prefs";
import { observePowerSettings, type IdleStatus } from "@moire/system-management/power-settings";
import { audioPlaybackActive } from "./audio-activity";
import {
  LOGIND_BUS,
  connectLogindPower,
  type InhibitorHold,
  type InhibitorOptions,
  type LogindPower,
} from "./logind-power";
import { PowerSession } from "./power-session";
import {
  LaunchRecords,
  PORTAL_BACKEND_NAME,
  callerIdentifier,
  type ProcessInspector,
} from "./sleep-blockers";
import { EventEmitter } from "node:events";

const MANAGER_PATH = "/org/freedesktop/login1";
const MANAGER = "org.freedesktop.login1.Manager";
const SESSION_PATH = "/org/freedesktop/login1/session/_31";
const SESSION = "org.freedesktop.login1.Session";
const UPOWER = "org.freedesktop.UPower";
const UPOWER_PATH = "/org/freedesktop/UPower";
const PROPS = "org.freedesktop.DBus.Properties";
const MIN = 60_000;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 4000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("Timeout: " + label);
    await delay(5);
  }
}

class LogindFixture {
  readonly calls: string[] = [];
  denyPowerOff = true;
  lidClosed = false;
  constructor(readonly bus: SessionBus) {
    bus.exportObject(MANAGER_PATH, {
      name: MANAGER,
      methods: {
        GetSessionByPID: {
          inSignature: "u",
          outSignature: "o",
          handler: ({ body }) => {
            assert.equal(body[0], 4242);
            return { body: [SESSION_PATH] };
          },
        },
        CanSuspend: { inSignature: "", outSignature: "s", handler: () => ({ body: ["yes"] }) },
        CanPowerOff: {
          inSignature: "",
          outSignature: "s",
          handler: () => ({ body: ["challenge"] }),
        },
        CanReboot: { inSignature: "", outSignature: "s", handler: () => ({ body: ["yes"] }) },
        Reboot: {
          inSignature: "b",
          outSignature: "",
          handler: ({ body }) => {
            this.calls.push(`Reboot(${body[0]})`);
            return {};
          },
        },
        Suspend: {
          inSignature: "b",
          outSignature: "",
          handler: ({ body }) => {
            this.calls.push(`Suspend(${body[0]})`);
            return {};
          },
        },
        PowerOff: {
          inSignature: "b",
          outSignature: "",
          handler: ({ body }) => {
            this.calls.push(`PowerOff(${body[0]})`);
            if (this.denyPowerOff)
              throw new DbusRemoteError(
                "org.freedesktop.DBus.Error.InteractiveAuthorizationRequired",
                "Interactive authentication required.",
              );
            return {};
          },
        },
      },
    });
    bus.exportObject(SESSION_PATH, {
      name: SESSION,
      methods: {
        SetIdleHint: {
          inSignature: "b",
          outSignature: "",
          handler: ({ body }) => {
            this.calls.push(`SetIdleHint(${body[0]})`);
            return {};
          },
        },
        SetLockedHint: {
          inSignature: "b",
          outSignature: "",
          handler: ({ body }) => {
            this.calls.push(`SetLockedHint(${body[0]})`);
            return {};
          },
        },
      },
    });
  }
  sleep(sleeping: boolean) {
    this.bus.emitSignal({
      path: MANAGER_PATH,
      interface: MANAGER,
      member: "PrepareForSleep",
      signature: "b",
      body: [sleeping],
    });
  }
  lock() {
    this.bus.emitSignal({ path: SESSION_PATH, interface: SESSION, member: "Lock" });
  }
}

class UPowerFixture {
  lidClosed = false;
  constructor(readonly bus: SessionBus) {
    bus.exportObject(UPOWER_PATH, {
      name: PROPS,
      methods: {
        GetAll: {
          inSignature: "s",
          outSignature: "a{sv}",
          handler: () => {
            const values: Record<string, DbusVariant> = {
              OnBattery: variant("b", true),
              LidIsPresent: variant("b", true),
              LidIsClosed: variant("b", this.lidClosed),
            };
            return { body: [values] };
          },
        },
      },
    });
  }
  setLid(closed: boolean) {
    this.lidClosed = closed;
    this.bus.emitSignal({
      path: UPOWER_PATH,
      interface: PROPS,
      member: "PropertiesChanged",
      signature: "sa{sv}as",
      body: [UPOWER, { LidIsClosed: variant("b", closed) }, []],
    });
  }
}

function fakeServer(clock: FakeIdleClock) {
  const listeners = new Set<() => void>();
  let keyHandler: ((code: number, value: number) => boolean) | null = null;
  const panel = { on: true };
  const outputs: unknown[] = [panel];
  const inhibitors = new IdleInhibitorRegistry<object>();
  const server = {
    reasons: [] as string[],
    outputs,
    panel,
    onUserActivity(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSystemKeyHandler(handler: typeof keyHandler) {
      keyHandler = handler;
    },
    idleInhibitorReasons: () => server.reasons,
    idleInhibitors: inhibitors,
    outputPower: new OutputPowerControl<{ on: boolean }>({
      outputs: () => [panel],
      setPower: (output, on) => {
        output.on = on;
        return true;
      },
      settled: () => true,
      now: () => clock.now(),
      wait: async () => {},
      repaint: () => {},
    }),
    getDisplayOutputs: () => outputs,
    /** What onKey does: activity first, then the power handler. */
    key(code: number, value: number): boolean {
      for (const listener of listeners) listener();
      return keyHandler?.(code, value) ?? false;
    },
  };
  return server;
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-power-session-"));
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
let session: PowerSession | null = null;
let cases = 0;
try {
  await until(() => address.includes("\n") || daemonError !== null, "private daemon");
  if (daemonError) throw daemonError;

  // Outside any logind: connect still succeeds, with nothing allowed and no session.
  {
    const lonely = await connectLogindPower({
      connect: bus,
      pid: 4242,
      events: {},
      timeoutMs: 500,
    });
    assert.equal(lonely.session, null);
    assert.equal(lonely.canSuspend, false);
    assert.equal(lonely.lid.present, false);
    await assert.rejects(lonely.setIdleHint(true));
    await lonely.dispose();
    cases++;
  }

  const logindBus = await bus();
  const logind = new LogindFixture(logindBus);
  assert.equal(await logindBus.requestName(LOGIND_BUS, 4), 1);
  const upowerBus = await bus();
  const upower = new UPowerFixture(upowerBus);
  assert.equal(await upowerBus.requestName(UPOWER, 4), 1);

  const clock = new FakeIdleClock();
  const server = fakeServer(clock);
  let settings: PowerSettings = applyPowerPatch(DEFAULT_POWER_SETTINGS, {
    powerButtonAction: "suspend",
  });
  let notifySettings = () => {};
  const holds: (InhibitorOptions & { hold: InhibitorHold })[] = [];
  let grant = true;
  let asked = 0;
  // Every connection here is this process, so the smoke says where in the process tree the
  // "caller" sits: under the launched terminal, or on its own with (or without) an executable.
  const TERMINAL_PID = 7001;
  const launches = new LaunchRecords();
  launches.track(Object.assign(new EventEmitter(), { pid: TERMINAL_PID }), "moire-terminal");
  const caller: { parent: number | null; executable: string | null } = {
    parent: null,
    executable: null,
  };
  const inspector: ProcessInspector = {
    parent: (pid) => (pid === process.pid ? caller.parent : null),
    executable: (pid) => (pid === process.pid ? caller.executable : null),
  };
  const notices: string[] = [];
  let wallClock = 1_000_000;
  session = new PowerSession({
    server,
    powerSource: "battery",
    settings: {
      load: () => settings,
      watch(listener) {
        notifySettings = listener;
        return () => {};
      },
    },
    timers: clock,
    holdInhibitor: (options) => {
      let held = grant;
      const hold: InhibitorHold = {
        ready: Promise.resolve(grant),
        get held() {
          return held;
        },
        release() {
          held = false;
        },
      };
      holds.push({ ...options, hold });
      return hold;
    },
    audioActive: () => false,
    askPowerAction: () => {
      asked++;
      return true;
    },
    identifyCaller: callerIdentifier({
      launches,
      inspector,
      displayName: (command) => (command === "moire-terminal" ? "Terminal" : null),
      // The daemon reads the peer's pid from the socket on Linux; macOS's cannot.
      ...(process.platform === "linux" ? {} : { peerPid: async () => process.pid }),
      timeoutMs: 1000,
    }),
    notify: (summary, body) => notices.push(`${summary}: ${body}`),
    now: () => wallClock,
    log: () => {},
  });
  const s = session;
  const change = (patch: Parameters<typeof applyPowerPatch>[1]) => {
    settings = applyPowerPatch(settings, patch);
    notifySettings();
  };

  // logind: session, capabilities, lid, and the handling inhibitor.
  const power: LogindPower = await connectLogindPower({
    connect: bus,
    pid: 4242,
    events: s.logindEvents,
    timeoutMs: 1000,
  });
  assert.equal(power.session, SESSION_PATH);
  assert.equal(power.canSuspend, true);
  assert.equal(power.canPowerOff, false, '"challenge" is not allowed without asking');
  assert.equal(power.canReboot, true);
  assert.deepEqual(power.lid, { present: true, closed: false });
  s.setLogind(power);
  assert.equal(holds.length, 1);
  assert.equal(holds[0]!.what, "handle-power-key:handle-suspend-key:handle-lid-switch");
  assert.equal(holds[0]!.mode, "block");
  await delay(0);
  assert.equal(s.status().capabilities.lidAction, true);
  assert.equal(s.status().capabilities.lock, false);
  assert.equal(
    holds.some((hold) => hold.what === "sleep"),
    false,
    "no sleep delay without a lock screen",
  );
  cases++;

  // Idle1 through the Settings client.
  const compositorBus = await bus();
  s.exportStatus(compositorBus);
  assert.equal(await compositorBus.requestName("org.moire.Display1", 4), 1);
  const client = await observePowerSettings(await bus(), {
    store: { load: () => settings, update: () => settings },
    readTimeoutMs: 1000,
  });
  const idle = (): IdleStatus | null =>
    client.state.idle.kind === "ready" ? client.state.idle.status : null;
  await until(() => idle() !== null, "idle status");
  assert.deepEqual(idle()?.capabilities, {
    screenOff: null,
    lock: false,
    suspend: true,
    powerOff: false,
    reboot: true,
    lidPresent: true,
    lidAction: true,
    powerButton: true,
  });
  assert.equal(idle()?.powerSource, "battery");
  assert.deepEqual(idle()?.sleepBlocking, { requests: [], lidHeld: false });
  cases++;

  const idleCall = (from: SessionBus, member: string, signature = "", body: unknown[] = []) =>
    from.call({
      destination: "org.moire.Display1",
      path: "/org/moire/Idle1",
      interface: "org.moire.Idle1",
      member,
      signature,
      body,
    });
  const noSleepBlock = () =>
    assert.equal(
      holds.some((hold) => hold.what.split(":").includes("sleep") && hold.mode === "block"),
      false,
      "no block-mode logind sleep inhibitor is ever taken for an app",
    );

  // App inhibitors (the portal backend's Inhibit): idle holds the display awake, suspend holds
  // off idle suspend, only the caller can release, and a caller that leaves releases.
  {
    const appBus = await bus();
    const cookie = (await idleCall(appBus, "Inhibit", "sus", ["org.example.Player", 12, "Video"]))
      .body?.[0] as number;
    await until(
      () => idle()?.inhibitors.display.includes("org.example.Player: Video") === true,
      "app idle inhibitor published",
    );
    assert.deepEqual(idle()?.inhibitors.display, ["org.example.Player: Video"]);
    noSleepBlock();
    // Nothing identifies this caller, so it is listed by the name it gave and cannot be allowed.
    assert.deepEqual(idle()?.sleepBlocking.requests, [
      { id: null, name: "org.example.Player", x11: false, allowed: false, holding: true },
    ]);
    clock.advance(120 * MIN);
    assert.equal(s.status().phase, "active", "an inhibited session does not dim or suspend");
    assert.deepEqual((await idleCall(appBus, "ListInhibitors")).body?.[0], [
      ["org.example.Player", 12, "Video"],
    ]);
    await assert.rejects(idleCall(compositorBus, "Uninhibit", "u", [cookie]));
    await assert.rejects(idleCall(appBus, "Inhibit", "sus", ["x", 0, ""]));
    await assert.rejects(idleCall(appBus, "Inhibit", "sus", ["x", 16, ""]));
    const logout = (await idleCall(appBus, "Inhibit", "sus", ["org.example.Editor", 1, "Unsaved"]))
      .body?.[0] as number;
    assert.deepEqual(idle()?.inhibitors.display, ["org.example.Player: Video"]);
    await idleCall(appBus, "Uninhibit", "u", [cookie]);
    await until(() => idle()?.inhibitors.display.length === 0, "app inhibitor released");
    assert.equal(idle()?.sleepBlocking.requests[0]?.holding, false, "remembered as having asked");
    assert.notEqual(logout, cookie);
    await idleCall(appBus, "Inhibit", "sus", ["org.example.Player", 8, "Again"]);
    await until(() => idle()?.inhibitors.display.length === 1, "second inhibitor");
    appBus.close();
    await until(() => idle()?.inhibitors.display.length === 0, "a caller that leaves releases");
    assert.equal(s.appInhibitorList().length, 0);
    server.key(30, 1);
    cases++;
  }

  // Idle: logind's idle hint follows dim/off, the screen goes dark, suspend at 30 minutes.
  clock.advance(2 * MIN);
  await until(() => logind.calls.includes("SetIdleHint(true)"), "idle hint");
  await until(() => idle()?.state === "dimmed", "dimmed published");
  clock.advance(3 * MIN);
  clock.advance(1000);
  await until(() => !server.panel.on, "DPMS off");
  await until(() => idle()?.state === "off" && idle()?.capabilities.screenOff === true, "off");
  // The power key that wakes a dark screen only wakes it.
  assert.equal(server.key(116, 1), true);
  assert.equal(server.key(116, 0), true);
  assert.equal(server.panel.on, true);
  await until(() => logind.calls.includes("SetIdleHint(false)"), "active hint");
  assert.equal(logind.calls.includes("Suspend(false)"), false);
  clock.advance(30 * MIN);
  await until(() => logind.calls.includes("Suspend(false)"), "idle suspend");
  cases++;

  // logind sleeping and waking: waking counts as activity and wakes the screen.
  logind.sleep(true);
  logind.sleep(false);
  await until(() => s.status().phase === "active", "resumed");
  assert.equal(server.panel.on, true);
  // logind's Lock signal without a lock screen does nothing (and says so in capabilities).
  logind.lock();
  await delay(20);
  assert.equal(s.status().locked, false);
  cases++;

  // Power key actions per pref; refusals are reported, not swallowed.
  const suspends = () => logind.calls.filter((call) => call === "Suspend(false)").length;
  const before = suspends();
  server.key(116, 1);
  server.key(116, 0);
  await until(() => suspends() === before + 1, "power key suspend");
  server.key(142, 1);
  await until(() => suspends() === before + 2, "sleep key suspend");
  change({ powerButtonAction: "power-off" });
  server.key(116, 1);
  await until(() => logind.calls.includes("PowerOff(false)"), "power off attempted");
  await until(() => idle()?.lastError?.startsWith("power-off:") === true, "error published");
  // Restart on request (the lock screen and Quick Settings), never interactive.
  s.requestPowerAction("reboot", "quick settings");
  await until(() => logind.calls.includes("Reboot(false)"), "reboot requested");
  change({ powerButtonAction: "ask" });
  server.key(116, 1);
  assert.equal(asked, 1);
  change({ powerButtonAction: "nothing" });
  assert.equal(server.key(116, 1), true, "consumed even when it does nothing");
  assert.equal(server.key(30, 1), false, "other keys are not the power handler's");
  cases++;

  // Sleep blocking. An app may always ask; the request holds off a lid-close suspend only for
  // an app on the user's allowlist, named by where its process sits and never by what it says.
  {
    const TERMINAL = { id: "launch:moire-terminal", name: "Terminal", x11: false };
    const requests = () => idle()?.sleepBlocking.requests ?? [];
    const request = (id: string | null) => requests().find((entry) => entry.id === id);
    const setLid = async (closed: boolean) => {
      upower.setLid(closed);
      await until(() => power.lid.closed === closed, closed ? "lid closed" : "lid open");
    };
    const stillAwake = async (count: number, why: string) => {
      await delay(50);
      assert.equal(suspends(), count, why);
    };
    const agentBus = await bus();
    const ask = async (from: SessionBus, appId: string) =>
      (await idleCall(from, "Inhibit", "sus", [appId, 4, "Long build"])).body?.[0] as number;

    // Not allowed (the default): the request is accepted and listed, and the lid still sleeps.
    caller.parent = TERMINAL_PID;
    let count = suspends();
    let cookie = await ask(agentBus, "whatever it says");
    await until(() => request(TERMINAL.id)?.holding === true, "request listed");
    assert.deepEqual(request(TERMINAL.id), { ...TERMINAL, allowed: false, holding: true });
    assert.deepEqual(idle()?.inhibitors.suspend, [], "read only when an idle suspend is due");
    await setLid(true);
    await until(() => suspends() === count + 1, "lid suspend despite the request");
    assert.equal(idle()?.sleepBlocking.lidHeld, false);
    await setLid(false);
    assert.deepEqual(notices, [], "nothing was kept awake, nothing to report");

    // Allowed: the lid no longer suspends while the request is held.
    change({ sleepBlockers: [TERMINAL] });
    await until(() => request(TERMINAL.id)?.allowed === true, "grant published");
    count = suspends();
    await setLid(true);
    await until(() => idle()?.sleepBlocking.lidHeld === true, "lid held published");
    await stillAwake(count, "an allowed app keeps the computer awake under a closed lid");
    noSleepBlock();
    // The person outranks the app: Suspend from the shell sleeps anyway.
    s.requestPowerAction("suspend", "quick settings");
    await until(() => suspends() === count + 1, "explicit suspend");
    // When the app lets go, the held-off suspend happens.
    wallClock += 12 * MIN;
    await idleCall(agentBus, "Uninhibit", "u", [cookie]);
    await until(() => suspends() === count + 2, "suspend once nothing keeps it awake");
    await until(() => idle()?.sleepBlocking.lidHeld === false, "hold over");
    wallClock += 30 * MIN;
    await setLid(false);
    assert.equal(notices.length, 1);
    assert.match(
      notices[0]!,
      /^Kept awake with the lid closed: Terminal kept this computer awake for 12 minutes\./,
    );

    // A critically low battery outranks the app, held or about to be.
    cookie = await ask(agentBus, "");
    count = suspends();
    await setLid(true);
    await until(() => idle()?.sleepBlocking.lidHeld === true, "held again");
    await stillAwake(count, "held on a healthy battery");
    s.setBatteryCritical(true);
    await until(() => suspends() === count + 1, "battery critical ends the hold");
    await setLid(false);
    await setLid(true);
    await until(() => suspends() === count + 2, "no hold starts on a critical battery");
    await setLid(false);
    s.setBatteryCritical(false);
    assert.equal(notices.length, 2);

    // Taking the grant back while the lid is held ends the hold.
    count = suspends();
    await setLid(true);
    await stillAwake(count, "held");
    change({ sleepBlockers: [] });
    await until(() => suspends() === count + 1, "revoked under a closed lid");
    await setLid(false);
    await idleCall(agentBus, "Uninhibit", "u", [cookie]);

    // A different program cannot borrow the grant by naming the allowed app.
    change({ sleepBlockers: [TERMINAL] });
    caller.parent = null;
    caller.executable = "/usr/local/bin/agent";
    const impostor = await ask(agentBus, "launch:moire-terminal");
    await until(() => request("exe:/usr/local/bin/agent")?.holding === true, "impostor listed");
    assert.equal(request("exe:/usr/local/bin/agent")?.allowed, false);
    assert.equal(request("exe:/usr/local/bin/agent")?.name, "agent");
    count = suspends();
    await setLid(true);
    await until(() => suspends() === count + 1, "the name it gives buys nothing");
    await setLid(false);
    await idleCall(agentBus, "Uninhibit", "u", [impostor]);

    // The portal backend (the owner of its bus name) forwards the frontend's app id; that id is
    // the identity, and a request the frontend could not attribute has none.
    const portalBus = await bus();
    assert.equal(await portalBus.requestName(PORTAL_BACKEND_NAME, 4), 1);
    const flat = await ask(portalBus, "org.example.Flat");
    const anonymous = await ask(portalBus, "");
    await until(() => request("portal:org.example.Flat")?.holding === true, "portal app listed");
    assert.equal(request(null)?.name, "An app");
    count = suspends();
    await setLid(true);
    await until(() => suspends() === count + 1, "a portal app is off the list by default");
    await setLid(false);
    change({
      sleepBlockers: [{ id: "portal:org.example.Flat", name: "org.example.Flat", x11: false }],
    });
    await until(() => request("portal:org.example.Flat")?.allowed === true, "portal app allowed");
    await setLid(true);
    await stillAwake(count + 1, "an allowed portal app keeps it awake");
    // Lid action "Shut down" is not a sleep, so nothing holds it off.
    await setLid(false);
    change({ lidCloseAction: "power-off" });
    const offs = logind.calls.filter((call) => call === "PowerOff(false)").length;
    await setLid(true);
    await until(
      () => logind.calls.filter((call) => call === "PowerOff(false)").length === offs + 1,
      "lid power off",
    );
    await setLid(false);
    change({ lidCloseAction: "suspend" });
    await idleCall(portalBus, "Uninhibit", "u", [flat]);
    await idleCall(portalBus, "Uninhibit", "u", [anonymous]);

    // Idle suspend: any app's request holds it off (allowed or not), until the battery is critical.
    change({ sleepBlockers: [] });
    caller.executable = "/usr/local/bin/agent";
    await ask(agentBus, "");
    server.key(30, 1);
    count = suspends();
    clock.advance(45 * MIN);
    await stillAwake(count, "a suspend inhibitor still stops the idle suspend");
    assert.deepEqual(s.status().inhibitors.suspend, ["agent: Long build"]);
    s.setBatteryCritical(true);
    clock.advance(2 * MIN);
    await until(() => suspends() === count + 1, "idle suspend on a critical battery");
    s.setBatteryCritical(false);
    agentBus.close();
    portalBus.close();
    await until(() => requests().every((entry) => !entry.holding), "callers gone");
    assert.equal(s.appInhibitorList().length, 0);
    server.key(30, 1);
    await until(() => s.status().phase === "active", "awake again");
    caller.executable = null;
    notices.length = 0;
    cases++;
  }

  // The lid: closing suspends while Moire holds the inhibitor, unless docked or released.
  const lidBefore = suspends();
  upower.setLid(true);
  await until(() => suspends() === lidBefore + 1, "lid suspend");
  upower.setLid(false);
  await until(() => !power.lid.closed, "lid open");
  server.outputs.push({ on: true });
  upower.setLid(true);
  await delay(50);
  assert.equal(suspends(), lidBefore + 1, "docked: an external display keeps the session up");
  server.outputs.pop();
  upower.setLid(false);
  await until(() => !power.lid.closed, "lid open again");
  holds[0]!.hold.release();
  upower.setLid(true);
  await delay(50);
  assert.equal(suspends(), lidBefore + 1, "without the inhibitor logind handles the lid");
  change({ lidCloseAction: "nothing" });
  cases++;

  // A refused handling inhibitor leaves the lid with logind and says so.
  grant = false;
  s.setLogind(power);
  await delay(0);
  assert.equal(s.status().capabilities.lidAction, false);
  cases++;

  // Settings changes reach the policy live: screen off "never" on battery keeps it lit.
  change({
    screenOffAfterSeconds: { battery: null },
    dimAfterSeconds: null,
    suspendAfterSeconds: { battery: null },
  });
  server.key(30, 1);
  clock.advance(120 * MIN);
  assert.equal(s.status().phase, "active");
  cases++;

  // Dispose leaves the screen lit and undimmed.
  change({ dimAfterSeconds: 30 });
  clock.advance(MIN);
  assert.ok(server.outputPower.dimLevel() > 0);
  await client.dispose();
  await s.dispose();
  session = null;
  assert.equal(server.panel.on, true);
  assert.equal(server.outputPower.dimLevel(), 0);
  cases++;

  // logind inhibitors over D-Bus. On Linux the fake logind hands over a real descriptor and
  // release closes it; elsewhere the connection cannot carry one and the hold reports refusal.
  {
    const linux = process.platform === "linux";
    const transport = linux ? (await import("@moire/sys/dbus-fds")).dbusUnixFdTransport : undefined;
    const connect = async () => {
      const b = await SessionBus.connect(address.trim(), transport ? { unixFds: transport } : {});
      buses.push(b);
      return b;
    };
    const inhibitFile = path.join(directory, "inhibit");
    await fs.writeFile(inhibitFile, "");
    const asked: unknown[][] = [];
    let refuse = false;
    const giver = await connect();
    giver.exportObject(MANAGER_PATH, {
      name: MANAGER,
      methods: {
        Inhibit: {
          inSignature: "ssss",
          outSignature: "h",
          handler: async ({ body }) => {
            asked.push(body);
            if (refuse)
              throw new DbusRemoteError("org.freedesktop.DBus.Error.AccessDenied", "denied");
            return { body: [0], fds: [(await fs.open(inhibitFile, "r")).fd] };
          },
        },
      },
    });
    // The first fake logind's name is free once the daemon has seen its connection close.
    logindBus.close();
    let owned = 0;
    for (let attempt = 0; attempt < 200 && owned !== 1; attempt++) {
      owned = await giver.requestName(LOGIND_BUS, 4);
      if (owned !== 1) await delay(10);
    }
    assert.equal(owned, 1);
    let lost = 0;
    const power2 = await connectLogindPower({ connect, pid: 1, events: {}, timeoutMs: 1000 });
    const hold = power2.inhibit({
      what: "sleep",
      why: "smoke",
      mode: "block",
      onLost: () => lost++,
    });
    assert.equal(await hold.ready, linux);
    assert.equal(hold.held, linux);
    assert.deepEqual(asked[0], ["sleep", "Moire", "smoke", "block"]);
    hold.release();
    assert.equal(hold.held, false);
    assert.equal(lost, 0, "a released inhibitor is not lost");

    refuse = true;
    const denied = power2.inhibit({ what: "sleep", why: "smoke", mode: "delay" });
    assert.equal(await denied.ready, false);
    assert.equal(denied.held, false);
    refuse = false;

    if (linux) {
      // logind going away drops what it held.
      const kept = power2.inhibit({
        what: "idle",
        why: "smoke",
        mode: "block",
        onLost: () => lost++,
      });
      assert.equal(await kept.ready, true);
      giver.close();
      await until(() => lost === 1, "lost inhibitor reported");
      assert.equal(kept.held, false);
    }
    await power2.dispose();
    cases++;
  }

  // ALSA playback probe.
  {
    const root = path.join(directory, "asound");
    assert.equal(audioPlaybackActive(path.join(directory, "none")), false);
    const sub = path.join(root, "card0", "pcm0p", "sub0");
    await fs.mkdir(sub, { recursive: true });
    await fs.mkdir(path.join(root, "card0", "pcm0c", "sub0"), { recursive: true });
    await fs.writeFile(path.join(root, "card0", "pcm0c", "sub0", "status"), "state: RUNNING\n");
    await fs.writeFile(path.join(sub, "status"), "closed\n");
    assert.equal(audioPlaybackActive(root), false, "capture alone is not playback");
    await fs.writeFile(path.join(sub, "status"), "state: RUNNING\nowner_pid   : 1\n");
    assert.equal(audioPlaybackActive(root), true);
    await fs.writeFile(path.join(sub, "status"), "state: PAUSED\n");
    assert.equal(audioPlaybackActive(root), false);
    cases++;
  }
} finally {
  await session?.dispose().catch(() => {});
  for (const b of buses) b.close();
  daemon.kill("SIGTERM");
  await fs.rm(directory, { recursive: true, force: true });
}
console.log(`[power-session] ${cases} cases PASS`);

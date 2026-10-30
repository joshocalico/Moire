/**
 * The lock screen in the session: the power backend's idle lock, lock on suspend with the sleep
 * delay inhibitor held until a locked frame is presented, logind's Lock and Unlock with the
 * LockedHint, the throttled authenticator, the password never in argv or the environment, and
 * org.moire.Lock1. Runs on a portable CompositorServer with fakes for logind and the bus.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_POWER_SETTINGS, applyPowerPatch } from "@moire/prefs";
import {
  createPasswordThrottle,
  createUnixPasswordChecker,
} from "@moire/system-management/password-check";
import type { LogindPower, InhibitorHold, InhibitorOptions } from "./logind-power";
import {
  createLockAuthenticator,
  exportLockStatus,
  LOCK_INTERFACE,
  lockUser,
} from "./lock-session";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-lock-session-"));
const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
const { CompositorServer, FakeIdleClock } = await import("@moire/core");
const { PowerSession } = await import("./power-session");

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};
let cases = 0;

const failNative = (): never => {
  throw new Error("No native operation allowed in this fixture");
};
/** One output that can never be scanned out, so frames are composed but not presented. */
const output = {
  availability: "unavailable",
  fd: -1,
  ownsFd: false,
  cardPath: "fixture",
  connectorId: 1,
  connectorName: "fixture",
  identity: { id: "fixture", make: "fixture", model: "fixture", serial: "" },
  physicalWidthMm: 0,
  physicalHeightMm: 0,
  crtcId: 0,
  width: 160,
  height: 120,
  pitch: 640,
  handle: 0,
  fbId: 0,
  size: 160 * 120 * 4,
  map: null,
  modePtr: null,
  modes: [],
  currentModeId: "fixture",
  connectorsPtr: null,
  setCrtc: failNative,
  drmIoctl: failNative,
  addFb: failNative,
  rmFb: failNative,
  getConnector: failNative,
  freeConnector: failNative,
  getEncoder: failNative,
  freeEncoder: failNative,
  getResources: failNative,
  freeResources: failNative,
  modeData: new Map(),
};
let frames = 0;
const renderer = {
  id: "software",
  detail: "fixture",
  renderingGeneration: Object.freeze({}),
  capabilities: { retainedLayers: false },
  beginFrame: () => frames++,
  renderOutput: () => ({}),
  captureOutput: () => new Uint8Array(),
  destroy() {},
};

try {
  const server = new CompositorServer(fixture);
  Object.assign(server, { syncHardwareCursor: () => false, reducedMotion: true });
  const clock = new FakeIdleClock();
  let settings = applyPowerPatch(DEFAULT_POWER_SETTINGS, {
    dimAfterSeconds: null,
    screenOffAfterSeconds: { ac: 60, battery: 60 },
    lockAfterScreenOffSeconds: 0,
    lockOnSuspend: true,
  });
  const holds: { options: InhibitorOptions; released: boolean }[] = [];
  const hints: boolean[] = [];
  const actions: string[] = [];
  /** Suspend, lock and sleep-inhibitor release, in the order they happened. */
  const timeline: string[] = [];
  /** Like logind: Suspend() announces PrepareForSleep(true) while delay inhibitors hold. */
  let suspendSignals = false;
  const session = new PowerSession({
    server,
    settings: { load: () => settings },
    timers: clock,
    lock: (reason) => server.lockSession(reason === "request" ? "logind" : reason),
    unlock: () => server.unlockSession("logind"),
    holdInhibitor: (options) => {
      const record = { options, released: false };
      holds.push(record);
      const hold: InhibitorHold = {
        ready: Promise.resolve(true),
        get held() {
          return !record.released;
        },
        release() {
          if (!record.released && options.what === "sleep") timeline.push("sleep released");
          record.released = true;
        },
      };
      return hold;
    },
    audioActive: () => false,
    log: () => {},
  });
  const logind: LogindPower = {
    session: "/org/freedesktop/login1/session/fixture",
    canSuspend: true,
    canPowerOff: false,
    canReboot: true,
    lid: { present: false, closed: false },
    inhibit: () => ({ ready: Promise.resolve(false), held: false, release() {} }),
    suspend: async () => {
      actions.push("suspend");
      timeline.push("suspend");
      if (suspendSignals) session.logindEvents.prepareForSleep?.(true);
    },
    powerOff: async () => {
      actions.push("power-off");
    },
    reboot: async () => {
      actions.push("reboot");
    },
    setIdleHint: async () => {},
    setLockedHint: async (locked) => {
      hints.push(locked);
    },
    dispose: async () => {},
  };
  session.setLogind(logind);
  server.onLockChanged((locked) => {
    timeline.push(locked ? "locked" : "unlocked");
    session.setLocked(locked);
  });
  const user = { name: "Test User", username: "test" };
  server.setLockEnvironment({
    user,
    authenticate: async () => ({ verdict: "wrong" }),
    power: () => ({
      suspend: session.status().capabilities.suspend,
      powerOff: session.status().capabilities.powerOff,
      reboot: session.status().capabilities.reboot,
    }),
    runPowerAction: (action) => session.requestPowerAction(action, "lock screen"),
  });

  // A lock provider makes locking supported, and the sleep delay inhibitor is held.
  assert.equal(session.status().capabilities.lock, true, "Settings now shows the lock rows");
  const sleepHold = () => holds.filter((hold) => hold.options.what === "sleep");
  assert.equal(sleepHold().length, 1);
  assert.equal(sleepHold()[0]!.options.mode, "delay");
  assert.equal(server.lockScreenView().power.suspend, true, "power menu follows logind");
  assert.equal(server.lockScreenView().power.powerOff, false);
  cases++;

  // Idle: "lock after screen off: immediately" locks as the screen goes dark.
  clock.advance(60_000);
  await flush();
  assert.equal(server.locked, true, "the idle policy locked the session");
  assert.equal(server.sessionLock.lockReason, "idle");
  assert.equal(session.status().locked, true);
  assert.deepEqual(hints, [true], "logind's LockedHint follows");
  server.unlockSession("logind");
  await flush();
  assert.equal(session.status().locked, false);
  assert.deepEqual(hints, [true, false]);
  await server.outputPower.setPowered(true);
  session.controller.activity();
  cases++;

  // Lock on suspend: the delay inhibitor goes only after a locked frame is presented.
  Object.assign(server, {
    outputs: [{ kms: output, x: 0, y: 0, scale120: 120, primary: true }],
    outputRenderer: renderer,
    lockFramePossible: () => true,
  });
  session.logindEvents.prepareForSleep?.(true);
  await flush();
  assert.equal(server.locked, true, "locked before sleeping");
  assert.equal(server.sessionLock.lockReason, "suspend");
  assert.equal(sleepHold()[0]!.released, false, "still held: nothing locked is on screen yet");
  const before = frames;
  await server.composite();
  assert.equal(frames, before + 1, "a locked frame was composed");
  await flush();
  assert.equal(sleepHold()[0]!.released, true, "released once the locked frame presented");
  session.logindEvents.prepareForSleep?.(false);
  await flush();
  assert.equal(sleepHold().length, 2, "re-held after waking");
  assert.equal(server.locked, true, "and still locked after waking");
  cases++;

  // Already locked: sleeping again releases at once (the lock is already on screen).
  session.logindEvents.prepareForSleep?.(true);
  await flush();
  assert.equal(sleepHold()[1]!.released, true);
  session.logindEvents.prepareForSleep?.(false);
  await flush();
  cases++;

  // logind's Unlock (loginctl unlock-session) ends the lock; its Lock starts one.
  session.logindEvents.sessionLock?.(false);
  assert.equal(server.locked, false);
  session.logindEvents.sessionLock?.(true);
  await flush();
  assert.equal(server.locked, true);
  assert.equal(server.sessionLock.lockReason, "logind");
  assert.equal(hints.at(-1), true);
  cases++;

  // The lock screen's power menu goes through logind, and only for allowed actions.
  const lockPointer = (
    server as unknown as {
      lockPointer(button?: { code: number; value: number }): void;
    }
  ).lockPointer.bind(server);
  let menuAction: "suspend" | "reboot" | "power-off" = "power-off";
  server.setShell({
    paint() {},
    onKey: () => false,
    onPointerButton: () => false,
    isLauncherOpen: () => false,
    onLockPointer: (ev) => (ev.value === 0 ? menuAction : null),
  });
  lockPointer({ code: 0x110, value: 0 });
  await flush();
  assert.deepEqual(actions, [], "power off is not allowed here, so it is never asked for");
  menuAction = "suspend";
  lockPointer({ code: 0x110, value: 0 });
  await flush();
  assert.deepEqual(actions, ["suspend"]);
  assert.equal(server.lockScreenView().power.reboot, true, "restart follows CanReboot");
  menuAction = "reboot";
  lockPointer({ code: 0x110, value: 0 });
  await flush();
  assert.deepEqual(actions, ["suspend", "reboot"]);
  server.unlockSession("logind");
  cases++;

  // Quick Settings' Suspend (requestPowerAction, as the shell's power view calls it) takes the
  // same path: logind's PrepareForSleep locks, and sleep waits for the locked frame.
  await flush();
  assert.equal(server.locked, false);
  const hold = sleepHold().at(-1)!;
  assert.equal(hold.released, false, "the sleep delay is held before suspending");
  timeline.length = 0;
  suspendSignals = true;
  session.requestPowerAction("suspend", "quick settings");
  await flush();
  assert.equal(server.locked, true, "locked on the way to sleep");
  assert.equal(server.sessionLock.lockReason, "suspend");
  assert.equal(hold.released, false, "sleep still waits: no locked frame yet");
  await server.composite();
  await flush();
  assert.deepEqual(timeline, ["suspend", "locked", "sleep released"], "lock before sleep");
  suspendSignals = false;
  session.logindEvents.prepareForSleep?.(false);
  await flush();
  server.unlockSession("logind");
  await flush();
  cases++;

  // The authenticator: the throttle's lockout comes back as a retry time.
  {
    let now = 1_000;
    const throttle = createPasswordThrottle({
      failureDelayMs: 0,
      limit: 2,
      lockoutMs: 5_000,
      now: () => now,
    });
    const authenticate = createLockAuthenticator({
      username: "test",
      checker: async (_user, password) =>
        Buffer.from(password as Uint8Array).toString() === "right" ? "ok" : "wrong",
      throttle,
      now: () => now,
    });
    const bytes = (text: string) => new Uint8Array(Buffer.from(text));
    assert.deepEqual(await authenticate(bytes("no")), { verdict: "wrong" });
    assert.deepEqual(await authenticate(bytes("no")), { verdict: "wrong" });
    assert.deepEqual(await authenticate(bytes("right")), {
      verdict: "rate_limited",
      retryInMs: 5_000,
    });
    now += 5_000;
    assert.deepEqual(await authenticate(bytes("right")), { verdict: "ok" });
    cases++;
  }

  // The password reaches unix_chkpwd only on stdin: never argv, never the environment.
  {
    const helper = path.join(fixture, "unix_chkpwd");
    const record = path.join(fixture, "record");
    fs.writeFileSync(
      helper,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$0" "$@" > '${record}.argv'`,
        `/usr/bin/env > '${record}.env'`,
        `/bin/cat > '${record}.stdin'`,
        `[ "$(/usr/bin/tr -d '\\000' < '${record}.stdin')" = 'S3cret-pass' ] && exit 0`,
        "exit 7",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const authenticate = createLockAuthenticator({
      username: os.userInfo().username,
      checker: createUnixPasswordChecker({ helper }),
      throttle: createPasswordThrottle({ failureDelayMs: 0 }),
    });
    const secret = new Uint8Array(Buffer.from("S3cret-pass"));
    assert.deepEqual(await authenticate(secret), { verdict: "ok" });
    const argv = fs.readFileSync(`${record}.argv`, "utf8");
    const env = fs.readFileSync(`${record}.env`, "utf8");
    const stdin = fs.readFileSync(`${record}.stdin`);
    assert.ok(!argv.includes("S3cret"), "not in argv");
    assert.deepEqual(argv.trim().split("\n").slice(1), [os.userInfo().username, "nonull"]);
    assert.ok(!env.includes("S3cret"), "not in the environment");
    assert.ok(!/^(HOME|PATH|USER)=/m.test(env), "the helper inherits no environment");
    assert.deepEqual(stdin, Buffer.from("S3cret-pass\0"), "NUL-terminated on stdin");
    assert.deepEqual(await authenticate(new Uint8Array(Buffer.from("wrong"))), {
      verdict: "wrong",
    });
    cases++;
  }

  // The session user, with the passwd full name.
  {
    const info = os.userInfo();
    const passwd = path.join(fixture, "passwd");
    fs.writeFileSync(
      passwd,
      `other:x:1:1:Other:/:/bin/sh\n${info.username}:x:${info.uid}:1:Ada Lovelace,,,:/home:/bin/sh\n`,
    );
    assert.deepEqual(lockUser(passwd), { name: "Ada Lovelace", username: info.username });
    assert.deepEqual(lockUser(path.join(fixture, "missing")), {
      name: "",
      username: info.username,
    });
    cases++;
  }

  // org.moire.Lock1: GetLocked, Lock (resolves once shown), LockedChanged; no Unlock method.
  {
    type Method = { handler: (call: { body: unknown[] }) => unknown };
    let exported: { name: string; methods: Record<string, Method> } | null = null;
    const signals: unknown[][] = [];
    const bus = {
      exportObject: (_path: string, object: { name: string; methods: Record<string, Method> }) => {
        exported = object;
        return () => {
          exported = null;
        };
      },
      emitSignal: (signal: { body: unknown[] }) => signals.push(signal.body),
    };
    const stop = exportLockStatus(bus as never, server);
    const object = exported as unknown as { name: string; methods: Record<string, Method> };
    assert.equal(object.name, LOCK_INTERFACE);
    assert.deepEqual(Object.keys(object.methods).sort(), ["GetLocked", "Lock"]);
    assert.deepEqual(await object.methods.GetLocked!.handler({ body: [] }), { body: [false] });
    const locking = object.methods.Lock!.handler({ body: [] }) as Promise<{ body: unknown[] }>;
    await flush();
    await server.composite();
    assert.deepEqual(await locking, { body: [true] }, "Lock answers once the lock is shown");
    assert.deepEqual(signals, [[true]]);
    server.unlockSession("logind");
    assert.deepEqual(signals, [[true], [false]]);
    stop();
    assert.equal(exported, null);
    cases++;
  }

  await session.dispose();
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
console.log(`[lock-session] ${cases} cases PASS`);

/**
 * Idle → outputs: the controller's fades and DPMS against a fake output driver and fake clock,
 * plus the compositor's own hooks (idle inhibitor protocol, activity, power keys, presentation
 * gate) on a portable CompositorServer with a fake client connection.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageBuilder, decodeHeader } from "@moire/protocol";
import { wlCompositor, wlDisplay, wlRegistry } from "@moire/protocol/generated";
import { DEFAULT_POWER_SETTINGS, applyPowerPatch } from "@moire/prefs";
import {
  DIM_FADE_MS,
  DIM_LEVEL,
  IdleController,
  SCREEN_OFF_FADE_MS,
  UNDIM_FADE_MS,
  type IdleControllerHooks,
} from "./idle-controller";
import { OutputPowerControl } from "./output-power";
import { FakeClock } from "./idle-testing";

const S = 1000;
const MIN = 60 * S;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
let cases = 0;

type FakeOutput = { name: string; on: boolean; settledAfter: number; dpms: boolean };

function outputs(clock: FakeClock, list: FakeOutput[]) {
  const calls: string[] = [];
  let repaints = 0;
  const control = new OutputPowerControl<FakeOutput>({
    outputs: () => list,
    setPower(output, on) {
      calls.push(`${output.name}:${on ? "on" : "off"}`);
      if (!output.dpms) return false;
      output.on = on;
      return true;
    },
    settled: (output) => clock.now() >= output.settledAfter,
    now: () => clock.now(),
    wait: async (ms) => clock.advance(ms),
    repaint: () => repaints++,
  });
  return { control, calls, repaints: () => repaints };
}

// OutputPowerControl: off waits for an in-flight flip, on is immediate, a wake supersedes.
{
  const clock = new FakeClock();
  const a: FakeOutput = { name: "A", on: true, settledAfter: 20, dpms: true };
  const b: FakeOutput = { name: "B", on: true, settledAfter: 0, dpms: true };
  const { control, calls } = outputs(clock, [a, b]);
  const off = control.setPowered(false);
  assert.equal(control.presenting, false, "presentation stops before DPMS");
  assert.deepEqual(calls, [], "DPMS waits for the pending flip");
  assert.equal(await off, true);
  assert.ok(clock.now() >= 20);
  assert.deepEqual(calls, ["A:off", "B:off"]);
  assert.equal(control.supported, true);
  assert.equal(await control.setPowered(true), true);
  assert.equal(control.presenting, true);
  assert.deepEqual(calls.slice(2), ["A:on", "B:on"]);
  // A keypress while waiting for the flip wins: the outputs never go dark.
  a.settledAfter = clock.now() + 100;
  calls.length = 0;
  const superseded = control.setPowered(false);
  const wake = control.setPowered(true);
  assert.equal(await superseded, false);
  await wake;
  assert.deepEqual(calls, ["A:on", "B:on"]);
  assert.equal(a.on && b.on, true);
  cases++;
}
{
  const clock = new FakeClock();
  const { control } = outputs(clock, [{ name: "V", on: true, settledAfter: 0, dpms: false }]);
  assert.equal(await control.setPowered(false), false);
  assert.equal(control.supported, false, "an output without DPMS reports unsupported");
  assert.equal(control.presenting, false, "still stops drawing behind the black fade");
  cases++;
}

// Dim overlay levels follow the fade; a no-op set does not repaint.
{
  const clock = new FakeClock();
  const { control, repaints } = outputs(clock, []);
  control.setDim(0.5, 100);
  assert.equal(repaints(), 1);
  clock.advance(50);
  assert.equal(control.dimLevel(), 0.25);
  assert.equal(control.animating(), true);
  clock.advance(50);
  assert.equal(control.dimLevel(), 0.5);
  control.setDim(0.5, 100);
  assert.equal(repaints(), 1, "setting the current level again is free");
  cases++;
}

function controller(
  options: {
    reducedMotion?: boolean;
    lock?: IdleControllerHooks["lock"];
    suspend?: () => Promise<void>;
  } = {},
) {
  const clock = new FakeClock();
  const panel: FakeOutput = { name: "eDP-1", on: true, settledAfter: 0, dpms: true };
  const out = outputs(clock, [panel]);
  const dims: string[] = [];
  const setDim = out.control.setDim.bind(out.control);
  out.control.setDim = (level, ms) => {
    dims.push(`${level}/${ms}`);
    setDim(level, ms);
  };
  const hints: boolean[] = [];
  const suspends: number[] = [];
  let changes = 0;
  const idle = new IdleController({
    settings: DEFAULT_POWER_SETTINGS,
    source: "battery",
    outputs: out.control,
    timers: clock,
    reducedMotion: () => options.reducedMotion ?? false,
    hooks: {
      ...(options.lock ? { lock: options.lock } : {}),
      suspend:
        options.suspend ??
        (async () => {
          suspends.push(clock.now());
        }),
      idleHint: (idle) => hints.push(idle),
      changed: () => changes++,
    },
  });
  return { clock, panel, out, dims, hints, suspends, idle, changes: () => changes };
}

// The full battery timeline through real fades and DPMS.
{
  const h = controller();
  h.clock.advance(2 * MIN);
  assert.deepEqual(h.dims, [`${DIM_LEVEL}/${DIM_FADE_MS}`]);
  assert.equal(h.idle.status().state, "dimmed");
  assert.deepEqual(h.hints, [true]);
  h.clock.advance(3 * MIN);
  assert.deepEqual(h.dims.at(-1), `1/${SCREEN_OFF_FADE_MS}`, "fades to black before DPMS");
  assert.equal(h.panel.on, true, "still on during the fade");
  h.clock.advance(SCREEN_OFF_FADE_MS);
  await flush();
  assert.equal(h.panel.on, false);
  assert.equal(h.out.control.presenting, false);
  assert.equal(h.idle.status().state, "off");
  assert.equal(h.idle.status().screenOffSupported, true);
  // Wake: power before the undim, so the first composite after the key reaches the screen.
  h.idle.activity();
  assert.equal(h.panel.on, true);
  assert.equal(h.out.control.presenting, true);
  assert.deepEqual(h.dims.at(-1), `0/${UNDIM_FADE_MS}`);
  assert.deepEqual(h.hints, [true, true, false]);
  h.clock.advance(30 * MIN);
  await flush();
  assert.deepEqual(h.suspends, [h.clock.now()], "suspend 30 min after the wake");
  assert.ok(h.changes() > 0);
  h.idle.dispose();
  cases++;
}

// Activity during the black fade cancels the power-off.
{
  const h = controller();
  h.clock.advance(5 * MIN + SCREEN_OFF_FADE_MS / 2);
  h.idle.activity();
  h.clock.advance(SCREEN_OFF_FADE_MS);
  await flush();
  assert.equal(h.panel.on, true);
  assert.equal(h.out.control.presenting, true);
  h.idle.dispose();
  cases++;
}

// Reduce motion: every fade is instant.
{
  const h = controller({ reducedMotion: true });
  h.clock.advance(5 * MIN);
  await flush();
  assert.deepEqual(h.dims, ["0.55/0", "1/0"]);
  assert.equal(h.panel.on, false, "DPMS without waiting for a fade");
  h.idle.activity();
  assert.deepEqual(h.dims.at(-1), "0/0");
  h.idle.dispose();
  cases++;
}

// Settings and power source changes apply immediately.
{
  const h = controller();
  h.idle.setSettings(applyPowerPatch(DEFAULT_POWER_SETTINGS, { dimAfterSeconds: 30 }));
  h.clock.advance(30 * S);
  assert.equal(h.idle.status().phase, "dimmed");
  h.idle.setPowerSource("ac");
  assert.equal(h.idle.status().powerSource, "ac");
  h.clock.advance(5 * MIN);
  assert.equal(h.idle.status().phase, "dimmed", "AC turns the screen off at 10 min, not 5");
  h.idle.dispose();
  cases++;
}

// With a lock provider: lock at screen off, state reads "locked" after waking, sleep waits.
{
  const reasons: string[] = [];
  let finishLock: (locked: boolean) => void = () => {};
  const h = controller({
    lock: (reason) => {
      reasons.push(reason);
      return new Promise<boolean>((resolve) => {
        finishLock = resolve;
      });
    },
  });
  h.clock.advance(5 * MIN);
  assert.deepEqual(reasons, ["idle"]);
  finishLock(true);
  await flush();
  h.idle.activity();
  assert.equal(h.idle.status().state, "locked");
  assert.equal(h.idle.status().lockSupported, true);
  h.idle.setLocked(false);
  let slept = false;
  const sleeping = h.idle.prepareForSleep().then(() => {
    slept = true;
  });
  await flush();
  assert.deepEqual(reasons, ["idle", "suspend"]);
  assert.equal(slept, false, "sleep waits for the lock screen");
  finishLock(true);
  await sleeping;
  assert.equal(h.idle.status().locked, true);
  h.idle.dispose();
  cases++;
}

// No lock provider and a failing suspend: reported, not retried until the next idle period.
{
  let attempts = 0;
  const h = controller({
    suspend: async () => {
      attempts++;
      throw new Error("Access denied");
    },
  });
  assert.equal(h.idle.status().lockSupported, false);
  h.clock.advance(60 * MIN);
  await flush();
  assert.equal(attempts, 1);
  assert.equal(h.idle.status().lastError, "suspend: Access denied");
  assert.equal(h.idle.status().locked, false);
  h.idle.dispose();
  cases++;
}

// The compositor: idle inhibitor protocol, activity hook, power keys, presentation gate.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-idle-output-"));
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
process.env.XDG_DATA_HOME = path.join(fixture, "data");
const { CompositorServer, ClientSession } = await import("./server");
class Connection extends EventEmitter {
  readonly peerPid = null;
  readonly sent: Buffer[] = [];
  send(data: Buffer): boolean {
    this.sent.push(Buffer.from(data));
    return true;
  }
  close(): void {
    this.emit("close");
  }
}
try {
  const server = new CompositorServer(fixture);
  const conn = new Connection();
  const client = new ClientSession(server, conn, 1);
  // start() registers connections and their close handling; mirror the parts used here.
  const clients = (server as unknown as { clients: Set<unknown> }).clients;
  clients.add(client);
  conn.on("close", () => {
    clients.delete(client);
    server.idleInhibitors.retireSession(client);
  });
  conn.emit("message", wlDisplay.requests.getRegistry.encode(1, 2));
  const globals = conn.sent
    .filter((data) => decodeHeader(data).objectId === 2)
    .map((data) => wlRegistry.events.global.decode(data));
  const compositor = globals.find((global) => global.interfaceValue === "wl_compositor");
  const manager = globals.find((global) => global.interfaceValue === "zwp_idle_inhibit_manager_v1");
  assert.ok(compositor && manager, "zwp_idle_inhibit_manager_v1 is advertised");
  assert.equal(manager.version, 1);
  conn.emit("message", wlRegistry.requests.bind.encode(2, compositor.name, "wl_compositor", 4, 3));
  conn.emit(
    "message",
    wlRegistry.requests.bind.encode(2, manager.name, "zwp_idle_inhibit_manager_v1", 1, 5),
  );
  conn.emit("message", wlCompositor.requests.createSurface.encode(3, 10));
  const surface = client.surfaceById(10);
  assert.ok(surface);
  Object.assign(surface, {
    mapped: true,
    role: "toplevel",
    appId: "org.moire.Video",
    width: 8,
    height: 8,
    content: {
      width: 8,
      height: 8,
      stride: 32,
      storage: "cpu",
      pixels: new Uint8Array(256),
      destroy() {},
    },
  });
  server.registerToplevel(client, 10);
  let inhibitorChanges = 0;
  server.idleInhibitors.onChanged(() => inhibitorChanges++);
  assert.deepEqual(server.idleInhibitorReasons(), []);
  conn.emit("message", new MessageBuilder().newId(30).object(10).build(5, 1));
  assert.equal(inhibitorChanges, 1);
  assert.deepEqual(server.idleInhibitorReasons(), ["org.moire.Video"]);
  surface.minimized = true;
  assert.deepEqual(server.idleInhibitorReasons(), [], "a hidden surface does not inhibit");
  surface.minimized = false;
  conn.emit("message", new MessageBuilder().build(30, 0));
  assert.equal(inhibitorChanges, 2);
  assert.deepEqual(server.idleInhibitorReasons(), []);
  conn.emit("message", new MessageBuilder().newId(31).object(10).build(5, 1));
  assert.deepEqual(server.idleInhibitorReasons(), ["org.moire.Video"]);
  conn.close();
  assert.deepEqual(server.idleInhibitorReasons(), [], "a departed client's inhibitors go");
  cases++;

  // Activity fires for keys; power keys go to the handler and never reach clients or the seat.
  let activity = 0;
  const stop = server.onUserActivity(() => activity++);
  const keys: string[] = [];
  server.setSystemKeyHandler((code, value) => {
    keys.push(`${code}:${value}`);
    return true;
  });
  const onKey = (code: number, value: number) =>
    (server as unknown as { onKey(ev: object): void }).onKey({ code, value, timeMs: 0 });
  onKey(116, 1);
  onKey(116, 0);
  assert.equal(activity, 2);
  assert.deepEqual(keys, ["116:1", "116:0"]);
  assert.deepEqual(server.keyboardPressedKeys(), [], "the seat never saw KEY_POWER");
  onKey(30, 1);
  assert.deepEqual(keys.length, 2, "ordinary keys are not offered to the power handler");
  assert.deepEqual(server.keyboardPressedKeys(), [30]);
  onKey(30, 0);
  server.setSystemKeyHandler((code) => code === 142);
  onKey(116, 1);
  assert.deepEqual(server.keyboardPressedKeys(), [116], "a declined power key routes normally");
  onKey(116, 0);
  stop();
  onKey(30, 1);
  onKey(30, 0);
  assert.equal(activity, 6, "no activity after unsubscribing");
  cases++;

  // Presentation gate: outputs off stops composition until woken.
  assert.equal(server.outputPower.presenting, true);
  await server.outputPower.setPowered(false);
  assert.equal(server.outputPower.presenting, false);
  await server.composite();
  await server.outputPower.setPowered(true);
  assert.equal(server.outputPower.presenting, true);
  cases++;
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log(`[idle-output] ${cases} cases PASS`);

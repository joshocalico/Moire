/**
 * The compositor while locked, on a portable CompositorServer with fake client connections and
 * a recording output renderer (no DRM, GPU or devices):
 *
 * - presentation: a locked frame is identical whatever the clients' pixels are, never goes
 *   through the retained scene, shows the lock UI, and falls back to the compositor's own
 *   prompt (still locked) when the shell's lock UI throws or is missing;
 * - input: keys and pointer never reach a client while locked, focus changes and Super+L,
 *   unlock with the password restores focus and swallows the unlocking keys;
 * - clipboard: no paste while locked; ordering: lockSession resolves only after a locked frame;
 * - the password never appears in a log line.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeHeader, type EncodedWaylandMessage } from "@moire/protocol";
import { wlCompositor, wlDisplay, wlRegistry, wlSeat } from "@moire/protocol/generated";
import { loadTheme, setTheme } from "@moire/theme";
import type { KmsOutput } from "@moire/sys";
import type { CompositionScene, PixelSurface } from "./composition";
import type { CompositorOutputRenderer } from "./output-renderer";
import type { LockScreenView } from "./session-lock";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-lock-screen-"));
const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
const { CompositorServer, ClientSession } = await import("./server");

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const width = 320;
const height = 240;
const failNative = (): never => {
  throw new Error("No native operation allowed in this fixture");
};
const output: KmsOutput = {
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
  width,
  height,
  pitch: width * 4,
  handle: 0,
  fbId: 0,
  size: width * height * 4,
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

/** Records every frame: flat stages (copied) and retained scenes. */
const flatFrames: Uint8Array[] = [];
const scenes: CompositionScene[] = [];
const renderer: CompositorOutputRenderer = {
  id: "egl",
  detail: "fixture",
  renderingGeneration: Object.freeze({}),
  capabilities: {
    retainedLayers: true,
    projectiveTransforms: false,
    meshDeformation: false,
    extensionEffects: false,
    surfaceGeometryMask: false,
    directScanout: false,
    backdropBlur: false,
    dropShadow: false,
    colorMatrix: false,
    roundedClip: false,
  },
  beginFrame(scene: PixelSurface) {
    flatFrames.push(Uint8Array.from(scene.pixels));
  },
  beginComposition(scene: CompositionScene) {
    scenes.push(scene);
  },
  renderOutput: () => ({}),
  captureOutput: () => new Uint8Array(),
  destroy() {},
};

const theme = loadTheme();
theme.wallpaper = { mode: "solid", color: "#204060" };
setTheme(theme);
const server = new CompositorServer(fixture);
Object.assign(server, {
  outputs: [{ kms: output, x: 0, y: 0, scale120: 120, primary: true }],
  outputRenderer: renderer,
  theme,
  reducedMotion: true,
  syncHardwareCursor: () => false,
  cursorX: 40,
  cursorY: 40,
});

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
  request(message: EncodedWaylandMessage): void {
    this.emit("message", message);
  }
}
const KEYBOARD = 20;
const POINTER = 21;
const EVENTS = {
  keyboard: { enter: 1, leave: 2, key: 3, modifiers: 4 },
  pointer: { enter: 0, leave: 1, motion: 2, button: 3, axis: 4 },
};
type FakeClient = {
  conn: Connection;
  session: InstanceType<typeof ClientSession>;
  surface: NonNullable<ReturnType<InstanceType<typeof ClientSession>["surfaceById"]>>;
  events(object: number, opcode?: number): number;
};
const clients: FakeClient[] = [];
function solid(color: number) {
  const pixels = new Uint8Array(96 * 64 * 4);
  new Uint32Array(pixels.buffer).fill(color);
  return { pixels, width: 96, height: 64, stride: 96 * 4, storage: "cpu" as const, destroy() {} };
}
function client(id: number, color: number, x: number): FakeClient {
  const conn = new Connection();
  const session = new ClientSession(server, conn, id);
  (server as unknown as { clients: Set<unknown> }).clients.add(session);
  conn.request(wlDisplay.requests.getRegistry.encode(1, 2));
  const globals = conn.sent
    .filter((data) => decodeHeader(data).objectId === 2)
    .map((data) => wlRegistry.events.global.decode(data));
  const global = (name: string) => globals.find((g) => g.interfaceValue === name)!;
  conn.request(
    wlRegistry.requests.bind.encode(2, global("wl_compositor").name, "wl_compositor", 4, 3),
  );
  conn.request(wlRegistry.requests.bind.encode(2, global("wl_seat").name, "wl_seat", 5, 4));
  conn.request(wlSeat.requests.getKeyboard.encode(4, KEYBOARD));
  conn.request(wlSeat.requests.getPointer.encode(4, POINTER));
  conn.request(wlCompositor.requests.createSurface.encode(3, 10));
  const surface = session.surfaceById(10)!;
  Object.assign(surface, {
    role: "toplevel",
    mapped: true,
    x,
    y: 30,
    width: 96,
    height: 64,
    bufferWidth: 96,
    bufferHeight: 64,
    stride: 96 * 4,
    opaque: true,
    content: solid(color),
    decoration: "client",
    title: `Client ${id}`,
  });
  server.registerToplevel(session, 10);
  const events = (object: number, opcode?: number) =>
    conn.sent.filter((data) => {
      const header = decodeHeader(data);
      return header.objectId === object && (opcode === undefined || header.opcode === opcode);
    }).length;
  const entry = { conn, session, surface, events };
  clients.push(entry);
  return entry;
}

const lockRasterCalls: LockScreenView[] = [];
const LOCK_MARK = 0xff123456;
let lockUi: "ok" | "throws" = "ok";
const shellLocked: boolean[] = [];
const mark = new Uint8Array(12 * 12 * 4);
new Uint32Array(mark.buffer).fill(LOCK_MARK);
const shell = {
  paint() {},
  onKey: () => false,
  onPointerButton: () => false,
  isLauncherOpen: () => false,
  desktopRaster: () => null,
  chromeRaster: () => null,
  ssdRaster: () => ({
    id: "ssd",
    pixels: mark,
    width: 12,
    height: 12,
    stride: 48,
    revision: 1,
    x: 0,
    y: 0,
  }),
  setLocked: (locked: boolean) => shellLocked.push(locked),
  lockRaster(view: LockScreenView, w: number, h: number) {
    lockRasterCalls.push(view);
    if (lockUi === "throws") throw new Error("lock UI exploded");
    assert.equal(w, width);
    assert.equal(h, height);
    return {
      id: "shell:lock",
      pixels: mark,
      width: 12,
      height: 12,
      stride: 48,
      revision: view.revision,
      x: 150,
      y: 110,
    };
  },
  onLockPointer: () => null,
};
server.setShell(shell);

const words = (pixels: Uint8Array) =>
  new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength >>> 2);
const containsColor = (pixels: Uint8Array, color: number) =>
  words(pixels).some((word) => word >>> 0 === color >>> 0);
const MAGENTA = 0xffff00ff;
const GREEN = 0xff00ff00;
const YELLOW = 0xffffff00;
/** Force a fresh locked frame (the compositor skips unchanged ones) and return it. */
async function lockedFrame(): Promise<Uint8Array> {
  Object.assign(server, { lockFrameKey: "" });
  const before = flatFrames.length;
  await server.composite();
  assert.equal(flatFrames.length, before + 1, "one flat frame per locked composite");
  return flatFrames.at(-1)!;
}
const onKey = (code: number, value: number) =>
  (server as unknown as { onKey(ev: object): void }).onKey({ code, value, timeMs: 0 });
const pointerMotion = (dx: number, dy: number) =>
  (server as unknown as { onPointerMotion(ev: object): void }).onPointerMotion({
    dx,
    dy,
    timeMs: 0,
  });
const pointerButton = (code: number, value: number) =>
  (server as unknown as { onPointerButton(ev: object): void }).onPointerButton({
    code,
    value,
    timeMs: 0,
  });
const pointerAxis = (value: number) =>
  (server as unknown as { onPointerAxis(ev: object): void }).onPointerAxis({ value, timeMs: 0 });

const logged: string[] = [];
const original = { log: console.log, warn: console.warn, error: console.error };
for (const name of ["log", "warn", "error"] as const)
  console[name] = (...args: unknown[]) => logged.push(args.map(String).join(" "));
let cases = 0;
const PASSWORD = "tr0ub4dor";
const PASSWORD_KEYS = [20, 19, 11, 22, 48, 5, 32, 24, 19];
try {
  const a = client(1, MAGENTA, 20);
  const b = client(2, GREEN, 160);
  const checked: string[] = [];
  server.setLockEnvironment({
    user: { name: "Test User", username: "test" },
    authenticate: async (secret) => {
      checked.push(Buffer.from(secret).toString("utf8"));
      return { verdict: Buffer.from(secret).toString("utf8") === PASSWORD ? "ok" : "wrong" };
    },
    power: () => ({ suspend: true, powerOff: false }),
  });

  // Unlocked: the clients are composed through the retained scene.
  server.focusClient(a.session, 10);
  await server.composite();
  assert.ok(
    scenes.at(-1)?.layers.some((layer) => layer.id === "surface:1:10"),
    "sanity",
  );
  pointerMotion(20, 20); // over client 1: pointer enter
  assert.ok(a.events(POINTER, EVENTS.pointer.enter) >= 1);
  cases++;

  // Super+L locks: the compositor owns the shortcut, the shell is told, focus leaves clients.
  const keysBefore = a.events(KEYBOARD, EVENTS.keyboard.key);
  onKey(125, 1);
  onKey(38, 1);
  assert.equal(server.locked, true, "Super+L locked");
  assert.deepEqual(shellLocked, [true]);
  assert.equal(a.events(KEYBOARD, EVENTS.keyboard.leave), 1, "keyboard focus left the client");
  assert.equal(a.events(POINTER, EVENTS.pointer.leave), 1, "pointer focus left the client");
  assert.equal(a.events(KEYBOARD, EVENTS.keyboard.key), keysBefore + 1, "only Super reached it");
  onKey(38, 0);
  onKey(125, 0);
  cases++;

  // Presentation: flat only, the lock UI is drawn, and the frame does not depend on clients.
  const scenesBefore = scenes.length;
  const first = await lockedFrame();
  assert.equal(scenes.length, scenesBefore, "no retained scene (with client layers) while locked");
  assert.ok(containsColor(first, LOCK_MARK), "the shell's lock UI is on screen");
  assert.ok(!containsColor(first, MAGENTA) && !containsColor(first, GREEN), "no client colour");
  assert.equal(lockRasterCalls.at(-1)?.user.name, "Test User");
  assert.deepEqual(lockRasterCalls.at(-1)?.power, {
    suspend: true,
    powerOff: false,
    reboot: false,
  });
  a.surface.content = solid(YELLOW);
  b.surface.content = solid(0xff0000ff);
  const c = client(3, 0xffffffff, 60); // a window mapping while locked
  server.focusClient(c.session, 10);
  assert.equal(c.events(KEYBOARD, EVENTS.keyboard.enter), 0, "a new window gets no focus");
  const second = await lockedFrame();
  assert.deepEqual(second, first, "the locked frame is identical whatever clients draw or map");
  const dirtyFrames = flatFrames.length;
  await server.composite();
  assert.equal(flatFrames.length, dirtyFrames, "an unchanged lock is not redrawn");
  cases++;

  // Input while locked: nothing reaches any client; pointer goes to the lock UI only.
  const before = clients.map((entry) => [entry.events(KEYBOARD), entry.events(POINTER)]);
  for (const code of [30, 31, 15, 56]) {
    onKey(code, 1);
    onKey(code, 0);
  }
  pointerMotion(80, 0); // over client 2's old place
  pointerButton(0x110, 1);
  pointerButton(0x110, 0);
  pointerAxis(1);
  server.focusClient(b.session, 10);
  assert.deepEqual(
    clients.map((entry) => [entry.events(KEYBOARD), entry.events(POINTER)]),
    before,
    "no keyboard or pointer event reached a client while locked",
  );
  assert.equal(server.lockScreenView().length, 2, "the letter keys went to the password");
  onKey(1, 1); // Escape clears
  onKey(1, 0);
  assert.equal(server.lockScreenView().length, 0);
  cases++;

  // Clipboard: no paste while locked; the source is never asked.
  let sourceAsked = 0;
  Object.assign(b.session, { sendDataSourceSend: () => sourceAsked++ });
  Object.assign(server, {
    selection: { sourceSession: b.session, sourceId: 5, mimeTypes: ["text/plain"] },
  });
  const pipe = fs.openSync(path.join(fixture, "paste"), "w");
  server.forwardSelectionReceive("text/plain", pipe);
  assert.equal(sourceAsked, 0, "the clipboard owner is never asked to paste");
  try {
    fs.closeSync(pipe); // closeFd is libc on Linux; portable runs close it here
  } catch {
    /* already closed by the compositor */
  }
  assert.deepEqual(server.idleInhibitorReasons(), [], "nothing holds a locked screen awake");
  cases++;

  // Fail closed: a throwing lock UI leaves the session locked behind the compositor's prompt.
  lockUi = "throws";
  const fallback = await lockedFrame();
  assert.equal(server.locked, true);
  assert.ok(!containsColor(fallback, LOCK_MARK), "the broken UI is not drawn");
  assert.ok(!containsColor(fallback, YELLOW), "and no client shows through");
  assert.ok(
    logged.some((line) => line.includes("lock UI failed")),
    "the failure is logged",
  );
  a.surface.content = solid(MAGENTA);
  assert.deepEqual(await lockedFrame(), fallback, "the fallback frame ignores clients too");
  // Typing still works against the fallback.
  onKey(30, 1);
  onKey(30, 0);
  assert.equal(server.lockScreenView().length, 1);
  onKey(14, 1); // Backspace
  onKey(14, 0);
  cases++;

  // A wrong password stays locked; the right one unlocks, restores focus and swallows Enter.
  for (const code of [30, 30]) {
    onKey(code, 1);
    onKey(code, 0);
  }
  onKey(28, 1);
  onKey(28, 0);
  await flush();
  await flush();
  assert.equal(server.locked, true);
  assert.equal(server.lockScreenView().phase, "wrong");
  for (const code of PASSWORD_KEYS) {
    onKey(code, 1);
    onKey(code, 0);
  }
  const focusTarget = clients.find(
    (entry) => entry.session === (server as unknown as { focused: unknown }).focused,
  )!;
  const entersBefore = focusTarget.events(KEYBOARD, EVENTS.keyboard.enter);
  const keysAtUnlock = focusTarget.events(KEYBOARD, EVENTS.keyboard.key);
  onKey(28, 1);
  await flush();
  await flush();
  assert.deepEqual(checked, ["aa", PASSWORD]);
  assert.equal(server.locked, false, "the right password unlocks");
  assert.deepEqual(shellLocked, [true, false]);
  assert.equal(
    focusTarget.events(KEYBOARD, EVENTS.keyboard.enter),
    entersBefore + 1,
    "keyboard focus returns to the focused window",
  );
  onKey(28, 0); // the Enter that unlocked is released after unlock
  assert.equal(focusTarget.events(KEYBOARD, EVENTS.keyboard.key), keysAtUnlock, "Enter swallowed");
  onKey(30, 1);
  onKey(30, 0);
  assert.equal(
    focusTarget.events(KEYBOARD, EVENTS.keyboard.key),
    keysAtUnlock + 2,
    "keys flow again",
  );
  await server.composite();
  assert.ok(
    scenes.at(-1)?.layers.some((layer) => layer.id.startsWith("surface:")),
    "clients back",
  );
  cases++;

  // Ordering: lockSession resolves only once a locked frame has been presented.
  lockUi = "ok";
  Object.assign(server, { lockFramePossible: () => true });
  let resolved: boolean | null = null;
  const locking = server.lockSession("suspend").then((value) => (resolved = value));
  await flush();
  assert.equal(server.locked, true, "locked synchronously");
  assert.equal(resolved, null, "not resolved before a locked frame");
  await server.composite();
  await locking;
  assert.equal(resolved, true, "resolved by the locked frame");
  assert.equal(await server.lockSession("request"), true, "already locked and shown: at once");
  assert.equal(server.unlockSession("logind"), true, "logind's Unlock ends it");
  assert.equal(server.locked, false);
  cases++;

  // Without a lock environment (the greeter), Super+L does nothing.
  server.setLockEnvironment(null);
  onKey(125, 1);
  onKey(38, 1);
  onKey(38, 0);
  onKey(125, 0);
  assert.equal(server.locked, false, "no lock shortcut without a way to unlock");
  cases++;
} finally {
  Object.assign(console, original);
  fs.rmSync(fixture, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
assert.ok(!logged.join("\n").includes(PASSWORD), "the password never reached a log line");
console.log(`[lock-screen] ${cases} cases PASS`);

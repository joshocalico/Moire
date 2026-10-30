/**
 * The compositor while a secure prompt is up, on a portable CompositorServer with fake client
 * connections and a recording output renderer (no DRM, GPU or devices):
 *
 * - presentation: the frame holds the prompt and no client colour, is identical whatever clients
 *   draw or map, is on the output under the pointer with the other black, and falls back to the
 *   compositor's own prompt when the shell's view throws; if that fails too the request ends as
 *   "failed";
 * - input: no key or pointer event reaches any client or Xwayland; the answer is typed into the
 *   prompt; focus returns afterwards and the submitting Enter is swallowed;
 * - the verification key (Super+Escape) reaches no client: it pulses a real prompt, shows the
 *   notice with none open, and nothing while locked;
 * - the lock cancels the prompt and holds the queue; captures are refused; a pre-login
 *   compositor refuses every request; the answer never appears in a log line.
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
import { FakeClock } from "./idle-testing";
import type { CompositorOutputRenderer } from "./output-renderer";
import {
  SECURE_PROMPT_ARMING_MS,
  SECURE_PROMPT_COOL_DOWN_MS,
  type SecurePromptAction,
  type SecurePromptView,
} from "./secure-prompt";
import type {
  SecurePromptRequest,
  SecurePromptResult,
  SecurePromptVerdict,
} from "./secure-prompt-types";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-secure-prompt-"));
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
const kmsOutput = (connectorId: number): KmsOutput => ({
  availability: "unavailable",
  fd: -1,
  ownsFd: false,
  cardPath: "fixture",
  connectorId,
  connectorName: `fixture-${connectorId}`,
  identity: { id: `fixture-${connectorId}`, make: "fixture", model: "fixture", serial: "" },
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
});

/** Records every frame: flat stages (copied) and retained scenes. */
const flatFrames: Uint8Array[] = [];
const scenes: CompositionScene[] = [];
let captures = 0;
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
  captureOutput: () => {
    captures++;
    return new Uint8Array();
  },
  destroy() {},
};

const theme = loadTheme();
theme.wallpaper = { mode: "solid", color: "#204060" };
setTheme(theme);
const server = new CompositorServer(fixture);
const single = [{ kms: kmsOutput(1), x: 0, y: 0, scale120: 120, primary: true }];
Object.assign(server, {
  outputs: single,
  outputRenderer: renderer,
  theme,
  reducedMotion: true,
  syncHardwareCursor: () => false,
  cursorX: 40,
  cursorY: 40,
});
// The prompt's own clock (arming, timeouts, cool-downs) is advanced by hand.
const clock = new FakeClock();
type Internals = {
  securePromptQueue: { timers: FakeClock; typedBytes(): number };
  secureNoticeTimer: unknown;
  endSecureNotice(): void;
  promptFrameKey: string;
  lockFrameKey: string;
  focused: unknown;
  clients: Set<unknown>;
  onKey(ev: object): void;
  onPointerMotion(ev: object): void;
  onPointerButton(ev: object): void;
  onPointerAxis(ev: object): void;
};
const internals = server as unknown as Internals;
Object.assign(internals.securePromptQueue, { timers: clock });

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
function client(id: number, color: number, x: number, xwayland = false): FakeClient {
  const conn = new Connection();
  const session = new ClientSession(server, conn, id);
  if (xwayland) Object.assign(session, { isXwayland: true });
  internals.clients.add(session);
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
    // An X11 window: the compositor ghost-feeds pointer motion to it on the desktop.
    ...(xwayland ? { x11Wid: 77 } : {}),
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

const PROMPT_MARK = 0xff123456;
const NOTICE_MARK = 0xff654321;
const LOCK_MARK = 0xff0badf0;
const square = (color: number) => {
  const pixels = new Uint8Array(12 * 12 * 4);
  new Uint32Array(pixels.buffer).fill(color);
  return pixels;
};
const raster = (id: string, color: number, revision: number) => ({
  id,
  pixels: square(color),
  width: 12,
  height: 12,
  stride: 48,
  revision,
  x: 150,
  y: 110,
});
const promptViews: SecurePromptView[] = [];
let promptUi: "ok" | "throws" = "ok";
let pointerAnswer: SecurePromptAction | null = null;
const shellPrompt: boolean[] = [];
const shellKeys: number[] = [];
let superChords = 0;
const shell = {
  paint() {},
  onKey: (ev: { code: number }) => {
    shellKeys.push(ev.code);
    return false;
  },
  onPointerButton: () => false,
  onSuperChord: () => superChords++,
  isLauncherOpen: () => false,
  desktopRaster: () => null,
  chromeRaster: () => null,
  ssdRaster: () => raster("ssd", 0xff111111, 1),
  setLocked() {},
  lockRaster: (view: { revision: number }) => raster("shell:lock", LOCK_MARK, view.revision),
  onLockPointer: () => null,
  setSecurePromptOpen: (open: boolean) => shellPrompt.push(open),
  securePromptRaster(view: SecurePromptView, w: number, h: number) {
    promptViews.push(view);
    if (promptUi === "throws") throw new Error("prompt UI exploded");
    assert.equal(w, width);
    assert.equal(h, height);
    return raster("shell:secure-prompt", PROMPT_MARK, view.revision + (view.pulsing ? 0.5 : 0));
  },
  onSecurePromptPointer: (ev: { button?: number; value?: number }) =>
    ev.button !== undefined && ev.value === 0 ? pointerAnswer : null,
  secureNoticeRaster: () => raster("shell:secure-notice", NOTICE_MARK, 1),
};
server.setShell(shell);

const words = (pixels: Uint8Array) =>
  new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength >>> 2);
const containsColor = (pixels: Uint8Array, color: number) =>
  words(pixels).some((word) => word >>> 0 === color >>> 0);
const MAGENTA = 0xffff00ff;
const GREEN = 0xff00ff00;
const YELLOW = 0xffffff00;
const CYAN = 0xff00ffff;
const ORANGE = 0xffff8001;
const CLIENT_COLOURS = [MAGENTA, GREEN, YELLOW, CYAN, ORANGE, 0xff0000ff];
const noClientColour = (pixels: Uint8Array) =>
  CLIENT_COLOURS.every((color) => !containsColor(pixels, color));
/** Force a fresh protected frame (the compositor skips unchanged ones) and return it. */
async function protectedFrame(): Promise<Uint8Array> {
  Object.assign(server, { promptFrameKey: "", lockFrameKey: "" });
  const before = flatFrames.length;
  const scenesBefore = scenes.length;
  await server.composite();
  assert.equal(flatFrames.length, before + 1, "one flat frame per protected composite");
  assert.equal(scenes.length, scenesBefore, "no retained scene (with client layers)");
  return flatFrames.at(-1)!;
}
const onKey = (code: number, value: number) => internals.onKey({ code, value, timeMs: 0 });
const tap = (code: number) => {
  onKey(code, 1);
  onKey(code, 0);
};
const pointerMotion = (dx: number, dy: number) => internals.onPointerMotion({ dx, dy, timeMs: 0 });
const pointerButton = (code: number, value: number) =>
  internals.onPointerButton({ code, value, timeMs: 0 });
const pointerAxis = (value: number) => internals.onPointerAxis({ value, timeMs: 0 });
const inputEvents = () => clients.map((entry) => [entry.events(KEYBOARD), entry.events(POINTER)]);

const PASSWORD = "tr0ub4dor";
const PASSWORD_KEYS = [20, 19, 11, 22, 48, 5, 32, 24, 19];
const KEY = { esc: 1, enter: 28, a: 30, l: 38, super: 125, backspace: 14 };
const checked: string[] = [];
const request = (patch: Partial<SecurePromptRequest> = {}): SecurePromptRequest => ({
  kind: "password",
  headline: "Authentication is required to add a user",
  requester: { name: "Settings", pid: 4242, x11: false },
  identities: [{ account: "ada", displayName: "Ada Lovelace" }],
  selected: 0,
  needsAdministrator: false,
  details: [],
  check: async (_identity, secret): Promise<SecurePromptVerdict> => {
    const answer = Buffer.from(secret).toString("utf8");
    checked.push(answer);
    return answer === PASSWORD ? "accepted" : "rejected";
  },
  ...patch,
});
const ask = (patch: Partial<SecurePromptRequest> = {}) => {
  const handle = server.securePrompts.request(request(patch));
  const box: { result: SecurePromptResult | null; cancel(): void } = {
    result: null,
    cancel: () => handle.cancel(),
  };
  void handle.result.then((result) => (box.result = result));
  return box;
};
const arm = () => clock.advance(SECURE_PROMPT_ARMING_MS);

const logged: string[] = [];
const original = { log: console.log, warn: console.warn, error: console.error };
for (const name of ["log", "warn", "error"] as const)
  console[name] = (...args: unknown[]) => logged.push(args.map(String).join(" "));
let cases = 0;
try {
  const a = client(1, MAGENTA, 20);
  const b = client(2, GREEN, 160);
  const x = client(3, CYAN, 200, true); // Xwayland
  server.setLockEnvironment({
    user: { name: "Test User", username: "test" },
    authenticate: async () => ({ verdict: "ok" }),
  });

  // No prompt: the clients are composed through the retained scene and take input.
  server.focusClient(a.session, 10);
  await server.composite();
  assert.ok(
    scenes.at(-1)?.layers.some((layer) => layer.id === "surface:1:10"),
    "sanity",
  );
  pointerMotion(20, 20); // over client 1: pointer enter
  assert.ok(a.events(POINTER, EVENTS.pointer.enter) >= 1);
  assert.ok(x.events(POINTER, EVENTS.pointer.motion) >= 1, "sanity: Xwayland follows the pointer");
  assert.equal(server.seatProtected, false);
  assert.equal(server.securePromptView(), null);
  cases++;

  // A request: the seat leaves the clients at once, before any frame.
  onKey(KEY.a, 1); // held from before the prompt
  const first = ask();
  assert.equal(server.securePromptOpen, true);
  assert.equal(server.seatProtected, true);
  assert.equal(server.locked, false, "a prompt is not a lock");
  assert.deepEqual(shellPrompt, [true]);
  assert.equal(a.events(KEYBOARD, EVENTS.keyboard.leave), 1, "keyboard focus left the client");
  assert.equal(a.events(POINTER, EVENTS.pointer.leave), 1, "pointer focus left the client");
  cases++;

  // Presentation: flat only, the prompt is drawn, and the frame does not depend on clients.
  const shown = await protectedFrame();
  assert.ok(containsColor(shown, PROMPT_MARK), "the shell's prompt is on screen");
  assert.ok(noClientColour(shown), "no client colour");
  assert.equal(promptViews.at(-1)?.headline, "Authentication is required to add a user");
  assert.equal(promptViews.at(-1)?.requester?.name, "Settings");
  a.surface.content = solid(YELLOW);
  b.surface.content = solid(0xff0000ff);
  const c = client(4, ORANGE, 60); // a window mapping while the prompt is up
  server.focusClient(c.session, 10);
  assert.equal(c.events(KEYBOARD, EVENTS.keyboard.enter), 0, "a new window gets no focus");
  assert.deepEqual(await protectedFrame(), shown, "identical whatever clients draw or map");
  const frames = flatFrames.length;
  await server.composite();
  assert.equal(flatFrames.length, frames, "an unchanged prompt is not redrawn");
  cases++;

  // Captures are refused while the prompt is up.
  assert.throws(() => server.capturePrimaryOutput(), /capture unavailable/);
  assert.equal(captures, 0, "the screen is never read back");
  cases++;

  // Input: nothing reaches any client or Xwayland; keys go to the prompt once it is armed.
  const before = inputEvents();
  onKey(KEY.a, 2); // the held key repeats
  tap(31);
  assert.equal(server.securePromptView()!.length, 0, "nothing types before the arming delay");
  arm();
  onKey(KEY.a, 2);
  assert.equal(server.securePromptView()!.length, 0, "a key held from before never types");
  onKey(KEY.a, 0);
  for (const code of [KEY.a, 31, 15, 56]) tap(code);
  pointerMotion(80, 0); // over client 2's old place
  pointerButton(0x110, 1);
  pointerButton(0x110, 0);
  pointerAxis(1);
  pointerMotion(100, 0); // over the X11 window's old place
  server.focusClient(b.session, 10);
  server.focusClient(x.session, 10);
  assert.deepEqual(inputEvents(), before, "no keyboard or pointer event reached a client");
  assert.equal(server.securePromptView()!.length, 2, "the letter keys went to the answer");
  cases++;

  // The verification key with a real prompt: its badge pulses, nothing else happens.
  onKey(KEY.super, 1);
  tap(KEY.esc);
  onKey(KEY.super, 0);
  assert.equal(server.securePromptOpen, true, "Super+Escape does not cancel");
  assert.equal(server.securePromptView()!.verifications, 1);
  assert.equal(server.securePromptView()!.pulsing, true);
  assert.equal(server.securePromptView()!.length, 2);
  assert.equal(internals.secureNoticeTimer, null, "no notice over a real prompt");
  assert.deepEqual(inputEvents(), before);
  cases++;

  // Fail closed: a throwing prompt UI leaves the compositor's own prompt, still client-free.
  promptUi = "throws";
  const fallback = await protectedFrame();
  assert.equal(server.securePromptOpen, true);
  assert.equal(first.result, null, "a failing UI answers nothing");
  assert.ok(!containsColor(fallback, PROMPT_MARK), "the broken UI is not drawn");
  assert.ok(noClientColour(fallback), "and no client shows through");
  assert.ok(
    logged.some((line) => line.includes("prompt UI failed")),
    "the failure is logged",
  );
  a.surface.content = solid(MAGENTA);
  assert.deepEqual(await protectedFrame(), fallback, "the fallback frame ignores clients too");
  tap(KEY.a);
  assert.equal(server.securePromptView()!.length, 3, "typing still works against the fallback");
  assert.notDeepEqual(await protectedFrame(), fallback, "and its dots follow");
  for (let index = 0; index < 3; index++) tap(KEY.backspace);
  cases++;

  // A wrong answer keeps the prompt; the right one completes it, restores focus and swallows
  // the Enter.
  tap(KEY.a);
  tap(KEY.a);
  tap(KEY.enter);
  await flush();
  await flush();
  assert.equal(first.result, null);
  assert.equal(server.securePromptView()!.phase, "wrong");
  assert.equal(server.securePromptView()!.failures, 1);
  for (const code of PASSWORD_KEYS) tap(code);
  const focusTarget = clients.find((entry) => entry.session === internals.focused)!;
  const entersBefore = focusTarget.events(KEYBOARD, EVENTS.keyboard.enter);
  const keysBefore = focusTarget.events(KEYBOARD, EVENTS.keyboard.key);
  onKey(KEY.enter, 1);
  await flush();
  await flush();
  assert.deepEqual(checked, ["aa", PASSWORD]);
  assert.deepEqual(first.result, {
    outcome: "completed",
    identity: { account: "ada", displayName: "Ada Lovelace" },
  });
  assert.equal(server.seatProtected, false);
  assert.deepEqual(shellPrompt, [true, false]);
  assert.equal(internals.securePromptQueue.typedBytes(), 0);
  assert.equal(
    focusTarget.events(KEYBOARD, EVENTS.keyboard.enter),
    entersBefore + 1,
    "keyboard focus returns to the focused window",
  );
  onKey(KEY.enter, 0); // the Enter that submitted is released after the prompt closed
  assert.equal(focusTarget.events(KEYBOARD, EVENTS.keyboard.key), keysBefore, "Enter swallowed");
  tap(KEY.a);
  assert.equal(focusTarget.events(KEYBOARD, EVENTS.keyboard.key), keysBefore + 2, "keys flow");
  await server.composite();
  assert.ok(
    scenes.at(-1)?.layers.some((layer) => layer.id.startsWith("surface:")),
    "clients back",
  );
  assert.doesNotThrow(() => server.capturePrimaryOutput(), "captures work again");
  promptUi = "ok";
  cases++;

  // Neither the shell nor the compositor's own painter can draw: the request ends as failed.
  {
    const doomed = ask();
    promptUi = "throws";
    const painter = Object.getOwnPropertyDescriptor(server, "paintPromptFallback");
    Object.assign(server, {
      paintPromptFallback: () => {
        throw new Error("no painter");
      },
    });
    const framesBefore = flatFrames.length;
    await server.composite();
    await flush();
    assert.deepEqual(doomed.result, { outcome: "failed" }, "never granted, never left unseen");
    assert.equal(flatFrames.length, framesBefore, "no half-drawn prompt frame is presented");
    assert.equal(server.seatProtected, false);
    assert.ok(logged.some((line) => line.includes("code=draw-failed")));
    if (painter) Object.defineProperty(server, "paintPromptFallback", painter);
    else delete (server as unknown as Record<string, unknown>).paintPromptFallback;
    promptUi = "ok";
    cases++;
  }

  // Pointer: the prompt UI's choice is the only thing a click can do.
  {
    const pending = ask({ coolDownKey: "settings:add-user" });
    arm();
    const untouched = inputEvents();
    pointerAnswer = { type: "cancel" };
    pointerButton(0x110, 1);
    pointerButton(0x110, 0);
    pointerAnswer = null;
    await flush();
    assert.deepEqual(pending.result, { outcome: "cancelled" });
    // The seat is back, so compare only what was sent while the prompt was up: leave, then the
    // refocus enter for the focused window.
    assert.deepEqual(
      inputEvents().map(([, pointer]) => pointer),
      untouched.map(([, pointer]) => pointer),
      "the click reached no client",
    );
    const again = ask({ coolDownKey: "settings:add-user" });
    await flush();
    assert.deepEqual(again.result, { outcome: "refused" }, "the cancel cool-down holds");
    assert.equal(server.seatProtected, false, "a refused request takes no seat");
    clock.advance(SECURE_PROMPT_COOL_DOWN_MS);
    cases++;
  }

  // The flood hook: three cancels of one key name the program once.
  {
    const floods: string[] = [];
    const unlisten = server.onSecurePromptFlood((program) => floods.push(program));
    const asks = Array.from({ length: 4 }, () => ask({ coolDownKey: "busctl:loop" }));
    arm();
    tap(KEY.esc);
    await flush();
    assert.deepEqual(
      asks.map((entry) => entry.result?.outcome),
      ["cancelled", "refused", "refused", "refused"],
    );
    assert.deepEqual(floods, ["Settings"]);
    assert.equal(server.seatProtected, false);
    unlisten();
    cases++;
  }

  // The lock cancels the visible prompt and holds the queue: never a prompt over the lock.
  {
    const visible = ask({ headline: "Visible" });
    const queued = ask({ headline: "Queued" });
    arm();
    tap(KEY.a);
    // Super+L still locks with a prompt open.
    onKey(KEY.super, 1);
    onKey(KEY.l, 1);
    onKey(KEY.l, 0);
    onKey(KEY.super, 0);
    await flush();
    assert.equal(server.locked, true, "Super+L locked");
    assert.deepEqual(visible.result, { outcome: "locked" });
    assert.equal(queued.result, null, "the queue is held");
    assert.equal(server.securePromptOpen, false);
    assert.equal(server.securePromptView(), null);
    assert.equal(internals.securePromptQueue.typedBytes(), 0);
    const locked = await protectedFrame();
    assert.ok(containsColor(locked, LOCK_MARK), "the lock screen is what is drawn");
    assert.ok(!containsColor(locked, PROMPT_MARK), "no prompt over the lock screen");
    const duringLock = ask({ headline: "Arrived while locked" });
    assert.equal(server.securePromptOpen, false, "a request while locked waits unseen");
    // The verification key does nothing visible on the lock screen.
    tap(KEY.a);
    const typed = server.lockScreenView().length;
    onKey(KEY.super, 1);
    tap(KEY.esc);
    onKey(KEY.super, 0);
    assert.equal(server.lockScreenView().length, typed, "it does not clear the lock's field");
    assert.equal(internals.secureNoticeTimer, null, "and shows no notice");
    assert.ok(!containsColor(await protectedFrame(), NOTICE_MARK));
    server.unlockSession("logind");
    assert.equal(server.locked, false);
    assert.equal(server.securePromptOpen, true, "the held request shows after unlock");
    assert.equal(server.securePromptView()!.headline, "Queued");
    const after = await protectedFrame();
    assert.ok(containsColor(after, PROMPT_MARK) && !containsColor(after, LOCK_MARK));
    arm();
    tap(KEY.esc);
    await flush();
    assert.deepEqual(queued.result, { outcome: "cancelled" });
    assert.equal(server.securePromptView()!.headline, "Arrived while locked");
    duringLock.cancel();
    await flush();
    assert.equal(server.seatProtected, false);
    cases++;
  }

  // The verification key with no prompt: the compositor's notice, and no client sees the key.
  {
    await server.composite();
    const focusTarget = clients.find((entry) => entry.session === internals.focused)!;
    const keys = () => clients.map((entry) => entry.events(KEYBOARD, EVENTS.keyboard.key));
    const chords = superChords;
    onKey(KEY.super, 1);
    const afterSuper = keys();
    const shellSaw = shellKeys.length;
    onKey(KEY.esc, 1);
    assert.notEqual(internals.secureNoticeTimer, null, "the notice is up");
    assert.equal(server.seatProtected, true, "over a protected frame, not over clients");
    assert.equal(server.securePromptOpen, false);
    assert.equal(superChords, chords + 1, "the shell learns Super was a chord");
    const notice = await protectedFrame();
    assert.ok(containsColor(notice, NOTICE_MARK), "the notice is drawn");
    assert.ok(noClientColour(notice), "with no client beside it");
    onKey(KEY.esc, 2);
    onKey(KEY.esc, 0);
    onKey(KEY.super, 0);
    assert.deepEqual(keys(), afterSuper, "Escape, its repeat and its release reach no client");
    assert.equal(shellKeys.length, shellSaw, "nor the shell");
    const enters = focusTarget.events(KEYBOARD, EVENTS.keyboard.enter);
    tap(KEY.a); // any key puts the notice away, and is not delivered
    assert.equal(internals.secureNoticeTimer, null);
    assert.equal(server.seatProtected, false);
    assert.deepEqual(keys(), afterSuper, "the dismissing key is swallowed");
    assert.equal(focusTarget.events(KEYBOARD, EVENTS.keyboard.enter), enters + 1, "focus is back");
    tap(KEY.a);
    assert.equal(
      focusTarget.events(KEYBOARD, EVENTS.keyboard.key),
      afterSuper[clients.indexOf(focusTarget)]! + 2,
      "keys flow again",
    );
    // With the shell's notice missing the compositor draws its own; a request replaces it.
    onKey(KEY.super, 1);
    tap(KEY.esc);
    onKey(KEY.super, 0);
    const noticeBridge = shell.secureNoticeRaster;
    Object.assign(shell, { secureNoticeRaster: undefined });
    const own = await protectedFrame();
    assert.ok(!containsColor(own, NOTICE_MARK) && noClientColour(own));
    assert.notDeepEqual(
      [...new Set(words(own))].length,
      1,
      "something is drawn (the backdrop and the empty shield)",
    );
    Object.assign(shell, { secureNoticeRaster: noticeBridge });
    const real = ask();
    assert.ok(containsColor(await protectedFrame(), PROMPT_MARK), "a real prompt takes over");
    internals.endSecureNotice();
    assert.equal(server.seatProtected, true, "the prompt keeps the seat when the notice ends");
    real.cancel();
    await flush();
    assert.equal(server.seatProtected, false);
    cases++;
  }

  // Two outputs: the prompt is on the one under the pointer, and the other is black.
  {
    Object.assign(server, {
      outputs: [single[0]!, { kms: kmsOutput(2), x: width, y: 0, scale120: 120, primary: false }],
      cursorX: width + 40,
      cursorY: 40,
    });
    const pending = ask();
    const frame = words(await protectedFrame());
    const stageWidth = width * 2;
    assert.equal(frame.length, stageWidth * height);
    let leftBlack = true;
    let markOnRight = false;
    for (let y = 0; y < height; y++)
      for (let column = 0; column < stageWidth; column++) {
        const pixel = frame[y * stageWidth + column]! >>> 0;
        if (column < width && pixel !== 0xff000000) leftBlack = false;
        if (column >= width && pixel === PROMPT_MARK) markOnRight = true;
      }
    assert.ok(markOnRight, "the prompt is on the output under the pointer");
    assert.ok(leftBlack, "the other output is black");
    pending.cancel();
    await flush();
    Object.assign(server, { outputs: single, cursorX: 40, cursorY: 40 });
    cases++;
  }

  // A pre-login compositor exposes no prompt: every request is refused unseen.
  {
    const greeter = new CompositorServer(fixture, "greeter", {
      mode: "greeter",
      clientPid: process.pid,
      devices: {
        open: failNative,
        close: failNative,
      },
    });
    const refused = await greeter.securePrompts.request(request()).result;
    assert.deepEqual(refused, { outcome: "refused" });
    assert.equal(greeter.securePromptOpen, false);
    assert.equal(greeter.seatProtected, false);
    cases++;
  }

  // Shutdown cancels whatever is open.
  {
    const open = ask();
    server.stop();
    await flush();
    assert.deepEqual(open.result, { outcome: "cancelled" });
    cases++;
  }
} finally {
  Object.assign(console, original);
  fs.rmSync(fixture, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
assert.ok(!logged.join("\n").includes(PASSWORD), "the answer never reached a log line");
console.log(`[secure-prompt-screen] ${cases} cases PASS`);

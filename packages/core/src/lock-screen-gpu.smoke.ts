/**
 * The locked frame on the GPU presentation path, portably: a CompositorServer drives the real
 * `EglCompositorOutputRenderer` and the real `EglOutputScaler` methods (`beginComposition`,
 * `beginFrame`, `renderOutputDirect`) over a fake GL that tracks texture storage, uploads and
 * which texture each output draw samples. No DRM, GPU or devices.
 *
 * - After retained desktop frames, the locked frame (flat) is uploaded into allocated storage
 *   and the output pass samples exactly that frame. (r55: a retained frame recorded its scene
 *   size as the flat texture's size, the flat upload went to an unallocated texture, and every
 *   output sampled an incomplete texture: black.)
 * - The lock UI, or the compositor's prompt when the shell's UI throws, is on exactly one
 *   output: the one under the pointer, else the primary; the others are black; no client pixel.
 * - Output selection with absolute (tablet) pointer coordinates and with no pointer motion.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeHeader, type EncodedWaylandMessage } from "@moire/protocol";
import { wlCompositor, wlDisplay, wlRegistry } from "@moire/protocol/generated";
import { loadTheme, setTheme } from "@moire/theme";
import { EglOutputScaler, type KmsOutput } from "@moire/sys";
import { EglCompositorOutputRenderer } from "./output-renderer";
import type { LockScreenView } from "./session-lock";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-lock-gpu-"));
const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
const { CompositorServer, ClientSession } = await import("./server");
// The scaler's GL name allocation goes through koffi out-pointers.
const koffi = createRequire(fileURLToPath(new URL("../../sys/package.json", import.meta.url)))(
  "koffi",
) as { encode(ref: unknown, type: string, value: number): void };

// ---- Fake GL -------------------------------------------------------------------------------

const GL_TEXTURE0 = 0x84c0;
const GL_FRAMEBUFFER_COMPLETE = 0x8cd5;
type Texture = { width: number; height: number; pixels: Uint8Array };
type Draw = { framebuffer: number; sampled: number; snapshot: Texture | null };

class FakeGl {
  readonly textures = new Map<number, Texture>();
  readonly errors: string[] = [];
  readonly draws: Draw[] = [];
  private readonly bound = new Map<number, number>();
  private unit = 0;
  private framebuffer = 0;
  private nextName = 100;

  private texture(): number {
    return this.bound.get(this.unit) ?? 0;
  }

  readonly fns: Record<string, (...args: never[]) => unknown> = {
    glGenTextures: (_count: number, out: unknown) =>
      koffi.encode(out, "unsigned int", this.nextName++),
    glActiveTexture: (unit: number) => void (this.unit = unit - GL_TEXTURE0),
    glBindTexture: (_target: number, texture: number) => void this.bound.set(this.unit, texture),
    glTexImage2D: (...args: never[]) => {
      const [, , , width, height, , , , data] = args as unknown as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        Uint8Array | null,
      ];
      const pixels = new Uint8Array(width * height * 4);
      if (data) pixels.set(data.subarray(0, pixels.byteLength));
      this.textures.set(this.texture(), { width, height, pixels });
    },
    glTexSubImage2D: (...args: never[]) => {
      const [, , x, y, width, height, , , data] = args as unknown as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        Uint8Array,
      ];
      const texture = this.textures.get(this.texture());
      if (!texture || x + width > texture.width || y + height > texture.height) {
        // GLES: GL_INVALID_VALUE, nothing is uploaded.
        this.errors.push(`glTexSubImage2D ${width}x${height} into texture ${this.texture()}`);
        return;
      }
      for (let row = 0; row < height; row++)
        texture.pixels.set(
          data.subarray(row * width * 4, (row + 1) * width * 4),
          ((y + row) * texture.width + x) * 4,
        );
    },
    glBindFramebuffer: (_target: number, framebuffer: number) =>
      void (this.framebuffer = framebuffer),
    glCheckFramebufferStatus: () => GL_FRAMEBUFFER_COMPLETE,
    glDrawArrays: () => {
      const sampled = this.bound.get(0) ?? 0;
      const texture = this.textures.get(sampled);
      this.draws.push({
        framebuffer: this.framebuffer,
        sampled,
        snapshot: texture ? { ...texture, pixels: Uint8Array.from(texture.pixels) } : null,
      });
    },
  };

  fn(name: string): (...args: unknown[]) => unknown {
    return (this.fns[name] as ((...args: unknown[]) => unknown) | undefined) ?? (() => 0);
  }
}

const OUTPUT_FRAMEBUFFER = 900;

/** The real scaler methods over FakeGl; only the native context, GBM and fd plumbing are stubbed. */
function fakeScaler(gl: FakeGl): EglOutputScaler {
  const state: Record<string, unknown> = {
    info: { glRenderer: "fake", glVersion: "fake", eglExtensions: [] },
    clientVersion: 2,
    gl: { func: (signature: string) => gl.fn(/(gl\w+)\(/.exec(signature)![1]!) },
    program: 1,
    sourceTexture: 1,
    targetTexture: 2,
    sceneTexture: 3,
    backdropTexture: 4,
    blurTextureA: 5,
    blurTextureB: 6,
    framebuffer: 10,
    sceneFramebuffer: 11,
    blurFramebufferA: 12,
    blurFramebufferB: 13,
    outputSourceTexture: 1,
    layerTextures: new Map(),
    layerGeometry: new Map(),
    backdropCaches: new Map(),
    pixelIds: new WeakMap(),
    nextPixelId: 1,
    residentImages: new Map(),
    snapshotProgram: null,
    effectPositions: new Float32Array(8),
    effectTexCoords: new Float32Array(8),
    outputTexCoords: new Float32Array(8),
    layerSnapshots: new Map(),
    layerOrder: [],
    sceneClearColor: null,
    activeDamage: null,
    directTargets: new Map(),
    clientTargets: new Map(),
    currentClientPool: new Map(),
    nextClientTargetId: 1,
    compositionFrame: 0,
    sourceWidth: 0,
    sourceHeight: 0,
    sourceTextureWidth: 0,
    sourceTextureHeight: 0,
    sceneWidth: 0,
    sceneHeight: 0,
    backdropWidth: 0,
    backdropHeight: 0,
    blurWidth: 0,
    blurHeight: 0,
    targetWidth: 0,
    targetHeight: 0,
    readback: null,
    clientReadback: null,
    destroyed: false,
    measureTransfers: false,
    bindContext() {},
    // One GBM scanout target per output; its texture is what the output pass draws into.
    directTargetFor(output: { id: string; targetWidth: number; targetHeight: number }) {
      return {
        texture: 800,
        framebuffer: OUTPUT_FRAMEBUFFER,
        framebufferId: 7,
        stride: output.targetWidth * 4,
        width: output.targetWidth,
        height: output.targetHeight,
      };
    },
  };
  const target = Object.assign(Object.create(EglOutputScaler.prototype) as object, state);
  return new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === "string" && !(property in object)) {
        if (/^gl[A-Z]/.test(property)) return gl.fn(property);
        if (property.endsWith("Location")) return 0;
        throw new Error(`fake EGL scaler has no ${property}`);
      }
      return Reflect.get(object, property, receiver);
    },
  }) as unknown as EglOutputScaler;
}

// ---- Server fixture --------------------------------------------------------------------------

const failNative = (): never => {
  throw new Error("No native operation allowed in this fixture");
};
function kmsOutput(connectorId: number, width: number, height: number): KmsOutput {
  return {
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
  };
}

// Two heads side by side; the right one is shorter, so (500, 200) is on neither.
const LEFT = { kms: kmsOutput(1, 320, 240), x: 0, y: 0, scale120: 120, primary: true };
const RIGHT = { kms: kmsOutput(2, 320, 120), x: 320, y: 0, scale120: 120, primary: false };
const DESKTOP = { width: 640, height: 240 };

const gl = new FakeGl();
const renderer = new EglCompositorOutputRenderer(fakeScaler(gl), "direct");
const theme = loadTheme();
// The r55 image wallpaper never decoded: a missing image must still give a backdrop.
theme.wallpaper = { mode: "image", path: path.join(fixture, "missing.png") };
setTheme(theme);
const server = new CompositorServer(fixture);
Object.assign(server, {
  outputs: [LEFT, RIGHT],
  outputRenderer: renderer,
  theme,
  reducedMotion: true,
  syncHardwareCursor: () => false,
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
const MAGENTA = 0xffff00ff;
function client(id: number, x: number, y: number): void {
  const conn = new Connection();
  const session = new ClientSession(server, conn, id);
  (server as unknown as { clients: Set<unknown> }).clients.add(session);
  conn.request(wlDisplay.requests.getRegistry.encode(1, 2));
  const global = (name: string) =>
    conn.sent
      .filter((data) => decodeHeader(data).objectId === 2)
      .map((data) => wlRegistry.events.global.decode(data))
      .find((g) => g.interfaceValue === name)!;
  conn.request(
    wlRegistry.requests.bind.encode(2, global("wl_compositor").name, "wl_compositor", 4, 3),
  );
  conn.request(wlCompositor.requests.createSurface.encode(3, 10));
  const pixels = new Uint8Array(200 * 100 * 4);
  new Uint32Array(pixels.buffer).fill(MAGENTA);
  Object.assign(session.surfaceById(10)!, {
    role: "toplevel",
    mapped: true,
    x,
    y,
    width: 200,
    height: 100,
    bufferWidth: 200,
    bufferHeight: 100,
    stride: 200 * 4,
    opaque: true,
    content: {
      pixels,
      width: 200,
      height: 100,
      stride: 800,
      storage: "cpu" as const,
      destroy() {},
    },
    decoration: "client",
    title: `Client ${id}`,
  });
  server.registerToplevel(session, 10);
  server.focusClient(session, 10);
}

const LOCK_MARK = 0xff123456;
let lockUi: "ok" | "throws" = "ok";
const lockSizes: string[] = [];
const shell = {
  paint() {},
  onKey: () => false,
  onPointerButton: () => false,
  isLauncherOpen: () => false,
  desktopRaster: () => null,
  chromeRaster: () => null,
  ssdRaster: () => null,
  setLocked() {},
  lockRaster(view: LockScreenView, w: number, h: number) {
    lockSizes.push(`${w}x${h}`);
    if (lockUi === "throws") throw new Error("lock UI exploded");
    // Like the real shell: a full-output raster, mostly transparent, with the UI in the middle.
    const pixels = new Uint8Array(w * h * 4);
    const words = new Uint32Array(pixels.buffer);
    for (let y = (h >> 1) - 8; y < (h >> 1) + 8; y++)
      words.fill(LOCK_MARK, y * w + (w >> 1) - 8, y * w + (w >> 1) + 8);
    return {
      id: "shell:lock",
      pixels,
      width: w,
      height: h,
      stride: w * 4,
      revision: view.revision,
      x: 0,
      y: 0,
    };
  },
  onLockPointer: () => null,
};
server.setShell(shell as never);

const priv = server as unknown as {
  cursorX: number;
  cursorY: number;
  lockFrameKey: string;
  onPointerAbsolute(ev: object): void;
  onPointerMotion(ev: object): void;
  onKey(ev: object): void;
  lockOutput(): { kms: KmsOutput } | null;
};

/** What the scanout of one output shows: the output pass's sampled texture, cropped. */
function scanout(output: typeof LEFT): Uint32Array {
  const draws = gl.draws.length;
  const errors = gl.errors.length;
  const rendered = renderer.renderOutput({
    geometry: {
      id: output.kms.connectorName,
      x: output.x,
      y: output.y,
      width: output.kms.width,
      height: output.kms.height,
    },
    pixels: new Uint8Array(output.kms.size),
    physicalWidth: output.kms.width,
    physicalHeight: output.kms.height,
    pitch: output.kms.pitch,
  });
  assert.equal(rendered.framebufferId, 7, "the GBM direct path presented");
  assert.deepEqual(gl.errors.slice(errors), [], "no GL error in the output pass");
  const draw = gl.draws.at(-1);
  assert.ok(draw && gl.draws.length === draws + 1 && draw.framebuffer === OUTPUT_FRAMEBUFFER);
  assert.ok(draw.snapshot, `the output pass sampled texture ${draw.sampled}, which has no storage`);
  const source = draw.snapshot;
  const words = new Uint32Array(source.pixels.buffer);
  const out = new Uint32Array(output.kms.width * output.kms.height);
  for (let y = 0; y < output.kms.height; y++)
    out.set(
      words.subarray(
        (output.y + y) * source.width + output.x,
        (output.y + y) * source.width + output.x + output.kms.width,
      ),
      y * output.kms.width,
    );
  return out;
}
const has = (pixels: Uint32Array, color: number) => pixels.some((word) => word === color >>> 0);
const black = (pixels: Uint32Array) => pixels.every((word) => (word & 0xffffff) === 0);
/** A fresh locked composite, then both outputs' scanouts. */
async function lockedScanouts(): Promise<{ left: Uint32Array; right: Uint32Array }> {
  priv.lockFrameKey = "";
  const errors = gl.errors.length;
  await server.composite();
  assert.deepEqual(gl.errors.slice(errors), [], "the locked frame uploaded without a GL error");
  return { left: scanout(LEFT), right: scanout(RIGHT) };
}

let cases = 0;
const original = { log: console.log, warn: console.warn, error: console.error };
const logged: string[] = [];
for (const name of ["log", "warn", "error"] as const)
  console[name] = (...args: unknown[]) => logged.push(args.map(String).join(" "));
try {
  server.setLockEnvironment({
    user: { name: "Test User", username: "test" },
    authenticate: async () => ({ verdict: "wrong" }),
  });
  client(1, 40, 40);
  client(2, 360, 10);

  // The desktop composes through the retained GPU scene, as on the native session.
  priv.cursorX = 100;
  priv.cursorY = 100;
  await server.composite();
  await server.composite();
  assert.ok(gl.textures.has(3), "the retained scene texture was drawn");
  assert.ok(
    !gl.textures.has(1),
    "the flat source texture was never allocated (desktop is retained)",
  );
  scanout(LEFT);
  assert.equal(gl.draws.at(-1)?.sampled, 3, "sanity: the desktop scanout samples the scene");
  cases++;

  // Super+L: the locked frame reaches the scanout, with the UI on the pointer's output.
  priv.onKey({ code: 125, value: 1, timeMs: 0 });
  priv.onKey({ code: 38, value: 1, timeMs: 0 });
  priv.onKey({ code: 38, value: 0, timeMs: 0 });
  priv.onKey({ code: 125, value: 0, timeMs: 0 });
  assert.equal(server.locked, true);
  let frame = await lockedScanouts();
  assert.ok(
    has(frame.left, LOCK_MARK),
    "the lock UI is on the GPU scanout of the pointer's output",
  );
  assert.ok(!black(frame.left), "and the obscured wallpaper behind it (image missing: gradient)");
  assert.ok(black(frame.right), "the other output is black");
  assert.ok(!has(frame.left, MAGENTA) && !has(frame.right, MAGENTA), "no client pixel");
  assert.equal(lockSizes.at(-1), "320x240", "the UI is sized for its output");
  cases++;

  // Absolute (tablet) pointer: normalised coordinates over the whole desktop.
  priv.onPointerAbsolute({ x: 0.9, y: 0.2, timeMs: 0 }); // (575, 48): the right head
  assert.equal(priv.lockOutput()?.kms.connectorId, 2);
  frame = await lockedScanouts();
  assert.ok(has(frame.right, LOCK_MARK) && black(frame.left), "the UI follows a tablet pointer");
  assert.equal(lockSizes.at(-1), "320x120");
  priv.onPointerAbsolute({ x: 500 / 639, y: 200 / 239, timeMs: 0 }); // on neither head
  assert.equal(priv.cursorX, 500);
  assert.equal(priv.lockOutput()?.kms.connectorId, 1, "off every output: the primary");
  frame = await lockedScanouts();
  assert.ok(has(frame.left, LOCK_MARK) && black(frame.right));
  priv.onPointerMotion({ dx: -400, dy: -150, timeMs: 0 }); // relative motion still works
  assert.equal(priv.lockOutput()?.kms.connectorId, 1);
  cases++;

  // No pointer motion since boot: the start-up cursor (desktop centre), and the constructor's.
  priv.cursorX = Math.floor(DESKTOP.width / 2);
  priv.cursorY = Math.floor(DESKTOP.height / 2);
  assert.equal(priv.lockOutput()?.kms.connectorId, 1, "(320, 120) is below the right head");
  const fresh = new CompositorServer(fixture) as unknown as typeof priv;
  Object.assign(fresh, { outputs: [RIGHT, { ...LEFT, primary: false }] });
  assert.equal(fresh.lockOutput()?.kms.connectorId, 1, "the boot cursor's output");
  Object.assign(fresh, { outputs: [RIGHT, { ...LEFT, x: 640 }] });
  assert.equal(fresh.lockOutput()?.kms.connectorId, 1, "off every output: the primary");
  Object.assign(fresh, { outputs: [RIGHT, { ...LEFT, x: 640, primary: false }] });
  assert.equal(fresh.lockOutput()?.kms.connectorId, 2, "no primary: the first output");
  cases++;

  // Fail closed on the GPU path: a throwing UI gives the compositor's prompt, still one output.
  lockUi = "throws";
  frame = await lockedScanouts();
  assert.equal(server.locked, true);
  assert.ok(!has(frame.left, LOCK_MARK), "the broken UI is not drawn");
  assert.ok(!black(frame.left), "the compositor's prompt and backdrop are");
  assert.ok(black(frame.right), "the other output stays black");
  assert.ok(!has(frame.left, MAGENTA), "no client pixel");
  assert.ok(logged.some((line) => line.includes("lock UI failed")));
  cases++;

  // Unlocking returns to the retained scene, and the next lock still reaches the scanout.
  assert.equal(server.unlockSession("logind"), true);
  await server.composite();
  scanout(LEFT);
  assert.equal(gl.draws.at(-1)?.sampled, 3, "the desktop is back on the scene texture");
  lockUi = "ok";
  void server.lockSession("request");
  frame = await lockedScanouts();
  assert.ok(has(frame.left, LOCK_MARK) && black(frame.right), "a second lock is shown too");
  server.unlockSession("logind");
  cases++;
} finally {
  Object.assign(console, original);
  fs.rmSync(fixture, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
console.log(`[lock-screen-gpu] ${cases} cases PASS`);

/** Production scene/CPU blit and retained adapter proof; no DRM/GPU/scanout claims. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { RetainedSoftwareRenderer } from "@moire/react-host";
import { PNG } from "pngjs";
import { wlDisplay, wlRegistry, wlCompositor } from "@moire/protocol/generated";
import type { EncodedWaylandMessage } from "@moire/protocol";
import { applyThemeFamily, loadTheme, setTheme, THEME_FAMILIES, windowChrome } from "@moire/theme";
import type { KmsOutput, EglCompositionScene } from "@moire/sys";
import { EglResidentImage } from "@moire/sys";
import type { CompositionScene, PixelSurface } from "./composition";
import { validateCompositionScene } from "./composition";
import { EglCompositorOutputRenderer, createCompositorOutputRenderer } from "./output-renderer";
import { WindowBorderPainter } from "./window-border";
import { contentShapeCoverage } from "./window-content-shape";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-window-border-"));
const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
const { CompositorServer, ClientSession } = await import("./server");
class SchedulingServer extends CompositorServer {
  dirtyCalls = 0;
  override markDirty(): void {
    this.dirtyCalls++;
    super.markDirty();
  }
}
const server = new SchedulingServer(fixture);
const base = loadTheme();
const width = 384,
  height = 300;
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
// Unavailable physical output prevents submission. The native cursor seam is
// deliberately disabled, while both real compositor scene builders still run.
Object.assign(server, {
  outputs: [{ kms: output, x: 0, y: 0, scale120: 120, primary: true }],
  // Flat/retained parity: windows show settled rather than mid-entrance.
  reducedMotion: true,
  syncHardwareCursor: () => false,
  cursorX: -100,
  cursorY: -100,
});
class Connection extends EventEmitter {
  readonly peerPid = null;
  send(): boolean {
    return true;
  }
  close(): void {
    this.emit("close");
  }
  request(message: EncodedWaylandMessage): void {
    this.emit("message", message);
  }
}
function client(id: number) {
  const conn = new Connection();
  const session = new ClientSession(server, conn, id);
  conn.request(wlDisplay.requests.getRegistry.encode(1, 2));
  conn.request(wlRegistry.requests.bind.encode(2, 1, "wl_compositor", 4, 3));
  conn.request(wlCompositor.requests.createSurface.encode(3, 10));
  const surface = session.surfaceById(10);
  assert.ok(surface);
  Object.assign(surface, {
    role: "toplevel",
    mapped: true,
    x: 18 + id * 10,
    y: 24 + id * 14,
    width: 160,
    height: 120,
    bufferWidth: 160,
    bufferHeight: 120,
    stride: 640,
    content: {
      ...solid(160, 120, id === 1 ? 0xff282a38 : 0xff353842),
      storage: "cpu",
      destroy() {},
    },
    decoration: id === 1 ? "client" : "server",
    title: id === 1 ? "CSD" : "SSD",
  });
  server.registerToplevel(session, 10);
  return { conn, session, surface };
}
function solid(w: number, h: number, color: number): PixelSurface {
  const pixels = new Uint8Array(w * h * 4);
  new Uint32Array(pixels.buffer).fill(color);
  return { pixels, width: w, height: h, stride: w * 4, revision: 1 };
}
const lower = client(1),
  upper = client(2);
let latestScene: CompositionScene | null = null;
let latestFlat: PixelSurface | null = null;
const retainedPixels = new RetainedSoftwareRenderer();
type Scaler = ConstructorParameters<typeof EglCompositorOutputRenderer>[0];
class ScalerFixture implements Scaler {
  readonly execution = "unknown";
  readonly info = {
    eglVendor: "fixture",
    eglVersion: "fixture",
    eglExtensions: "",
    glVendor: "fixture",
    glRenderer: "fixture",
    glVersion: "fixture",
  };
  rendered: Uint8Array | null = null;
  beginFrame(pixels: Uint8Array) {
    this.rendered = pixels;
  }
  beginComposition(scene: EglCompositionScene) {
    this.rendered = retainedPixels.render({
      width: scene.width,
      height: scene.height,
      clearColor: scene.clearColor,
      layers: scene.layers.map((layer) => {
        assert.ok(!(layer.pixels instanceof EglResidentImage));
        assert.equal(layer.transform, undefined);
        assert.ok(
          !layer.surfaceGeometry || layer.contentShape,
          "geometry cohort requires the actual frame mask",
        );
        // The portable oracle has no frame-in-buffer primitive. Materialize
        // only this CPU fixture's mask; production passes it directly to EGL.
        const pixels = layer.contentShape ? layer.pixels.slice() : layer.pixels;
        if (layer.contentShape) {
          for (let y = 0; y < layer.sourceHeight; y++)
            for (let x = 0; x < layer.sourceWidth; x++) {
              let coverage = contentShapeCoverage(
                layer.contentShape,
                layer.destination.x + ((x + 0.5) * layer.destination.width) / layer.sourceWidth,
                layer.destination.y + ((y + 0.5) * layer.destination.height) / layer.sourceHeight,
              );
              const offset = y * layer.sourceStride + x * 4;
              const { bounds } = layer.contentShape;
              const sceneX =
                layer.destination.x + ((x + 0.5) * layer.destination.width) / layer.sourceWidth;
              const sceneY =
                layer.destination.y + ((y + 0.5) * layer.destination.height) / layer.sourceHeight;
              if (
                pixels[offset + 3] === 255 &&
                (sceneX < bounds.x ||
                  sceneY < bounds.y ||
                  sceneX >= bounds.x + bounds.width ||
                  sceneY >= bounds.y + bounds.height)
              )
                coverage = 0;
              for (let channel = 0; channel < 4; channel++)
                pixels[offset + channel] = Math.round(pixels[offset + channel]! * coverage);
            }
        }
        return {
          id: layer.id,
          pixels,
          sourceWidth: layer.sourceWidth,
          sourceHeight: layer.sourceHeight,
          sourceStride: layer.sourceStride,
          revision: layer.revision ?? 0,
          destination: layer.destination,
          sampling: layer.sampling,
          opacity: layer.opacity,
          dropShadow: layer.dropShadow,
          cornerRadius: typeof layer.cornerRadius === "number" ? layer.cornerRadius : undefined,
        };
      }),
    }).pixels;
    return null;
  }
  renderOutput(): void {
    failNative();
  }
  renderOutputDirect(): ReturnType<Scaler["renderOutputDirect"]> {
    return failNative();
  }
  snapshotDmabuf(): ReturnType<Scaler["snapshotDmabuf"]> {
    return failNative();
  }
  destroy(): void {}
}
const scaler = new ScalerFixture();
const retained = new EglCompositorOutputRenderer(scaler, "readback");
const flat = createCompositorOutputRenderer(-1, "software");
const observer = {
  ...flat,
  id: flat.id,
  detail: flat.detail,
  capabilities: flat.capabilities,
  renderingGeneration: flat.renderingGeneration,
  beginFrame(scene: PixelSurface) {
    latestFlat = scene;
    flat.beginFrame(scene);
  },
  renderOutput: flat.renderOutput.bind(flat),
  captureOutput: flat.captureOutput.bind(flat),
  destroy: flat.destroy.bind(flat),
};
const retainedObserver = {
  id: retained.id,
  detail: retained.detail,
  capabilities: retained.capabilities,
  renderingGeneration: retained.renderingGeneration,
  beginFrame: retained.beginFrame.bind(retained),
  beginComposition(scene: CompositionScene) {
    latestScene = scene;
    validateCompositionScene(scene);
    retained.beginComposition(scene);
  },
  renderOutput: retained.renderOutput.bind(retained),
  captureOutput: retained.captureOutput.bind(retained),
  destroy: retained.destroy.bind(retained),
};
const header = solid(160, 40, 0xff171820);
server.setShell({
  paint() {},
  onKey: () => false,
  onPointerButton: () => false,
  isLauncherOpen: () => false,
  desktopRaster: () => null,
  chromeRaster: () => null,
  ssdRaster(window) {
    return {
      ...header,
      id: `ssd:${window.clientId}:${window.surfaceId}`,
      revision: 1,
      x: window.x,
      y: window.y,
      width: window.contentW,
      height: base.tokens.titlebarHeight,
    };
  },
  paintSsdWindow(fb, pitch, w, h, window) {
    server.paintWindowBorder(fb, pitch, w, h, [
      {
        id: "fixture-ssd",
        z: 0,
        source: header,
        destination: {
          x: window.x,
          y: window.y,
          width: window.contentW,
          height: base.tokens.titlebarHeight,
        },
      },
    ]);
  },
});
let cases = 0;
const hashes: Record<string, string> = {};
const captureRoot = process.env.MOIRE_BORDER_CAPTURE_DIR;
if (captureRoot) fs.mkdirSync(captureRoot, { recursive: true });
function png(name: string, pixels: Uint8Array, w = width, h = height) {
  hashes[name] = createHash("sha256").update(pixels).digest("hex");
  if (!captureRoot) return;
  const image = new PNG({ width: w, height: h });
  for (let i = 0; i < pixels.length; i += 4) {
    image.data[i] = pixels[i + 2]!;
    image.data[i + 1] = pixels[i + 1]!;
    image.data[i + 2] = pixels[i]!;
    image.data[i + 3] = pixels[i + 3]!;
  }
  fs.writeFileSync(path.join(captureRoot, `${name}.png`), PNG.sync.write(image));
}
function words(pixels: Uint8Array) {
  return new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4);
}
function sceneNow(): CompositionScene {
  assert.ok(latestScene);
  return latestScene;
}
function flatNow(): PixelSurface {
  assert.ok(latestFlat);
  return latestFlat;
}
try {
  for (const family of THEME_FAMILIES)
    for (const dark of [true, false]) {
      const theme = applyThemeFamily(base, family, dark);
      // Fixed wallpaper removes time drift from the repaint/differential oracle.
      theme.wallpaper = { mode: "solid", color: "#101018" };
      setTheme(theme);
      Object.assign(server, { theme });
      let previousFocusedEdge: PixelSurface | undefined;
      for (const focused of [lower, upper]) {
        const dirtyBeforeFocus = server.dirtyCalls;
        server.focusClient(focused.session, 10);
        assert.ok(
          server.dirtyCalls > dirtyBeforeFocus,
          "compositor focus wakes chrome repaint without client commit",
        );
        const frame = server.frameBox(focused.surface);
        const before = { ...frame };
        const border = server.windowBorderLayers(focused.session, focused.surface, 0);
        assert.equal(border.length, 8);
        assert.deepEqual(
          server.frameBox(focused.surface),
          before,
          "paint must not change hit/allocation geometry",
        );
        const totalBytes = border.reduce((total, layer) => total + layer.source.pixels.length, 0);
        assert.ok(totalBytes < 20_000, "small patches must not allocate a whole-window raster");
        assert.ok(
          border.every(
            (layer) =>
              layer.destination.x >= frame.x &&
              layer.destination.y >= frame.y &&
              layer.destination.x + layer.destination.width <= frame.x + frame.w &&
              layer.destination.y + layer.destination.height <= frame.y + frame.h,
          ),
        );
        const borderOnly = new Uint32Array(width * height).fill(0xff101018);
        server.paintWindowBorder(borderOnly, width, width, height, border);
        const topMiddle = Math.floor(frame.x + frame.w / 2) + frame.y * width;
        assert.equal(borderOnly[topMiddle], windowChrome(theme, true).color);
        assert.equal(
          borderOnly[(frame.y + 10) * width + frame.x + 10],
          0xff101018,
          "border never fills client interior",
        );
        assert.equal(
          borderOnly[frame.y * width + frame.x],
          0xff101018,
          "rounded corner preserves uncovered pixels",
        );
        const exact = new EglCompositorOutputRenderer(scaler, "readback");
        exact.beginComposition({ width, height, clearColor: 0xff101018, layers: border });
        assert.ok(scaler.rendered);
        // The existing compositor blitter truncates alpha blends; the retained
        // CPU renderer rounds them. Only partially covered corner RGB samples
        // may differ by one; opaque edges and unaffected pixels stay exact.
        const cpuBorder = new Uint8Array(borderOnly.buffer);
        for (let byte = 0; byte < cpuBorder.length; byte++) {
          assert.ok(
            Math.abs(cpuBorder[byte]! - scaler.rendered[byte]!) <= 1,
            `border differential exceeded existing alpha rounding at byte ${byte}`,
          );
          if (
            byte % 4 === 3 ||
            borderOnly[Math.floor(byte / 4)] === 0xff101018 ||
            borderOnly[Math.floor(byte / 4)] === windowChrome(theme, true).color
          )
            assert.equal(cpuBorder[byte], scaler.rendered[byte]);
        }
        Object.assign(server, { outputRenderer: observer });
        await server.composite();
        const cpu = flatNow().pixels.slice();
        Object.assign(server, { outputRenderer: retainedObserver });
        await server.composite();
        const scene = sceneNow();
        const indices = scene.layers.flatMap((layer, index) =>
          layer.id.startsWith(`window:${focused.session.clientId}:10:edge:`) ? [index] : [],
        );
        assert.equal(
          indices.length,
          8,
          "actual retained production path has exactly one outline owner",
        );
        const contentIndex = scene.layers.findIndex(
          (layer) => layer.id === `surface:${focused.session.clientId}:10`,
        );
        assert.ok(indices[0]! > contentIndex);
        if (focused === upper)
          assert.ok(indices[0]! > scene.layers.findIndex((layer) => layer.id === "ssd:2:10"));
        assert.ok(scaler.rendered);
        assert.equal(
          words(cpu)[topMiddle],
          windowChrome(theme, true).color,
          "actual flat composition paints focused outer edge",
        );
        assert.equal(
          words(scaler.rendered)[topMiddle],
          windowChrome(theme, true).color,
          "actual retained scene paints same focused outer edge",
        );
        const lowerEdge = scene.layers.find((layer) => layer.id === "window:1:10:edge:0");
        assert.ok(lowerEdge);
        if (focused === lower) previousFocusedEdge = lowerEdge.source;
        else {
          assert.ok(previousFocusedEdge);
          assert.notEqual(
            lowerEdge.source,
            previousFocusedEdge,
            "focus recolor replaces immutable retained source identity",
          );
          assert.equal(
            words(previousFocusedEdge.pixels)[0],
            windowChrome(theme, true).color,
            "earlier accepted scene's source stays immutable",
          );
          assert.equal(words(lowerEdge.source.pixels)[0], windowChrome(theme, false).color);
          const inactiveFrame = server.frameBox(lower.surface);
          const inactiveTop =
            inactiveFrame.y * width + inactiveFrame.x + Math.floor(inactiveFrame.w / 2);
          assert.equal(words(cpu)[inactiveTop], windowChrome(theme, false).color);
          assert.equal(
            words(scaler.rendered)[inactiveTop],
            windowChrome(theme, false).color,
            "consecutive retained scene actually shows focus recolor",
          );
        }
        const inactive = focused === lower ? upper : lower;
        const quiet = server.windowBorderLayers(inactive.session, inactive.surface, 0);
        assert.equal(words(quiet[0]!.source.pixels)[0], windowChrome(theme, false).color);
        if (focused === upper) {
          const lowerFrame = server.frameBox(lower.surface);
          const occluded =
            (lowerFrame.y + lowerFrame.h - 1) * width + lowerFrame.x + Math.floor(lowerFrame.w / 2);
          assert.equal(
            words(cpu)[occluded],
            0xff353842,
            "higher SSD content covers lower outline in flat stack slot",
          );
          assert.equal(
            words(scaler.rendered)[occluded],
            0xff353842,
            "higher SSD content covers lower outline in retained stack slot",
          );
        }
        png(`${theme.name}-${focused === lower ? "csd" : "ssd"}-focused`, scaler.rendered);
        retained.beginComposition({
          ...scene,
          layers: scene.layers.filter((layer) => !layer.id.includes(":edge:")),
        });
        assert.ok(scaler.rendered);
        png(
          `${theme.name}-${focused === lower ? "csd" : "ssd"}-outline-omitted-control`,
          scaler.rendered,
        );
        cases++;
      }
    }
  const theme = applyThemeFamily(base, "moire", true);
  theme.wallpaper = { mode: "solid", color: "#101018" };
  setTheme(theme);
  Object.assign(server, { theme });
  // Isolated actual parent/header scene: compare corners with the underlying
  // layers, including SSD shadow, rather than painting wallpaper into them.
  for (const owner of [lower, upper]) {
    const other = owner === lower ? upper : lower;
    other.surface.mapped = false;
    owner.surface.mapped = true;
    owner.surface.opaque = true;
    server.focusClient(owner.session, 10);
    const frame = server.frameBox(owner.surface);
    Object.assign(server, { outputRenderer: observer });
    await server.composite();
    const cpu = flatNow().pixels.slice();
    Object.assign(server, { outputRenderer: retainedObserver });
    await server.composite();
    const actualScene = sceneNow();
    assert.ok(scaler.rendered);
    const actual = scaler.rendered.slice();
    const parent = actualScene.layers.find(
      (layer) => layer.id === `surface:${owner.session.clientId}:10`,
    );
    assert.ok(parent?.contentShape);
    assert.deepEqual(parent.contentShape.bounds, {
      x: frame.x,
      y: frame.y,
      width: frame.w,
      height: frame.h,
    });
    const headerLayer = actualScene.layers.find(
      (layer) => layer.id === `ssd:${owner.session.clientId}:10`,
    );
    if (headerLayer) assert.deepEqual(headerLayer.contentShape, parent.contentShape);
    retained.beginComposition({
      ...actualScene,
      layers: actualScene.layers.filter(
        (layer) =>
          layer !== parent &&
          layer !== headerLayer &&
          !layer.id.startsWith(`window:${owner.session.clientId}:10:edge:`),
      ),
    });
    assert.ok(scaler.rendered);
    for (const [x, y] of [
      [frame.x, frame.y],
      [frame.x + frame.w - 1, frame.y],
      [frame.x, frame.y + frame.h - 1],
      [frame.x + frame.w - 1, frame.y + frame.h - 1],
    ]) {
      const pixel = y! * width + x!;
      assert.equal(
        words(cpu)[pixel],
        0xff101018,
        "flat parent/header cannot fill exterior curved corner",
      );
      assert.equal(
        words(actual)[pixel],
        words(scaler.rendered)[pixel],
        "retained corner preserves actual underlying scene including shadow",
      );
    }
    const interior = (frame.y + frame.h - 12) * width + frame.x + 12;
    assert.equal(words(cpu)[interior], owner === lower ? 0xff282a38 : 0xff353842);
    assert.equal(words(actual)[interior], words(cpu)[interior]);
    png(`moire-dark-${owner === lower ? "csd" : "ssd"}-shaped-parent`, actual);
    const scaledRenderer = createCompositorOutputRenderer(-1, "software");
    scaledRenderer.beginFrame({ pixels: actual, width, height, stride: width * 4 });
    const physicalWidth = width * 1.5,
      physicalHeight = height * 1.5;
    const scaledPixels = new Uint8Array(physicalWidth * physicalHeight * 4);
    scaledRenderer.renderOutput({
      geometry: { id: "shaped-scale", x: 0, y: 0, width, height },
      physicalWidth,
      physicalHeight,
      pitch: physicalWidth * 4,
      pixels: scaledPixels,
    });
    assert.notEqual(
      words(scaledPixels)[Math.ceil(frame.y * 1.5) * physicalWidth + Math.ceil(frame.x * 1.5)],
      owner === lower ? 0xff282a38 : 0xff353842,
      "physical scaling cannot refill masked corner",
    );
    png(
      `moire-dark-${owner === lower ? "csd" : "ssd"}-shaped-scale1.5`,
      scaledPixels,
      physicalWidth,
      physicalHeight,
    );
    scaledRenderer.destroy();
    owner.surface.opaque = false;
    other.surface.mapped = true;
  }
  // Real geometry offset inside a padded CSD buffer. Translucent padding is a
  // shadow, opaque padding is not; neither determines the rounded frame origin.
  upper.surface.mapped = false;
  const originalContent = lower.surface.content;
  const padded = solid(160, 120, 0xff282a38);
  const paddedWords = words(padded.pixels);
  for (let y = 0; y < 120; y++)
    for (let x = 0; x < 160; x++)
      if (x < 8 || y < 8 || x >= 148 || y >= 108)
        paddedWords[y * 160 + x] = x === 0 ? 0xff707070 : 0x40100804;
  Object.assign(lower.surface, {
    geomX: 8,
    geomY: 8,
    geomW: 140,
    geomH: 100,
    content: { ...padded, storage: "cpu", destroy() {} },
  });
  Object.assign(server, { outputRenderer: observer });
  await server.composite();
  const paddedFlat = flatNow().pixels.slice();
  Object.assign(server, { outputRenderer: retainedObserver });
  await server.composite();
  assert.ok(scaler.rendered);
  const paddedFrame = server.frameBox(lower.surface);
  for (const pixels of [paddedFlat, scaler.rendered]) {
    assert.equal(
      words(pixels)[paddedFrame.y * width + paddedFrame.x],
      0xff101018,
      "geometry frame corner masks opaque buffer fill",
    );
    assert.notEqual(
      words(pixels)[(lower.surface.y + 30) * width + lower.surface.x + 3],
      0xff101018,
      "translucent CSD padding survives outside frame",
    );
    assert.equal(
      words(pixels)[(lower.surface.y + 30) * width + lower.surface.x],
      0xff101018,
      "opaque CSD padding is discarded",
    );
    assert.equal(words(pixels)[(paddedFrame.y + 14) * width + paddedFrame.x + 14], 0xff282a38);
  }
  png("moire-dark-csd-padded-shape", scaler.rendered);
  const highDpiPixels = new Uint8Array(320 * 240 * 4);
  for (let y = 0; y < 240; y++)
    for (let x = 0; x < 320; x++) {
      const offset = (Math.floor(y / 2) * 160 + Math.floor(x / 2)) * 4;
      highDpiPixels.set(padded.pixels.subarray(offset, offset + 4), (y * 320 + x) * 4);
    }
  Object.assign(lower.surface, {
    bufferWidth: 320,
    bufferHeight: 240,
    stride: 1280,
    bufferScale: 2,
    content: {
      pixels: highDpiPixels,
      width: 320,
      height: 240,
      stride: 1280,
      revision: 2,
      storage: "cpu",
      destroy() {},
    },
  });
  for (const outputRenderer of [observer, retainedObserver]) {
    Object.assign(server, { outputRenderer });
    await server.composite();
    const pixels: Uint8Array | null =
      outputRenderer === observer ? flatNow().pixels : scaler.rendered;
    assert.ok(pixels);
    assert.equal(
      words(pixels)[paddedFrame.y * width + paddedFrame.x],
      0xff101018,
      "2x client buffer cannot change frame corner mask origin",
    );
    assert.equal(
      words(pixels)[(paddedFrame.y + 14) * width + paddedFrame.x + 14],
      0xff282a38,
      "2x client content stays visible inside logical frame",
    );
  }
  assert.ok(scaler.rendered);
  png("moire-dark-csd-buffer-scale2", scaler.rendered);
  Object.assign(lower.surface, {
    geomX: 0,
    geomY: 0,
    geomW: 0,
    geomH: 0,
    content: originalContent,
    bufferWidth: 160,
    bufferHeight: 120,
    stride: 640,
    bufferScale: 1,
  });
  upper.surface.mapped = true;
  // Real server surface-tree order: parent chrome stays below crossing
  // children, and popupStack remains above all windows/chrome.
  for (const owner of [lower, upper]) {
    server.focusClient(owner.session, 10);
    owner.conn.request(wlCompositor.requests.createSurface.encode(3, 11));
    const child = owner.session.surfaceById(11);
    assert.ok(child);
    Object.assign(child, {
      role: "subsurface",
      parentId: 10,
      mapped: true,
      subX: -5,
      subY: owner === upper ? -(theme.tokens.titlebarHeight + 5) : -5,
      width: 30,
      height: 30,
      bufferWidth: 30,
      bufferHeight: 30,
      stride: 120,
      content: { ...solid(30, 30, 0xff1880a0), storage: "cpu", destroy() {} },
    });
    owner.surface.children.push(11);
    owner.session.layout();
    assert.equal(
      child.y,
      owner.surface.y - 5,
      "negative offset crosses actual parent-buffer/header origin",
    );
    Object.assign(server, { outputRenderer: observer });
    await server.composite();
    const childPixel = owner.surface.y * width + owner.surface.x + 15;
    assert.equal(
      words(flatNow().pixels)[childPixel],
      0xff1880a0,
      "negative-offset child covers parent chrome in flat path",
    );
    Object.assign(server, { outputRenderer: retainedObserver });
    await server.composite();
    assert.ok(scaler.rendered);
    assert.equal(
      words(scaler.rendered)[childPixel],
      0xff1880a0,
      "negative-offset child covers parent chrome in retained path",
    );
    const childIndex = sceneNow().layers.findIndex(
      (layer) => layer.id === `surface:${owner.session.clientId}:11`,
    );
    assert.ok(
      sceneNow()
        .layers.filter((layer) => layer.id.startsWith(`window:${owner.session.clientId}:10:edge:`))
        .every((layer) => layer.z < sceneNow().layers[childIndex]!.z),
    );
    if (owner === upper) {
      assert.equal(
        server.hitVisibleSsd(owner.surface.x + 15, owner.surface.y + 5),
        null,
        "visibly covering child vetoes SSD header action",
      );
      assert.equal(
        server.hitVisibleSsd(owner.surface.x + 60, owner.surface.y + 5)?.kind,
        "drag",
        "uncovered parent header retains drag",
      );
    }
    png(`moire-dark-${owner === lower ? "csd" : "ssd"}-crossing-child`, scaler.rendered);
    child.subX = 5;
    child.subY = 10;
    owner.session.layout();
    const paintedParent = server.surfacePaintLayer(owner.session, owner.surface, false, 0);
    assert.equal(child.x, paintedParent.destination.x + 5);
    assert.equal(
      child.y,
      paintedParent.destination.y + 10,
      "positive child aligns with real parent content, below SSD once",
    );
    owner.conn.request(wlCompositor.requests.createSurface.encode(3, 13));
    const nested = owner.session.surfaceById(13);
    assert.ok(nested);
    Object.assign(nested, { role: "subsurface", parentId: 11, subX: 3, subY: 4 });
    child.children.push(13);
    owner.session.layout();
    assert.equal(nested.x, paintedParent.destination.x + 8);
    assert.equal(
      nested.y,
      paintedParent.destination.y + 14,
      "nested child must not add SSD offset a second time",
    );
    const positivePixel = (child.y + 2) * width + child.x + 2;
    Object.assign(server, { outputRenderer: observer });
    await server.composite();
    assert.equal(words(flatNow().pixels)[positivePixel], 0xff1880a0);
    Object.assign(server, { outputRenderer: retainedObserver });
    await server.composite();
    assert.ok(scaler.rendered);
    assert.equal(words(scaler.rendered)[positivePixel], 0xff1880a0);
    png(`moire-dark-${owner === lower ? "csd" : "ssd"}-positive-child-alignment`, scaler.rendered);
    Object.assign(child, { mapped: false });
    owner.surface.children = owner.surface.children.filter((id) => id !== 11);
    owner.conn.request(wlCompositor.requests.createSurface.encode(3, 12));
    const popup = owner.session.surfaceById(12);
    assert.ok(popup);
    Object.assign(popup, {
      role: "popup",
      parentId: 10,
      mapped: true,
      popupRelX: 150,
      popupRelY: 30,
      width: 30,
      height: 30,
      bufferWidth: 30,
      bufferHeight: 30,
      stride: 120,
      content: { ...solid(30, 30, 0xffad346f), storage: "cpu", destroy() {} },
    });
    server.registerPopup(owner.session, 12);
    server.layoutPopup(owner.session, popup);
    assert.equal(
      owner.session.paintTree(10).includes(popup),
      false,
      "xdg popup has separate paint stack",
    );
    const popupPixel = (popup.y + 15) * width + owner.surface.x + 159;
    Object.assign(server, { outputRenderer: observer });
    await server.composite();
    assert.equal(words(flatNow().pixels)[popupPixel], 0xffad346f);
    Object.assign(server, { outputRenderer: retainedObserver });
    await server.composite();
    assert.ok(scaler.rendered);
    assert.equal(words(scaler.rendered)[popupPixel], 0xffad346f);
    const popupLayer = sceneNow().layers.find(
      (layer) => layer.id === `popup:${owner.session.clientId}:12`,
    );
    assert.ok(popupLayer);
    assert.ok(
      sceneNow()
        .layers.filter((layer) => layer.id.startsWith(`window:${owner.session.clientId}:10:edge:`))
        .every((layer) => layer.z < popupLayer.z),
    );
    png(`moire-dark-${owner === lower ? "csd" : "ssd"}-crossing-popup`, scaler.rendered);
    server.unregisterPopup(owner.session, 12);
    popup.mapped = false;
  }
  // The supported bulk-only shell seam paints a batch in each stack slot,
  // before its border/children, rather than erasing outlines in a late pass.
  const bulkCalls: number[] = [];
  server.setShell({
    paint() {},
    onKey: () => false,
    onPointerButton: () => false,
    isLauncherOpen: () => false,
    paintSsd(fb, pitch, w, h, windows) {
      for (const window of windows) {
        bulkCalls.push(window.clientId);
        server.paintWindowBorder(fb, pitch, w, h, [
          {
            id: "bulk-header",
            z: 0,
            source: header,
            destination: {
              x: window.x,
              y: window.y,
              width: window.contentW,
              height: theme.tokens.titlebarHeight,
            },
          },
        ]);
      }
    },
  });
  lower.surface.decoration = "server";
  server.focusClient(upper.session, 10);
  Object.assign(server, { outputRenderer: observer });
  await server.composite();
  assert.deepEqual(bulkCalls, [1, 2], "bulk seam called once for each actual SSD stack slot");
  const bulkFrame = server.frameBox(upper.surface);
  assert.equal(
    words(flatNow().pixels)[bulkFrame.y * width + bulkFrame.x + Math.floor(bulkFrame.w / 2)],
    windowChrome(theme, true).color,
    "late bulk painting cannot erase top border",
  );
  upper.surface.decoration = "client";
  await server.composite();
  const coveredHeader = (lower.surface.y + 20) * width + lower.surface.x + 70;
  assert.equal(
    words(flatNow().pixels)[coveredHeader],
    0xff353842,
    "higher CSD content occludes legacy bulk SSD chrome",
  );
  assert.equal(
    server.hitVisibleSsd(lower.surface.x + 70, lower.surface.y + 20),
    null,
    "higher window vetoes covered SSD action",
  );
  lower.surface.decoration = "client";
  upper.surface.decoration = "server";
  server.setShell({
    paint() {},
    onKey: () => false,
    onPointerButton: () => false,
    isLauncherOpen: () => false,
    desktopRaster: () => null,
    chromeRaster: () => null,
    ssdRaster(window) {
      return {
        ...header,
        revision: 1,
        id: `ssd:${window.clientId}:${window.surfaceId}`,
        x: window.x,
        y: window.y,
      };
    },
  });
  server.focusClient(lower.session, 10);
  Object.assign(lower.surface, { geomX: 5, geomY: 7, geomW: 130, geomH: 100 });
  const geometry = server.frameBox(lower.surface);
  const offsetBorder = server.windowBorderLayers(lower.session, lower.surface, 1);
  assert.equal(offsetBorder[0]!.destination.y, geometry.y);
  assert.equal(offsetBorder[2]!.destination.x, geometry.x);
  Object.assign(lower.surface, {
    geomX: 0,
    geomY: 0,
    geomW: 0,
    geomH: 0,
    width: 220,
    height: 150,
    bufferWidth: 220,
    bufferHeight: 150,
    stride: 880,
    content: { ...solid(220, 150, 0xff282a38), storage: "cpu", destroy() {} },
  });
  const resized = server.windowBorderLayers(lower.session, lower.surface, 0);
  assert.equal(resized[1]!.destination.y, lower.surface.y + 149);
  Object.assign(server, { outputRenderer: retainedObserver });
  await server.composite();
  assert.equal(
    sceneNow().layers.filter((layer) => layer.id.startsWith("window:1:10:edge:")).length,
    8,
  );
  assert.ok(scaler.rendered);
  png("moire-dark-resized-csd", scaler.rendered);
  server.toggleMaximized(lower.session, 10, true);
  assert.equal(
    server.windowBorderLayers(lower.session, lower.surface, 0).length,
    4,
    "maximized frame is square",
  );
  await server.composite();
  assert.equal(
    sceneNow().layers.filter((layer) => layer.id.startsWith("window:1:10:edge:")).length,
    4,
  );
  assert.deepEqual(
    sceneNow().layers.find((layer) => layer.id === "surface:1:10")?.contentShape?.radii,
    [0, 0, 0, 0],
    "maximized actual scene uses square frame content",
  );
  assert.ok(scaler.rendered);
  png("moire-dark-maximized-csd-before-client-resize", scaler.rendered);
  server.toggleFullscreen(lower.session, 10, true);
  assert.deepEqual(
    server.windowBorderLayers(lower.session, lower.surface, 0),
    [],
    "fullscreen is unchromed",
  );
  await server.composite();
  assert.equal(
    sceneNow().layers.filter((layer) => layer.id.startsWith("window:1:10:edge:")).length,
    0,
  );
  assert.equal(
    sceneNow().layers.find((layer) => layer.id === "surface:1:10")?.contentShape,
    undefined,
    "fullscreen actual scene drops content mask and outer chrome",
  );
  assert.ok(scaler.rendered);
  png("moire-dark-fullscreen-unchromed-before-client-resize", scaler.rendered);
  server.toggleFullscreen(lower.session, 10, false);
  server.setMinimized(lower.session, 10);
  await server.composite();
  assert.equal(
    sceneNow().layers.filter((layer) => layer.id.startsWith("window:1:10:edge:")).length,
    0,
  );
  assert.deepEqual(server.windowBorderLayers(lower.session, lower.surface, 0), []);
  Object.assign(lower.surface, { minimized: false, mapped: false });
  assert.deepEqual(server.windowBorderLayers(lower.session, lower.surface, 0), []);
  Object.assign(lower.surface, { mapped: true, maximized: false });
  const committed = lower.surface.content;
  let gpuReads = 0;
  lower.surface.content = {
    storage: "gpu",
    width: 220,
    height: 150,
    stride: 880,
    get pixels(): Uint8Array {
      gpuReads++;
      throw new Error("Border must not read resident client pixels");
    },
    destroy() {},
  };
  assert.equal(server.windowBorderLayers(lower.session, lower.surface, 0).length, 8);
  assert.equal(gpuReads, 0);
  lower.surface.content = committed;
  const painter = new WindowBorderPainter();
  const tiny = painter.layers(
    "tiny",
    0,
    { x: -2, y: -3, width: 2, height: 2 },
    { width: 1, radius: 10000, color: 0x80ffffff },
  );
  assert.equal(tiny.length, 4); // Zero-length straight edges are omitted; corners remain.
  assert.ok(tiny.every((layer) => layer.source.pixels.length <= 64 * 64 * 4));
  const bounded = painter.layers(
    "large",
    0,
    { x: 0, y: 0, width: 8192, height: 8192 },
    { width: 1, radius: 10000, color: 0x80ffffff },
  );
  assert.ok(bounded.every((layer) => layer.source.pixels.length <= 64 * 64 * 4));
  assert.ok(
    bounded.every((layer) =>
      layer.source.pixels.every(
        (value, index, pixels) => index % 4 === 3 || value <= pixels[index - (index % 4) + 3]!,
      ),
    ),
    "alpha remains premultiplied",
  );
  const contrast = {
    ...theme,
    tokens: { ...theme.tokens, accent: "#ffffff", borderSubtle: "#808080", focusRing: "#ffff00" },
  };
  assert.equal(windowChrome(contrast, true).color, 0xffffffff);
  assert.equal(windowChrome({ ...contrast, family: "redmond" }, true).color, 0xffffff00);
  // Physical output scale resamples the logical edge without changing client geometry.
  const edgeFrame = new Uint32Array(width * height).fill(0xff101018);
  server.paintWindowBorder(edgeFrame, width, width, height, resized);
  const outputRenderer = createCompositorOutputRenderer(-1, "software");
  outputRenderer.beginFrame({
    pixels: new Uint8Array(edgeFrame.buffer),
    width,
    height,
    stride: width * 4,
  });
  const scaled = new Uint8Array(width * 1.5 * height * 1.5 * 4);
  outputRenderer.renderOutput({
    geometry: { id: "scale", x: 0, y: 0, width, height },
    physicalWidth: width * 1.5,
    physicalHeight: height * 1.5,
    pitch: width * 1.5 * 4,
    pixels: scaled,
  });
  png("moire-dark-physical-scale1.5", scaled, width * 1.5, height * 1.5);
  assert.notEqual(
    createHash("sha256").update(scaled).digest("hex"),
    createHash("sha256").update(edgeFrame).digest("hex"),
  );
  if (captureRoot)
    fs.writeFileSync(
      path.join(captureRoot, "result.json"),
      JSON.stringify(
        {
          exit: 0,
          cases,
          hashes,
          cpuAndRetainedBytes: "opaque/unaffected exact; translucent corners max1 RGB rounding",
          physicalOutputs: "unavailable fixture; no native calls",
          nativeOrHardwareClaim: false,
        },
        null,
        2,
      ) + "\n",
    );
  console.log(
    JSON.stringify({
      exit: 0,
      cases,
      captures: Object.keys(hashes).length,
      nativeOrHardwareClaim: false,
    }),
  );
} finally {
  lower.conn.close();
  upper.conn.close();
  flat.destroy();
  retained.destroy();
  setTheme(base);
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}

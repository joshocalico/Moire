/** Actual adapter/Server/ClientSession branches; structural EGL engine, no device or native claim. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EglResidentImage } from "@moire/sys";
import { decodeHeader } from "@moire/protocol";
import { wlCompositor, wlDisplay, wlRegistry, wlSurface } from "@moire/protocol/generated";
import {
  moireSurfaceStateManagerV1 as manager,
  moireSurfaceStateV1 as observation,
} from "@moire/protocol/surface-state";
import { EglCompositorOutputRenderer, type OutputRenderTarget } from "./output-renderer";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "moire-rendering-authority-"));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, "config");
process.env.XDG_DATA_HOME = path.join(home, "data");
const { CompositorServer, ClientSession } = await import("./server");
type Scaler = ConstructorParameters<typeof EglCompositorOutputRenderer>[0];
class ScalerFixture implements Scaler {
  constructor(readonly execution: Scaler["execution"] = "unknown") {}
  readonly info = {
    eglVendor: "fixture",
    eglVersion: "fixture",
    eglExtensions: "",
    glVendor: "fixture",
    glRenderer: "fixture",
    glVersion: "fixture",
  };
  imports = 0;
  readbacks = 0;
  copies = 0;
  uploads = 0;
  failDirect = false;
  destroyed = false;
  beginFrame() {
    this.uploads++;
  }
  beginComposition(scene: Parameters<Scaler["beginComposition"]>[0]) {
    for (const layer of scene.layers)
      assert.ok(layer.pixels instanceof EglResidentImage || layer.pixels instanceof Uint8Array);
    return null;
  }
  renderOutput() {
    this.readbacks++;
  }
  renderOutputDirect(): ReturnType<Scaler["renderOutputDirect"]> {
    if (this.failDirect) throw new Error("fixture direct target lost");
    return { framebufferId: 41, width: 8, height: 8, stride: 32 };
  }
  snapshotDmabuf(): ReturnType<Scaler["snapshotDmabuf"]> {
    this.imports++;
    this.copies++;
    return new EglResidentImage(
      this,
      8,
      8,
      () => {
        this.readbacks++;
        return new Uint8Array(256).fill(255);
      },
      () => {},
    );
  }
  destroy() {
    this.destroyed = true;
  }
}
class Connection extends EventEmitter {
  readonly peerPid = null;
  readonly sent: Buffer[] = [];
  send(data: Buffer, fds: number[] = []) {
    assert.equal(fds.length, 0);
    this.sent.push(Buffer.from(data));
    return true;
  }
  close() {
    this.emit("close");
  }
  rendering() {
    const data = this.sent
      .filter((message) => {
        const h = decodeHeader(message);
        return h.objectId === 20 && h.opcode === observation.events.rendering.opcode;
      })
      .at(-1);
    assert.ok(data);
    return observation.events.rendering.decode(data);
  }
}
const scaler = new ScalerFixture();
const renderer = new EglCompositorOutputRenderer(scaler, "auto");
const target: OutputRenderTarget = {
  geometry: { id: "controlled-output", x: 0, y: 0, width: 8, height: 8 },
  physicalWidth: 8,
  physicalHeight: 8,
  pitch: 32,
  pixels: new Uint8Array(256),
};
const source = renderer.snapshotDmabuf({
  kind: "dmabuf",
  width: 8,
  height: 8,
  format: 0x34325258,
  flags: 0,
  planes: [{ fd: 123, offset: 0, stride: 32, modifierHi: 0, modifierLo: 0 }],
});
assert.ok(source);
const server = new CompositorServer(home);
// Explicit structural native-engine boundary: Server owns the actual production adapter.
// No fake KmsOutput, visibility boolean or production-only test API is introduced.
Object.assign(server, { outputRenderer: renderer });
const conn = new Connection();
const client = new ClientSession(server, conn, 1);
try {
  conn.emit("message", wlDisplay.requests.getRegistry.encode(1, 2));
  const globals = conn.sent
    .filter((message) => decodeHeader(message).objectId === 2)
    .map((message) => wlRegistry.events.global.decode(message));
  const compositor = globals.find((global) => global.interfaceValue === "wl_compositor");
  const extension = globals.find((global) => global.interfaceValue === manager.name);
  assert.ok(compositor && extension);
  conn.emit("message", wlRegistry.requests.bind.encode(2, compositor.name, "wl_compositor", 4, 3));
  conn.emit("message", wlRegistry.requests.bind.encode(2, extension.name, manager.name, 2, 4));
  conn.emit("message", wlCompositor.requests.createSurface.encode(3, 10));
  const surface = client.surfaceById(10);
  assert.ok(surface);
  // Portable mapped-source fixture; actual submission request/commit/observation handlers below.
  Object.assign(surface, {
    mapped: true,
    role: "toplevel",
    fullscreen: true, // Correlation needs a provably visible rectangular fixture.
    x: 0,
    y: 0,
    width: 8,
    height: 8,
    bufferWidth: 8,
    bufferHeight: 8,
    stride: 32,
    opaque: true,
    content: source,
    revision: 1,
    renderingSourceAccepted: true,
  });
  source.revision = 1;
  server.registerToplevel(client, 10);
  conn.emit("message", manager.requests.getSurfaceState.encode(4, 20, 10));
  assert.equal(conn.rendering().token, 0);
  const commit = (token: number) => {
    conn.emit("message", observation.requests.submission.encode(20, token));
    conn.emit("message", wlSurface.requests.commit.encode(10));
  };
  const scene = () => ({
    width: 8,
    height: 8,
    clearColor: 0xff000000,
    layers: [server.surfacePaintLayer(client, surface, false, 0)],
  });
  server.observeOutputAvailability(1, "available");
  commit(10);
  const firstScene = scene();
  const firstEpoch = server.beginVisibilityPresentation();
  renderer.beginComposition(firstScene);
  const first = renderer.renderOutput(target).rendering;
  assert.ok(first);
  assert.equal(first.path, "retained-direct");
  assert.equal(first.execution, "unknown");
  assert.equal(first.residentSources.has(source), true);
  const publish = (epoch = firstEpoch, draw = firstScene, facts = first) =>
    server.completeVisibilityPresentation(
      epoch,
      draw,
      [{ connectorId: 1, bounds: { x: 0, y: 0, width: 8, height: 8 }, presentationReady: true }],
      [{ connectorId: 1, success: true, rendering: facts }],
    );
  publish();
  assert.equal(conn.rendering().rendering, observation.enums.rendering.retainedUnknown);
  assert.equal(conn.rendering().token, 10);
  const frames = conn.sent.length;
  publish();
  assert.equal(conn.sent.length, frames, "stable accepted state is deduplicated");
  for (let tick = 0; tick < 100; tick++) {
    renderer.beginComposition(firstScene);
    renderer.renderOutput(target);
  }
  assert.equal(scaler.imports, 1);
  assert.equal(scaler.copies, 1);
  assert.equal(scaler.uploads, 0);
  assert.equal(scaler.readbacks, 0, "retained facts never touch lazy source pixels");
  commit(11);
  assert.equal(conn.rendering().rendering, 0);
  publish();
  assert.equal(
    conn.rendering().rendering,
    0,
    "old completion cannot certify an idle recommit of the identical source",
  );
  publish(server.beginVisibilityPresentation());
  assert.equal(conn.rendering().token, 11);
  assert.equal(conn.rendering().rendering, observation.enums.rendering.retainedUnknown);
  const beforeRepeat = server.beginVisibilityPresentation();
  commit(11);
  publish(beforeRepeat);
  assert.equal(
    conn.rendering().rendering,
    0,
    "even repeated client tokens cannot bypass server commit generation",
  );
  // A missing attach retains the last good display but cannot certify the failed submission.
  conn.emit("message", wlSurface.requests.attach.encode(10, 99999, 0, 0));
  commit(77);
  assert.equal(surface.content, source);
  assert.equal(conn.rendering().token, 0);
  publish(server.beginVisibilityPresentation());
  assert.equal(
    conn.rendering().rendering,
    0,
    "missing-buffer commit cannot bind new token to old resident pixels",
  );
  commit(78);
  publish(server.beginVisibilityPresentation());
  assert.equal(
    conn.rendering().rendering,
    0,
    "failed latest source stays unknown on subsequent idle commits",
  );
  assert.equal(conn.rendering().token, 0);
  const current = server.beginVisibilityPresentation();
  const replacement = {
    storage: "cpu" as const,
    pixels: new Uint8Array(256).fill(255),
    width: 8,
    height: 8,
    stride: 32,
    revision: 2,
    destroy() {},
  };
  surface.content = replacement;
  surface.revision = 2;
  commit(12);
  publish(current);
  assert.equal(
    conn.rendering().rendering,
    0,
    "changed committed-source identity rejects old scene",
  );
  server.observeOutputAvailability(1, "available");
  const acceptedEpoch = server.beginVisibilityPresentation();
  server.observeOutputAvailability(1, "unavailable");
  server.completeVisibilityPresentation(
    acceptedEpoch,
    firstScene,
    [{ connectorId: 1, bounds: { x: 0, y: 0, width: 8, height: 8 }, presentationReady: true }],
    [{ connectorId: 1, success: true, rendering: first }],
  );
  assert.equal(conn.rendering().rendering, 0, "stale success cannot override output loss");
  server.observeOutputAvailability(1, "available");
  surface.content = source;
  surface.renderingSourceAccepted = true;
  surface.revision = 3;
  source.revision = 3;
  commit(13);
  const beforeLoss = server.beginVisibilityPresentation();
  const liveScene = scene();
  renderer.beginComposition(liveScene);
  const liveFacts = renderer.renderOutput(target).rendering;
  assert.ok(liveFacts);
  publish(beforeLoss, liveScene, liveFacts);
  assert.equal(
    conn.rendering().rendering,
    observation.enums.rendering.retainedUnknown,
    "actual accepted complete must qualify before testing generation loss",
  );
  const generation = renderer.renderingGeneration;
  scaler.failDirect = true;
  const fallback = renderer.renderOutput(target).rendering;
  assert.ok(fallback);
  assert.equal(fallback.path, "readback");
  assert.notEqual(renderer.renderingGeneration, generation);
  assert.equal(fallback.residentSources.size, 0);
  assert.equal(scaler.readbacks, 1);
  publish(beforeLoss, liveScene, liveFacts);
  assert.equal(
    conn.rendering().rendering,
    0,
    "old accepted completion cannot survive actual adapter readback demotion",
  );
  publish(server.beginVisibilityPresentation(), liveScene, fallback);
  assert.equal(conn.rendering().rendering, 0);
  const replaced = new EglCompositorOutputRenderer(new ScalerFixture(), "auto");
  Object.assign(server, { outputRenderer: replaced });
  publish(beforeLoss, liveScene, liveFacts);
  assert.equal(
    conn.rendering().rendering,
    0,
    "renderer replacement invalidates old accepted generation",
  );
  const virtualScaler = new ScalerFixture("virtual");
  const virtualRenderer = new EglCompositorOutputRenderer(virtualScaler, "auto");
  try {
    Object.assign(server, { outputRenderer: virtualRenderer });
    surface.content = replacement;
    surface.revision = replacement.revision;
    surface.renderingSourceAccepted = true;
    commit(14);
    const cpuEpoch = server.beginVisibilityPresentation();
    const cpuScene = scene();
    Object.assign(server, { outputRenderer: replaced });
    replaced.beginComposition(cpuScene);
    const unknownCpuFacts = replaced.renderOutput(target).rendering;
    assert.ok(unknownCpuFacts);
    publish(server.beginVisibilityPresentation(), cpuScene, unknownCpuFacts);
    assert.equal(conn.rendering().rendering, 0, "unknown execution cannot qualify SHM pixels");
    replaced.destroy();
    Object.assign(server, { outputRenderer: virtualRenderer });
    virtualRenderer.beginComposition(cpuScene);
    const cpuFacts = virtualRenderer.renderOutput(target).rendering;
    assert.ok(cpuFacts);
    assert.equal(cpuFacts.residentSources.size, 0, "SHM source has no resident proof");
    publish(cpuEpoch, cpuScene, cpuFacts);
    assert.equal(conn.rendering().rendering, observation.enums.rendering.virtual);
    assert.equal(conn.rendering().token, 14, "verified virtual output accepts the SHM commit");
    commit(15);
    publish(cpuEpoch, cpuScene, cpuFacts);
    assert.equal(conn.rendering().rendering, 0, "virtual output cannot accept a later commit");
    const freshEpoch = server.beginVisibilityPresentation();
    publish(freshEpoch, cpuScene, cpuFacts);
    assert.equal(conn.rendering().token, 15);
    virtualRenderer.beginFrame(replacement);
    const flatFacts = virtualRenderer.renderOutput(target).rendering;
    assert.ok(flatFacts);
    assert.equal(flatFacts.path, "flat-direct");
    publish(server.beginVisibilityPresentation(), cpuScene, flatFacts);
    assert.equal(
      conn.rendering().token,
      15,
      "direct flattened virtual output also identifies execution",
    );
    surface.content = { ...replacement, revision: 4 };
    surface.revision = 4;
    commit(16);
    publish(server.beginVisibilityPresentation(), cpuScene, cpuFacts);
    assert.equal(conn.rendering().rendering, 0, "virtual output rejects replaced SHM pixels");
    const newestScene = scene();
    virtualRenderer.beginComposition(newestScene);
    const newestFacts = virtualRenderer.renderOutput(target).rendering;
    assert.ok(newestFacts);
    const newestEpoch = server.beginVisibilityPresentation();
    publish(newestEpoch, newestScene, newestFacts);
    assert.equal(conn.rendering().token, 16);
    server.observeOutputAvailability(1, "unavailable");
    publish(newestEpoch, newestScene, newestFacts);
    assert.equal(conn.rendering().rendering, 0, "virtual output cannot override output loss");
    server.observeOutputAvailability(1, "available");
    virtualScaler.failDirect = true;
    const virtualReadback = virtualRenderer.renderOutput(target).rendering;
    assert.ok(virtualReadback);
    assert.equal(virtualReadback.path, "readback");
    publish(server.beginVisibilityPresentation(), newestScene, virtualReadback);
    assert.equal(conn.rendering().rendering, 0, "virtual readback does not admit bounded motion");
  } finally {
    virtualRenderer.destroy();
  }
  const destroyed = renderer.renderingGeneration;
  renderer.destroy();
  assert.notEqual(renderer.renderingGeneration, destroyed);
  conn.emit("message", observation.requests.destroy.encode(20));
  const stopped = conn.sent.length;
  publish();
  assert.equal(conn.sent.length, stopped);
  console.log(
    "Actual adapter + Server/ClientSession v2 commit correlation, virtual SHM/direct output, immutable resident facts, idle/repeated-token/new-source stale rejection, loss/dedup/teardown, bounded imports/copies and zero retained CPU uploads/readbacks PASS (structural native engine; no hardware claim)",
  );
} finally {
  source.destroy();
  renderer.destroy();
  await server.stop();
  for (const name of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"] as const) {
    const value = previous[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
}

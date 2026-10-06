import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeHeader, type EncodedWaylandMessage } from "@moire/protocol";
import { wlCompositor, wlDisplay, wlRegistry, wlSurface } from "@moire/protocol/generated";
import {
  moireSurfaceStateManagerV1 as manager,
  moireSurfaceStateV1 as observation,
} from "@moire/protocol/surface-state";
import type { CompositionLayer, CompositionScene, OwnedPixelSurface } from "./composition";
import type { SurfaceVisibilityOutput } from "./surface-visibility";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-surface-state-"));
const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
const { CompositorServer, ClientSession } = await import("./server");

class WireConnection extends EventEmitter {
  readonly peerPid = null;
  readonly sent: Buffer[] = [];
  closed = false;
  send(data: Buffer, fds: number[] = []): boolean {
    assert.equal(fds.length, 0);
    this.sent.push(Buffer.from(data));
    return true;
  }
  request(message: EncodedWaylandMessage): void {
    this.emit("message", message);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
  states(id: number): { serial: number; visibility: number }[] {
    return this.sent
      .filter((data) => decodeHeader(data).objectId === id)
      .map((data) => observation.events.state.decode(data));
  }
  errors(): ReturnType<typeof wlDisplay.events.error.decode>[] {
    return this.sent
      .filter((data) => {
        const header = decodeHeader(data);
        return header.objectId === 1 && header.opcode === wlDisplay.events.error.opcode;
      })
      .map((data) => wlDisplay.events.error.decode(data));
  }
}
class SchedulingServer extends CompositorServer {
  dirtyCalls = 0;
  override markDirty(): void {
    this.dirtyCalls++;
    super.markDirty();
  }
}
let pixelReads = 0;
let storageDestroyed = 0;
const content = (): OwnedPixelSurface => ({
  storage: "gpu",
  width: 8,
  height: 8,
  stride: 32,
  get pixels(): Uint8Array {
    pixelReads++;
    throw new Error("Visibility must never trigger a GPU readback");
  },
  destroy() {
    storageDestroyed++;
  },
});
const output: SurfaceVisibilityOutput = {
  bounds: { x: 0, y: 0, width: 16, height: 16 },
  state: "usable",
};
const server = new SchedulingServer(fixture);
const clients: InstanceType<typeof ClientSession>[] = [];
function client(id: number) {
  const conn = new WireConnection();
  const session = new ClientSession(server, conn, id);
  clients.push(session);
  conn.request(wlDisplay.requests.getRegistry.encode(1, 2));
  const globals = conn.sent
    .filter((data) => decodeHeader(data).objectId === 2)
    .map((data) => wlRegistry.events.global.decode(data));
  const compositor = globals.find((global) => global.interfaceValue === "wl_compositor");
  const extension = globals.find((global) => global.interfaceValue === manager.name);
  assert.ok(compositor);
  assert.ok(extension, "real registry must advertise the optional global");
  assert.equal(extension.version, manager.version);
  // Deliberately bind v1: visibility-only clients receive no v2 rendering events.
  conn.request(wlRegistry.requests.bind.encode(2, compositor.name, "wl_compositor", 4, 3));
  conn.request(wlRegistry.requests.bind.encode(2, extension.name, manager.name, 1, 4));
  return { conn, session };
}
function surface(owner: ReturnType<typeof client>, id: number, x = 0, opaque = true) {
  owner.conn.request(wlCompositor.requests.createSurface.encode(3, id));
  const state = owner.session.surfaceById(id);
  assert.ok(state);
  Object.assign(state, {
    mapped: true,
    role: "toplevel",
    fullscreen: true, // Rectangle lifecycle policy is separate from rounded-frame coverage.
    x,
    y: 0,
    width: 8,
    height: 8,
    bufferWidth: 8,
    bufferHeight: 8,
    stride: 32,
    content: content(),
    opaque,
  });
  server.registerToplevel(owner.session, id);
  return state;
}
function layer(
  owner: ReturnType<typeof client>,
  id: number,
  z: number,
  extra: Partial<CompositionLayer> = {},
): CompositionLayer {
  const state = owner.session.surfaceById(id);
  assert.ok(state?.content);
  return { ...server.surfacePaintLayer(owner.session, state, state.role === "popup", z), ...extra };
}
function publish(layers: CompositionLayer[], outputs = [output]): void {
  const scene: CompositionScene = { width: 16, height: 16, clearColor: 0, layers };
  server.publishSurfaceVisibilityScene(scene, outputs);
}
function expectLast(
  conn: WireConnection,
  id: number,
  expected: keyof typeof observation.enums.visibility,
): void {
  assert.equal(
    conn.states(id).at(-1)?.visibility,
    observation.enums.visibility[expected],
    expected,
  );
}
try {
  const lower = client(1),
    upper = client(2);
  const subject = surface(lower, 10);
  const cover = surface(upper, 10);
  const subscribe = manager.requests.getSurfaceState.encode(4, 20, 10);
  lower.conn.emit("message", { data: subscribe.data.subarray(0, 5), fds: [] });
  assert.equal(lower.conn.states(20).length, 0);
  lower.conn.emit("message", { data: subscribe.data.subarray(5), fds: [] });
  assert.deepEqual(
    lower.conn.states(20).map((state) => state.visibility),
    [0],
    "initial state is unknown even for a mapped XRGB subject",
  );
  assert.equal(
    lower.conn.sent.some((data) => {
      const header = decodeHeader(data);
      return header.objectId === 20 && header.opcode === observation.events.rendering.opcode;
    }),
    false,
    "v1 observation receives only its original visibility event",
  );
  publish([layer(lower, 10, 0)]);
  expectLast(lower.conn, 20, "visible");
  const unchanged = lower.conn.states(20).length;
  publish([layer(lower, 10, 0)]);
  assert.equal(
    lower.conn.states(20).length,
    unchanged,
    "unchanged state does not create event churn",
  );
  publish([layer(lower, 10, 0), layer(upper, 10, 1)]);
  expectLast(lower.conn, 20, "hidden");
  cover.opaque = false;
  publish([layer(lower, 10, 0), layer(upper, 10, 1)]);
  expectLast(lower.conn, 20, "unknown");
  cover.x = 4;
  publish([layer(lower, 10, 0), layer(upper, 10, 1)]);
  expectLast(lower.conn, 20, "visible"); // no lower client commit
  cover.x = 0;
  cover.opaque = true;
  publish([layer(upper, 10, 1), layer(lower, 10, 2)]);
  expectLast(lower.conn, 20, "visible"); // actual z ordering, regardless of input array order
  publish([layer(lower, 10, 0)], [{ ...output, state: "unresolved" }]);
  expectLast(lower.conn, 20, "unknown");
  publish([layer(lower, 10, 0)], [{ ...output, state: "unresolved" }, output]);
  expectLast(lower.conn, 20, "visible");

  // SSD/content offset, geometry mask, clip, unknown rounded material and cursor exclusion.
  subject.fullscreen = false;
  subject.decoration = "server";
  const ssdContent = layer(lower, 10, 0);
  assert.equal(ssdContent.destination.y, server.windowGeomOrigin(subject).y);
  assert.ok(
    ssdContent.destination.y > subject.y,
    "actual SSD scene builder must offset content below chrome",
  );
  subject.decoration = "none";
  subject.fullscreen = true;
  subject.geomX = 4;
  subject.geomW = 4;
  subject.geomH = 8;
  assert.deepEqual(layer(lower, 10, 0).surfaceGeometry, { x: 4, y: 0, width: 4, height: 8 });
  subject.geomW = 0;
  subject.geomH = 0;
  publish([layer(lower, 10, 0, { destination: { x: 0, y: 8, width: 8, height: 8 } })]);
  expectLast(lower.conn, 20, "visible");
  publish([
    layer(lower, 10, 0, { surfaceGeometry: { x: 4, y: 0, width: 4, height: 8 } }),
    layer(upper, 10, 1, { destination: { x: 4, y: 0, width: 4, height: 8 } }),
  ]);
  expectLast(lower.conn, 20, "hidden");
  publish([layer(lower, 10, 0, { clip: { x: 16, y: 16, width: 1, height: 1 } })]);
  expectLast(lower.conn, 20, "hidden");
  publish([layer(lower, 10, 0), layer(upper, 10, 1, { id: "shell:chrome", cornerRadius: 4 })]);
  expectLast(lower.conn, 20, "unknown");
  publish([layer(lower, 10, 0), layer(upper, 10, 1, { id: "cursor:fallback" })]);
  expectLast(lower.conn, 20, "visible");
  publish([
    layer(lower, 10, 0),
    layer(upper, 10, 1, { id: "shell:material", effects: [{ kind: "backdrop-blur", radius: 18 }] }),
  ]);
  expectLast(lower.conn, 20, "unknown");
  lower.conn.request(wlSurface.requests.setBufferTransform.encode(10, 1));
  publish([layer(lower, 10, 0)]);
  expectLast(lower.conn, 20, "unknown");
  lower.conn.request(wlSurface.requests.setBufferTransform.encode(10, 0));
  publish([layer(lower, 10, 0)]);
  expectLast(lower.conn, 20, "visible");
  subject.opaque = false;
  publish([layer(lower, 10, 0)]);
  expectLast(lower.conn, 20, "unknown");
  subject.opaque = true;

  publish(
    Array.from({ length: 4097 }, (_, index) => layer(lower, 10, index, { id: `budget:${index}` })),
  );
  expectLast(lower.conn, 20, "unknown");

  // The production popup mutations wake composition, which then publishes reveal without a subject commit.
  const popup = surface(upper, 11);
  popup.role = "popup";
  popup.parentId = 10;
  const dirtyBefore = server.dirtyCalls;
  server.registerPopup(upper.session, 11);
  server.raisePopup(upper.session, 11);
  assert.equal(server.dirtyCalls, dirtyBefore + 2);
  publish([layer(lower, 10, 0), layer(upper, 11, 1, { id: "popup:2:11" })]);
  expectLast(lower.conn, 20, "hidden");
  server.unregisterPopup(upper.session, 11);
  assert.equal(server.dirtyCalls, dirtyBefore + 3);
  publish([layer(lower, 10, 0)]);
  expectLast(lower.conn, 20, "visible");

  subject.minimized = true;
  server.markDirty();
  expectLast(lower.conn, 20, "hidden");
  subject.minimized = false;
  server.markDirty(); // reveal must wait for a real scene/output publication
  expectLast(lower.conn, 20, "hidden");
  publish([layer(lower, 10, 0)]);
  expectLast(lower.conn, 20, "visible");
  lower.conn.request(wlSurface.requests.attach.encode(10, null, 0, 0));
  lower.conn.request(wlSurface.requests.commit.encode(10));
  expectLast(lower.conn, 20, "hidden");
  assert.equal(subject.mapped, false);
  subject.mapped = true;
  subject.content = content();
  subject.opaque = true;
  publish([layer(lower, 10, 0)]);
  expectLast(lower.conn, 20, "visible");

  lower.conn.request(observation.requests.destroy.encode(20));
  const stopped = lower.conn.states(20).length;
  publish([layer(lower, 10, 0), layer(upper, 10, 1)]);
  assert.equal(lower.conn.states(20).length, stopped);
  assert.ok(
    lower.conn.sent.some(
      (data) =>
        decodeHeader(data).objectId === 1 &&
        decodeHeader(data).opcode === wlDisplay.events.deleteId.opcode &&
        wlDisplay.events.deleteId.decode(data).id === 20,
    ),
  );
  lower.conn.request(manager.requests.getSurfaceState.encode(4, 21, 10));
  publish([layer(lower, 10, 0)]);
  lower.conn.request(wlSurface.requests.destroy.encode(10));
  expectLast(lower.conn, 21, "hidden");
  const retired = lower.conn.states(21).length;
  surface(lower, 10); // same wire ID, new lifetime
  publish([layer(lower, 10, 0)]);
  assert.equal(
    lower.conn.states(21).length,
    retired,
    "destroyed surface never revives an inert observer",
  );
  lower.conn.request(observation.requests.destroy.encode(21));

  lower.conn.request(manager.requests.getSurfaceState.encode(4, 22, 10));
  lower.conn.request(manager.requests.destroy.encode(4));
  publish([layer(lower, 10, 0)]);
  expectLast(lower.conn, 22, "visible"); // manager lifetime does not destroy its children
  lower.conn.request(wlCompositor.requests.createSurface.encode(3, 99));
  assert.ok(lower.session.surfaceById(99));
  lower.conn.close();
  const disconnected = lower.conn.states(22).length;
  publish([layer(lower, 10, 0), layer(upper, 10, 1)]);
  assert.equal(lower.conn.states(22).length, disconnected);

  upper.conn.request(manager.requests.getSurfaceState.encode(4, 30, 99));
  assert.equal(
    upper.conn.errors().at(-1)?.code,
    manager.enums.error.invalidSurface,
    "another connection's surface ID is not owned",
  );
  upper.conn.request(manager.requests.getSurfaceState.encode(4, 30, 999));
  assert.equal(upper.conn.errors().at(-1)?.code, manager.enums.error.invalidSurface);
  upper.conn.request(manager.requests.getSurfaceState.encode(4, 30, 4));
  assert.equal(upper.conn.errors().at(-1)?.code, manager.enums.error.invalidSurface);
  upper.conn.request(manager.requests.getSurfaceState.encode(4, 10, 10));
  assert.equal(upper.conn.errors().at(-1)?.code, manager.enums.error.invalidSurface);
  for (let index = 0; index < 256; index++)
    upper.conn.request(manager.requests.getSurfaceState.encode(4, 100 + index, 10));
  upper.conn.request(manager.requests.getSurfaceState.encode(4, 500, 10));
  assert.equal(upper.conn.errors().at(-1)?.code, manager.enums.error.resourceLimit);
  assert.equal(upper.conn.states(500).length, 0);
  upper.conn.request(observation.requests.destroy.encode(100));
  upper.conn.request(manager.requests.getSurfaceState.encode(4, 500, 10));
  assert.equal(upper.conn.states(500).at(0)?.visibility, 0);
  upper.session.destroy();
  const destroyedClient = upper.conn.sent.length;
  publish([]);
  assert.equal(upper.conn.sent.length, destroyedClient);
  assert.equal(pixelReads, 0);
  assert.ok(storageDestroyed > 0);
  const serials = lower.conn.states(20).map((state) => state.serial);
  assert.ok(serials.every((serial, index) => index === 0 || serial > (serials[index - 1] ?? 0)));
  console.log(
    "[surface-visibility-wire] registry, real handlers, initial/dedup/reveal, paint metadata, lifecycle and 256-observer budget passed; GPU pixel reads=0",
  );
} finally {
  for (const session of clients) session.destroy();
  for (const name of ["HOME", "XDG_CONFIG_HOME"] as const) {
    const value = previous[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}

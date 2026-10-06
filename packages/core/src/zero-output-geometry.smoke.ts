import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  decodeHeader,
  MessageBuilder,
  MessageReader,
  type EncodedWaylandMessage,
} from "@moire/protocol";
import {
  wlCompositor,
  wlDisplay,
  wlRegistry,
  wlShm,
  wlShmPool,
  wlSurface,
  xdgSurface,
  xdgToplevel,
  xdgWmBase,
} from "@moire/protocol/generated";
import {
  moireSurfaceStateManagerV1 as visibilityManager,
  moireSurfaceStateV1 as visibility,
} from "@moire/protocol/surface-state";
import { createMemfd, truncateFd, closeFd } from "@moire/sys";

const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "moire-zero-output-")));
const prior = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = directory;
process.env.XDG_CONFIG_HOME = path.join(directory, "config");
const { CompositorServer, ClientSession } = await import("./server");
class WireConnection extends EventEmitter {
  readonly peerPid = null;
  readonly sent: Buffer[] = [];
  send(data: Buffer, fds: number[] = []): boolean {
    assert.equal(fds.length, 0);
    this.sent.push(Buffer.from(data));
    return true;
  }
  request(message: EncodedWaylandMessage): void {
    this.emit("message", message);
  }
  close(): void {
    this.emit("close");
  }
  events(id: number, opcode?: number): Buffer[] {
    return this.sent.filter((data) => {
      const header = decodeHeader(data);
      return header.objectId === id && (opcode === undefined || header.opcode === opcode);
    });
  }
}
const server = new CompositorServer(directory);
const conn = new WireConnection();
const session = new ClientSession(server, conn, 1);
let pendingFd: number | null = null;
let deliveredFd: number | null = null;
const diagnostics: unknown[][] = [];
const reportError = console.error;
console.error = (...args: unknown[]) => {
  diagnostics.push(args);
};
try {
  conn.request(wlDisplay.requests.getRegistry.encode(1, 2));
  const globals = conn.events(2).map((data) => wlRegistry.events.global.decode(data));
  function bind(name: string, id: number) {
    const global = globals.find((item) => item.interfaceValue === name);
    assert.ok(global, `Missing real registry global ${name}`);
    conn.request(wlRegistry.requests.bind.encode(2, global.name, name, global.version, id));
  }
  bind("wl_compositor", 3);
  bind("xdg_wm_base", 4);
  bind("wl_shm", 5);
  bind("wp_fractional_scale_manager_v1", 6);
  bind(visibilityManager.name, 7);
  conn.request(wlCompositor.requests.createSurface.encode(3, 10));
  conn.request(xdgWmBase.requests.getXdgSurface.encode(4, 11, 10));
  conn.request(xdgSurface.requests.getToplevel.encode(11, 12));
  const configured = xdgSurface.events.configure.decode(conn.events(11).at(-1)!);
  conn.request(xdgSurface.requests.ackConfigure.encode(11, configured.serial));
  conn.request(xdgSurface.requests.setWindowGeometry.encode(11, 7, 9, 80, 40));
  const surface = session.surfaceById(10);
  assert.ok(surface);
  const geometry = () => ({
    x: surface.x,
    y: surface.y,
    width: surface.width,
    height: surface.height,
    geomX: surface.geomX,
    geomY: surface.geomY,
    geomW: surface.geomW,
    geomH: surface.geomH,
    savedX: surface.savedX,
    savedY: surface.savedY,
    savedW: surface.savedW,
    savedH: surface.savedH,
    fullscreen: surface.fullscreen,
    maximized: surface.maximized,
  });
  assert.deepEqual(server.getDisplayOutputs(), []);
  assert.equal(server.outputForSurface(surface), null, "Output absence is explicit");
  const before = geometry();
  server.fitToplevelToOutput(session, surface.id);
  assert.equal(server.placeMaximized(surface), null);
  conn.request(xdgToplevel.requests.setMaximized.encode(12));
  conn.request(xdgToplevel.requests.setFullscreen.encode(12, null));
  conn.request(xdgToplevel.requests.unsetFullscreen.encode(12));
  conn.request(xdgToplevel.requests.unsetMaximized.encode(12));
  assert.deepEqual(geometry(), before, "No-output requests cannot invent a full/maximized target");
  // This protocol is handled by the production server's opcodes, with no generated codec yet.
  conn.request(new MessageBuilder().newId(13).object(10).build(6, 1));
  assert.equal(new MessageReader(conn.events(13, 0)[0]!, []).uint(), 120);
  conn.request(visibilityManager.requests.getSurfaceState.encode(7, 14, 10));
  assert.equal(visibility.events.state.decode(conn.events(14)[0]!).visibility, 0);
  assert.equal(
    visibility.events.state.decode(conn.events(14).at(-1)!).visibility,
    1,
    "Unmapped surface is known hidden",
  );

  if (process.platform !== "linux") {
    surface.width = 96;
    surface.height = 64;
    const geometryOnly = geometry();
    server.fitToplevelToOutput(session, surface.id);
    assert.deepEqual(geometry(), geometryOnly);
    console.log(
      "zero-output native SHM first-map/FD release skipped: Linux only; portable geometry is an explicit state fixture",
    );
  } else {
    const width = 96,
      height = 64;
    const pixels = Buffer.alloc(width * height * 4);
    for (let index = 0; index < pixels.length; index += 4) pixels.writeUInt32LE(0xff3167ad, index);
    pendingFd = createMemfd("moire-zero-output-fixture", 1);
    truncateFd(pendingFd, pixels.length);
    fs.writeSync(pendingFd, pixels, 0, pixels.length, 0);
    conn.request(wlShm.requests.createPool.encode(5, 20, pendingFd, pixels.length));
    deliveredFd = pendingFd;
    pendingFd = null; // The actual production pool owns/closes its delivered descriptor.
    conn.request(wlShmPool.requests.createBuffer.encode(20, 21, 0, width, height, width * 4, 1));
    conn.request(wlSurface.requests.attach.encode(10, 21, 0, 0));
    conn.request(wlSurface.requests.damageBuffer.encode(10, 0, 0, width, height));
    conn.request(wlSurface.requests.frame.encode(10, 22));
    conn.request(wlSurface.requests.commit.encode(10));
    assert.equal(surface.mapped, true);
    assert.equal(server.isStacked(session, surface.id), true, "First map must finish registration");
    assert.equal(surface.opaque, true);
    assert.equal(surface.content?.storage, "cpu");
    assert.deepEqual(surface.content?.pixels, new Uint8Array(pixels));
    assert.equal(surface.width, width);
    assert.equal(surface.height, height);
    assert.equal(surface.x, before.x);
    assert.equal(surface.y, before.y);
    assert.deepEqual([surface.geomX, surface.geomY, surface.geomW, surface.geomH], [7, 9, 80, 40]);
    session.finishSurfaceFrame(surface);
    assert.equal(conn.events(22).length, 1);
    assert.equal(conn.events(21).length, 1, "Copied SHM releases its producer buffer");
    const registered = geometry();
    conn.request(wlSurface.requests.commit.encode(10));
    assert.equal(server.isStacked(session, surface.id), true);
    assert.deepEqual(geometry(), registered, "Idle commit retains client geometry");
    console.log(
      "zero-output Linux: actual memfd/mmap/SHM wire handlers, first-map registration, copied pixels, callback/buffer release, idle commit PASS (local transport; no native Unix/device claim)",
    );
  }
  const retained = geometry();
  server.observeOutputAvailability(1, "available");
  server.observeOutputAvailability(1, "unavailable");
  server.observeOutputAvailability(1, "available");
  await server.composite();
  assert.deepEqual(
    geometry(),
    retained,
    "Availability/reconnect alone cannot replace client geometry",
  );
  assert.equal(
    visibility.events.state.decode(conn.events(14).at(-1)!).visibility,
    process.platform === "linux" ? 0 : 1,
    "No accepted output keeps mapped visibility unknown; unmapped stays hidden",
  );
  assert.equal(conn.events(13, 0).length, 1, "Neutral scale updates are change-only");
  assert.deepEqual(diagnostics, [], "No swallowed dispatch/snapshot errors");
  conn.request(wlSurface.requests.destroy.encode(10));
  assert.equal(server.isStacked(session, 10), false);
  assert.equal(session.surfaceById(10), null);
  console.log(
    "zero-output geometry: actual registry/xdg/fractional dispatch, explicit null output, retained geometry, safe full/max requests, neutral120 scale, conservative visibility, reconnect preservation and destroy PASS",
  );
} finally {
  console.error = reportError;
  if (pendingFd !== null) closeFd(pendingFd);
  session.destroy();
  const closedFd = deliveredFd;
  if (closedFd !== null) assert.throws(() => fs.fstatSync(closedFd), { code: "EBADF" });
  server.stop();
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

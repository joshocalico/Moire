import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeHeader } from "@moire/protocol";
import { wlCompositor, wlDisplay, wlRegistry } from "@moire/protocol/generated";
import {
  moireSurfaceStateManagerV1 as manager,
  moireSurfaceStateV1 as observation,
} from "@moire/protocol/surface-state";
import type { CompositionScene } from "./composition";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-output-state-"));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
process.env.XDG_DATA_HOME = path.join(fixture, "data");
const { CompositorServer, ClientSession } = await import("./server");
class Connection extends EventEmitter {
  readonly peerPid = null;
  readonly sent: Buffer[] = [];
  send(data: Buffer, fds: number[] = []): boolean {
    assert.equal(fds.length, 0);
    this.sent.push(Buffer.from(data));
    return true;
  }
  close(): void {
    this.emit("close");
  }
  current(): number | undefined {
    return this.sent
      .filter((data) => decodeHeader(data).objectId === 20)
      .map((data) => observation.events.state.decode(data).visibility)
      .at(-1);
  }
}
const server = new CompositorServer(fixture);
const conn = new Connection();
const client = new ClientSession(server, conn, 1);
try {
  conn.emit("message", wlDisplay.requests.getRegistry.encode(1, 2));
  const globals = conn.sent
    .filter((data) => decodeHeader(data).objectId === 2)
    .map((data) => wlRegistry.events.global.decode(data));
  const compositor = globals.find((global) => global.interfaceValue === "wl_compositor");
  const extension = globals.find((global) => global.interfaceValue === manager.name);
  assert.ok(compositor && extension);
  conn.emit("message", wlRegistry.requests.bind.encode(2, compositor.name, "wl_compositor", 4, 3));
  conn.emit("message", wlRegistry.requests.bind.encode(2, extension.name, manager.name, 1, 4));
  conn.emit("message", wlCompositor.requests.createSurface.encode(3, 10));
  const surface = client.surfaceById(10);
  assert.ok(surface);
  // Portable lifecycle fixture only; the separate Linux fixture commits actual native SHM.
  Object.assign(surface, {
    mapped: true,
    role: "toplevel",
    fullscreen: true,
    x: 0,
    y: 0,
    width: 8,
    height: 8,
    bufferWidth: 8,
    bufferHeight: 8,
    stride: 32,
    opaque: true,
    content: {
      width: 8,
      height: 8,
      stride: 32,
      storage: "cpu",
      pixels: new Uint8Array(256).fill(255),
      destroy() {},
    },
  });
  server.registerToplevel(client, 10);
  conn.emit("message", manager.requests.getSurfaceState.encode(4, 20, 10));
  const scene: CompositionScene = {
    width: 8,
    height: 8,
    clearColor: 0,
    layers: [server.surfacePaintLayer(client, surface, false, 0)],
  };
  const output = (connectorId: number, presentationReady = true) => ({
    connectorId,
    bounds: { x: 0, y: 0, width: 8, height: 8 },
    presentationReady,
  });
  const accepted = (connectorId: number, success = true) => ({ connectorId, success });
  const complete = (
    outputs = [output(1)],
    results = [accepted(1)],
    epoch = server.beginVisibilityPresentation(),
  ) => server.completeVisibilityPresentation(epoch, scene, outputs, results);
  complete();
  assert.equal(conn.current(), 0, "unobserved output cannot certify visibility");
  server.observeOutputAvailability(1, "available");
  complete();
  assert.equal(conn.current(), 2);
  const stale = server.beginVisibilityPresentation();
  server.observeOutputAvailability(1, "unavailable");
  assert.equal(conn.current(), 0, "idle witness revoked without a client commit or frame");
  complete([output(1)], [accepted(1)], stale);
  assert.equal(conn.current(), 0);
  complete();
  assert.equal(
    conn.current(),
    0,
    "successful stale-device completion cannot certify unavailable output",
  );
  server.observeOutputAvailability(1, "available");
  assert.equal(conn.current(), 0, "reconnection alone supplies no accepted frame");
  complete([output(1)], [accepted(1)], stale);
  assert.equal(conn.current(), 0);
  complete([output(1)], [accepted(1, false)]);
  assert.equal(conn.current(), 0);
  complete([output(1, false)]);
  assert.equal(conn.current(), 0);
  complete();
  assert.equal(conn.current(), 2);
  server.observeOutputAvailability(1, "unknown");
  assert.equal(conn.current(), 0);
  complete();
  assert.equal(conn.current(), 0);
  server.observeOutputAvailability(2, "available");
  complete([output(1), output(2)], [accepted(2)]);
  assert.equal(conn.current(), 2, "healthy overlapping secondary supplies its own witness");
  server.observeOutputAvailability(1, "unavailable");
  complete([output(2)], [accepted(2)]);
  assert.equal(conn.current(), 2, "removed primary does not permanently lose healthy output");
  const changed = conn.sent.length;
  server.observeOutputAvailability(1, "unavailable");
  complete([output(2)], [accepted(2)]);
  assert.equal(conn.sent.length, changed, "duplicate observation/completion stays silent");
  const other = new CompositorServer(fixture);
  complete([output(2)], [accepted(2)], other.beginVisibilityPresentation());
  assert.equal(conn.current(), 0, "foreign owner cannot supply completion authority");
  // Availability authority is independent of rectangular lifecycle fixtures:
  // a real normal frame has rounded possible bounds plus a guaranteed interior.
  let pixelReads = 0;
  Object.assign(surface, {
    fullscreen: false,
    width: 64,
    height: 48,
    bufferWidth: 64,
    bufferHeight: 48,
    stride: 256,
    content: {
      width: 64,
      height: 48,
      stride: 256,
      storage: "gpu",
      get pixels(): Uint8Array {
        pixelReads++;
        throw new Error("Visibility must not read pixels");
      },
      destroy() {},
    },
  });
  const normalScene: CompositionScene = {
    width: 64,
    height: 48,
    clearColor: 0,
    layers: [server.surfacePaintLayer(client, surface, false, 0)],
  };
  const largeOutput = {
    connectorId: 2,
    bounds: { x: 0, y: 0, width: 64, height: 48 },
    presentationReady: true,
  };
  const completeNormal = (epoch = server.beginVisibilityPresentation()) =>
    server.completeVisibilityPresentation(epoch, normalScene, [largeOutput], [accepted(2)]);
  completeNormal();
  assert.equal(
    conn.current(),
    2,
    "normal rounded opaque foreground has an accepted interior witness",
  );
  const normalEpoch = server.beginVisibilityPresentation();
  server.observeOutputAvailability(2, "unavailable");
  assert.equal(conn.current(), 0, "normal foreground idle output loss revokes its witness");
  completeNormal(normalEpoch);
  assert.equal(conn.current(), 0, "normal interior cannot bypass output epoch loss");
  server.observeOutputAvailability(2, "available");
  assert.equal(conn.current(), 0, "normal reconnect still waits for an accepted frame");
  completeNormal();
  assert.equal(conn.current(), 2);
  surface.width = 8;
  surface.height = 8;
  normalScene.layers = [server.surfacePaintLayer(client, surface, false, 0)];
  completeNormal();
  assert.equal(conn.current(), 0, "tiny rounded frame has no provable central strip");
  assert.equal(pixelReads, 0);
  console.log(
    "Output availability: actual Server lifecycle + protocol handler, idle loss, query unknown, stale/reconnect/acceptance, primary replacement and healthy secondary PASS (portable transport/mapped-surface fixture; no native claim)",
  );
} finally {
  client.destroy();
  server.stop();
  for (const name of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"] as const) {
    const value = previous[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}

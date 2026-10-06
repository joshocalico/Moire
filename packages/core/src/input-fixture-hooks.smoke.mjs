import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeHeader } from "@moire/protocol";
import {
  wlDisplay,
  wlRegistry,
  wlCompositor,
  wlSeat,
  wlKeyboard,
  wlPointer,
} from "@moire/protocol/generated";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-input-route-"));
const old = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
process.env.XDG_DATA_HOME = path.join(fixture, "data");
const { CompositorServer, ClientSession } = await import("./server");
class Connection extends EventEmitter {
  peerPid = 4242;
  sent = [];
  send(data, fds = []) {
    assert.equal(fds.length, 0);
    this.sent.push(Buffer.from(data));
    return true;
  }
  close() {
    this.emit("close");
  }
}
function observe(mode) {
  const records = [],
    links = new WeakMap();
  let stops = 0,
    ended = false;
  const trace = {
    active() {
      return mode !== "off" && !ended;
    },
    write(event, source = null) {
      if (mode === "throw") throw new Error("diagnostic sink failed");
      records.push({ event, source });
      return records.length;
    },
    value() {},
    stop() {
      stops++;
      ended = true;
    },
    link(event, source) {
      links.set(event, source);
    },
    sourceOf(event) {
      return links.get(event) ?? null;
    },
  };
  return { records, trace, stops: () => stops };
}
function windowFixture() {
  const server = new CompositorServer(fixture),
    conn = new Connection(),
    client = new ClientSession(server, conn, 1);
  conn.emit("message", wlDisplay.requests.getRegistry.encode(1, 2));
  const globals = conn.sent
    .filter((b) => decodeHeader(b).objectId === 2)
    .map((b) => wlRegistry.events.global.decode(b));
  const compositor = globals.find((g) => g.interfaceValue === "wl_compositor");
  const seat = globals.find((g) => g.interfaceValue === "wl_seat");
  assert(compositor && seat);
  conn.emit("message", wlRegistry.requests.bind.encode(2, compositor.name, "wl_compositor", 4, 3));
  conn.emit("message", wlRegistry.requests.bind.encode(2, seat.name, "wl_seat", 7, 4));
  conn.emit("message", wlCompositor.requests.createSurface.encode(3, 10));
  conn.emit("message", wlSeat.requests.getKeyboard.encode(4, 11));
  conn.emit("message", wlSeat.requests.getPointer.encode(4, 12));
  const surface = client.surfaceById(10);
  assert(surface);
  Object.assign(surface, {
    mapped: true,
    role: "toplevel",
    fullscreen: true,
    appId: "org.moire.Screenshot",
    x: 100,
    y: 100,
    width: 1200,
    height: 900,
    bufferWidth: 1200,
    bufferHeight: 900,
    stride: 4800,
    opaque: true,
    content: {
      width: 1200,
      height: 900,
      stride: 4800,
      storage: "cpu",
      pixels: new Uint8Array(0),
      destroy() {},
    },
  });
  server.registerToplevel(client, 10);
  server.focusClient(client, 10);
  return { server, conn, client, surface };
}
const modes = ["off", "on", "throw"];
let baseline;
try {
  for (const mode of modes) {
    const { server, conn, client, surface } = windowFixture();
    const o = observe(mode);
    server.inputFixtureTrace = o.trace;
    assert.equal(client.peerPid, 4242, "actual transport peer identity");
    const before = conn.sent.length;
    const down = { code: 20, value: 1, timeMs: 5 },
      up = { code: 20, value: 0, timeMs: 6 };
    o.trace.link(down, 101);
    o.trace.link(up, 102);
    // Invoke production routing methods without starting KMS/input or replacing any route implementation.
    server.onKey(down);
    server.onKey(up);
    const absolute = { x: 0.2, y: 0.3, timeMs: 7 };
    o.trace.link(absolute, 103);
    server.onPointerAbsolute(absolute);
    const press = { code: 0x110, value: 1, timeMs: 8 },
      release = { code: 0x110, value: 0, timeMs: 9 };
    o.trace.link(press, 104);
    o.trace.link(release, 105);
    server.onPointerButton(press);
    server.onPointerButton(release);
    const wire = conn.sent.slice(before).filter((b) => [11, 12].includes(decodeHeader(b).objectId));
    if (!baseline) baseline = wire;
    assert.equal(wire.length, baseline.length);
    assert(
      wire.every((b, i) => b.equals(baseline[i])),
      `${mode}: exact client wire forwarding retained`,
    );
    const keys = wire
      .filter(
        (b) =>
          decodeHeader(b).objectId === 11 &&
          decodeHeader(b).opcode === wlKeyboard.events.key.opcode,
      )
      .map((b) => wlKeyboard.events.key.decode(b));
    assert.deepEqual(
      keys.map((k) => [k.key, k.state]),
      [
        [20, 1],
        [20, 0],
      ],
    );
    const buttons = wire
      .filter(
        (b) =>
          decodeHeader(b).objectId === 12 &&
          decodeHeader(b).opcode === wlPointer.events.button.opcode,
      )
      .map((b) => wlPointer.events.button.decode(b));
    assert.deepEqual(
      buttons.map((b) => [b.button, b.state]),
      [
        [0x110, 1],
        [0x110, 0],
      ],
    );
    if (mode === "on") {
      const keys = o.records.filter((r) => r.event.layer === "key-route");
      assert.deepEqual(
        keys.map((r) => r.event.phase),
        ["translated", "client", "translated", "client"],
      );
      assert.deepEqual(
        keys.map((r) => r.source),
        [101, 101, 102, 102],
      );
      const route = o.records.find(
        (r) =>
          r.event.layer === "pointer-route" &&
          r.event.phase === "client" &&
          r.event.event === "absolute",
      );
      assert(route);
      assert.equal(route.source, 103);
      assert.equal(route.event.localX, Math.round(0.2 * 1919) - surface.x);
      assert.equal(route.event.localY, Math.round(0.3 * 1079) - surface.y);
      assert.equal(route.event.clientId, 1);
      assert.equal(route.event.surfaceId, 10);
      assert(
        o.records
          .filter((r) => r.event.layer === "pointer-route" && r.event.event === "button")
          .every((r) => [104, 105].includes(r.source)),
      );
    } else assert.equal(o.records.length, 0);
    assert.equal(o.stops(), mode === "throw" ? 1 : 0);
    const beforeShell = conn.sent.length;
    let calls = 0;
    server.setShell({
      onKey() {
        calls++;
        return true;
      },
      onPointerMotion() {
        return true;
      },
      onPointerButton() {
        return true;
      },
    });
    server.onKey({ code: 20, value: 1, timeMs: 10 });
    server.onPointerAbsolute({ x: 0.21, y: 0.31, timeMs: 11 });
    server.onPointerButton({ code: 0x110, value: 1, timeMs: 12 });
    assert.equal(calls, 1, "observer never reruns stateful shell decision");
    assert.equal(
      conn.sent
        .slice(beforeShell)
        .filter(
          (b) =>
            [11, 12].includes(decodeHeader(b).objectId) &&
            [wlKeyboard.events.key.opcode, wlPointer.events.button.opcode].includes(
              decodeHeader(b).opcode,
            ),
        ).length,
      0,
      "shell-consumed input never forwards key/button",
    );
    if (mode === "on")
      assert.deepEqual(
        o.records.slice(-6).map((r) => r.event.phase),
        ["translated", "shell", "translated", "shell", "translated", "shell"],
      );
    server.setShell(null);
    client.destroy();
    server.stop();
  }
  const server = new CompositorServer(fixture),
    o = observe("on");
  server.inputFixtureTrace = o.trace;
  server.onKey({ code: 20, value: 1, timeMs: 1 });
  server.onPointerAbsolute({ x: 0.5, y: 0.5, timeMs: 2 });
  assert.deepEqual(
    o.records.map((r) => r.event.phase),
    ["translated", "no-focus", "translated", "no-focus"],
  );
  assert(o.records.every((r) => r.event.clientId === null && r.event.surfaceId === null));
  server.stop();

  {
    const { server, client, surface } = windowFixture();
    const o = observe("on");
    server.inputFixtureTrace = o.trace;
    surface.fullscreen = false;
    server.beginMove(client, 10);
    server.onPointerAbsolute({ x: 0.25, y: 0.35, timeMs: 21 });
    assert.deepEqual(
      o.records.map((r) => r.event.phase),
      ["translated", "grab"],
    );
    client.destroy();
    server.stop();
  }
  {
    const { server, client } = windowFixture();
    const o = observe("on");
    server.inputFixtureTrace = o.trace;
    const foreignConn = new Connection();
    foreignConn.peerPid = 5252;
    const foreign = new ClientSession(server, foreignConn, 2);
    foreignConn.emit("message", wlDisplay.requests.getRegistry.encode(1, 2));
    const globals = foreignConn.sent
      .filter((b) => decodeHeader(b).objectId === 2)
      .map((b) => wlRegistry.events.global.decode(b));
    const compositor = globals.find((g) => g.interfaceValue === "wl_compositor");
    assert(compositor);
    foreignConn.emit(
      "message",
      wlRegistry.requests.bind.encode(2, compositor.name, "wl_compositor", 4, 3),
    );
    foreignConn.emit("message", wlCompositor.requests.createSurface.encode(3, 10));
    const foreignSurface = foreign.surfaceById(10);
    assert(foreignSurface);
    Object.assign(foreignSurface, {
      mapped: true,
      role: "toplevel",
      fullscreen: true,
      appId: "unrelated",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      bufferWidth: 1920,
      bufferHeight: 1080,
      stride: 7680,
      content: {
        width: 1920,
        height: 1080,
        stride: 7680,
        storage: "cpu",
        pixels: new Uint8Array(0),
        destroy() {},
      },
    });
    server.registerToplevel(foreign, 10);
    server.onPointerAbsolute({ x: 0.2, y: 0.3, timeMs: 22 });
    assert.equal(o.stops(), 1, "foreign pointer target retires diagnostics before target detail");
    assert.deepEqual(
      o.records.map((r) => r.event.phase),
      ["translated"],
    );
    assert(o.records.every((r) => r.event.clientId !== 2));
    // An ended observer may not resume after returning to the original window.
    server.focusClient(client, 10);
    server.onKey({ code: 20, value: 1, timeMs: 23 });
    assert.equal(o.records.length, 1);
    foreign.destroy();
    client.destroy();
    server.stop();
  }
  console.log(
    "[input-fixture/router] real ClientSession keyboard/button wire identical off/on/throw; local geometry, source provenance, single shell consumption and no-focus passed",
  );
} finally {
  for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}

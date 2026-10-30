/** Actual seat routing, generated wire and client decoder; no native device or renderer. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { decodeHeader, MessageReader } from "@moire/protocol";
import { wlDisplay, wlRegistry, wlCompositor, wlSeat, wlKeyboard } from "@moire/protocol/generated";
// Exercise the actual decoder rather than duplicate its held-key logic.
// oxlint-disable-next-line no-relative-parent-imports, no-restricted-imports
import { WaylandKeyboard } from "../../ui/src/platforms/wayland/keyboard";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-keyboard-focus-"));
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
const live = new Set();
let cases = 0;
const modifiers = [
  [42, "shift"],
  [54, "shift"],
  [29, "ctrl"],
  [97, "ctrl"],
  [56, "alt"],
  [100, "alt"],
  [125, "meta"],
  [126, "meta"],
];
function make() {
  const server = new CompositorServer(fixture);
  live.add(server);
  const targets = [];
  function add(id) {
    const conn = new Connection();
    const client = new ClientSession(server, conn, id);
    server.clients.add(client);
    conn.emit("message", wlDisplay.requests.getRegistry.encode(1, 2));
    const globals = conn.sent
      .filter((b) => decodeHeader(b).objectId === 2)
      .map((b) => wlRegistry.events.global.decode(b));
    for (const [name, version, target] of [
      ["wl_compositor", 4, 3],
      ["wl_seat", 7, 4],
    ]) {
      const global = globals.find((g) => g.interfaceValue === name);
      assert(global);
      conn.emit("message", wlRegistry.requests.bind.encode(2, global.name, name, version, target));
    }
    conn.emit("message", wlCompositor.requests.createSurface.encode(3, 10));
    conn.emit("message", wlSeat.requests.getKeyboard.encode(4, 11));
    const surface = client.surfaceById(10);
    assert(surface);
    Object.assign(surface, {
      mapped: true,
      role: "toplevel",
      fullscreen: true,
      appId: "org.moire.Screenshot",
      x: 100,
      y: 100,
      width: 640,
      height: 480,
      bufferWidth: 640,
      bufferHeight: 480,
      stride: 2560,
      opaque: true,
      content: {
        width: 640,
        height: 480,
        stride: 2560,
        storage: "cpu",
        pixels: new Uint8Array(0),
        destroy() {},
      },
    });
    server.registerToplevel(client, 10);
    let decoded = 0;
    const events = [];
    const decoder = new WaylandKeyboard({
      // Client repeat timers are covered by the Wayland keyboard suite; keep this wire proof deterministic.
      timers: { setTimeout: () => 0, clearTimeout() {} },
      pressedKeys: new Set(),
      resolveSurface: (surfaceId) => (surfaceId === 10 ? id : null),
      emitKey: (_target, event) => events.push(event),
      onSerial() {},
    });
    const target = {
      conn,
      client,
      events,
      pump() {
        while (decoded < conn.sent.length) {
          const data = conn.sent[decoded++];
          const header = decodeHeader(data);
          if (header.objectId === 11) decoder.handle(header.opcode, new MessageReader(data));
        }
      },
      enters() {
        return conn.sent
          .filter(
            (data) =>
              decodeHeader(data).objectId === 11 &&
              decodeHeader(data).opcode === wlKeyboard.events.enter.opcode,
          )
          .map((data) => {
            const { keys } = wlKeyboard.events.enter.decode(data);
            return Array.from({ length: keys.length / 4 }, (_, index) =>
              keys.readUInt32LE(index * 4),
            );
          });
      },
      wireKeys() {
        return conn.sent
          .filter(
            (data) =>
              decodeHeader(data).objectId === 11 &&
              decodeHeader(data).opcode === wlKeyboard.events.key.opcode,
          )
          .map((data) => wlKeyboard.events.key.decode(data));
      },
    };
    targets.push(target);
    return target;
  }
  const a = add(1),
    b = add(2);
  let time = 0;
  function pump() {
    for (const target of targets) target.pump();
  }
  return {
    server,
    a,
    b,
    focus(target) {
      server.focusClient(target.client, 10);
      pump();
    },
    key(code, value) {
      const event = Object.freeze({ code, value, timeMs: ++time });
      server.onKey(event);
      pump();
      assert.deepEqual(event, { code, value, timeMs: time }, "original input object unchanged");
    },
    close() {
      server.stop();
      live.delete(server);
    },
  };
}
function check(name, run) {
  const f = make();
  try {
    run(f);
    cases++;
    console.log(`PASS ${name}`);
  } finally {
    f.close();
  }
}
try {
  check("registered fallback forwards the first ordinary press as down", (f) => {
    f.key(20, 1);
    assert.deepEqual(f.a.enters(), [[]], "enter precedes the triggering press");
    assert.equal(f.a.events.at(-1).type, "down");
    assert.equal(f.a.events.at(-1).text, "t");
    assert.deepEqual(f.server.keyboardPressedKeys(), [20]);
    f.key(20, 2);
    f.key(20, 0);
    assert.deepEqual(
      f.a.events.map((event) => event.type),
      ["down", "up"],
      "kernel autorepeat is not a wl_keyboard event; clients repeat from repeat_info",
    );
    assert.deepEqual(
      f.a.wireKeys().map((event) => [event.key, event.state, event.time]),
      [
        [20, 1, 1],
        [20, 0, 3],
      ],
    );
  });
  check("registered fallback forwards the first modifier press as down", (f) => {
    f.key(42, 1);
    assert.deepEqual(f.a.enters(), [[]]);
    assert.equal(f.a.events.at(-1).type, "down");
    assert.equal(f.a.events.at(-1).modifiers.shift, true);
    f.key(53, 1);
    assert.equal(f.a.events.at(-1).text, "?");
  });
  check("registered fallback Enter remains a first activation rather than repeat", (f) => {
    f.key(28, 1);
    assert.deepEqual(f.a.enters(), [[]]);
    assert.equal(f.a.events.at(-1).type, "down");
    assert.equal(f.a.events.at(-1).key, "Enter");
    f.key(28, 0);
    assert.equal(f.a.events.at(-1).type, "up");
  });
  check("registered fallback preserves a previously held shell-consumed modifier", (f) => {
    f.server.shell = { onKey: (event) => event.code === 42 };
    f.key(42, 1);
    assert.equal(f.a.enters().length, 0);
    f.key(53, 1);
    assert.deepEqual(f.a.enters(), [[42]]);
    assert.equal(f.a.events.at(-1).type, "down");
    assert.equal(f.a.events.at(-1).text, "?");
    f.key(42, 0);
    f.focus(f.b);
    assert.deepEqual(f.b.enters().at(-1), [53]);
  });
  check("registered fallback repeat retains the existing accepted hold", (f) => {
    f.server.shell = { onKey: (event) => event.code === 20 && event.value === 1 };
    f.key(20, 1);
    assert.equal(f.a.enters().length, 0);
    f.key(20, 2);
    assert.deepEqual(f.a.enters(), [[20]], "the hold is still conveyed by enter");
    assert.equal(f.a.events.length, 0, "the kernel repeat itself is not forwarded");
    assert.deepEqual(f.server.keyboardPressedKeys(), [20]);
  });
  check("registered fallback release includes the prior hold then delivers up", (f) => {
    f.server.shell = { onKey: (event) => event.code === 42 && event.value === 1 };
    f.key(42, 1);
    f.key(42, 0);
    assert.deepEqual(f.a.enters(), [[42]]);
    assert.equal(f.a.events.at(-1).type, "up");
    assert.equal(f.a.events.at(-1).modifiers.shift, false);
    assert.deepEqual(f.server.keyboardPressedKeys(), []);
  });
  for (const [code, modifier] of modifiers) {
    check(`released ${code} never resurrects in earlier client`, (f) => {
      f.focus(f.a);
      f.key(code, 1);
      f.focus(f.b);
      f.key(code, 0);
      f.focus(f.a);
      assert(!f.a.enters().at(-1).includes(code), "released key must be absent from re-enter");
      f.key(53, 1);
      assert.equal(f.a.events.at(-1).modifiers[modifier], false);
      assert.equal(f.a.events.at(-1).text, "/");
    });
    check(`held ${code} survives focus and real release`, (f) => {
      f.focus(f.a);
      f.key(code, 1);
      f.focus(f.b);
      assert(f.b.enters().at(-1).includes(code), "still-held key included on new focus");
      f.key(20, 1);
      assert.equal(f.b.events.at(-1).modifiers[modifier], true);
      f.key(20, 0);
      f.key(code, 0);
      f.key(20, 1);
      assert.equal(f.b.events.at(-1).modifiers[modifier], false);
    });
  }
  check("Alt-Tab consumes Tab but new client receives current modifier snapshot", (f) => {
    f.focus(f.a);
    f.key(42, 1);
    f.key(56, 1);
    const oldKeys = f.a.wireKeys().length;
    f.key(15, 1);
    assert.equal(f.a.wireKeys().length, oldKeys, "global Tab press consumed");
    assert.deepEqual(
      f.b
        .enters()
        .at(-1)
        .sort((a, b) => a - b),
      [15, 42, 56],
    );
    f.key(15, 0);
    f.key(42, 0);
    f.key(56, 0);
    f.focus(f.a);
    assert.deepEqual(f.a.enters().at(-1), []);
    f.key(53, 1);
    assert.equal(f.a.events.at(-1).text, "/");
  });
  check("shell-consumed release retires seat key while holding another modifier", (f) => {
    f.focus(f.a);
    f.key(42, 1);
    f.key(29, 1);
    let observed;
    f.server.shell = {
      onKey(event) {
        if (event.code === 42 && event.value === 0) {
          observed = f.server.keyboardPressedKeys();
          return true;
        }
        return false;
      },
    };
    const before = f.a.wireKeys().length;
    f.key(42, 0);
    assert.equal(f.a.wireKeys().length, before);
    assert.deepEqual(observed, [29], "seat state updated before shell branch");
    f.focus(f.b);
    assert.deepEqual(f.b.enters().at(-1), [29]);
    f.key(29, 0);
    f.focus(f.a);
    assert.deepEqual(f.a.enters().at(-1), []);
  });
  check("no-focus release retires earlier client key", (f) => {
    f.focus(f.a);
    f.key(42, 1);
    f.a.client.keyboardLeave();
    f.server.focused = null;
    f.server.focusedToplevel = null;
    f.server.clients.clear();
    f.key(42, 0);
    f.focus(f.a);
    assert.deepEqual(f.a.enters().at(-1), []);
    f.key(53, 1);
    assert.equal(f.a.events.at(-1).text, "/");
  });
  check("no-focus hold is carried into the first actual client", (f) => {
    f.server.clients.clear();
    f.key(42, 1);
    f.focus(f.a);
    assert.deepEqual(f.a.enters().at(-1), [42]);
    f.key(53, 1);
    assert.equal(f.a.events.at(-1).text, "?");
    f.key(42, 0);
    f.key(53, 0);
  });
  check("ordinary down up, dropped kernel repeat and same-focus wire ordering preserved", (f) => {
    f.focus(f.a);
    const enters = f.a.enters().length;
    f.focus(f.a);
    assert.equal(f.a.enters().length, enters);
    f.key(20, 1);
    f.key(20, 2);
    f.key(20, 0);
    f.key(20, 1);
    assert.deepEqual(
      f.a.wireKeys().map((event) => [event.key, event.state, event.time]),
      [
        [20, 1, 1],
        [20, 0, 3],
        [20, 1, 4],
      ],
    );
    assert.deepEqual(
      f.a.events.map((event) => event.type),
      ["down", "up", "down"],
    );
    f.key(20, 0);
    f.focus(f.b);
    f.focus(f.a);
    f.key(20, 1);
    assert.equal(f.a.events.at(-1).type, "down", "old enter never creates a false repeat");
  });
  check("both Shift keys held, releasing one keeps the other", (f) => {
    f.focus(f.a);
    f.key(42, 1);
    f.key(54, 1);
    f.key(42, 0);
    f.focus(f.b);
    assert.deepEqual(f.b.enters().at(-1), [54]);
    f.key(53, 1);
    assert.equal(f.b.events.at(-1).text, "?");
    f.key(54, 0);
    f.key(53, 0);
    f.key(53, 1);
    assert.equal(f.b.events.at(-1).text, "/");
  });
  check("right Alt still cycles after left Alt release", (f) => {
    f.focus(f.a);
    f.key(56, 1);
    f.key(100, 1);
    f.key(56, 0);
    f.key(15, 1);
    assert.deepEqual(
      f.b
        .enters()
        .at(-1)
        .sort((a, b) => a - b),
      [15, 100],
    );
    f.key(15, 0);
    f.key(100, 0);
    f.focus(f.a);
    assert.deepEqual(f.a.enters().at(-1), []);
  });
  check("translated and consumed route diagnostics share accepted seat authority", (f) => {
    const observations = [];
    f.server.inputFixtureTrace = {
      active: () => true,
      write(event) {
        observations.push(event);
        return observations.length;
      },
      stop() {},
      sourceOf: () => null,
    };
    f.focus(f.a);
    f.key(42, 1);
    f.focus(f.b);
    f.server.shell = { onKey: (event) => event.code === 42 && event.value === 0 };
    f.key(42, 0);
    const translated = observations.filter((event) => event.phase === "translated");
    assert.deepEqual(
      translated.map((event) => event.modifiers.shift),
      [true, false],
    );
    const consumed = observations.find((event) => event.phase === "shell");
    assert(consumed);
    assert.equal(consumed.modifiers.shift, false);
    f.focus(f.a);
    assert.deepEqual(f.a.enters().at(-1), []);
  });
  check("seat snapshot cannot mutate live state and teardown clears held state", (f) => {
    f.focus(f.a);
    f.key(42, 1);
    const snapshot = f.server.keyboardPressedKeys();
    snapshot.splice(0);
    assert.deepEqual(f.server.keyboardPressedKeys(), [42]);
    f.server.stop();
    assert.deepEqual(f.server.keyboardPressedKeys(), []);
    f.server.stop();
    assert.deepEqual(f.server.keyboardPressedKeys(), []);
  });
  console.log(
    JSON.stringify({
      status: "pass",
      cases,
      scope:
        "actual server two-client focus and generated wire/client decoder; no devices/native transport",
    }),
  );
} finally {
  for (const server of live) server.stop();
  fs.rmSync(fixture, { recursive: true, force: true });
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

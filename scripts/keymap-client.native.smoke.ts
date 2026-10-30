/** Actual generated keymap -> C60 client. Requires existing Linux libxkbcommon; no seat/device. */
// oxlint-disable import/no-relative-parent-imports -- This source-only regression connects the exact producer and client implementations.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageBuilder, MessageReader } from "@moire/protocol";
import { wlKeyboard } from "@moire/protocol/generated";
import { createXkbKeymapMemfd } from "../packages/sys/src/keymap";
import { WaylandKeyboard } from "../packages/ui/src/platforms/wayland/keyboard";
import { nodeKeymapFdIo, readKeymapFd } from "../packages/ui/src/platforms/wayland/keymap-fd";
import { createXkbClientKeymap } from "../packages/ui/src/platforms/wayland/xkb";
import type { UiKeyEvent } from "@moire/ui";

assert.equal(
  process.platform,
  "linux",
  "Native compatibility proof requires Linux; do not count a host skip as success",
);

function closed(fd: number): void {
  assert.throws(
    () => fstatSync(fd),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "EBADF",
  );
}

// The producer's advertised size must include exactly one final NUL.
let source: Buffer;
{
  const produced = createXkbKeymapMemfd();
  let ownedFd: number | null = produced.fd;
  try {
    assert.equal(fstatSync(produced.fd).size, produced.size);
    const bytes = Buffer.alloc(produced.size);
    assert.equal(readSync(produced.fd, bytes, 0, bytes.length, 0), produced.size);
    const terminated = bytes.at(-1) === 0;
    const body = terminated ? bytes.subarray(0, -1) : bytes;
    console.log(
      JSON.stringify({
        generatedMap: true,
        advertisedSize: produced.size,
        fileSize: bytes.length,
        terminalNul: terminated,
        bodySha256: createHash("sha256").update(body).digest("hex"),
      }),
    );
    assert.equal(bytes.at(-1), 0, "advertised bytes include the required terminator");
    assert.equal(bytes.subarray(0, -1).includes(0), false);
    ownedFd = null;
    source = readKeymapFd(nodeKeymapFdIo, produced.fd, produced.size);
    closed(produced.fd);
    assert.deepEqual(source, bytes);
    const map = createXkbClientKeymap(source);
    try {
      assert.equal(map.translate(30).text, "a", "existing default producer layout remains US");
    } finally {
      map.destroy();
    }
  } finally {
    if (ownedFd !== null) closeSync(ownedFd);
  }
}
console.log(
  "ok actual generated memfd size, terminal NUL, strict reader ownership and native compilation",
);

const target = {};
const events: UiKeyEvent[] = [];
const keyboard = new WaylandKeyboard({
  // Client repeat timing is covered by the Wayland keyboard suite; keep this boot check deterministic.
  timers: { setTimeout: () => 0, clearTimeout() {} },
  pressedKeys: new Set<number>(),
  resolveSurface: (id) => (id === 10 ? target : null),
  emitKey: (_target, event) => events.push(event),
  onSerial: () => {},
});
function dispatch(opcode: number, builder: MessageBuilder): void {
  const wire = builder.build(100, opcode);
  keyboard.handle(opcode, new MessageReader(wire.data, wire.fds));
}
function installProducedMap(): void {
  const produced = createXkbKeymapMemfd();
  dispatch(
    wlKeyboard.events.keymap.opcode,
    new MessageBuilder()
      .uint(wlKeyboard.enums.keymapFormat.xkbV1)
      .fd(produced.fd)
      .uint(produced.size),
  );
  closed(produced.fd);
  assert.deepEqual(keyboard.keymapState(), { kind: "available" });
}
function masks(depressed: number, locked = 0): void {
  dispatch(
    wlKeyboard.events.modifiers.opcode,
    new MessageBuilder().uint(2).uint(depressed).uint(0).uint(locked).uint(0),
  );
}
/** One fresh press and its release; wl_keyboard never re-presses a held key. */
function down(code = 30): UiKeyEvent {
  const before = events.length;
  dispatch(wlKeyboard.events.key.opcode, new MessageBuilder().uint(3).uint(0).uint(code).uint(1));
  assert.equal(events.length, before + 1, "each focused key press must deliver a fresh event");
  const event = events.at(-1);
  assert.ok(event);
  assert.equal(event.code, code);
  assert.equal(event.type, "down");
  dispatch(wlKeyboard.events.key.opcode, new MessageBuilder().uint(3).uint(0).uint(code).uint(0));
  return event;
}
try {
  installProducedMap();
  dispatch(
    wlKeyboard.events.enter.opcode,
    new MessageBuilder().uint(1).object(10).array(Buffer.alloc(0)),
  );
  masks(0);
  assert.equal(down().text, "a");
  masks(1);
  assert.equal(down().text, "A");
  assert.equal(keyboard.modifiers().shift, true);
  masks(0, 2);
  assert.equal(down().text, "A");
  masks(1, 2);
  assert.equal(down().text, "a");
  masks(4);
  assert.equal(down().text, undefined);
  assert.equal(keyboard.modifiers().ctrl, true);
  console.log(
    "ok generated map through actual Wayland decoding follows Shift, Caps and Control masks",
  );

  const directory = mkdtempSync(path.join(os.tmpdir(), "moire-produced-map-invalid-"));
  try {
    const filename = path.join(directory, "keymap");
    writeFileSync(filename, source.subarray(0, -1));
    const fd = openSync(filename, "r");
    dispatch(
      wlKeyboard.events.keymap.opcode,
      new MessageBuilder()
        .uint(wlKeyboard.enums.keymapFormat.xkbV1)
        .fd(fd)
        .uint(source.length - 1),
    );
    closed(fd);
    assert.deepEqual(keyboard.keymapState(), { kind: "unavailable", reason: "invalid" });
    const suppressed = down();
    assert.equal(suppressed.key, undefined);
    assert.equal(suppressed.text, undefined);
    assert.equal(down(28).key, "Enter");
    installProducedMap();
    masks(0);
    assert.equal(down().text, "a");
    console.log("ok omitted terminator remains rejected; fresh generated replacement recovers");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
} finally {
  keyboard.disconnect();
}
assert.deepEqual(keyboard.keymapState(), { kind: "unavailable", reason: "disconnected" });
console.log(
  JSON.stringify({
    suite: "generated producer to C60 client",
    cases: 3,
    actualExitCode: 0,
    nativeXkb: true,
    seatConnections: 0,
    deviceAccess: 0,
  }),
);

/** Deterministic client-keymap fixtures prove event/FD ownership, not native XKB layout behavior. */
import assert from "node:assert/strict";
import { fstatSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageBuilder, MessageReader } from "@moire/protocol";
import { wlKeyboard } from "@moire/protocol/generated";
import type { UiKeyEvent } from "#ui/platform";
import { WaylandKeyboard } from "./keyboard";
import { nodeKeymapFdIo } from "./keymap-fd";
import type { ClientKeymap, KeymapFdIo, WaylandModifierMask } from "./keymap-types";

const zeroMask: WaylandModifierMask = { depressed: 0, latched: 0, locked: 0, group: 0 };
const zeroModifiers = { shift: false, ctrl: false, alt: false, meta: false };
class FixtureKeymap implements ClientKeymap {
  mask: WaylandModifierMask = zeroMask;
  updates: WaylandModifierMask[] = [];
  resets = 0;
  destroyed = 0;
  fail: "none" | "mask" | "translate" | "modifiers" | "reset" = "none";
  updateMask(mask: WaylandModifierMask) {
    if (this.fail === "mask") throw new Error("Synthetic native resource failure");
    this.mask = { ...mask };
    this.updates.push(this.mask);
  }
  translate(code: number) {
    if (this.fail === "translate") throw new Error("Synthetic native resource failure");
    if (code === 28) return { key: "Enter" };
    if (code !== 30) return {};
    const effective = this.mask.depressed | this.mask.latched | this.mask.locked;
    const uppercase = Boolean(effective & 1) !== Boolean(this.mask.locked & 2);
    const text = this.mask.group === 1 ? "й" : effective & 128 ? "€" : uppercase ? "Q" : "q";
    return { key: text, text };
  }
  modifiers() {
    if (this.fail === "modifiers") throw new Error("Synthetic native resource failure");
    const effective = this.mask.depressed | this.mask.latched | this.mask.locked;
    return {
      shift: Boolean(effective & 1),
      ctrl: Boolean(effective & 4),
      alt: Boolean(effective & 8),
      meta: Boolean(effective & 16),
    };
  }
  reset() {
    if (this.fail === "reset") throw new Error("Synthetic native resource failure");
    this.resets++;
    this.mask = zeroMask;
  }
  destroy() {
    this.destroyed++;
  }
}
type Target = { keys: UiKeyEvent[] };
const folder = mkdtempSync(path.join(os.tmpdir(), "moire-keyboard-fixture-"));
let fileSerial = 0;
function realFd(source: Buffer) {
  const filename = path.join(folder, String(++fileSerial));
  writeFileSync(filename, source);
  return openSync(filename, "r");
}
function assertClosed(fd: number) {
  assert.throws(
    () => fstatSync(fd),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "EBADF",
  );
}
function setup() {
  const parent: Target = { keys: [] };
  const popup: Target = { keys: [] };
  const surfaces = new Map([
    [10, parent],
    [20, popup],
  ]);
  const maps: FixtureKeymap[] = [];
  const sources: Buffer[] = [];
  const reads: number[] = [];
  const closes: number[] = [];
  const pressedKeys = new Set<number>();
  let serial = 0;
  const configuration = { rejectFactory: false };
  const io: KeymapFdIo = {
    read(fd, size) {
      reads.push(fd);
      return nodeKeymapFdIo.read(fd, size);
    },
    close(fd) {
      closes.push(fd);
      nodeKeymapFdIo.close(fd);
    },
  };
  const keyboard = new WaylandKeyboard({
    pressedKeys,
    resolveSurface: (id) => surfaces.get(id) ?? null,
    emitKey: (target, event) => target.keys.push(event),
    onSerial: (value) => {
      serial = value;
    },
    onFocus() {
      throw new Error("Synthetic observer failure");
    },
    keymapIo: io,
    createKeymap(source) {
      sources.push(Buffer.from(source));
      if (configuration.rejectFactory) throw new Error("Synthetic invalid source");
      const map = new FixtureKeymap();
      maps.push(map);
      return map;
    },
  });
  function dispatch(opcode: number, builder: MessageBuilder) {
    const message = builder.build(7, opcode);
    keyboard.handle(opcode, new MessageReader(message.data, message.fds));
  }
  function sendMap(
    source = Buffer.from("xkb_keymap { /* deterministic mapping fixture */ };\0"),
    format: number = wlKeyboard.enums.keymapFormat.xkbV1,
    size = source.length,
  ) {
    const fd = realFd(source);
    const before = closes.length;
    dispatch(wlKeyboard.events.keymap.opcode, new MessageBuilder().uint(format).fd(fd).uint(size));
    assert.equal(closes.length, before + 1, "each received FD closes exactly once");
    assertClosed(fd);
    return fd;
  }
  function enter(surface: number, held: readonly number[] = []) {
    const keys = Buffer.alloc(held.length * 4);
    held.forEach((code, index) => keys.writeUInt32LE(code, index * 4));
    dispatch(
      wlKeyboard.events.enter.opcode,
      new MessageBuilder().uint(100).object(surface).array(keys),
    );
  }
  function leave(surface: number) {
    dispatch(wlKeyboard.events.leave.opcode, new MessageBuilder().uint(101).object(surface));
  }
  function key(code: number, state: number = wlKeyboard.enums.keyState.pressed) {
    dispatch(
      wlKeyboard.events.key.opcode,
      new MessageBuilder().uint(102).uint(1).uint(code).uint(state),
    );
  }
  function modifiers(mask: WaylandModifierMask) {
    dispatch(
      wlKeyboard.events.modifiers.opcode,
      new MessageBuilder()
        .uint(300)
        .uint(mask.depressed)
        .uint(mask.latched)
        .uint(mask.locked)
        .uint(mask.group),
    );
  }
  function currentMap() {
    const map = maps.at(-1);
    assert(map);
    return map;
  }
  return {
    keyboard,
    parent,
    popup,
    maps,
    sources,
    reads,
    closes,
    pressedKeys,
    configuration,
    serial: () => serial,
    dispatch,
    sendMap,
    enter,
    leave,
    key,
    modifiers,
    currentMap,
  };
}
let cases = 0;
function test(name: string, run: () => void) {
  run();
  cases++;
  console.log("ok " + name);
}

try {
  test("missing keymaps preserve navigation and never synthesize printable or held-key modifiers", () => {
    const f = setup();
    assert.deepEqual(f.keyboard.keymapState(), { kind: "unavailable", reason: "missing" });
    assert(Object.isFrozen(f.keyboard.keymapState()));
    f.key(28);
    assert.equal(f.parent.keys.length, 0);
    f.enter(10, [42, 29, 56, 125]);
    f.key(30);
    f.key(57);
    assert.equal(f.parent.keys[0]?.key, undefined);
    assert.equal(f.parent.keys[0]?.text, undefined);
    assert.equal(f.parent.keys[1]?.key, undefined);
    assert.equal(f.parent.keys[1]?.text, undefined);
    assert.deepEqual(f.keyboard.modifiers(), zeroModifiers);
    for (const [code, name] of [
      [1, "Escape"],
      [14, "Backspace"],
      [15, "Tab"],
      [28, "Enter"],
      [102, "Home"],
      [103, "ArrowUp"],
      [105, "ArrowLeft"],
      [106, "ArrowRight"],
      [107, "End"],
      [108, "ArrowDown"],
      [111, "Delete"],
    ] satisfies Array<[number, string]>) {
      f.key(code);
      assert.equal(f.parent.keys.at(-1)?.key, name);
      assert.equal(f.parent.keys.at(-1)?.text, undefined);
      assert.deepEqual(f.parent.keys.at(-1)?.modifiers, zeroModifiers);
    }
    f.keyboard.disconnect();
  });

  test("synthetic layout translates compositor depressed, latched, locked and group masks", () => {
    const f = setup();
    f.sendMap();
    assert.deepEqual(f.keyboard.keymapState(), { kind: "available" });
    assert.equal(f.sources.length, 1);
    assert.equal(f.sources[0]?.at(-1), 0);
    assert.equal(f.reads.length, 1);
    f.enter(10, [42]);
    f.key(30);
    assert.equal(f.parent.keys.at(-1)?.text, "q", "held Shift cannot override compositor masks");
    assert.deepEqual(f.parent.keys.at(-1)?.modifiers, zeroModifiers);
    const mask = { depressed: 4, latched: 1, locked: 2, group: 1 };
    f.modifiers(mask);
    assert.equal(f.serial(), 300);
    assert.deepEqual(f.currentMap().updates, [mask]);
    f.key(30);
    assert.equal(f.parent.keys.at(-1)?.text, "й");
    assert.deepEqual(f.parent.keys.at(-1)?.modifiers, {
      shift: true,
      ctrl: true,
      alt: false,
      meta: false,
    });
    f.modifiers({ depressed: 128, latched: 0, locked: 0, group: 0 });
    f.key(30);
    assert.equal(f.parent.keys.at(-1)?.text, "€");
    assert.equal(f.parent.keys.at(-1)?.modifiers.alt, false, "synthetic AltGr is not Alt");
    f.modifiers({ depressed: 0, latched: 1, locked: 0, group: 0 });
    f.key(42, wlKeyboard.enums.keyState.released);
    f.key(30);
    assert.equal(
      f.parent.keys.at(-1)?.text,
      "Q",
      "physical release cannot clear compositor latched state",
    );
    f.modifiers({ depressed: 0, latched: 0, locked: 2, group: 0 });
    f.key(30);
    assert.equal(f.parent.keys.at(-1)?.text, "Q");
    assert.equal(f.parent.keys.at(-1)?.modifiers.shift, false);
    const publicModifiers = f.keyboard.modifiers();
    publicModifiers.ctrl = true;
    assert.equal(f.keyboard.modifiers().ctrl, false);
    f.keyboard.disconnect();
    assert.equal(f.currentMap().destroyed, 1);
  });

  test("focus routing, popup stale leave, repeat, unknown surfaces and forget reset masks safely", () => {
    const f = setup();
    f.sendMap();
    const map = f.currentMap();
    f.enter(10);
    f.modifiers({ depressed: 1, latched: 0, locked: 0, group: 0 });
    f.enter(20, [42, 30]);
    assert.deepEqual(f.keyboard.modifiers(), zeroModifiers);
    f.modifiers({ depressed: 1, latched: 0, locked: 0, group: 0 });
    f.leave(10);
    assert.equal(f.keyboard.modifiers().shift, true, "stale parent leave cannot clear popup masks");
    f.key(30);
    f.key(30, wlKeyboard.enums.keyState.released);
    f.key(30);
    assert.deepEqual(
      f.popup.keys.map((event) => event.type),
      ["repeat", "up", "down"],
    );
    assert.equal(f.parent.keys.length, 0);
    assert.equal(f.serial(), 102);
    f.keyboard.forget(f.parent);
    assert.equal(f.keyboard.modifiers().shift, true);
    f.leave(20);
    f.key(28);
    assert.equal(f.popup.keys.length, 3);
    assert.equal(f.pressedKeys.size, 0);
    assert.deepEqual(f.keyboard.modifiers(), zeroModifiers);
    assert.equal(map.destroyed, 0);
    f.enter(999, [42]);
    f.modifiers({ depressed: 1, latched: 1, locked: 2, group: 1 });
    f.key(28);
    assert.equal(
      f.keyboard.modifiers().shift,
      true,
      "unfocused masks remain valid for the pointer",
    );
    assert.equal(f.pressedKeys.size, 0);
    f.enter(10);
    f.key(30);
    assert.equal(f.parent.keys.at(-1)?.text, "q");
    f.keyboard.forget(f.parent);
    f.key(28);
    assert.equal(f.parent.keys.length, 1);
    assert.equal(f.pressedKeys.size, 0);
    assert.equal(map.destroyed, 0);
    f.keyboard.disconnect();
    assert.equal(map.destroyed, 1);
    assert.deepEqual(f.keyboard.keymapState(), { kind: "unavailable", reason: "disconnected" });
  });

  test("unfocused compositor masks drive pointer modifiers and enter waits for fresh masks", () => {
    const f = setup();
    f.sendMap();
    f.modifiers({ depressed: 5, latched: 8, locked: 16, group: 1 });
    assert.deepEqual(f.keyboard.modifiers(), { shift: true, ctrl: true, alt: true, meta: true });
    assert.equal(f.serial(), 300);
    f.key(30);
    assert.equal(f.parent.keys.length, 0);
    assert.equal(f.pressedKeys.size, 0);
    f.enter(10, [42]);
    assert.deepEqual(f.keyboard.modifiers(), zeroModifiers);
    f.key(30);
    assert.equal(f.parent.keys.at(-1)?.text, "q");
    f.modifiers({ depressed: 1, latched: 0, locked: 0, group: 0 });
    f.key(30);
    assert.equal(f.parent.keys.at(-1)?.text, "Q");
    f.leave(10);
    assert.deepEqual(f.keyboard.modifiers(), zeroModifiers);
    f.modifiers({ depressed: 4, latched: 0, locked: 0, group: 0 });
    assert.equal(f.keyboard.modifiers().ctrl, true);
    f.key(30);
    assert.equal(f.parent.keys.length, 2);
    f.keyboard.disconnect();
  });

  test("invalid key states preserve held keys, serial and focused event delivery", () => {
    const f = setup();
    f.sendMap();
    f.enter(10);
    f.key(30);
    f.modifiers({ depressed: 1, latched: 0, locked: 0, group: 0 });
    f.key(30, 2);
    assert.equal(f.parent.keys.length, 1);
    assert.equal(f.pressedKeys.has(30), true);
    assert.equal(f.serial(), 300);
    f.key(30, 0xffffffff);
    assert.equal(f.parent.keys.length, 1);
    assert.equal(f.pressedKeys.has(30), true);
    f.key(30);
    assert.equal(f.parent.keys.at(-1)?.type, "repeat");
    assert.equal(f.parent.keys.at(-1)?.text, "Q");
    f.key(30, wlKeyboard.enums.keyState.released);
    assert.equal(f.parent.keys.at(-1)?.type, "up");
    assert.equal(f.pressedKeys.has(30), false);
    f.keyboard.disconnect();
  });

  test("replacements retire old state and classify unsupported, absent and malformed keymaps", () => {
    const f = setup();
    f.sendMap();
    const first = f.currentMap();
    f.enter(10);
    f.modifiers({ depressed: 1, latched: 0, locked: 0, group: 1 });
    f.sendMap();
    assert.equal(first.destroyed, 1);
    const second = f.currentMap();
    assert.equal(second.resets, 1);
    assert.deepEqual(f.keyboard.modifiers(), zeroModifiers);
    f.key(30);
    assert.equal(f.parent.keys.at(-1)?.text, "q");
    f.sendMap(Buffer.from("ignored"), 99);
    assert.equal(second.destroyed, 1);
    assert.deepEqual(f.keyboard.keymapState(), { kind: "unavailable", reason: "unsupported" });
    assert.equal(f.reads.length, 2, "unsupported format is closed without reading");
    f.sendMap(Buffer.alloc(0), wlKeyboard.enums.keymapFormat.noKeymap, 0);
    assert.deepEqual(f.keyboard.keymapState(), { kind: "unavailable", reason: "missing" });
    for (const source of [
      Buffer.from("missing NUL"),
      Buffer.from("embedded\0NUL\0"),
      Buffer.from([0xff, 0]),
    ]) {
      f.sendMap(source);
      assert.deepEqual(f.keyboard.keymapState(), { kind: "unavailable", reason: "invalid" });
    }
    f.sendMap(Buffer.from("short\0"), wlKeyboard.enums.keymapFormat.xkbV1, 20);
    assert.deepEqual(f.keyboard.keymapState(), { kind: "unavailable", reason: "invalid" });
    f.configuration.rejectFactory = true;
    f.sendMap();
    assert.deepEqual(f.keyboard.keymapState(), { kind: "unavailable", reason: "invalid" });
    f.keyboard.disconnect();
  });

  test("truncated size, truncated format and absent FD invalidate and never double-close", () => {
    const f = setup();
    for (const includeFormat of [true, false]) {
      f.sendMap();
      const previous = f.currentMap();
      const fd = realFd(Buffer.from("temporary\0"));
      const builder = new MessageBuilder().fd(fd);
      if (includeFormat) builder.uint(wlKeyboard.enums.keymapFormat.xkbV1);
      const before = f.closes.length;
      assert.doesNotThrow(() => f.dispatch(wlKeyboard.events.keymap.opcode, builder));
      assert.equal(f.closes.length, before + 1);
      assertClosed(fd);
      assert.equal(previous.destroyed, 1);
      assert.deepEqual(f.keyboard.keymapState(), { kind: "unavailable", reason: "invalid" });
    }
    f.sendMap();
    const previous = f.currentMap();
    const before = f.closes.length;
    assert.doesNotThrow(() =>
      f.dispatch(wlKeyboard.events.keymap.opcode, new MessageBuilder().uint(1).uint(10)),
    );
    assert.equal(f.closes.length, before);
    assert.equal(previous.destroyed, 1);
    assert.deepEqual(f.keyboard.keymapState(), { kind: "unavailable", reason: "invalid" });
    f.keyboard.disconnect();
  });

  test("client state errors release the map and stop printable and modifier authority", () => {
    for (const failure of ["mask", "translate", "modifiers", "reset"] satisfies Array<
      FixtureKeymap["fail"]
    >) {
      const f = setup();
      f.sendMap();
      const map = f.currentMap();
      f.enter(10);
      f.modifiers({ depressed: 1, latched: 0, locked: 0, group: 0 });
      map.fail = failure;
      if (failure === "mask") f.modifiers(zeroMask);
      else if (failure === "reset") {
        f.keyboard.reset();
        f.enter(10);
      }
      f.key(30);
      assert.equal(f.parent.keys.at(-1)?.text, undefined);
      assert.deepEqual(f.parent.keys.at(-1)?.modifiers, zeroModifiers);
      assert.equal(map.destroyed, 1);
      assert.deepEqual(f.keyboard.keymapState(), { kind: "unavailable", reason: "invalid" });
      f.key(28);
      assert.equal(f.parent.keys.at(-1)?.key, "Enter");
      f.keyboard.disconnect();
      f.keyboard.disconnect();
      assert.equal(map.destroyed, 1);
    }
  });

  console.log(
    JSON.stringify({
      suite: "Wayland keyboard event and FD ownership",
      cases,
      deterministicKeymapFixture: true,
      nativeXkbLayoutProof: false,
    }),
  );
} finally {
  rmSync(folder, { recursive: true, force: true });
}

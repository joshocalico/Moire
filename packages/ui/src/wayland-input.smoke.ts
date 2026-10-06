import assert from "node:assert/strict";
import { MessageBuilder, MessageReader } from "@moire/protocol";
import { wlKeyboard } from "@moire/protocol/generated";
import type { UiKeyEvent } from "./platform";
import { WaylandKeyboard } from "./platforms/wayland/keyboard";
import {
  createDeterministicClientKeymap,
  installDeterministicKeymap,
} from "./platforms/wayland/keyboard-fixture";

const parent: { keys: UiKeyEvent[] } = { keys: [] };
const popup: { keys: UiKeyEvent[] } = { keys: [] };
const surfaces = new Map([
  [10, parent],
  [20, popup],
]);
const pressedKeys = new Set<number>();
let latestSerial = 0;
const keyboard = new WaylandKeyboard({
  pressedKeys,
  resolveSurface: (surface) => surfaces.get(surface) ?? null,
  emitKey: (target, event) => target.keys.push(event),
  onSerial: (serial) => {
    latestSerial = serial;
  },
  createKeymap: createDeterministicClientKeymap,
});
const dispatch = (opcode: number, builder: MessageBuilder) => {
  const message = builder.build(7, opcode);
  keyboard.handle(opcode, new MessageReader(message.data, message.fds));
};
const enter = (surface: number, keys: readonly number[] = []) => {
  const heldKeys = Buffer.alloc(keys.length * 4);
  keys.forEach((key, index) => heldKeys.writeUInt32LE(key, index * 4));
  dispatch(
    wlKeyboard.events.enter.opcode,
    new MessageBuilder().uint(100).object(surface).array(heldKeys),
  );
};
const leave = (surface: number) =>
  dispatch(wlKeyboard.events.leave.opcode, new MessageBuilder().uint(101).object(surface));
const key = (code: number, state: number = wlKeyboard.enums.keyState.pressed) =>
  dispatch(
    wlKeyboard.events.key.opcode,
    new MessageBuilder().uint(102).uint(1).uint(code).uint(state),
  );
const modifiers = (depressed: number) =>
  dispatch(
    wlKeyboard.events.modifiers.opcode,
    new MessageBuilder().uint(103).uint(depressed).uint(0).uint(0).uint(0),
  );

// Missing-keymap behavior is exercised independently of the mapped focus cases below.
{
  const keys: UiKeyEvent[] = [];
  const unmapped = new WaylandKeyboard({
    pressedKeys: new Set<number>(),
    resolveSurface: () => keys,
    emitKey: (target, event) => target.push(event),
    onSerial: () => {},
    createKeymap: createDeterministicClientKeymap,
  });
  const send = (opcode: number, builder: MessageBuilder) => {
    const message = builder.build(8, opcode);
    unmapped.handle(opcode, new MessageReader(message.data, message.fds));
  };
  send(
    wlKeyboard.events.enter.opcode,
    new MessageBuilder().uint(1).object(10).array(Buffer.alloc(0)),
  );
  send(wlKeyboard.events.key.opcode, new MessageBuilder().uint(2).uint(0).uint(30).uint(1));
  send(wlKeyboard.events.key.opcode, new MessageBuilder().uint(3).uint(0).uint(28).uint(1));
  assert.equal(keys[0]?.key, undefined, "missing keymap supplies no assumed printable logical key");
  assert.equal(keys[0]?.text, undefined, "missing keymap supplies no assumed printable text");
  assert.equal(keys[1]?.key, "Enter", "safe navigation remains available without a keymap");
  assert.equal(keys[1]?.text, undefined);
  unmapped.disconnect();
}

key(28);
assert.equal(parent.keys.length, 0, "no keyboard focus means no fallback to the first window");
installDeterministicKeymap(dispatch);
assert.deepEqual(keyboard.keymapState(), { kind: "available" });
enter(10, [42]);
assert.equal(pressedKeys.has(42), true, "enter restores held keys for repeat tracking");
assert.equal(keyboard.modifiers().shift, false, "held Shift cannot authorize a modifier mask");
modifiers(1);
key(30);
assert.equal(parent.keys[0]?.text, "A", "mapped input uses the explicit compositor Shift mask");
assert.equal(parent.keys[0]?.modifiers.shift, true);
assert.equal(latestSerial, 102, "keyboard activation supplies a usable popup grab serial");

enter(20, [42]);
assert.equal(keyboard.modifiers().shift, false, "popup enter clears the previous modifier mask");
modifiers(1);
leave(10);
assert.equal(keyboard.modifiers().shift, true, "stale parent leave cannot clear popup masks");
key(108);
key(108);
key(108, wlKeyboard.enums.keyState.released);
assert.deepEqual(
  popup.keys.map((event) => event.type),
  ["down", "repeat", "up"],
  "native popup receives keys after enter even if parent receives a stale leave",
);
assert.equal(parent.keys.length, 1, "popup keys never leak to its parent");
leave(20);
key(28);
assert.equal(popup.keys.length, 3, "leave stops delivery");
assert.equal(pressedKeys.size, 0, "leave clears stale modifiers and repeat state");

enter(10);
assert.equal(keyboard.modifiers().shift, false, "valid leave and fresh enter clear old masks");
modifiers(0);
key(30);
assert.equal(parent.keys[1]?.text, "a", "held Shift does not survive a leave and re-enter");
keyboard.forget(parent);
key(28);
assert.equal(parent.keys.length, 2, "destroyed keyboard target receives no later keys");
assert.equal(pressedKeys.size, 0);

enter(999, [42]);
key(28);
assert.equal(parent.keys.length, 2, "unknown surface never selects an unrelated window");
assert.equal(pressedKeys.size, 0);
assert.throws(
  () =>
    dispatch(
      wlKeyboard.events.enter.opcode,
      new MessageBuilder().uint(100).object(10).array(Buffer.alloc(1)),
    ),
  /Invalid wl_keyboard.enter key array/,
);
keyboard.disconnect();

console.log(
  "[ui/wayland-input-smoke] mapped focus/popups/held keys/repeat/teardown + missing-map suppression (2 scenarios; deterministic keymap fixture, no native XKB layout proof)",
);

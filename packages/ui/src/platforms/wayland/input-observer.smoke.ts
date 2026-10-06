import assert from "node:assert/strict";
import { MessageBuilder, MessageReader } from "@moire/protocol";
import { wlKeyboard } from "@moire/protocol/generated";
import { WaylandKeyboard } from "./keyboard";
import { createDeterministicClientKeymap, installDeterministicKeymap } from "./keyboard-fixture";
import type { InputFixtureTrace, InputFixtureObservation } from "@moire/sys";
import type { UiKeyEvent, UiPointerEvent } from "#ui/platform";

// Actual wire decoding/focus state with deterministic keymap fixtures; no native XKB proof.
for (const observer of ["absent", "record", "throw"]) {
  const held = new Set<number>();
  const first = { id: 1 },
    second = { id: 2 };
  const keys: { target: typeof first; event: UiKeyEvent }[] = [];
  const focus: { type: "enter" | "leave"; surfaceId: number; target: typeof first | null }[] = [];
  const serials: number[] = [];
  const keyboard = new WaylandKeyboard({
    pressedKeys: held,
    resolveSurface: (id) => (id === 10 ? first : id === 20 ? second : null),
    emitKey: (target, event) => keys.push({ target, event }),
    onSerial: (serial) => serials.push(serial),
    createKeymap: createDeterministicClientKeymap,
    onFocus:
      observer === "absent"
        ? undefined
        : (type, surfaceId, target) => {
            focus.push({ type, surfaceId, target });
            if (observer === "throw") throw new Error("Observer failed");
          },
  });
  const dispatch = (opcode: number, builder: MessageBuilder) => {
    const message = builder.build(100, opcode);
    keyboard.handle(opcode, new MessageReader(message.data, message.fds));
  };
  const down = (serial: number, code: number) =>
    dispatch(
      wlKeyboard.events.key.opcode,
      new MessageBuilder().uint(serial).uint(0).uint(code).uint(1),
    );
  const heldShift = Buffer.alloc(4);
  heldShift.writeUInt32LE(42);
  installDeterministicKeymap(dispatch);
  assert.deepEqual(keyboard.keymapState(), { kind: "available" });
  dispatch(
    wlKeyboard.events.enter.opcode,
    new MessageBuilder().uint(1).object(10).array(heldShift),
  );
  assert.equal(held.has(42), true);
  assert.equal(keyboard.modifiers().shift, false, "held keys alone never authorize Shift");
  dispatch(
    wlKeyboard.events.modifiers.opcode,
    new MessageBuilder().uint(2).uint(1).uint(0).uint(0).uint(0),
  );
  down(3, 30);
  assert.equal(keys[0]?.target, first);
  assert.equal(keys[0]?.event.text, "A");
  down(4, 30);
  assert.equal(keys[1]?.event.type, "repeat");
  dispatch(wlKeyboard.events.leave.opcode, new MessageBuilder().uint(5).object(20));
  assert.equal(keyboard.modifiers().shift, true, "unrelated leave preserves the compositor mask");
  down(6, 48); // Unrelated leave must preserve actual first focus.
  assert.equal(keys[2]?.target, first);
  dispatch(wlKeyboard.events.leave.opcode, new MessageBuilder().uint(7).object(10));
  assert.equal(held.size, 0);
  assert.equal(keyboard.modifiers().shift, false);
  down(8, 46);
  assert.equal(keys.length, 3);
  dispatch(
    wlKeyboard.events.enter.opcode,
    new MessageBuilder().uint(9).object(20).array(Buffer.alloc(0)),
  );
  assert.equal(keyboard.modifiers().shift, false, "fresh focus waits for fresh modifier state");
  dispatch(
    wlKeyboard.events.modifiers.opcode,
    new MessageBuilder().uint(10).uint(0).uint(0).uint(0).uint(0),
  );
  down(11, 32);
  assert.equal(keys[3]?.target, second);
  assert.equal(keys[3]?.event.text, "d");
  dispatch(
    wlKeyboard.events.enter.opcode,
    new MessageBuilder().uint(12).object(999).array(Buffer.alloc(0)),
  );
  down(13, 18);
  assert.equal(keys.length, 4);
  assert.equal(held.size, 0);
  assert.deepEqual(serials, [1, 2, 3, 4, 6, 9, 10, 11]);
  if (observer === "absent") assert.equal(focus.length, 0);
  else
    assert.deepEqual(
      focus.map(({ type, surfaceId, target }) => [type, surfaceId, target?.id ?? null]),
      [
        ["enter", 10, 1],
        ["leave", 20, 2],
        ["leave", 10, 1],
        ["enter", 20, 2],
        ["enter", 999, null],
      ],
    );
  keyboard.disconnect();
}
console.log(
  "input-observer: keyboard wire/focus, compositor masks/repeat, unknown target and absent/throwing observers preserved (3 deterministic keymap fixture cases; no native XKB layout proof)",
);

// Production Window emit methods forward the identical object even if the sink throws.
const { WaylandPlatform, WaylandWindow } = await import("./index");
for (const observer of ["off", "record", "throw"]) {
  const observations: InputFixtureObservation[] = [];
  const links = new WeakMap<object, number | null>();
  let stopped = false;
  const trace: InputFixtureTrace = {
    active: () => observer !== "off" && !stopped,
    write: (event) => {
      if (observer === "throw") throw new Error("Broken diagnostic sink");
      observations.push(event);
      return observations.length;
    },
    value: () => {},
    stop: () => {
      stopped = true;
    },
    link: (event, sequence) => {
      links.set(event, sequence);
    },
    sourceOf: (event) => links.get(event) ?? null,
  };
  const platform = new WaylandPlatform();
  const window = new WaylandWindow(
    platform,
    {
      appId: "org.moire.Screenshot",
      title: "Trace fixture",
      width: 10,
      height: 10,
    },
    null,
    trace,
  );
  const key: UiKeyEvent = {
    type: "down",
    code: 30,
    key: "a",
    text: "a",
    timeMs: 1,
    modifiers: { ctrl: false, shift: false, alt: false, meta: false },
  };
  const pointer: UiPointerEvent = { type: "down", x: 4, y: 7, button: "left", timeMs: 2 };
  const delivered: object[] = [];
  window.onKey((event) => delivered.push(event));
  window.onPointer((event) => delivered.push(event));
  window.observeInputFocus("keyboard", "enter", 23);
  window.emitKey(key);
  window.emitPointer(pointer);
  assert.equal(delivered[0], key);
  assert.equal(delivered[1], pointer);
  assert.deepEqual(Object.keys(key).sort(), ["code", "key", "modifiers", "text", "timeMs", "type"]);
  if (observer === "record") {
    assert.deepEqual(
      observations.map((event) => event.layer),
      ["client-focus", "client-key", "client-pointer"],
    );
    assert.equal(trace.sourceOf(key), 2);
    assert.equal(trace.sourceOf(pointer), 3);
    assert.ok(!JSON.stringify(observations).includes('"text"'));
    const other = new WaylandWindow(
      platform,
      { appId: "org.moire.Other", title: "Other", width: 1, height: 1 },
      null,
      trace,
    );
    other.emitKey(key);
    assert.equal(stopped, true);
    assert.equal(observations.length, 3);
  } else assert.equal(observations.length, 0);
}
console.log(
  "input-observer: 3 actual WaylandWindow forwarding cases preserve event identity/text and diagnostic-only links; unexpected app stops observer only",
);

// Actual generated focus wire -> production keyboard -> production window. A later
// enter resumes input normally, but can never resume this single diagnostic fixture.
{
  const observations: InputFixtureObservation[] = [];
  const reasons: string[] = [];
  let active = true;
  const trace: InputFixtureTrace = {
    active: () => active,
    write: (event) => {
      observations.push(event);
      return observations.length;
    },
    stop: (reason) => {
      active = false;
      reasons.push(reason);
    },
    value: () => {},
    link: () => {},
    sourceOf: () => null,
  };
  const window = new WaylandWindow(
    new WaylandPlatform(),
    {
      appId: "org.moire.Screenshot",
      title: "Single focus lifetime",
      width: 10,
      height: 10,
    },
    null,
    trace,
  );
  const keys: UiKeyEvent[] = [];
  const pointers: UiPointerEvent[] = [];
  window.onKey((event) => keys.push(event));
  window.onPointer((event) => pointers.push(event));
  const held = new Set<number>();
  const keyboard = new WaylandKeyboard({
    pressedKeys: held,
    resolveSurface: (id) => (id === 23 ? window : null),
    emitKey: (target, event) => target.emitKey(event),
    onSerial: () => {},
    createKeymap: createDeterministicClientKeymap,
    onFocus: (type, surfaceId, target) => target?.observeInputFocus("keyboard", type, surfaceId),
  });
  const dispatch = (opcode: number, builder: MessageBuilder) => {
    const message = builder.build(100, opcode);
    keyboard.handle(opcode, new MessageReader(message.data, message.fds));
  };
  const enter = () =>
    dispatch(
      wlKeyboard.events.enter.opcode,
      new MessageBuilder().uint(1).object(23).array(Buffer.alloc(0)),
    );
  const down = (code: number) =>
    dispatch(wlKeyboard.events.key.opcode, new MessageBuilder().uint(2).uint(0).uint(code).uint(1));
  const modifiers = () =>
    dispatch(
      wlKeyboard.events.modifiers.opcode,
      new MessageBuilder().uint(2).uint(0).uint(0).uint(0).uint(0),
    );
  installDeterministicKeymap(dispatch);
  assert.deepEqual(keyboard.keymapState(), { kind: "available" });
  enter();
  modifiers();
  window.observeInputFocus("pointer", "leave", 23);
  assert.equal(active, true, "pointer leave remains valid during a keyboard-focused fixture");
  down(30);
  dispatch(wlKeyboard.events.leave.opcode, new MessageBuilder().uint(3).object(23));
  assert.equal(active, false, "keyboard leave ends the single fixture scope");
  assert.deepEqual(reasons, ["focus"]);
  assert.equal(held.size, 0, "production held-key reset survives diagnostic termination");
  const last = observations.at(-1);
  assert.deepEqual(last, {
    layer: "client-focus",
    device: "keyboard",
    type: "leave",
    surfaceId: 23,
  });
  const count = observations.length;
  down(48);
  assert.equal(keys.length, 1, "unfocused keyboard wire still drops keys");
  enter();
  modifiers();
  down(48);
  assert.deepEqual(
    keys.map((event) => event.text),
    ["a", "b"],
    "later actual keyboard focus resumes normal delivery",
  );
  const pointer: UiPointerEvent = { type: "move", x: 2, y: 3, timeMs: 4 };
  window.emitPointer(pointer);
  assert.equal(pointers[0], pointer);
  assert.equal(observations.length, count, "ended diagnostics never resume on later focus/input");
  assert.deepEqual(reasons, ["focus"]);
  keyboard.disconnect();
}
console.log(
  "input-observer: keyboard leave ends app fixture; pointer leave and subsequent mapped wire input preserve behavior (1 deterministic keymap fixture case; no native XKB layout proof)",
);

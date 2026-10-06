import assert from "node:assert/strict";
import React from "react";
import { ContextMenu, contextMenuSurfaceSize, installUiFonts, Window } from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";
import { tickMotionFrame } from "./motion";

await installUiFonts();
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };

async function openMenu(count = 4, disabled = new Set([0, 2])) {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({ title: "Menu input", width: 300, height: 220 });
  const activated: number[] = [];
  let dismissals = 0;
  const actions = Array.from({ length: count }, (_, index) => ({
    id: String(index),
    label: `Action ${index}`,
    disabled: disabled.has(index),
    separatorBefore: index === 3,
    onPress: () => activated.push(index),
  }));
  window.setContent(() => (
    <ContextMenu
      viewportWidth={300}
      viewportHeight={220}
      x={260}
      y={200}
      title="Actions"
      actions={actions}
      onDismiss={() => dismissals++}
    />
  ));
  window.mount(backend);
  await Promise.resolve();
  const native = backend.getWindows()[0];
  assert.ok(native);
  const settle = async () => {
    for (let frame = 0; frame < 80; frame++) {
      tickMotionFrame(1 / 60);
      window.requestRedraw();
      window.tick();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  await settle();
  const key = (code: number, name: string, shift = false, repeat = false) => {
    native.injectKey({
      type: repeat ? "repeat" : "down",
      code,
      key: name,
      modifiers: { ...modifiers, shift },
      timeMs: code,
    });
    window.tick();
    window.tick();
    window.tick();
  };
  return {
    actions,
    activated,
    native,
    key,
    settle,
    dismissals: () => dismissals,
    close: () => {
      window.destroy();
      backend.disconnect();
    },
  };
}

const arrows = await openMenu();
arrows.key(108, "ArrowDown");
arrows.key(108, "ArrowDown", false, true);
arrows.key(103, "ArrowUp");
arrows.key(28, "Enter");
arrows.key(28, "Enter");
await arrows.settle();
assert.deepEqual(arrows.activated, [3], "Down skips disabled rows and activation runs once");
assert.equal(arrows.dismissals(), 1);
arrows.close();

const home = await openMenu();
home.key(107, "End");
home.key(102, "Home");
home.key(57, " ");
await home.settle();
assert.deepEqual(home.activated, [1], "Home selects the first enabled action");
home.close();

const traversal = await openMenu();
traversal.key(15, "Tab", true);
traversal.key(28, "Enter");
await traversal.settle();
assert.deepEqual(traversal.activated, [3], "Shift+Tab wraps within the enabled menu rows");
traversal.close();

const long = await openMenu(40, new Set([0, 39]));
long.native.injectPointer({ type: "move", x: 120, y: 100, modifiers, timeMs: 1 });
long.key(107, "End");
long.key(28, "Enter");
await long.settle();
assert.deepEqual(long.activated, [38], "End scrolls to and activates the last enabled row");
assert.ok(contextMenuSurfaceSize(long.actions, "Actions").height <= 480);
assert.ok(contextMenuSurfaceSize(long.actions, "Actions", 244, 220).height <= 220);
long.close();

const scrolled = await openMenu(40, new Set([0, 39]));
scrolled.key(107, "End");
await scrolled.settle();
for (const type of ["down", "up"] as const) {
  scrolled.native.injectPointer({
    type,
    x: 120,
    y: 172,
    button: "left",
    modifiers,
    timeMs: 1,
  });
}
await scrolled.settle();
assert.deepEqual(
  scrolled.activated,
  [38],
  "End brings the last enabled row into the painted viewport",
);
scrolled.close();

const empty = await openMenu(2, new Set([0, 1]));
empty.key(108, "ArrowDown");
empty.key(28, "Enter");
empty.key(1, "Escape");
await empty.settle();
assert.deepEqual(empty.activated, []);
assert.equal(empty.dismissals(), 1, "Escape dismisses a menu with no enabled actions");
empty.close();

console.log(
  "[ui/menu-input-smoke] menu focus, navigation, disabled rows, activation and bounds ok",
);

/* eslint-disable import/no-relative-parent-imports -- Exercise real platform dispatch across shared host/widget boundaries. */
import assert from "node:assert/strict";
import React, { useState } from "react";
import {
  Group,
  collectHits,
  createShellRoot,
  hitRegionContains,
  renderShell,
} from "@moire/react-host";
import { FocusScope, Pressable, Window, installUiFonts } from "@moire/ui";
import { HeadlessPlatform } from "../src/platforms/headless/index";

await installUiFonts();
let clippedPresses = 0;
const clippedTree = (
  <Group x={10} y={10} width={100} height={100} clip>
    <Group x={20} y={20} width={40} height={30} clip translateX={5}>
      <Pressable
        x={-20}
        y={-10}
        width={100}
        height={90}
        focusId="clipped"
        onPress={() => clippedPresses++}
      />
      <Pressable y={60} width={30} height={20} focusId="offscreen" focusable />
    </Group>
  </Group>
);
const root = createShellRoot();
renderShell(root, clippedTree);
const hits = collectHits(root.container);
const clipped = hits.find((hit) => hit.focusId === "clipped")!;
assert.deepEqual(clipped.pointerClip, { x: 35, y: 30, width: 40, height: 30 });
assert.ok(hitRegionContains(clipped, 40, 35));
assert.equal(hitRegionContains(clipped, 20, 35), false);
assert.equal(hitRegionContains(clipped, 40, 65), false);
assert.ok(
  hits.find((hit) => hit.focusId === "offscreen")?.focusable,
  "clipped rows remain keyboard accessible",
);
renderShell(
  root,
  <Group width={50} height={50} focusScopeId="inactive" focusScopeActive={false}>
    <Group width={50} height={50} focusScopeId="inner" focusScopeActive>
      <Pressable width={30} height={30} onPress={() => {}} />
    </Group>
  </Group>,
);
assert.ok(
  collectHits(root.container).every((hit) => hit.focusScopeActive === false),
  "nested scope cannot reactivate a closed ancestor",
);
const backend = new HeadlessPlatform();
await backend.connect();
const clipWindow = new Window({ width: 180, height: 150, title: "Clip dispatch" });
clipWindow.setContent(clippedTree);
clipWindow.mount(backend);
await Promise.resolve();
clipWindow.tick();
const nativeClip = backend.getWindows()[0]!;
const click = (x: number, y: number) => {
  nativeClip.injectPointer({ type: "down", x, y, button: "left", timeMs: 1 });
  nativeClip.injectPointer({ type: "up", x, y, button: "left", timeMs: 2 });
};
click(20, 35);
assert.equal(clippedPresses, 0, "invisible portions cannot receive pointer presses");
click(40, 35);
assert.equal(clippedPresses, 1);
let edgePresses = 0;
clipWindow.setContent(
  <Pressable x={170} y={80} width={40} height={30} onPress={() => edgePresses++} />,
);
clipWindow.tick();
nativeClip.injectPointer({ type: "down", x: 175, y: 90, button: "left", timeMs: 3 });
nativeClip.injectPointer({ type: "up", x: 190, y: 90, button: "left", timeMs: 4 });
assert.equal(edgePresses, 0, "captured release outside framebuffer cannot activate");
nativeClip.injectPointer({ type: "down", x: 175, y: 90, button: "left", timeMs: 5 });
clipWindow.setContent(null);
clipWindow.tick();
nativeClip.injectPointer({ type: "up", x: 175, y: 90, button: "left", timeMs: 6 });
assert.equal(edgePresses, 0, "removed pointer capture cannot call a stale press");
clipWindow.destroy();

let basePresses = 0,
  modalPresses = 0,
  firstModalPresses = 0;
function FocusFixture() {
  const [modal, setModal] = useState(false),
    [nested, setNested] = useState(false);
  return (
    <Group width={180} height={150}>
      <Pressable
        width={60}
        height={30}
        autoFocus
        focusId="base"
        onPress={() => {
          basePresses++;
          setModal(true);
        }}
      />
      {modal && (
        <FocusScope id="modal" width={160} height={120} onEscape={() => setModal(false)}>
          <Pressable
            y={35}
            width={60}
            height={30}
            autoFocus
            focusId="modal-first"
            onPress={() => firstModalPresses++}
          />
          <Pressable
            y={70}
            width={60}
            height={30}
            focusId="modal-button"
            onPress={() => {
              modalPresses++;
              setNested(true);
            }}
          />
          {nested && (
            <FocusScope id="nested" width={150} height={110} onEscape={() => setNested(false)}>
              <Pressable
                y={80}
                width={60}
                height={30}
                autoFocus
                focusId="nested-button"
                focusable
              />
            </FocusScope>
          )}
        </FocusScope>
      )}
    </Group>
  );
}
const window = new Window({ width: 180, height: 150, title: "Focus return" });
window.setContent(() => <FocusFixture />);
window.mount(backend);
await Promise.resolve();
window.tick();
const native = backend.getWindows()[1]!;
const key = (name: string, code: number) =>
  native.injectKey({
    type: "down",
    code,
    key: name,
    timeMs: 3,
    modifiers: { shift: false, ctrl: false, alt: false, meta: false },
  });
key("Enter", 28); // base -> modal
key("Tab", 15); // choose second modal control
key("Enter", 28); // modal -> nested
assert.equal(modalPresses, 1);
key("Escape", 1); // nested -> modal
key("Enter", 28);
assert.equal(modalPresses, 2, "nested close restores the previous modal control");
assert.equal(firstModalPresses, 0, "nested close must not substitute the first modal control");
key("Escape", 1);
key("Escape", 1); // modal -> base
key("Enter", 28);
assert.equal(basePresses, 2, "closing a modal restores its opener");
window.destroy();
backend.disconnect();
renderShell(root, null);
console.log("Shared input clipping and nested focus restoration passed");

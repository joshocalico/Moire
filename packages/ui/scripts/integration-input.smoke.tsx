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

// A control that goes away is remembered, not forgotten: disabled while its action runs (the
// system's password prompt holds the keyboard meanwhile) or briefly absent, it takes focus back
// when it returns, unless the user put focus elsewhere first. Native toolkits do the same.
const remembered = {
  busy: (_busy: boolean) => {},
  modal: (_open: boolean) => {},
  opener: (_shown: boolean) => {},
};
let actionPresses = 0;
function RememberFixture() {
  const [busy, setBusy] = useState(false),
    [modal, setModal] = useState(false),
    [opener, setOpener] = useState(true);
  remembered.busy = setBusy;
  remembered.modal = setModal;
  remembered.opener = setOpener;
  return (
    <Group width={180} height={150}>
      <Pressable width={40} height={20} focusId="other" onPress={() => {}} />
      {opener && (
        <Pressable y={25} width={40} height={20} focusId="opener" onPress={() => setModal(true)} />
      )}
      <Pressable
        y={50}
        width={40}
        height={20}
        focusId="action"
        disabled={busy}
        onPress={() => {
          actionPresses++;
          setBusy(true);
        }}
      />
      {modal && (
        <FocusScope id="sheet" x={60} width={120} height={150} onEscape={() => setModal(false)}>
          <Pressable width={60} height={20} autoFocus focusId="sheet-first" onPress={() => {}} />
          <Pressable
            y={25}
            width={60}
            height={20}
            focusId="sheet-submit"
            disabled={busy}
            onPress={() => setBusy(true)}
          />
        </FocusScope>
      )}
    </Group>
  );
}
const rememberWindow = new Window({ width: 180, height: 150, title: "Focus memory" });
rememberWindow.setContent(() => <RememberFixture />);
rememberWindow.mount(backend);
await Promise.resolve();
rememberWindow.tick();
const rememberNative = backend.getWindows().at(-1)!;
const focused = () => (rememberWindow as unknown as { focusedId: string | null }).focusedId;
const press = (name: string, code: number, shift = false) => {
  rememberNative.injectKey({
    type: "down",
    code,
    key: name,
    timeMs: 4,
    modifiers: { shift, ctrl: false, alt: false, meta: false },
  });
  rememberWindow.tick();
};
/** A state change from outside an input event: React commits it on its own schedule. */
const update = async (change: () => void) => {
  change();
  await new Promise((resolve) => setTimeout(resolve, 0));
  rememberWindow.tick();
};
press("Tab", 15);
press("Tab", 15);
press("Tab", 15);
assert.equal(focused(), "action");
press("Enter", 28);
assert.equal(focused(), null, "a disabled control holds no focus");
await update(() => remembered.busy(false));
assert.equal(focused(), "action", "re-enabled, it has focus again");
press("Enter", 28);
assert.equal(actionPresses, 2, "and keys reach it without a Tab first");
// Moving focus meanwhile wins: Tab, or a click on nothing.
press("Tab", 15);
assert.equal(focused(), "other");
await update(() => remembered.busy(false));
assert.equal(focused(), "other", "a Tab while it was away is not undone");
press("Tab", 15, true);
press("Enter", 28);
rememberNative.injectPointer({ type: "down", button: "left", x: 170, y: 140, timeMs: 5 });
rememberNative.injectPointer({ type: "up", button: "left", x: 170, y: 140, timeMs: 6 });
await update(() => remembered.busy(false));
assert.equal(focused(), null, "nor is a click that put focus nowhere");
// In a sheet: the button that asked comes back, from the scope's first control, which only
// stood in for it.
press("Tab", 15);
press("Tab", 15);
assert.equal(focused(), "opener");
press("Enter", 28);
assert.equal(focused(), "sheet-first");
press("Tab", 15);
press("Enter", 28);
assert.equal(focused(), "sheet-first", "the scope keeps focus while its button is disabled");
await update(() => remembered.busy(false));
assert.equal(focused(), "sheet-submit", "and gives it back when the button returns");
// The sheet closes while its opener is away (not committed yet): focus waits for it.
await update(() => {
  remembered.modal(false);
  remembered.opener(false);
});
assert.equal(focused(), null);
await update(() => remembered.opener(true));
assert.equal(focused(), "opener", "closing a sheet restores an opener that comes back");
rememberWindow.destroy();
backend.disconnect();
renderShell(root, null);
console.log("Shared input clipping, nested focus restoration and focus memory passed");

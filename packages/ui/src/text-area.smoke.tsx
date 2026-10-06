import assert from "node:assert/strict";
import React, { useState } from "react";
import {
  TextArea,
  Window,
  installUiFonts,
  writeClipboardText,
  readClipboardText,
  ContextMenu,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";
import { tickMotionFrame } from "./motion";

await installUiFonts();
const backend = new HeadlessPlatform();
await backend.connect();
let value = "",
  changes = 0,
  closeRequests = 0;
function Fixture() {
  const [text, setText] = useState("");
  return (
    <TextArea
      width={220}
      height={110}
      autoFocus
      value={text}
      fontFamily="mono"
      onChange={(next) => {
        value = next;
        changes++;
        setText(next);
      }}
    />
  );
}
const window = new Window({ title: "Multiline text editing", width: 220, height: 110 });
window.setContent(<Fixture />);
window.mount(backend);
await Promise.resolve();
window.tick();
const native = backend.getWindows()[0]!;
const key = (code: number, name: string, text?: string, ctrl = false, shift = false) =>
  native.injectKey({
    type: "down",
    code,
    key: name,
    text,
    timeMs: code,
    modifiers: { ctrl, shift, alt: false, meta: false },
  });
key(30, "a", "A");
key(28, "Enter");
key(48, "b", "B");
assert.equal(value, "A\nB");
key(103, "ArrowUp");
key(107, "End");
key(46, "c", "C");
assert.equal(value, "AC\nB");
key(44, "z", undefined, true);
assert.equal(value, "A\nB");
key(44, "z", undefined, true, true);
assert.equal(value, "AC\nB");
key(30, "a", undefined, true);
key(46, "c", undefined, true);
await new Promise<void>((resolve) => setImmediate(resolve));
assert.equal(await readClipboardText(), "AC\nB");
await writeClipboardText("paste\n🙂");
key(47, "v", undefined, true);
await new Promise<void>((resolve) => setImmediate(resolve));
window.tick();
assert.equal(value, "paste\n🙂");
key(14, "Backspace");
assert.equal(value, "paste\n", "backspace removes a surrogate pair together");
key(30, "a", undefined, true);
for (let index = 0; index < 120; index++) key(30, "a", "x");
assert.equal(value, "x".repeat(120));
assert.ok(changes >= 120);
await writeClipboardText("a\n😀");
key(30, "a", undefined, true);
key(47, "v", undefined, true);
await new Promise<void>((resolve) => setImmediate(resolve));
window.tick();
key(102, "Home", undefined, true);
key(106, "ArrowRight");
key(108, "ArrowDown");
key(111, "Delete");
assert.equal(value, "a\n", "vertical navigation cannot split a UTF-16 surrogate pair");
window.setCloseGuard(() => {
  closeRequests++;
  return false;
});
native.requestClose();
key(48, "b", "Y");
assert.equal(closeRequests, 1);
assert.ok(String(value).endsWith("Y"), "close guard retains a live editor");
window.destroy();

let activated = 0,
  dismissed = 0;
const menu = new Window({ width: 200, height: 130, title: "Static animated content" });
menu.setContent(
  <ContextMenu
    viewportWidth={200}
    viewportHeight={130}
    x={8}
    y={8}
    actions={[{ id: "run", label: "Run", onPress: () => activated++ }]}
    onDismiss={() => dismissed++}
  />,
);
menu.mount(backend);
await Promise.resolve();
menu.tick();
const menuNative = backend.getWindows()[1]!;
const settle = async () => {
  for (let frame = 0; frame < 80; frame++) {
    tickMotionFrame(1 / 60);
    menu.requestRedraw();
    menu.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};
await settle();
menuNative.injectKey({
  type: "down",
  code: 28,
  key: "Enter",
  timeMs: 1,
  modifiers: { ctrl: false, shift: false, alt: false, meta: false },
});
await settle();
assert.equal(activated, 1);
assert.equal(dismissed, 1, "static JSX must receive the final close animation");
menu.destroy();
const survivor = new Window({ width: 100, height: 100, title: "Clipboard survivor" });
survivor.mount(backend);
const newest = new Window({ width: 100, height: 100, title: "Clipboard newest" });
newest.mount(backend);
newest.destroy();
await writeClipboardText("survives window close");
assert.equal(await readClipboardText(), "survives window close");
survivor.destroy();
backend.disconnect();
console.log("Multiline editor, clipboard, guarded close and static motion passed");

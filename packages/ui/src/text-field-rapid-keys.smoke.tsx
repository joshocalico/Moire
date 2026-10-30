/** Keys delivered before the next render must not be lost, and a rejected edit must not leak. */
import assert from "node:assert/strict";
import React, { useState } from "react";
import { TextField, Window, installUiFonts } from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";

await installUiFonts();
const backend = new HeadlessPlatform();
await backend.connect();
let value = "";
let rejectNext = false;
function Fixture() {
  const [text, setText] = useState("");
  return (
    <TextField
      width={240}
      height={40}
      autoFocus
      password
      value={text}
      onChange={(next) => {
        if (rejectNext) return;
        value = next;
        setText(next);
      }}
    />
  );
}
const window = new Window({ title: "Rapid text entry", width: 240, height: 40 });
window.setContent(<Fixture />);
window.mount(backend);
await Promise.resolve();
window.tick();
const native = backend.getWindows()[0]!;
const type = (text: string) => {
  for (const ch of text)
    native.injectKey({
      type: "down",
      code: ch === "-" ? 12 : 30,
      key: ch,
      text: ch,
      timeMs: 0,
      modifiers: { ctrl: false, shift: false, alt: false, meta: false },
    });
};
const backspace = () =>
  native.injectKey({
    type: "down",
    code: 14,
    key: "Backspace",
    timeMs: 0,
    modifiers: { ctrl: false, shift: false, alt: false, meta: false },
  });

// No tick between keys: every key reaches a handler from the same rendered frame.
type("moire-pam");
assert.equal(value, "moire-pam", "keys before the next render were dropped");
backspace();
backspace();
assert.equal(value, "moire-p", "backspace before the next render used a stale value");
window.tick();
type("-test");
assert.equal(value, "moire-p-test");

// A parent that rejects an edit stays authoritative after the next render.
rejectNext = true;
type("x");
rejectNext = false;
window.tick();
type("!");
assert.equal(value, "moire-p-test!", "rejected edit leaked into later input");
console.log("[ui/text-field-rapid-keys] ok");
process.exit(0);

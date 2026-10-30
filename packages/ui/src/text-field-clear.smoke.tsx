/**
 * Clearing a search keeps typing in it: the × of SearchField and TokenField is a pointer-only
 * button, so pressing it leaves keyboard focus in the field (inside a trapped dialog scope too,
 * where focus used to fall to the dialog's first control), and Tab never stops on it. Ctrl+A
 * then Backspace clears the text from the keyboard.
 */
import assert from "node:assert/strict";
import React, { useState } from "react";
import {
  Button,
  FocusScope,
  SearchField,
  TokenField,
  Window,
  installUiFonts,
  type TokenFieldToken,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";

type Hit = {
  x: number;
  y: number;
  width: number;
  height: number;
  focusId?: string;
  focusable?: boolean;
  onPress?: unknown;
};
type Internals = { hits: Hit[]; focusedId: string | null };

await installUiFonts();
const backend = new HeadlessPlatform();
await backend.connect();
const values = { search: "", token: "" };
let tokens: TokenFieldToken[] = [];

function Fixture() {
  const [search, setSearch] = useState("");
  const [token, setToken] = useState("");
  const [chips, setChips] = useState<TokenFieldToken[]>([{ id: "kind:image", label: "Images" }]);
  values.search = search;
  values.token = token;
  tokens = chips;
  return (
    // Like a Settings sheet: a trapped scope whose first control is its close button.
    <FocusScope width={420} height={200}>
      <Button x={340} width={72} height={30} label="Close" focusId="close" onPress={() => {}} />
      <SearchField
        y={40}
        width={320}
        height={34}
        value={search}
        focusId="search"
        placeholder="Search cities"
        onChange={setSearch}
      />
      <TokenField
        y={100}
        width={320}
        height={34}
        value={token}
        tokens={chips}
        focusId="tokens"
        placeholder="Search files"
        onChange={setToken}
        onTokensChange={setChips}
      />
    </FocusScope>
  );
}

const window = new Window({ title: "Clearing a field", width: 420, height: 200 });
window.setContent(<Fixture />);
window.mount(backend);
await Promise.resolve();
window.tick();
const native = backend.getWindows()[0]!;
const internals = window as unknown as Internals;
const none = { shift: false, ctrl: false, alt: false, meta: false };
const settle = async () => {
  for (let frame = 0; frame < 4; frame++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    window.tick();
  }
};
const key = (code: number, name: string, text?: string, ctrl = false) => {
  const modifiers = { ...none, ctrl };
  native.injectKey({ type: "down", code, key: name, text, modifiers, timeMs: 1 });
  native.injectKey({ type: "up", code, key: name, modifiers, timeMs: 2 });
  window.tick();
};
const type = (text: string) => {
  for (const character of text) key(0, character, character);
};
const click = (x: number, y: number) => {
  native.injectPointer({ type: "down", button: "left", x, y, timeMs: 1 });
  native.injectPointer({ type: "up", button: "left", x, y, timeMs: 2 });
  window.tick();
};
/** The × inside a field: the pressable icon button whose centre lies in the field's row. */
const clearButton = (rowY: number) => {
  const hit = internals.hits.find(
    (candidate) =>
      candidate.focusId?.startsWith("icon-button:") &&
      !!candidate.onPress &&
      candidate.y <= rowY &&
      candidate.y + candidate.height >= rowY,
  );
  assert.ok(hit, `no clear button at y=${rowY}`);
  return hit;
};
const pressClear = (rowY: number) => {
  const hit = clearButton(rowY);
  click(hit.x + hit.width / 2, hit.y + hit.height / 2);
};

// ---- SearchField: × clears, focus stays, typing continues.
const searchHit = internals.hits.find((hit) => hit.focusId === "search")!;
click(searchHit.x + 20, searchHit.y + searchHit.height / 2);
assert.equal(internals.focusedId, "search");
type("lond");
assert.equal(values.search, "lond");
const searchClear = clearButton(57);
assert.equal(searchClear.focusable, false, "the × is not a focus stop");
pressClear(57);
await settle();
assert.equal(values.search, "", "× clears the text");
assert.equal(internals.focusedId, "search", "focus stays in the field after clearing");
type("par");
assert.equal(values.search, "par", "typing after clearing goes into the field");

// Tab never stops on the ×.
assert(
  !internals.hits.some((hit) => hit.focusable && hit.focusId?.startsWith("icon-button:")),
  "no clear button is a tab stop",
);

// ---- Ctrl+A, Backspace clears from the keyboard; Ctrl+A then typing replaces.
key(30, "a", "a", true);
key(14, "Backspace");
assert.equal(values.search, "", "Ctrl+A, Backspace clears the field");
type("tokyo");
key(30, "a", undefined, true);
type("Lima");
assert.equal(values.search, "Lima", "Ctrl+A then typing replaces the text");
key(30, "a", "a", true);
key(111, "Delete");
assert.equal(values.search, "", "Ctrl+A, Delete clears the field");

// ---- Pressing × while focus is elsewhere brings focus to the field.
type("oslo");
native.injectKey({ type: "down", code: 15, key: "Tab", modifiers: none, timeMs: 1 });
window.tick();
assert.notEqual(internals.focusedId, "search", "Tab moved focus off the field");
pressClear(57);
await settle();
assert.equal(values.search, "");
assert.equal(internals.focusedId, "search", "× focuses the field it clears");

// ---- TokenField: × clears text and tokens, focus stays, typing continues.
const tokenHit = internals.hits.find((hit) => hit.focusId === "tokens")!;
click(tokenHit.x + tokenHit.width / 2, tokenHit.y + tokenHit.height / 2);
await settle();
assert.equal(internals.focusedId, "tokens");
type("draft");
assert.equal(values.token, "draft");
pressClear(117);
await settle();
assert.equal(values.token, "", "× clears the text");
assert.equal(tokens.length, 0, "× clears the tokens");
assert.equal(internals.focusedId, "tokens", "focus returns to the token field");
type("notes");
assert.equal(values.token, "notes", "typing after clearing goes into the token field");
key(30, "a", "a", true);
key(14, "Backspace");
assert.equal(values.token, "", "Ctrl+A, Backspace clears the token field's text");

window.destroy();
backend.disconnect();
console.log("[ui/text-field-clear] × keeps focus in SearchField and TokenField; Ctrl+A clears");
process.exit(0);

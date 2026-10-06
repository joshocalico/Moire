import assert from "node:assert/strict";
import React from "react";
import { readClipboardText } from "@moire/ui";
import { findCharacters, unicodeCode } from "./catalog";
import { CharactersApp } from "./main";
import { harness } from "./testing";
assert.equal(findCharacters("copyright")[0]?.glyph, "©");
assert.equal(findCharacters("u+03c0")[0]?.glyph, "π");
assert.equal(unicodeCode("©"), "U+00A9");
const app = await harness((size) => <CharactersApp {...size} />, 620, 650);
app.text("copyright");
app.click(44, 240);
app.click(564, 26);
await app.settle();
assert.equal(
  await readClipboardText(),
  "©",
  "actual character selection and Copy did not reach headless clipboard",
);
app.click(100, 84);
app.key(30, "a", { ctrl: true });
app.key(14, "Backspace");
app.click(100, 128);
await app.settle();
app.key(108, "ArrowDown");
app.key(108, "ArrowDown");
app.key(28, "Enter");
await app.settle();
app.click(44, 240);
app.click(564, 26);
await app.settle();
assert.equal(
  await readClipboardText(),
  "×",
  "actual category overlay keyboard selection did not filter the character grid",
);
app.destroy();
console.log(
  "Characters search/code points, category keyboard overlay and actual Window clipboard copy passed",
);

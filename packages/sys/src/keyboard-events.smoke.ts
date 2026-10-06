import assert from "node:assert/strict";
import { KeyboardEventFilter } from "./keyboard-events";
const filter = new KeyboardEventFilter();
for (let index = 0; index < 80; index++) {
  const press = { code: 20, value: 1, timeMs: index * 2 };
  const release = { ...press, value: 0, timeMs: press.timeMs + 1 };
  assert.equal(filter.accept(10, press), true, "rapid presses on the same keyboard are real input");
  assert.equal(filter.accept(11, press), false, "the mirrored node does not duplicate a press");
  assert.equal(filter.accept(10, release), true, "every real release must reach the client");
  assert.equal(filter.accept(11, release), false);
}
assert.equal(
  filter.accept(11, { code: 20, value: 1, timeMs: 1000 }),
  true,
  "a later event from another keyboard is not a duplicate",
);
filter.clear();
assert.equal(filter.accept(10, { code: 20, value: 1, timeMs: 1000 }), true);
console.log("[sys/keyboard-events] fast presses/releases and mirrored nodes passed");

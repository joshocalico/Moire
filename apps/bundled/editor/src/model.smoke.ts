/** Find/replace, line and position logic of the editor, without rendering. */
import assert from "node:assert/strict";
import {
  MAX_MATCHES,
  cursorPosition,
  findMatches,
  lineCount,
  lineOffset,
  matchAt,
  replaceAll,
  stepMatch,
} from "./model";

const text = "Alpha beta alpha\nGAMMA alpha";
const insensitive = findMatches(text, "alpha", false);
assert.deepEqual(
  insensitive.map((match) => match.from),
  [0, 11, 23],
);
assert.deepEqual(
  findMatches(text, "alpha", true).map((match) => match.from),
  [11, 23],
  "match case skips other cases",
);
assert.deepEqual(findMatches(text, "", false), [], "an empty query matches nothing");
assert.deepEqual(
  findMatches("aaaa", "aa", false).map((match) => match.from),
  [0, 2],
  "matches do not overlap",
);
assert.equal(findMatches("x".repeat(MAX_MATCHES + 5), "x", false).length, MAX_MATCHES);

// Stepping skips the selected match and wraps around both ends.
assert.equal(stepMatch(insensitive, { from: 0, to: 5 }, 1), 1);
assert.equal(stepMatch(insensitive, { from: 23, to: 28 }, 1), 0, "next wraps to the first");
assert.equal(stepMatch(insensitive, { from: 0, to: 5 }, -1), 2, "previous wraps to the last");
assert.equal(stepMatch(insensitive, { from: 12, to: 12 }, -1), 0);
assert.equal(stepMatch([], { from: 0, to: 0 }, 1), -1);
assert.equal(matchAt(insensitive, { from: 11, to: 16 }), 1);
assert.equal(matchAt(insensitive, { from: 11, to: 12 }), -1);

assert.deepEqual(replaceAll(text, "alpha", "omega", false), {
  text: "omega beta omega\nGAMMA omega",
  count: 3,
});
assert.deepEqual(replaceAll(text, "zeta", "omega", false), { text, count: 0 });

assert.equal(lineCount(text), 2);
assert.equal(lineCount(""), 1);
assert.deepEqual(cursorPosition(text, 0), { line: 1, column: 1 });
assert.deepEqual(cursorPosition(text, 17), { line: 2, column: 1 });
assert.deepEqual(cursorPosition(text, 20), { line: 2, column: 4 });
assert.equal(lineOffset(text, "2"), 17);
assert.equal(lineOffset(text, " 1 "), 0);
assert.deepEqual(lineOffset(text, "3"), {
  error: "Enter a line number from 1 to 2.",
});
assert.deepEqual(lineOffset(text, "two"), {
  error: "Enter a line number from 1 to 2.",
});
console.log("[editor/model] find, step, replace-all, cursor position and go-to-line passed");

/** Batch rename patterns: placeholders, kept extensions, numbering and refused patterns. */
import assert from "node:assert/strict";
import { batchName, batchNames } from "./batch-rename";

assert.equal(batchName("photo.jpg", "{name}", 0, 3), "photo.jpg", "{name} keeps the extension");
assert.equal(batchName("photo.jpg", "Trip {n}", 1, 12), "Trip 02.jpg", "numbers pad to the count");
assert.equal(batchName("photo.jpg", "{name}.{ext}.bak", 0, 1), "photo.jpg.bak", "{ext} placed");
assert.equal(batchName("README", "{name}-old", 0, 1), "README-old", "no extension");
assert.equal(batchName(".bashrc", "{name}-copy", 0, 1), ".bashrc-copy", "dotfiles are names");
assert.deepEqual(batchNames(["a.jpg", "b.jpg"], "Trip {n}"), {
  names: ["Trip 1.jpg", "Trip 2.jpg"],
  error: null,
});
assert.match(batchNames(["a.jpg", "b.jpg"], "Trip").error ?? "", /\{n\}/, "collisions refused");
assert.match(batchNames(["a.jpg"], "a/b").error ?? "", /\//, "slashes refused");
assert.match(batchNames(["a.jpg"], "  ").error ?? "", /pattern/, "empty pattern refused");
console.log("[files/batch-rename] placeholders, numbering, extensions and refusals passed");

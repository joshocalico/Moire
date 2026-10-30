import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { withFixture } from "@moire/app-tools/testing";
import { scanUsage } from "./backend";
await withFixture(async (fixture) => {
  const directory = path.join(fixture, "tree");
  await fs.mkdir(directory);
  const folder = path.join(directory, "folder");
  await fs.mkdir(folder);
  const file = path.join(folder, "large.bin");
  await fs.writeFile(file, Buffer.alloc(128 * 1024));
  await fs.link(file, path.join(directory, "hard-link"));
  await fs.symlink(folder, path.join(folder, "recursive-link"));
  const result = await scanUsage(directory);
  assert.equal(
    result.root.logical,
    128 * 1024 + Buffer.byteLength(folder),
    "hardlinks counted once and symlink target not traversed",
  );
  assert.equal(result.entries, 5);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(scanUsage(directory, { signal: cancelled.signal }));
  const limited = await scanUsage(directory, { maxEntries: 2 });
  assert.equal(limited.truncated, true);
  assert.ok(limited.skipped.length > 0);
});
console.log(
  "Disk Usage actual allocated scan, hardlinks/symlinks, limits and cancel passed (UI in workflow.smoke.tsx)",
);

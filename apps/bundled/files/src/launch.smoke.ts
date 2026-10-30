/** Files' command line: what the desktop's Show in Files and Properties hand it. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { completeLocation, launchTarget } from "./filesystem";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-launch-"));
try {
  const folder = path.join(root, "Projects");
  const file = path.join(folder, "plan.txt");
  await fs.mkdir(path.join(folder, "Documents"), { recursive: true });
  await fs.mkdir(path.join(folder, "Downloads"));
  await fs.mkdir(path.join(folder, ".hidden"));
  await fs.writeFile(file, "plan");
  const fallback = path.join(root, "Desktop");
  assert.deepEqual(launchTarget([], fallback), {
    directory: fallback,
    select: null,
    properties: false,
  });
  assert.deepEqual(launchTarget([folder], fallback), {
    directory: folder,
    select: null,
    properties: false,
  });
  assert.deepEqual(launchTarget([pathToFileURL(file).href], fallback), {
    directory: folder,
    select: file,
    properties: false,
  });
  assert.deepEqual(
    launchTarget(["--select", folder], fallback),
    { directory: root, select: folder, properties: false },
    "--select reveals a folder in its parent",
  );
  assert.deepEqual(launchTarget(["--properties", file], fallback), {
    directory: folder,
    select: file,
    properties: true,
  });
  assert.deepEqual(
    launchTarget([path.join(root, "missing")], fallback),
    { directory: fallback, select: null, properties: false },
    "a missing path falls back to the Desktop",
  );
  // Tab completion: the common prefix, then the unique folder with a slash; hidden only on request.
  assert.equal(completeLocation(`${folder}/Do`, root, false), `${folder}/Do`);
  assert.equal(completeLocation(`${folder}/Doc`, root, false), `${folder}/Documents/`);
  assert.equal(completeLocation("Projects/Dow", root, false), "Projects/Downloads/");
  assert.equal(completeLocation(`${folder}/.h`, root, false), `${folder}/.hidden/`);
  assert.equal(completeLocation(`${folder}/pl`, root, false), null, "files are not completed");
  console.log("[files/launch] command-line targets and location completion passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

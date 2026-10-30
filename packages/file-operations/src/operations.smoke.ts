/** Extract, permission changes and batch rename, each with Undo. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { FileOperations, TransferCancelledError, type Progress } from "./index";

const run = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "moire-operations-"));
const exists = (file: string) =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );
const signal = () => new AbortController().signal;

try {
  const work = path.join(root, "work");
  await fs.mkdir(path.join(work, "source", "inner"), { recursive: true });
  await fs.writeFile(path.join(work, "source", "one.txt"), "one");
  await fs.writeFile(path.join(work, "source", "inner", "two.txt"), "two");
  const tags: string[] = [];
  const operations = new FileOperations(path.join(root, "trash"), {
    relocate: async (from, to) => {
      tags.push(`${path.basename(from)}→${path.basename(to)}`);
    },
  });

  // Extract a zip made with bsdtar into a new folder named after it.
  const zip = path.join(work, "photos.zip");
  await run("bsdtar", ["-cf", zip, "--format", "zip", "-C", path.join(work, "source"), "."]);
  const progress: Progress[] = [];
  const folder = await operations.extract(zip, signal(), (value) => progress.push(value));
  assert.equal(folder, path.join(work, "photos"));
  assert.equal(await fs.readFile(path.join(folder, "inner", "two.txt"), "utf8"), "two");
  const last = progress.at(-1)!;
  assert.ok(last.total >= 3, "the total comes from the listing");
  assert.equal(last.done, last.total);
  assert.ok(
    progress.some((value) => value.phase === "copying" && value.done > 0),
    "entries are reported while extracting",
  );
  assert.equal(operations.undoLabel, "Extract");

  // A second extract never replaces the first.
  const second = await operations.extract(zip, signal(), () => {});
  assert.equal(second, path.join(work, "photos (2)"));
  await operations.undo();
  assert.equal(await exists(second), false, "Undo moves the extracted folder to Trash");
  await operations.undo();
  assert.equal(await exists(folder), false);

  // The file-formats fixture, with a compound suffix-free name.
  const fixture = path.join(work, "bundle.zip");
  await fs.copyFile(
    fileURLToPath(new URL("../../file-formats/src/fixtures/bundle.zip", import.meta.url)),
    fixture,
  );
  const bundle = await operations.extract(fixture, signal(), () => {});
  assert.equal(path.basename(bundle), "bundle");
  assert.ok(await exists(path.join(bundle, "docs", "deep", "a.txt")));

  const tarball = path.join(work, "notes.tar.gz");
  await run("bsdtar", ["-czf", tarball, "-C", path.join(work, "source"), "one.txt"]);
  assert.equal(path.basename(await operations.extract(tarball, signal(), () => {})), "notes");

  // Entries that escape the folder are refused before anything is written.
  const before = (await fs.readdir(work)).sort();
  const slip = path.join(work, "slip.zip");
  await run("bsdtar", ["-cf", slip, "--format", "zip", "-s", ",^,../,", "one.txt"], {
    cwd: path.join(work, "source"),
  });
  await assert.rejects(
    operations.extract(slip, signal(), () => {}),
    /outside the folder/,
  );
  const absolute = path.join(work, "absolute.tar");
  await run("bsdtar", ["-cf", absolute, "-P", "-s", ",^,/tmp/,", "one.txt"], {
    cwd: path.join(work, "source"),
  });
  await assert.rejects(
    operations.extract(absolute, signal(), () => {}),
    /outside the folder/,
  );
  assert.deepEqual(
    (await fs.readdir(work))
      .filter((name) => name !== "slip.zip" && name !== "absolute.tar")
      .sort(),
    before,
    "a refused archive leaves no folder",
  );

  // Not an archive: a readable error and no folder.
  const junk = path.join(work, "broken.zip");
  await fs.writeFile(junk, "not an archive");
  await assert.rejects(
    operations.extract(junk, signal(), () => {}),
    /Could not read “broken.zip”/,
  );
  assert.equal(await exists(path.join(work, "broken")), false);

  // Cancelling while extracting removes the partial folder.
  const big = path.join(work, "big");
  await fs.mkdir(big);
  for (let index = 0; index < 400; index++)
    await fs.writeFile(path.join(big, `file-${index}.bin`), Buffer.alloc(4096, index));
  const bigArchive = path.join(work, "big.tar");
  await run("bsdtar", ["-cf", bigArchive, "-C", big, "."]);
  const controller = new AbortController();
  await assert.rejects(
    operations.extract(bigArchive, controller.signal, (value) => {
      if (value.phase === "copying") controller.abort();
    }),
    TransferCancelledError,
  );
  assert.equal(await exists(path.join(work, "big (2)")), false, "cancel leaves nothing");
  const early = new AbortController();
  early.abort();
  await assert.rejects(
    operations.extract(bigArchive, early.signal, () => {}),
    TransferCancelledError,
  );

  // Permissions change, and Undo restores the previous modes.
  const one = path.join(work, "source", "one.txt");
  const inner = path.join(work, "source", "inner");
  await fs.chmod(one, 0o644);
  await fs.chmod(inner, 0o755);
  await operations.setPermissions([
    { path: one, mode: 0o600 },
    { path: inner, mode: 0o700 },
  ]);
  assert.equal((await fs.stat(one)).mode & 0o7777, 0o600);
  assert.equal((await fs.stat(inner)).mode & 0o7777, 0o700);
  assert.equal(operations.undoLabel, "Change Permissions");
  await operations.undo();
  assert.equal((await fs.stat(one)).mode & 0o7777, 0o644);
  assert.equal((await fs.stat(inner)).mode & 0o7777, 0o755);
  await assert.rejects(
    operations.setPermissions([
      { path: one, mode: 0o600 },
      { path: path.join(work, "missing"), mode: 0o600 },
    ]),
  );
  assert.equal((await fs.stat(one)).mode & 0o7777, 0o644, "a failed change is rolled back");

  // Batch rename, including a swap, with one Undo.
  const names = path.join(work, "names");
  await fs.mkdir(names);
  for (const name of ["a.txt", "b.txt", "c.txt"]) await fs.writeFile(path.join(names, name), name);
  tags.length = 0;
  const renamed = await operations.renameMany([
    { from: path.join(names, "a.txt"), name: "b.txt" },
    { from: path.join(names, "b.txt"), name: "a.txt" },
    { from: path.join(names, "c.txt"), name: "C.txt" },
  ]);
  assert.deepEqual(
    renamed.map((file) => path.basename(file)),
    ["b.txt", "a.txt", "C.txt"],
  );
  assert.equal(await fs.readFile(path.join(names, "a.txt"), "utf8"), "b.txt");
  assert.equal(await fs.readFile(path.join(names, "b.txt"), "utf8"), "a.txt");
  assert.deepEqual((await fs.readdir(names)).sort(), ["C.txt", "a.txt", "b.txt"]);
  assert.ok(tags.length > 0, "metadata follows renamed items");
  assert.equal(operations.undoLabel, "Rename");
  await operations.undo();
  assert.equal(await fs.readFile(path.join(names, "a.txt"), "utf8"), "a.txt");
  assert.equal(await fs.readFile(path.join(names, "b.txt"), "utf8"), "b.txt");
  assert.deepEqual((await fs.readdir(names)).sort(), ["a.txt", "b.txt", "c.txt"]);

  // Collisions are refused before anything moves.
  await assert.rejects(
    operations.renameMany([
      { from: path.join(names, "a.txt"), name: "x.txt" },
      { from: path.join(names, "b.txt"), name: "x.txt" },
    ]),
    /both be named “x.txt”/,
  );
  await assert.rejects(
    operations.renameMany([{ from: path.join(names, "a.txt"), name: "c.txt" }]),
    /already exists/,
  );
  await assert.rejects(
    operations.renameMany([{ from: path.join(names, "a.txt"), name: "../escape" }]),
    /without slashes/,
  );
  assert.deepEqual((await fs.readdir(names)).sort(), ["a.txt", "b.txt", "c.txt"]);

  console.log("operations smoke passed");
} finally {
  await fs.chmod(root, 0o700).catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}

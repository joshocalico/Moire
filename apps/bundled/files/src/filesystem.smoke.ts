import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileOperations, readDirectory, sortEntries } from "./filesystem";
import { FileCatalog, parseTags } from "./catalog";
import { inspectFiles } from "./inspection";

// All writes, including Trash, are confined to a fresh disposable fixture.
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-workflow-"));
try {
  const source = path.join(fixture, "source");
  const destination = path.join(fixture, "destination");
  await fs.mkdir(source);
  await fs.mkdir(destination);
  const catalogPath = path.join(fixture, "config", "tags.json");
  const catalog = new FileCatalog(catalogPath);
  await catalog.load();
  const operations = new FileOperations(path.join(fixture, "Trash"), catalog);
  const signal = new AbortController().signal;
  const reports: string[] = [];
  const report = (value: { name: string }) => reports.push(value.name);
  await operations.create(source, "Documents", "folder");
  await operations.create(source, "notes #1?.txt", "file");
  const note = path.join(source, "notes #1?.txt");
  await fs.writeFile(note, "A file worth keeping\n");
  await catalog.update([note], parseTags("work, ideas, work"), "add");
  await fs.writeFile(path.join(source, ".hidden"), "hidden");
  assert.equal((await readDirectory(source, false)).length, 2);
  assert.equal((await readDirectory(source, true)).length, 3);
  assert.equal(
    sortEntries(await readDirectory(source, false), "size", true)[0]?.name,
    "Documents",
    "directories stay together when sort is reversed",
  );
  await assert.rejects(readDirectory(path.join(source, "missing"), false), { code: "ENOENT" });
  await assert.rejects(operations.create(source, "../escape", "file"), /without slashes/);
  await operations.transfer("copy", [note], destination, signal, report);
  assert.deepEqual(catalog.tags(path.join(destination, path.basename(note))), ["work", "ideas"]);
  const reopened = new FileCatalog(catalogPath);
  await reopened.load();
  assert.equal(
    (await reopened.entries("work")).length,
    2,
    "tag collections include real items in different folders after restart",
  );
  await operations.transfer("copy", [note], destination, signal, report, async () => "keep-both");
  assert.equal(
    await fs.readFile(path.join(destination, "notes #1? (2).txt"), "utf8"),
    "A file worth keeping\n",
  );
  let skipped = -1;
  await operations.transfer(
    "copy",
    [note],
    destination,
    signal,
    (value) => {
      skipped = value.skipped ?? 0;
    },
    async () => "skip",
  );
  assert.equal(skipped, 1);
  await assert.rejects(
    operations.transfer("copy", [note], destination, signal, report),
    /already exists/,
  );
  assert.equal(
    await fs.readFile(path.join(destination, path.basename(note)), "utf8"),
    "A file worth keeping\n",
    "a conflict must preserve the destination",
  );
  await operations.rename(note, "journal.txt");
  assert.deepEqual(catalog.tags(path.join(source, "journal.txt")), ["work", "ideas"]);
  assert.deepEqual(catalog.tags(note), []);
  await operations.undo();
  assert.equal(await fs.readFile(note, "utf8"), "A file worth keeping\n");
  await operations.transfer("copy", [path.join(source, "Documents")], destination, signal, report);
  await assert.rejects(
    operations.transfer("move", [source], path.join(source, "Documents"), signal, report),
    /inside itself/,
  );
  await operations.trash([note], signal, report);
  const trashed = (await readDirectory(operations.trashDirectory, true))[0]!;
  assert.ok(trashed.name.includes("notes #1?.txt"));
  await operations.restore(trashed.path);
  assert.deepEqual(catalog.tags(note), ["work", "ideas"]);
  assert.equal(
    await fs.readFile(note, "utf8"),
    "A file worth keeping\n",
    "Trash must restore special characters and content",
  );
  await operations.trash([note], signal, report);
  await fs.writeFile(note, "Replacement");
  await assert.rejects(operations.undo(), /already exists/);
  assert.equal(
    await fs.readFile(note, "utf8"),
    "Replacement",
    "undo cannot overwrite a newly-created file",
  );
  // A group Trash is one recoverable user action. Manual Restore must also
  // retire its member so Undo never retries an item that has already returned.
  const recoverySource = path.join(fixture, "recovery");
  await fs.mkdir(recoverySource);
  const first = path.join(recoverySource, "first.txt");
  const second = path.join(recoverySource, "second.txt");
  await fs.writeFile(first, "First recovery item");
  await fs.writeFile(second, "Second recovery item");
  const recovery = new FileOperations(path.join(fixture, "RecoveryTrash"), catalog);
  await catalog.update([first, second], ["recover"], "add");
  await recovery.trash([first, second], signal, report);
  await recovery.undo();
  assert.equal(await fs.readFile(first, "utf8"), "First recovery item");
  assert.equal(await fs.readFile(second, "utf8"), "Second recovery item");
  assert.equal(recovery.canUndo, false, "one Undo restores the whole Trash selection");
  assert.deepEqual(catalog.tags(first), ["recover"]);
  assert.deepEqual(catalog.tags(second), ["recover"]);
  assert.deepEqual(await fs.readdir(path.join(recovery.trashRoot, "info")), []);
  await recovery.trash([first, second], signal, report);
  const manual = (await readDirectory(recovery.trashDirectory, true)).find((entry) =>
    entry.name.endsWith("first.txt"),
  );
  assert.ok(manual);
  await recovery.restore(manual.path);
  await recovery.undo();
  assert.equal(await fs.readFile(second, "utf8"), "Second recovery item");
  assert.equal(recovery.canUndo, false, "manual Restore removes only its group member");

  await recovery.trash([first, second], signal, report);
  await fs.writeFile(first, "Replacement must survive");
  await assert.rejects(recovery.undo(), /already exists/);
  assert.equal(
    await fs.readFile(second, "utf8"),
    "Second recovery item",
    "group Undo retains completed restores before a conflict",
  );
  assert.equal(
    recovery.canUndo,
    true,
    "a failed group Undo remains available for the items still in Trash",
  );
  await fs.unlink(first);
  await recovery.undo();
  assert.equal(await fs.readFile(first, "utf8"), "First recovery item");
  assert.equal(recovery.canUndo, false, "retry restores only the remaining group members");

  await recovery.trash([first], signal, report);
  const restored = (await readDirectory(recovery.trashDirectory, true))[0];
  assert.ok(restored);
  await recovery.restore(path.relative(process.cwd(), restored.path));
  assert.equal(recovery.canUndo, false, "manual Restore cannot leave an obsolete Undo action");
  await recovery.rename(first, "renamed.txt");
  await recovery.trash([second], signal, report);
  const lastTrash = (await readDirectory(recovery.trashDirectory, true))[0];
  assert.ok(lastTrash);
  await recovery.restore(lastTrash.path);
  await recovery.undo();
  assert.equal(
    await fs.readFile(first, "utf8"),
    "First recovery item",
    "Restore preserves earlier unrelated Undo history",
  );
  const interruptedTrash = new AbortController();
  await assert.rejects(
    recovery.trash([first, second], interruptedTrash.signal, () => interruptedTrash.abort()),
    /Stopped after 1 of 2/,
  );
  await recovery.undo();
  assert.equal(
    await fs.readFile(first, "utf8"),
    "First recovery item",
    "Undo recovers the completed part of a cancelled Trash group",
  );
  assert.equal(await fs.readFile(second, "utf8"), "Second recovery item");
  assert.equal(recovery.canUndo, false);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    operations.transfer("copy", [note], destination, cancelled.signal, report),
    /Transfer cancelled/,
  );
  const large = path.join(source, "large.bin");
  await fs.writeFile(large, Buffer.alloc(12 * 1024 * 1024, 42));
  const interrupted = new AbortController();
  await assert.rejects(
    operations.transfer("copy", [large], destination, interrupted.signal, (value) => {
      if ((value.bytes ?? 0) > 0) interrupted.abort();
    }),
    /Transfer cancelled/,
  );
  assert.equal((await fs.stat(large)).size, 12 * 1024 * 1024);
  assert.equal(
    (await fs.readdir(destination)).some(
      (name) => name.startsWith(".moire-transfer-") || name === "large.bin",
    ),
    false,
    "mid-file cancellation removes only the unfinished staging copy",
  );
  const short = path.join(source, "completed.txt");
  await fs.writeFile(short, "Finished before cancellation");
  const partial = new AbortController();
  await assert.rejects(
    operations.transfer("copy", [short, large], destination, partial.signal, (value) => {
      if (value.done === 1) partial.abort();
    }),
    /Transfer cancelled/,
  );
  assert.equal(
    await fs.readFile(path.join(destination, "completed.txt"), "utf8"),
    "Finished before cancellation",
  );
  await operations.transfer("copy", [large], destination, signal, report);
  assert.equal(
    (await fs.stat(path.join(destination, "large.bin"))).size,
    12 * 1024 * 1024,
    "the interrupted operation can be retried",
  );
  const readonly = path.join(source, "readonly");
  await fs.mkdir(readonly);
  await fs.writeFile(path.join(readonly, "text.md"), "Readonly nested content");
  await fs.symlink("text.md", path.join(readonly, "link"));
  await fs.chmod(readonly, 0o555);
  await operations.transfer("copy", [readonly], destination, signal, report);
  assert.equal(await fs.readlink(path.join(destination, "readonly", "link")), "text.md");
  assert.equal((await fs.stat(path.join(destination, "readonly"))).mode & 0o777, 0o555);
  await fs.chmod(readonly, 0o700);
  await fs.chmod(path.join(destination, "readonly"), 0o700);
  const inspected = await inspectFiles(
    (await readDirectory(source, false)).filter((entry) => entry.name === "large.bin"),
    source,
  );
  assert.equal(inspected.text, undefined, "unknown extensions do not get an invented text preview");
  const textInspection = await inspectFiles(
    (await readDirectory(destination, false)).filter((entry) => entry.name === "completed.txt"),
    destination,
  );
  assert.equal(textInspection.text, "Finished before cancellation");
  assert.ok(textInspection.details.some(([key]) => key === "Permissions"));
  assert.ok(reports.length > 0, "operations must report visible progress");
  console.log(
    "[files/workflow] create, sort, collision choices, rename/undo, Trash/restore, persistent tags, mid-file cancellation, partial recovery, symlinks, metadata passed",
  );
} finally {
  const writable = async (folder: string) => {
    await fs.chmod(folder, 0o700);
    for (const name of await fs.readdir(folder)) {
      const file = path.join(folder, name);
      if ((await fs.lstat(file)).isDirectory()) await writable(file);
    }
  };
  await writable(fixture);
  await fs.rm(fixture, { recursive: true, force: true });
}

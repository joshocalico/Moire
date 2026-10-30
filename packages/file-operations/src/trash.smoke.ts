/** Freedesktop Trash: trash, list with origin and date, restore with conflicts, delete, empty. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileOperations } from "./operations";
import {
  emptyTrash,
  listTrash,
  restoreTrashItem,
  trashAt,
  trashCount,
  trashDisplayName,
  trashItem,
} from "./trash";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-trash-"));
try {
  const trash = trashAt(path.join(fixture, "Trash"));
  const home = path.join(fixture, "home");
  await fs.mkdir(path.join(home, "Projects"), { recursive: true });
  const note = path.join(home, "Projects", "note #1.txt");
  await fs.writeFile(note, "first");
  const before = Date.now();
  const first = await trashItem(note, trash);
  assert.equal(first.trashName, "note #1.txt", "the first entry keeps its own name");
  const info = await fs.readFile(path.join(trash.info, "note #1.txt.trashinfo"), "utf8");
  assert.match(
    info,
    /^\[Trash Info\]\nPath=.*\/Projects\/note%20%231\.txt\nDeletionDate=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\n$/,
  );
  // A second item with the same name gets a distinct Trash name, not a replacement.
  await fs.writeFile(note, "second");
  const second = await trashItem(note, trash);
  assert.equal(second.trashName, "note #1.2.txt");
  const listed = await listTrash(trash);
  assert.equal(listed.length, 2);
  for (const item of listed) {
    assert.equal(item.originalPath, note, "listing reports the original location");
    assert.equal(trashDisplayName(item), "note #1.txt");
    assert.ok(item.deletedAt! >= before - 1000 && item.deletedAt! <= Date.now() + 1000);
  }
  assert.equal(await trashCount(trash), 2);

  // Restore recreates a missing folder and never replaces a newer item.
  await fs.rm(path.join(home, "Projects"), { recursive: true });
  const restored = await restoreTrashItem(
    listed.find((item) => item.trashName === "note #1.txt")!,
    trash,
  );
  assert.equal(restored.restoredTo, note);
  assert.equal(await fs.readFile(note, "utf8"), "first");
  const conflict = await restoreTrashItem((await listTrash(trash))[0]!, trash);
  assert.equal(conflict.restoredTo, path.join(home, "Projects", "note #1 (2).txt"));
  assert.equal(await fs.readFile(note, "utf8"), "first", "restore kept the item already there");
  assert.equal(await trashCount(trash), 0);
  assert.deepEqual(await fs.readdir(trash.info), [], "restored items leave no metadata behind");

  // Items without metadata are listed (deletable) but cannot be restored.
  await fs.writeFile(path.join(trash.files, "orphan"), "x");
  const [orphan] = await listTrash(trash);
  assert.equal(orphan?.originalPath, null);
  await assert.rejects(restoreTrashItem(orphan!, trash), /no record of where it came from/);

  // Operations: trash a group, undo restores all; delete permanently; empty.
  const operations = new FileOperations(trash.root);
  const signal = new AbortController().signal;
  const folder = path.join(home, "Folder");
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "inside.txt"), "x");
  await operations.trash([folder, note], signal, () => {});
  assert.equal(operations.undoLabel, "Move to Trash");
  await operations.undo();
  assert.ok((await fs.stat(folder)).isDirectory());
  assert.equal(await fs.readFile(note, "utf8"), "first");
  await operations.trash([note], signal, () => {});
  const trashedNote = (await listTrash(trash)).find((item) => item.originalPath === note)!;
  await operations.deletePermanently([trashedNote.path], signal, () => {});
  assert.equal(
    (await listTrash(trash)).some((item) => item.originalPath === note),
    false,
  );
  await assert.rejects(
    fs.access(path.join(trash.info, `${trashedNote.trashName}.trashinfo`)),
    "deleting from Trash removes its metadata",
  );
  await operations.trash([folder], signal, () => {});
  assert.equal(await emptyTrash(trash), 2, "Empty Trash reports how many items it removed");
  assert.equal(await trashCount(trash), 0);
  await assert.rejects(
    operations.trash([trash.files], signal, () => {}),
    /already in Trash/,
  );
  console.log("[file-operations/trash] trash, listing, restore conflicts, delete and empty passed");
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}

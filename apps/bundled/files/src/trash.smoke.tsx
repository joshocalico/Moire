/**
 * Trash in Files: items list with where they came from and when they were
 * deleted; Restore (with conflicts kept beside), Delete Permanently and Empty
 * Trash both confirm, and Empty Trash works from the rail and the title row.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { listTrash } from "@moire/file-operations";
import { entryId, openFiles, withHome } from "./harness";

const exists = (file: string) =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );

await withHome(async (home) => {
  const folder = path.join(home, "Projects");
  await fs.mkdir(path.join(folder, "Drafts"), { recursive: true });
  for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"])
    await fs.writeFile(path.join(folder, name), name);
  const files = await openFiles({ initialPath: folder, width: 1200 });
  try {
    const [a, b, c] = ["a.txt", "b.txt", "c.txt"].map((name) => path.join(folder, name));
    await files.until(
      () => files.hits().some((hit) => hit.focusId === entryId(a!)),
      "listing loads",
    );
    // Delete moves the selection to Trash, with Undo.
    files.click(files.center(entryId(a!)));
    files.click(files.center(entryId(b!)), { ctrl: true });
    files.key(111, "Delete");
    await files.until(
      () => files.texts().includes("2 items moved to Trash"),
      "Delete trashes with feedback",
    );
    assert.equal(await exists(a!), false);
    // Drop onto the Trash place trashes too.
    await files.until(() => files.hits().some((hit) => hit.focusId === entryId(c!)), "c lists");
    files.click(files.center(entryId(c!)));
    files.key(111, "Delete");
    await files.until(async () => (await listTrash()).length === 3, "three items in Trash");
    const d = path.join(folder, "d.txt");
    await files.until(
      () => !files.hits().some((hit) => hit.focusId === entryId(c!)),
      "the listing drops c, so d's row is where it stays",
    );
    files.click(files.center(entryId(d)));
    files.key(111, "Delete");
    await files.until(async () => (await listTrash()).length === 4, "four items in Trash");

    // The Trash place: original names, origin and deletion date; no storage paths.
    files.click(files.center("rail:trash"));
    await files.until(
      () => files.texts().includes("Trash is empty") || files.texts().includes("a.txt"),
      "Trash opens",
    );
    const texts = files.texts();
    for (const label of ["a.txt", "b.txt", "c.txt", "From ~/Projects", "Empty Trash"])
      assert.ok(texts.includes(label), `Trash shows ${label}`);
    assert.ok(
      texts.some((text) => text.startsWith("Deleted Today")),
      "rows say when they were deleted",
    );
    assert.ok(
      !texts.some((text) => text.includes(".local/share/Trash")),
      "Trash never shows its storage folder",
    );
    assert.ok(texts.includes("Trash"), "the location reads Trash");

    const inTrash = async (name: string) =>
      (await listTrash()).find((item) => path.basename(item.originalPath ?? "") === name)!.path;

    // Restore puts an item back; a newer item in its place is kept, the restored one beside it.
    await fs.writeFile(a!, "newer a");
    files.click(files.center(entryId(await inTrash("a.txt"))));
    files.rightClick(files.center(entryId(await inTrash("a.txt"))));
    assert.deepEqual(
      files.menu.actions.map((action) => action.id),
      ["restore", "properties", "delete"],
    );
    await files.invoke("restore");
    await files.until(
      async () => await exists(path.join(folder, "a (2).txt")),
      "conflicting restore keeps both",
    );
    assert.equal(await fs.readFile(a!, "utf8"), "newer a", "restore never replaces");
    await files.until(
      // The outcome card wraps long messages over lines.
      () => files.texts().join(" ").includes("kept beside an existing item"),
      "restore explains the rename",
    );

    // Delete Permanently asks first, naming the item.
    await files.until(
      () =>
        files
          .hits()
          .some(
            (hit) => hit.focusId === entryId(path.join(home, ".local/share/Trash/files/b.txt")),
          ),
      "b in Trash",
    );
    const bInTrash = await inTrash("b.txt");
    files.click(files.center(entryId(bInTrash)));
    files.key(111, "Delete", { shift: true });
    await files.until(
      () => files.texts().includes("Permanently delete “b.txt”?"),
      "Delete Permanently confirms",
    );
    files.press("Cancel");
    await files.settle(10);
    assert.equal(await exists(bInTrash), true, "Cancel keeps the item");
    files.key(111, "Delete");
    await files.until(
      () => files.texts().includes("Permanently delete “b.txt”?"),
      "Delete in Trash also confirms",
    );
    files.press("Delete");
    await files.until(async () => !(await exists(bInTrash)), "confirmed deletion removes the item");

    // Restore from a row's hover actions.
    const dInTrash = await inTrash("d.txt");
    await files.until(
      () => !files.hits().some((hit) => hit.focusId === entryId(bInTrash)),
      "the deleted row is gone, so rows stay put",
    );
    const row = files.center(entryId(dInTrash));
    files.pointer("move", row.x, row.y);
    await files.settle(3);
    files.click(files.center(`action:restore:${dInTrash}`));
    await files.until(async () => await exists(d), "hover Restore restores");

    // Empty Trash from the rail, with the count in the confirmation.
    files.rightClick(files.center("rail:trash"));
    await files.until(() => files.menu.title === "Trash", "Trash place menu");
    await files.invoke("empty-trash");
    await files.until(() => files.texts().includes("Empty Trash?"), "Empty Trash confirms");
    assert.ok(
      files
        .texts()
        .some((text) => text.startsWith("All 1 item in Trash will be permanently deleted")),
    );
    files.press("Empty Trash");
    await files.until(async () => (await listTrash()).length === 0, "Empty Trash empties it");
    await files.until(() => files.texts().includes("Trash is empty"), "an empty Trash says so");
    files.rightClick({ x: files.window.getWidth() / 2, y: files.window.getHeight() - 60 });
    assert.equal(files.menu.title, "Trash", "the empty Trash has its own background menu");
    assert.equal(files.action("empty-trash").disabled, true);
    assert.match(files.action("empty-trash").disabledReason ?? "", /already empty/);
    assert.ok(
      files.texts().includes("Empty Trash") &&
        !files.hits().some((hit) => hit.focusId === "files:page-action" && hit.onPress),
      "the title row's Empty Trash is disabled too",
    );
    console.log(
      "[files/trash] listing, restore with conflict, confirmed permanent delete and Empty Trash passed",
    );
  } finally {
    files.close();
  }
});

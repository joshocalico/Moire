/**
 * Drag and drop in Files highlights only real destinations: the folder under
 * the pointer, breadcrumbs, sidebar places, Trash and tabs. The listing as a
 * whole never lights up, a folder never accepts itself, and dropping items
 * where they already are does nothing at all.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listTrash } from "@moire/file-operations";
import { notifyDrop, notifyDropHover } from "@moire/ui/testing";
import { entryId, openFiles, withHome } from "./harness";

const exists = (file: string) =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );
const uris = (...files: string[]) =>
  files.map((file) => pathToFileURL(file).href).join("\r\n") + "\r\n";

await withHome(async (home) => {
  const folder = path.join(home, "Projects");
  for (const name of ["Design", "Notes"])
    await fs.mkdir(path.join(folder, name), { recursive: true });
  for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"])
    await fs.writeFile(path.join(folder, name), name);
  const files = await openFiles({ initialPath: folder });
  try {
    const design = path.join(folder, "Design");
    const notes = path.join(folder, "Notes");
    const a = path.join(folder, "a.txt");
    await files.until(
      () => files.hits().some((hit) => hit.focusId === entryId(a)),
      "listing loads",
    );
    const dataAt = (focusId: string) => {
      const at = files.center(focusId);
      return files.window.hitTestData(at.x, at.y);
    };
    assert.equal(dataAt(entryId(design)), design, "a folder row is a destination");
    assert.equal(dataAt(entryId(a)), null, "a file row is not a destination");
    assert.equal(
      dataAt("rail:documents"),
      path.join(home, "Documents"),
      "a rail place is a destination",
    );
    assert.equal(
      dataAt("rail:trash"),
      path.join(home, ".local/share/Trash/files"),
      "Trash is a destination",
    );
    assert.ok(
      !files.hits().some((hit) => hit.focusId?.startsWith("tabs:")),
      "one tab shows no tab strip (tab drops are checked with two below)",
    );
    const background = { x: files.window.getWidth() / 2, y: files.window.getHeight() - 60 };
    assert.equal(
      files.window.hitTestData(background.x, background.y),
      null,
      "empty space is not a destination",
    );

    // A compatible drag over the window does not outline the whole listing.
    await files.settle(5);
    const before = Buffer.from(files.native.lastFrame!);
    notifyDropHover(true);
    files.window.updateDropHover(background.x, background.y);
    await files.settle(5);
    assert.equal(
      Buffer.compare(before, Buffer.from(files.native.lastFrame!)),
      0,
      "no whole-area highlight",
    );
    // Over a folder, only that folder's row changes.
    files.window.updateDropHover(
      ...(Object.values(files.center(entryId(notes))) as [number, number]),
    );
    await files.settle(5);
    const after = files.native.lastFrame!;
    const row = files.hit(entryId(notes));
    const width = files.window.getWidth();
    let changed = 0;
    for (let at = 0; at < after.length; at += 4)
      if (
        after[at] !== before[at] ||
        after[at + 1] !== before[at + 1] ||
        after[at + 2] !== before[at + 2]
      ) {
        const x = (at / 4) % width;
        const y = Math.floor(at / 4 / width);
        assert.ok(
          x >= row.x - 2 &&
            x <= row.x + row.width + 2 &&
            y >= row.y - 2 &&
            y <= row.y + row.height + 2,
          `drop feedback stays on the hovered folder (changed ${x},${y})`,
        );
        changed++;
      }
    assert.ok(changed > 0, "the hovered folder is highlighted");
    files.window.clearDropHover();
    notifyDropHover(false);

    // Dragging a folder: it never offers itself as a destination; others still do.
    const start = files.center(entryId(design));
    files.click(start);
    files.pointer("down", start.x, start.y);
    files.pointer("move", start.x + 30, start.y + 30);
    assert.equal(dataAt(entryId(design)), null, "a dragged folder is not its own destination");
    assert.equal(dataAt(entryId(notes)), notes, "other folders remain destinations");
    files.pointer("up", start.x + 30, start.y + 30);
    await files.settle(5);
    assert.equal(dataAt(entryId(design)), design, "after the drag the folder accepts drops again");

    // Dropping items where they already are does nothing, and says nothing.
    notifyDrop(uris(a), ["text/uri-list"], background.x, background.y);
    await files.settle(10);
    assert.equal(files.busy, false, "a no-op drop starts no operation");
    assert.ok(await exists(a));
    assert.ok(
      !files.texts().some((text) => text.includes("already in this folder")),
      "and shows no error",
    );

    // Real destinations act: a folder row moves, Trash trashes, a tab moves.
    const notesAt = files.center(entryId(notes));
    notifyDrop(uris(a), ["text/uri-list"], notesAt.x, notesAt.y);
    await files.until(
      async () => await exists(path.join(notes, "a.txt")),
      "dropping on a folder moves into it",
    );
    await files.until(() => files.texts().includes("Done"), "the outcome strip appears");
    files.press("Done");
    const trashAt = files.center("rail:trash");
    notifyDrop(uris(path.join(folder, "b.txt")), ["text/uri-list"], trashAt.x, trashAt.y);
    await files.until(async () => (await listTrash()).length === 1, "dropping on Trash trashes");
    files.key(20, "t", { ctrl: true });
    await files.settle(10);
    files.click(files.center(entryId(notes)));
    files.key(28, "Enter");
    await files.until(() => files.texts().includes("a.txt"), "second tab shows Notes");
    const projectsTab = files
      .hits()
      .find((hit) => hit.focusId?.startsWith("tabs:") && hit.onContextMenu)!;
    assert.equal(
      files.window.hitTestData(
        projectsTab.x + projectsTab.width / 2,
        projectsTab.y + projectsTab.height / 2,
      ),
      folder,
      "a tab is a destination",
    );
    notifyDrop(
      uris(path.join(notes, "a.txt")),
      ["text/uri-list"],
      projectsTab.x + 10,
      projectsTab.y + 10,
    );
    await files.until(async () => await exists(a), "dropping on a tab moves into its folder");
    console.log(
      "[files/drop-targets] targeted folder/place/Trash/tab highlighting, no area or self highlight, no-op drops passed",
    );
  } finally {
    files.close();
  }
});

/**
 * The folder page: kind chips filter it; past a dozen folders the cards fold behind "Show all";
 * a hovered row shows its actions; the title collapses into a sticky line when scrolled (and
 * starts collapsed in short windows); two selected items bring the selection bar, with room
 * kept under the last row; the sort button's menu orders the page.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { readFileClipboard } from "@moire/file-operations";
import { entryId, openFiles, withHome } from "./harness";
import { SHOW_ALL_FOLDERS_ID } from "./views/collection";

await withHome(async (home) => {
  const folder = path.join(home, "Projects");
  for (let index = 1; index <= 13; index++)
    await fs.mkdir(path.join(folder, `Folder ${String(index).padStart(2, "0")}`), {
      recursive: true,
    });
  const names = [
    ...Array.from({ length: 14 }, (_, index) => `note-${String(index).padStart(2, "0")}.txt`),
    "song.mp3",
    "photo.png",
  ];
  for (const [index, name] of names.entries()) {
    const file = path.join(folder, name);
    await fs.writeFile(file, "x".repeat(index + 1));
    const when = new Date(Date.now() - index * 60_000);
    await fs.utimes(file, when, when);
  }
  const files = await openFiles({ initialPath: folder, width: 1100, height: 760 });
  try {
    await files.until(() => files.texts().includes("Projects"), "the page loads");

    // Chips: All, then one per kind present, with counts.
    for (const label of ["All", "Folders", "Documents", "Audio", "Images"])
      assert.ok(files.texts().includes(label), `a ${label} chip`);
    files.press("Audio");
    await files.until(
      () => files.texts().includes("song.mp3") && !files.texts().includes("note-00.txt"),
      "the Audio chip shows only audio",
    );
    files.press("All");
    await files.until(() => files.texts().includes("note-00.txt"), "All shows everything again");

    // Thirteen folders: eight cards and "Show all 13 folders".
    assert.ok(files.texts().includes("Show all 13 folders"), "folders fold behind Show all");
    assert.ok(!files.hits().some((hit) => hit.focusId === entryId(path.join(folder, "Folder 13"))));
    files.click(files.center(SHOW_ALL_FOLDERS_ID));
    await files.until(
      () => files.hits().some((hit) => hit.focusId === entryId(path.join(folder, "Folder 13"))),
      "Show all shows every folder",
    );

    // Hover: the row's date gives way to its actions; Copy puts it on the clipboard.
    const note = path.join(folder, "note-00.txt");
    const row = files.center(entryId(note));
    assert.ok(!files.hits().some((hit) => hit.focusId === `action:copy:${note}`), "actions rest");
    files.pointer("move", row.x, row.y);
    await files.settle(3);
    files.click(files.center(`action:copy:${note}`));
    assert.deepEqual(readFileClipboard()?.paths, [note], "the row's Copy copies it");

    // Sort: the ghost button's menu orders by size.
    files.click(files.center("files:sort"));
    assert.equal(files.menu.title, "Sort By");
    await files.invoke("sort-size");
    files.click(files.center("files:sort"));
    assert.equal(files.action("sort-size").checked, true, "Size is now the order");
    await files.invoke("sort-reverse");
    await files.until(() => files.texts().includes("Size ↓"), "the button names the order");

    // Scrolling collapses the title into a sticky line.
    const titleY = () => files.hits().find((hit) => hit.focusId === "files:sort")!.y;
    const fullY = titleY();
    files.native.injectPointer({
      type: "wheel",
      x: 600,
      y: 500,
      deltaY: 600,
      timeMs: Date.now(),
    });
    await files.settle(5);
    assert.ok(files.texts().includes("in Home"), "the collapsed header reads “in Home”");
    assert.ok(titleY() < fullY, "the sort button moved up into the collapsed line");

    // Two selected: the selection bar, with room kept below the last row.
    const fileRows = () =>
      files
        .hits()
        .filter((hit) => hit.focusId?.startsWith("file:") && !hit.focusId.includes("Folder "));
    // A row in the middle of the page, clear of the sticky header.
    const first = fileRows().find((hit) => hit.y > files.window.getHeight() / 3)!;
    files.click({ x: first.x + first.width / 2, y: first.y + first.height / 2 });
    files.key(107, "End", { shift: true });
    await files.until(() => files.texts().includes("Move to…"), "the selection bar shows");
    await files.settle(5);
    const lastRow = fileRows().reduce((bottom, hit) => (hit.y > bottom.y ? hit : bottom));
    assert.ok(
      lastRow.focusId?.endsWith(".txt") ||
        lastRow.focusId?.endsWith(".mp3") ||
        lastRow.focusId?.endsWith(".png"),
    );
    const barTop = Math.min(
      ...files
        .hits()
        .filter((hit) => hit.y > files.window.getHeight() - 100 && hit.onPress && hit.height < 60)
        .map((hit) => hit.y),
    );
    assert.ok(Number.isFinite(barTop), "the bar's buttons are hit targets");
    assert.ok(
      lastRow.y + lastRow.height <= barTop,
      `the last row (${lastRow.y + lastRow.height}) ends above the bar (${barTop})`,
    );
  } finally {
    files.close();
  }

  // A short window opens with the header already collapsed.
  const short = await openFiles({ initialPath: folder, width: 900, height: 600 });
  try {
    await short.until(() => short.texts().includes("in Home"), "short windows start collapsed");
    assert.ok(!short.hits().some((hit) => hit.focusId?.startsWith("path:")), "no path line yet");
    short.key(38, "l", { ctrl: true });
    await short.until(
      () => short.hits().some((hit) => hit.focusId === "files:path"),
      "Ctrl+L opens the path field in the collapsed header",
    );
    short.key(1, "Escape");
  } finally {
    short.close();
  }
  console.log(
    "[files/folder-page] kind chips, Show all folders, hover actions, sort menu, collapsing header, selection bar room and short-window header passed",
  );
});

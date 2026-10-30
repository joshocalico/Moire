/**
 * Every Files context menu: what it offers (grouped, with shortcut hints and
 * reasons for what is unavailable) and that each entry actually works.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { readClipboardText } from "@moire/ui";
import { readFileClipboard } from "@moire/file-operations";
import { entryId, openFiles, withHome } from "./harness";

const groups = (actions: { id: string; separatorBefore?: boolean }[]) =>
  actions.reduce<string[][]>((all, action) => {
    if (action.separatorBefore || !all.length) all.push([]);
    all.at(-1)!.push(action.id);
    return all;
  }, []);

await withHome(async (home) => {
  const folder = path.join(home, "Projects");
  await fs.mkdir(path.join(folder, "Design"), { recursive: true });
  await fs.writeFile(path.join(folder, "notes.txt"), "Notes");
  await fs.writeFile(path.join(folder, "plan.txt"), "Plan");
  // The rail shows its labels, so renamed places can be read back.
  const files = await openFiles({ initialPath: folder, preferences: { railExpanded: true } });
  try {
    const notes = path.join(folder, "notes.txt");
    await files.until(
      () => files.hits().some((hit) => hit.focusId === entryId(notes)),
      "listing loads",
    );

    // A file: open, edit, organise, inspect, remove — each group separated.
    files.click(files.center(entryId(notes)));
    files.rightClick(files.center(entryId(notes)));
    assert.equal(files.menu.title, "notes.txt");
    assert.deepEqual(groups(files.menu.actions), [
      ["open", "open-with"],
      ["cut", "copy", "copy-to", "move-to"],
      ["duplicate", "rename", "compress"],
      ["copy-path", "properties"],
      ["trash", "delete"],
    ]);
    for (const [id, shortcut] of [
      ["open", "Enter"],
      ["cut", "Ctrl+X"],
      ["copy", "Ctrl+C"],
      ["rename", "F2"],
      ["properties", "Ctrl+I"],
      ["trash", "Delete"],
      ["delete", "Shift+Delete"],
    ])
      assert.equal(files.action(id).shortcut, shortcut, `${id} shows its shortcut`);
    assert.ok(
      files.action("open-with").submenu?.some((entry) => entry.id === "choose-application"),
      "Open With offers the full chooser",
    );

    await files.invoke("duplicate");
    await files.until(
      async () => !!(await fs.stat(path.join(folder, "notes (copy).txt")).catch(() => null)),
      "Duplicate makes a copy beside the original",
    );
    await files.until(
      () => files.texts().includes("Duplicated as “notes (copy).txt”"),
      "Duplicate reports what it made",
    );

    files.rightClick(files.center(entryId(notes)));
    await files.invoke("compress");
    await files.until(
      async () => !!(await fs.stat(path.join(folder, "notes.txt.tar.gz")).catch(() => null)),
      "Compress writes an archive",
    );

    files.rightClick(files.center(entryId(notes)));
    await files.invoke("copy-path");
    assert.equal(await readClipboardText(), notes, "Copy Path puts the path on the clipboard");

    files.rightClick(files.center(entryId(notes)));
    await files.invoke("copy");
    assert.deepEqual(readFileClipboard()?.paths, [notes], "Copy fills the shared file clipboard");
    assert.equal(readFileClipboard()?.kind, "copy");

    files.rightClick(files.center(entryId(notes)));
    await files.invoke("rename");
    files.key(30, "a", { ctrl: true });
    files.type("journal.txt");
    files.key(28, "Enter");
    const journal = path.join(folder, "journal.txt");
    await files.until(async () => !!(await fs.stat(journal).catch(() => null)), "Rename… renames");

    await files.until(
      () => files.hits().some((hit) => hit.focusId === entryId(journal)),
      "renamed row lists",
    );
    files.rightClick(files.center(entryId(journal)));
    await files.invoke("trash");
    await files.until(
      () => files.texts().includes("“journal.txt” moved to Trash"),
      "Trash reports",
    );
    files.press("Undo");
    await files.until(
      async () => !!(await fs.stat(journal).catch(() => null)),
      "Undo restores from Trash",
    );

    // Many items: per-item actions stay visible but say why they are unavailable.
    await files.until(
      () => files.hits().some((hit) => hit.focusId === entryId(journal)),
      "restored row lists",
    );
    files.key(30, "a", { ctrl: true });
    files.rightClick(files.center(entryId(journal)));
    assert.match(files.menu.title, /^\d+ Items$/);
    assert.equal(files.action("rename").disabled, true);
    assert.match(files.action("rename").disabledReason ?? "", /single item/);
    assert.equal(files.action("open-with").disabled, true);
    assert.match(files.action("open").label, /^Open \d+ items$/);

    // A folder: open in a tab or window, paste into it.
    files.click(files.center(entryId(journal)));
    files.key(46, "c", { ctrl: true });
    const design = path.join(folder, "Design");
    files.click(files.center(entryId(design)));
    files.rightClick(files.center(entryId(design)));
    assert.deepEqual(groups(files.menu.actions)[0], ["open", "open-new-tab", "open-new-window"]);
    await files.invoke("paste-into");
    await files.until(
      async () => !!(await fs.stat(path.join(design, "journal.txt")).catch(() => null)),
      "Paste Into Folder copies the clipboard into that folder",
    );
    await files.until(() => files.texts().includes("Done"), "the outcome strip appears");
    files.press("Done");
    await files.settle();

    // The folder background: create, paste, select, arrange, undo, inspect.
    files.rightClick({ x: files.window.getWidth() / 2, y: files.window.getHeight() - 60 });
    assert.equal(files.menu.title, "Projects");
    assert.deepEqual(groups(files.menu.actions), [
      ["new-folder", "new-file", "paste", "select-all"],
      ["sort", "view"],
      ["undo", "refresh"],
      ["properties"],
      ["pin-folder"],
    ]);
    assert.equal(files.action("sort-name").checked, true);
    assert.equal(files.action("view-list").checked, true);
    await files.invoke("sort-size");
    files.rightClick({ x: files.window.getWidth() / 2, y: files.window.getHeight() - 60 });
    assert.equal(files.action("sort-size").checked, true, "Sort By applies and shows its choice");
    await files.invoke("view-grid");
    files.rightClick({ x: files.window.getWidth() / 2, y: files.window.getHeight() - 60 });
    assert.equal(files.action("view-grid").checked, true, "View switches to the grid");
    await files.invoke("new-folder");
    files.key(28, "Enter");
    await files.until(() => files.texts().includes("“New Folder” created"), "New Folder… reports");
    assert.ok(
      (await fs.stat(path.join(folder, "New Folder"))).isDirectory(),
      "New Folder… creates a folder",
    );
    files.rightClick({ x: files.window.getWidth() / 2, y: files.window.getHeight() - 60 });
    assert.equal(files.action("undo").label, "Undo New Folder", "Undo names what it will undo");
    await files.invoke("undo");
    await files.until(
      async () => !(await fs.stat(path.join(folder, "New Folder")).catch(() => null)),
      "Undo removes the new folder",
    );
    files.rightClick({ x: files.window.getWidth() / 2, y: files.window.getHeight() - 60 });
    await files.invoke("pin-folder");
    files.rightClick({ x: files.window.getWidth() / 2, y: files.window.getHeight() - 60 });
    assert.equal(
      files.action("pin-folder").disabled,
      true,
      "a pinned folder cannot be pinned twice",
    );
    assert.match(files.action("pin-folder").disabledReason ?? "", /already in the sidebar/);

    // Rail places: built-ins explain why they cannot be renamed; custom ones can be.
    files.rightClick(files.center("rail:documents"));
    assert.equal(files.menu.title, "Documents");
    assert.equal(files.action("rename-place").disabled, true);
    assert.match(files.action("rename-place").disabledReason ?? "", /Built-in/);
    await files.invoke("open-new-tab");
    await files.until(() => files.texts().includes("Documents"), "a new tab opens on the place");
    files.rightClick(files.center(`rail:favorite:${folder}`));
    await files.invoke("rename-place");
    files.key(30, "a", { ctrl: true });
    files.type("Work");
    files.key(28, "Enter");
    await files.until(() => files.texts().includes("Work"), "Rename… renames a custom place");
    files.rightClick(files.center(`rail:favorite:${folder}`));
    await files.invoke("remove-place");
    await files.until(() => !files.texts().includes("Work"), "Remove from Sidebar removes it");

    // The Trash place offers Empty Trash (Undo of New Folder moved the folder there).
    files.rightClick(files.center("rail:trash"));
    await files.until(() => files.menu.title === "Trash", "Trash place menu opens");
    assert.deepEqual(groups(files.menu.actions), [["open", "open-new-tab"], ["empty-trash"]]);
    assert.equal(files.action("empty-trash").disabled, false);

    // Tabs: their own menu, including moving and closing others.
    const tab = files.hits().find((hit) => hit.focusId?.startsWith("tabs:") && hit.onContextMenu);
    assert.ok(tab, "tabs accept secondary clicks");
    files.rightClick({ x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 });
    for (const id of [
      "new-tab",
      "duplicate-tab",
      "move-tab-left",
      "move-tab-right",
      "close-other-tabs",
      "close-tab",
    ])
      files.action(id);
    assert.equal(files.action("move-tab-left").disabled, true);
    await files.invoke("close-other-tabs");
    // With one tab left there is no strip to right-click: it shows only with two or more.
    assert.ok(
      !files.hits().some((hit) => hit.focusId?.startsWith("tabs:")),
      "a single tab hides the tab strip",
    );

    // The top bar's ⋯: window-wide commands, including the shortcut list.
    files.click(files.center("files:window-menu"));
    assert.equal(files.menu.title, "Files");
    assert.deepEqual(groups(files.menu.actions), [
      ["new-tab", "new-window"],
      ["hidden"],
      ["keyboard-shortcuts"],
    ]);
    await files.invoke("keyboard-shortcuts");
    await files.until(
      () => files.texts().includes("Keyboard Shortcuts"),
      "the shortcut list opens",
    );
    assert.ok(files.texts().includes("Ctrl+B"), "it lists the rail's shortcut");
    files.press("Close");
    await files.until(() => !files.texts().includes("Keyboard Shortcuts"), "and closes");

    // The Menu key opens the menu at the focused item, not in a corner.
    const plan = path.join(folder, "plan.txt");
    files.click(files.center(entryId(plan)));
    files.key(139, "ContextMenu");
    const planHit = files.hit(entryId(plan));
    assert.equal(files.menu.title, "plan.txt");
    assert.ok(
      files.menu.x >= planHit.x &&
        files.menu.x <= planHit.x + planHit.width &&
        files.menu.y >= planHit.y &&
        files.menu.y <= planHit.y + planHit.height,
      `keyboard menu opens on the focused item (${files.menu.x},${files.menu.y})`,
    );
    console.log(
      "[files/context-menus] item, many-item, folder, background, rail place, Trash place, tab, window and keyboard menus passed",
    );
  } finally {
    files.close();
  }
});

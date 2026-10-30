/**
 * Selecting and finding in Files: rubber-band selection (Ctrl adds), type to
 * select through search, Tab completion in the path field, opening on a given
 * item with its properties, and Properties sections that stay as the user left them.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { entryId, openFiles, withHome } from "./harness";

await withHome(async (home) => {
  const folder = path.join(home, "Projects");
  await fs.mkdir(path.join(folder, "Design"), { recursive: true });
  await fs.mkdir(path.join(folder, "Documents"), { recursive: true });
  for (const name of ["alpha.txt", "beta.txt", "bravo.txt", "charlie.txt", "delta.txt"])
    await fs.writeFile(path.join(folder, name), name);

  // Launched with `--properties <file>`: the file is selected and its properties shown.
  const files = await openFiles({
    initialPath: folder,
    view: "grid",
    reveal: { path: path.join(folder, "charlie.txt"), properties: true },
  });
  try {
    await files.until(() => files.texts().includes("Properties"), "properties are shown");
    files.key(139, "ContextMenu");
    assert.equal(files.menu.title, "charlie.txt", "the launch argument selects that item");

    // Rubber band: drag across the first row's cells from empty space below them.
    const ids = ["alpha.txt", "beta.txt"].map((name) => entryId(path.join(folder, name)));
    const first = files.hit(entryId(path.join(folder, "Design")));
    const second = files.hit(ids[0]!);
    const start = { x: first.x + 4, y: files.window.getHeight() - 60 };
    files.pointer("down", start.x, start.y);
    files.pointer("move", start.x + 20, start.y - 20);
    files.pointer("move", second.x + second.width / 2, first.y + 10);
    await files.settle(2);
    files.pointer("up", second.x + second.width / 2, first.y + 10);
    files.key(139, "ContextMenu");
    assert.match(files.menu.title, /^\d+ Items$/, "a rubber band selects every item it crosses");
    const banded = Number(files.menu.title.split(" ")[0]);
    assert.ok(banded >= 3, `rubber band selected ${banded} items`);
    // A plain click on empty space clears the selection.
    files.click({ x: start.x, y: start.y });
    files.key(139, "ContextMenu");
    assert.equal(files.menu.title, "Projects", "clicking empty space clears the selection");

    // Type to select is search: a prefix ranks the first match in listing order best, and
    // Escape returns to the folder with it selected.
    files.click(files.center(entryId(path.join(folder, "Design"))));
    files.type("br");
    await files.until(() => files.texts().includes("Best match"), "typing starts a search");
    files.key(1, "Escape");
    files.key(139, "ContextMenu");
    assert.equal(files.menu.title, "bravo.txt", "typing a prefix selects the first match");
    files.type("d");
    await files.until(() => files.texts().includes("Best match"), "a new search");
    files.key(1, "Escape");
    files.key(139, "ContextMenu");
    assert.equal(files.menu.title, "Design", "folders lead the listing, so they match first");
    files.type("del");
    await files.until(() => files.texts().includes("Best match"), "a longer prefix");
    files.key(1, "Escape");
    files.key(139, "ContextMenu");
    assert.equal(files.menu.title, "delta.txt", "a longer prefix narrows the match");

    // Ctrl+L, then Tab completes the folder name.
    files.key(38, "l", { ctrl: true });
    files.key(30, "a", { ctrl: true });
    files.type(`${folder}/Do`);
    files.key(15, "Tab");
    files.key(28, "Enter");
    await files.until(
      () => files.texts().includes("Documents"),
      "Tab completion reaches the folder",
    );
    files.key(139, "ContextMenu");
    assert.equal(files.menu.title, "Documents", "completion committed the full path");
    files.key(105, "ArrowLeft", { alt: true });
    await files.until(
      () => files.hits().some((hit) => hit.focusId === entryId(path.join(folder, "alpha.txt"))),
      "back in Projects",
    );

    // The Properties pane follows the selection without opening editors by itself.
    files.click(files.center(entryId(path.join(folder, "alpha.txt"))));
    await files.until(
      () => files.texts().includes("Sharing & permissions"),
      "Properties shows the file",
    );
    files.click(files.center(entryId(path.join(folder, "Design"))));
    await files.until(() => files.texts().includes("Open in New Tab"), "and then the folder");
    files.click(files.center(entryId(path.join(folder, "beta.txt"))));
    await files.until(() => files.texts().includes("Information"), "and then the next file");
    assert.ok(
      !files
        .hits()
        .some((hit) => hit.focusId?.endsWith(":field") || hit.focusId === "inspector:rename"),
      "no tag or name field opens by itself",
    );
    console.log(
      "[files/selection] launch reveal, rubber band, type-to-select search, path completion and Properties following the selection passed",
    );
  } finally {
    files.close();
  }
});

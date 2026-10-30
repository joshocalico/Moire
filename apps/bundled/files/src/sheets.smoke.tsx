/**
 * The sheets over a page. Preview (Space): the item large with its details; arrows page through
 * the folder; Escape or Space closes. Properties (Alt+Enter, or ⋯ › Properties): the inspector
 * as a docked pane that follows the selection, with tags, sizes and permissions.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entryId, openFiles, withHome } from "./harness";
import { PREVIEW_FOCUS_ID } from "./views/preview-sheet";
import { PROPERTIES_CLOSE_ID } from "./views/properties-sheet";
import { TAG_ADD_ID } from "./views/inspector/tags-card";

const artwork = fileURLToPath(
  new URL("../../../../themes/default/botanical-wisteria.png", import.meta.url),
);

await withHome(async (home) => {
  const folder = path.join(home, "Projects");
  await fs.mkdir(folder, { recursive: true });
  await fs.copyFile(artwork, path.join(folder, "a-bloom.png"));
  await fs.writeFile(path.join(folder, "b-notes.txt"), "First line of the notes\nSecond line\n");
  await fs.writeFile(path.join(folder, "c-plan.md"), "# Plan\n");
  const files = await openFiles({ initialPath: folder });
  const focused = () => (files.window as unknown as { focusedId: string | null }).focusedId;
  try {
    const bloom = path.join(folder, "a-bloom.png");
    await files.until(() => files.hits().some((hit) => hit.focusId === entryId(bloom)), "lists");

    // Preview: Space opens it on the focused item.
    files.click(files.center(entryId(bloom)));
    files.key(57, " ");
    await files.until(() => files.texts().includes("1 of 3"), "Space opens the preview");
    assert.equal(focused(), PREVIEW_FOCUS_ID, "the preview takes the keyboard");
    await files.until(() => files.texts().includes("1586 × 992 pixels"), "an image shows its size");
    files.key(106, "ArrowRight");
    await files.until(() => files.texts().includes("2 of 3"), "Right pages to the next item");
    await files.until(
      () => files.texts().includes("First line of the notes"),
      "a text file shows an excerpt",
    );
    files.key(108, "ArrowDown");
    await files.until(() => files.texts().includes("3 of 3"), "Down pages too");
    files.key(106, "ArrowRight");
    assert.ok(files.texts().includes("3 of 3"), "paging stops at the last item");
    files.key(1, "Escape");
    await files.until(() => !files.texts().includes("3 of 3"), "Escape closes it");
    files.key(139, "ContextMenu");
    assert.equal(files.menu.title, "c-plan.md", "the paged-to item is selected");
    files.key(57, " ");
    await files.until(() => files.texts().includes("3 of 3"), "Space opens it again");
    files.key(57, " ");
    await files.until(() => !files.texts().includes("3 of 3"), "and Space closes it");

    // Properties: Alt+Enter opens the pane for the selection.
    files.click(files.center(entryId(path.join(folder, "b-notes.txt"))));
    files.key(28, "Enter", { alt: true });
    await files.until(() => files.texts().includes("Properties"), "Alt+Enter opens Properties");
    await files.until(() => files.texts().includes("Size"), "it lists the file's size");
    assert.ok(files.texts().includes("Projects"), "and where it is");
    await files.until(
      () => files.texts().includes("Sharing & permissions"),
      "permissions have their own card",
    );
    // It follows the selection.
    files.click(files.center(entryId(bloom)));
    await files.until(() => files.texts().includes("Dimensions"), "it follows the selection");
    // Tags: added from the pane, kept in the catalog.
    await files.until(
      () => files.hits().some((hit) => hit.focusId === TAG_ADD_ID),
      "the add-tag chip shows",
    );
    files.click(files.center(TAG_ADD_ID));
    await files.settle(5);
    files.type("trip");
    assert.ok(!files.texts().includes("Best match"), "typing in the tag field starts no search");
    files.key(28, "Enter");
    await files.until(() => files.texts().includes("trip"), "Enter adds the tag");
    const stored = JSON.parse(
      await fs.readFile(path.join(home, ".config", "moire", "files-tags.json"), "utf8"),
    );
    assert.deepEqual(stored.records[0].tags, ["trip"], "the tag is saved");
    files.click(files.center(PROPERTIES_CLOSE_ID));
    await files.until(() => !files.texts().includes("Properties"), "the button closes it");

    // ⋯ › Properties, from a row's hover actions.
    const row = files.center(entryId(path.join(folder, "c-plan.md")));
    files.pointer("move", row.x, row.y);
    await files.settle(3);
    files.click(files.center(`action:more:${path.join(folder, "c-plan.md")}`));
    assert.equal(files.menu.title, "c-plan.md");
    await files.invoke("properties");
    await files.until(() => files.texts().includes("Properties"), "⋯ › Properties opens it");
    files.click(files.center(entryId(bloom)));
    files.key(1, "Escape");
    await files.until(() => !files.texts().includes("Properties"), "Escape closes it");
    console.log(
      "[files/sheets] preview open/page/close by Space and Escape with image/text content; Properties by Alt+Enter and ⋯, following selection, details, permissions and tags passed",
    );
  } finally {
    files.close();
  }
});

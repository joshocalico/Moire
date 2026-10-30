/**
 * The columns view: Home down to the current folder, the way down marked; choosing a folder
 * opens it as the next column, a file shows in the preview column; Left and Right walk the
 * columns; narrow windows keep only the last two.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entryId, openFiles, withHome } from "./harness";
import { seedMixed } from "./inspector-fixtures";

const artwork = fileURLToPath(
  new URL("../../../../themes/default/botanical-wisteria.png", import.meta.url),
);

await withHome(async (home) => {
  const projects = path.join(home, "Projects");
  const design = path.join(projects, "Design");
  await fs.mkdir(design, { recursive: true });
  await fs.writeFile(path.join(projects, "plan.txt"), "plan");
  await fs.copyFile(artwork, path.join(design, "Moodboard.png"));
  await fs.writeFile(path.join(home, "notes.txt"), "notes");
  const files = await openFiles({
    initialPath: projects,
    view: "columns",
    width: 1200,
    height: 760,
  });
  try {
    await files.until(
      () => files.hits().some((hit) => hit.focusId === `column:${projects}`),
      "Home's column shows beside Projects",
    );
    assert.ok(files.texts().includes("notes.txt"), "the Home column lists Home");
    // Choosing a folder opens it as the next column.
    files.click(files.center(entryId(design)));
    await files.until(() => files.texts().includes("Moodboard.png"), "Design opens as a column");
    // Design's own listing is the tab's; the ancestor columns (Home, Projects) are read
    // separately and can land a few frames later, so wait for them rather than assert.
    await files.until(
      () => files.hits().some((hit) => hit.focusId === `column:${design}`),
      "Projects is now a column with Design marked",
    );
    assert.ok(files.texts().includes("Search Design"), "the title follows the deepest column");
    // A file shows in the preview column.
    files.click(files.center(entryId(path.join(design, "Moodboard.png"))));
    await files.until(
      () => files.texts().includes("1586 × 992 pixels"),
      "the preview reads its details",
    );
    assert.ok(
      files.hits().some((hit) => hit.focusId === "columns:open"),
      "the preview offers Open",
    );
    // Left goes back up with the folder selected; Right goes into it.
    files.key(105, "ArrowLeft");
    await files.until(() => files.texts().includes("Search Projects"), "Left opens the parent");
    await files.until(() => {
      files.key(139, "ContextMenu");
      return files.menu.title === "Design";
    }, "with the folder it came from selected");
    files.key(106, "ArrowRight");
    await files.until(() => files.texts().includes("Search Design"), "Right opens the folder");
    // A file in an earlier column opens its folder with it selected.
    const plan = `column:${path.join(projects, "plan.txt")}`;
    await files.until(() => files.hits().some((hit) => hit.focusId === plan), "Projects lists");
    files.click(files.center(`column:${path.join(projects, "plan.txt")}`));
    await files.until(() => files.texts().includes("Search Projects"), "back in Projects");
    await files.until(() => {
      files.key(139, "ContextMenu");
      return files.menu.title === "plan.txt";
    }, "the file is selected");
  } finally {
    files.close();
  }

  // Narrow: the last two columns and the preview.
  const narrow = await openFiles({ initialPath: design, view: "columns", width: 700, height: 600 });
  try {
    await narrow.until(() => narrow.texts().includes("Moodboard.png"), "Design lists");
    // The ancestor listings load after the tab's own; wait for them before judging the layout.
    await narrow.until(
      () => narrow.hits().some((hit) => hit.focusId === `column:${design}`),
      "Projects stays as the column before",
    );
    assert.ok(
      !narrow.hits().some((hit) => hit.focusId === `column:${projects}`),
      "Home's column gives way below 760px",
    );
  } finally {
    narrow.close();
  }

  // The preview pane: the inspector's parts, wide and without scrolling.
  const mixed = await seedMixed(home);
  const captures = process.env.MOIRE_CAPTURE_DIR;
  for (const variant of [
    { name: "image", file: "lisbon-tram.jpg", scheme: "dark" as const, shows: ["600 × 400"] },
    { name: "image", file: "lisbon-tram.jpg", scheme: "light" as const, shows: ["Exposure"] },
    { name: "pdf", file: "Guide.pdf", scheme: "dark" as const, shows: ["Page 1 of 2"] },
    { name: "audio", file: "Interlude.mp3", scheme: "dark" as const, shows: ["Sine_Title"] },
  ]) {
    const pane = await openFiles({
      initialPath: mixed,
      view: "columns",
      width: 1100,
      height: 760,
      scheme: variant.scheme,
    });
    try {
      const file = path.join(mixed, variant.file);
      await pane.until(() => pane.hits().some((hit) => hit.focusId === entryId(file)), "lists");
      pane.click(pane.center(entryId(file)));
      for (const text of [...variant.shows, "Size", "Modified"])
        await pane.until(() => pane.texts().includes(text), `${variant.name} pane shows ${text}`);
      for (const id of ["columns:open", "inspector:more"])
        assert.ok(
          pane.hits().some((hit) => hit.focusId === id),
          `the pane offers ${id}`,
        );
      if (variant.name !== "pdf")
        assert.ok(
          pane.hits().some((hit) => hit.focusId === "inspector:open-with"),
          "Open With",
        );
      // Nothing scrolls: every control lies inside the window.
      for (const hit of pane.hits().filter((hit) => hit.focusId?.startsWith("inspector:")))
        assert.ok(hit.y + hit.height <= 760, `${hit.focusId} stays in the pane`);
      if (variant.name === "pdf")
        await pane.until(() => pane.texts().includes("Opening words"), "a PDF fills the rest");
      await pane.settle(20);
      if (captures)
        await pane.capture(path.join(captures, `columns-${variant.name}-${variant.scheme}.png`));
    } finally {
      pane.close();
    }
  }
  console.log(
    "[files/columns] Home-down columns, folder opens a column, preview column (hero, actions, two-column facts, opening words, no scrolling), Left/Right, earlier-column files and narrow two-column layout passed",
  );
});

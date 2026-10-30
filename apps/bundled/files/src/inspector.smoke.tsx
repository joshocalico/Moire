/**
 * The Properties pane on the real window: docked beside the page so no row, date or hover
 * action is hidden (the page reflows into the room left of it, and the selection bar centres
 * there), covering the page over a scrim when that room would be too narrow, and a hero and
 * cards for every kind of item. Set MOIRE_CAPTURE_DIR to keep a PNG of each state.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { entryId, openFiles, withHome, type FilesHarness } from "./harness";
import { seedMixed } from "./inspector-fixtures";
import { PROPERTIES_CLOSE_ID } from "./views/properties-sheet";

const captures = process.env.MOIRE_CAPTURE_DIR;
const capture = async (files: FilesHarness, name: string) => {
  if (captures) await files.capture(path.join(captures, `${name}.png`));
};

/** The pane's left edge: its close button sits 10px (scaled) in from the right of a known width. */
function paneLeft(files: FilesHarness): number {
  const inspector = files
    .hits()
    .filter((hit) => hit.focusId?.startsWith("inspector:") || hit.focusId === PROPERTIES_CLOSE_ID);
  assert.ok(inspector.length, "the pane has controls");
  return Math.min(...inspector.map((hit) => hit.x));
}

/** No list row, its hover actions or its trailing date reaches under the pane. */
async function assertNothingUnder(files: FilesHarness, folder: string, scale: number) {
  const left = paneLeft(files) - 16 * scale;
  const rows = files.hits().filter((hit) => hit.focusId?.startsWith(`file:${folder}/`));
  assert.ok(rows.length >= 5, "rows are listed beside the pane");
  for (const row of rows)
    assert.ok(
      row.x + row.width <= left + 1,
      `${row.focusId} ends at ${row.x + row.width}, under the pane at ${left}`,
    );
  const rowRight = Math.max(...rows.map((row) => row.x + row.width));
  for (const text of files.textRects())
    if (/^(Today|Yesterday|\d+ \w+)/.test(text.text) && text.y > 200 * scale && text.x < left)
      assert.ok(text.x + text.width <= rowRight + 1, `“${text.text}” runs under the pane`);
  // Hover actions on a row stay beside the pane too.
  const row = files.center(entryId(path.join(folder, "bundle.zip")));
  files.pointer("move", row.x, row.y);
  await files.settle(3);
  const more = files.hit(`action:more:${path.join(folder, "bundle.zip")}`);
  assert.ok(more.x + more.width <= left + 1, "a row's ⋯ stays clear of the pane");
}

await withHome(async (home) => {
  const folder = await seedMixed(home);
  const at = (name: string) => path.join(folder, name);

  // Docked: every kind, with what its hero says.
  const kinds: Array<{ name: string; file: string; shows: string[]; scheme?: "light" }> = [
    { name: "image", file: "lisbon-tram.jpg", shows: ["600 × 400", "Dimensions", "Opens with"] },
    { name: "audio", file: "Interlude.mp3", shows: ["Sine_Title", "Moire_Band", "Track 3"] },
    { name: "video", file: "Lookout.mp4", shows: ["0:01", "H.264"] },
    { name: "pdf", file: "Guide.pdf", shows: ["Page 1 of 2", "Pages"] },
    { name: "code", file: "main.ts", shows: ["TypeScript", "14 lines · ASCII"] },
    { name: "markdown", file: "README.md", shows: ["Markdown", "Rendered", "Source"] },
    { name: "font", file: "Display.ttf", shows: ["IBM Plex Sans", "Medium", "Bold"] },
    { name: "archive", file: "bundle.zip", shows: ["Extract here", "Uncompressed"] },
    { name: "folder", file: "Trip", shows: ["Open in New Tab", "Images", "8 items · 1 folder"] },
    {
      name: "image-light",
      file: "lisbon-tram.jpg",
      shows: ["600 × 400"],
      scheme: "light",
    },
  ];
  for (const kind of kinds) {
    const files = await openFiles({
      initialPath: folder,
      reveal: { path: at(kind.file), properties: true },
      width: 1100,
      height: 760,
      scheme: kind.scheme ?? "dark",
    });
    try {
      await files.until(() => files.texts().includes("Properties"), `${kind.name}: pane opens`);
      for (const text of kind.shows)
        await files.until(() => files.texts().includes(text), `${kind.name} shows “${text}”`);
      for (const card of ["Location", "History"])
        assert.ok(files.texts().includes(card), `${kind.name} has ${card}`);
      if (kind.name === "image") await assertNothingUnder(files, folder, 1);
      if (kind.name === "pdf") {
        files.click(files.center("inspector:page:next"));
        await files.until(() => files.texts().includes("Page 2 of 2"), "the stepper turns pages");
        files.click(files.center("inspector:page:previous"));
        await files.until(() => files.texts().includes("Page 1 of 2"), "and back");
      }
      if (kind.name === "markdown") {
        files.press("Source");
        await files.until(
          () => files.texts().some((text) => text.includes("# Field trip")),
          "Source shows the Markdown itself",
        );
        files.press("Rendered");
        await files.settle(5);
      }
      await files.settle(20);
      await capture(files, `inspector-${kind.name}-dark`.replace("-light-dark", "-light"));
    } finally {
      files.close();
    }
  }

  // Several items: fanned thumbnails, a Selection card, bulk actions, and the selection bar
  // centred in the page's room left of the pane, all of it visible.
  {
    const files = await openFiles({
      initialPath: folder,
      reveal: { path: at("lisbon-tram.jpg"), properties: true },
      width: 1100,
      height: 760,
      scheme: "dark",
    });
    try {
      await files.until(() => files.texts().includes("Properties"), "pane opens");
      for (const name of ["harbour.jpg", "Guide.pdf"])
        files.click(files.center(entryId(at(name))), { ctrl: true });
      await files.until(() => files.texts().includes("3 items"), "the pane counts the selection");
      await files.until(() => files.texts().includes("Apply to all 3"), "with bulk actions");
      assert.ok(
        files.texts().some((text) => text.endsWith("2 images · 1 document")),
        "and what kinds they are",
      );
      await files.settle(20);
      await capture(files, "inspector-multi-dark");
      const left = paneLeft(files);
      const bar = files.textRects().find((text) => text.text.startsWith("selected"));
      assert.ok(bar, "the selection bar shows");
      const actions = files
        .hits()
        .filter(
          (hit) =>
            Math.abs(hit.y + hit.height / 2 - (bar.y + bar.height / 2)) < 12 &&
            !hit.focusId?.startsWith("file:") &&
            hit.x < left,
        );
      const barRight = Math.max(...actions.map((hit) => hit.x + hit.width));
      assert.ok(barRight <= left - 8, `the bar ends at ${barRight}, clear of the pane at ${left}`);
      const page = { left: 64, right: left - 16 };
      // The bar starts with its count bubble, just left of "selected".
      const barLeft = bar.x - 44;
      const centre = (barLeft + barRight) / 2;
      assert.ok(
        Math.abs(centre - (page.left + page.right) / 2) < 40,
        `the bar centres in the page (${centre} vs ${(page.left + page.right) / 2})`,
      );
    } finally {
      files.close();
    }
  }

  // The grid reflows its columns into the room left of the pane.
  {
    const files = await openFiles({
      initialPath: folder,
      view: "grid",
      reveal: { path: at("harbour.jpg"), properties: true },
      width: 1100,
      height: 760,
      scheme: "dark",
    });
    try {
      await files.until(() => files.texts().includes("Properties"), "grid: pane opens");
      await files.settle(20);
      const left = paneLeft(files) - 16;
      const tiles = files.hits().filter((hit) => hit.focusId?.startsWith(`file:${folder}/`));
      assert.ok(tiles.length >= 4, "tiles show beside the pane");
      for (const tile of tiles)
        assert.ok(tile.x + tile.width <= left + 1, `${tile.focusId} runs under the pane`);
      await capture(files, "inspector-grid-dark");
    } finally {
      files.close();
    }
  }

  // Too narrow to dock: the pane covers the page over a scrim; a press on it closes the pane.
  for (const variant of [
    { name: "image-640x650", width: 640, height: 650, scale: 1 },
    { name: "audio-scale1.5", width: 1500, height: 1080, scale: 1.5 },
    { name: "pdf-640x650", width: 640, height: 650, scale: 1 },
  ]) {
    const file = variant.name.startsWith("audio")
      ? "Interlude.mp3"
      : variant.name.startsWith("pdf")
        ? "Guide.pdf"
        : "lisbon-tram.jpg";
    const files = await openFiles({
      initialPath: folder,
      reveal: { path: at(file), properties: true },
      width: variant.width,
      height: variant.height,
      scale: variant.scale,
      scheme: "dark",
    });
    try {
      await files.until(() => files.texts().includes("Properties"), `${variant.name}: opens`);
      await files.settle(20);
      if (variant.width >= 1000) await assertNothingUnder(files, folder, variant.scale);
      await capture(files, `inspector-${variant.name}-dark`);
      if (variant.name === "image-640x650") {
        files.click({ x: 120, y: 400 });
        await files.until(() => !files.texts().includes("Properties"), "the scrim closes it");
      }
    } finally {
      files.close();
    }
  }
  console.log(
    "[files/inspector] docked pane with every kind (rows, dates and hover actions clear of it), page stepper, Markdown source, selection bar centred beside it, narrow scrim fallback passed",
  );
});

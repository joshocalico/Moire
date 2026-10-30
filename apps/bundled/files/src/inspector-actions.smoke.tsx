/**
 * What the Properties pane changes, end to end on real files: permissions and the executable
 * bit (chmod, with Undo), Extract here (with Undo), the default application (mimeapps.list),
 * tags (suggestions, the add field, colours, removal), renaming in place with F2, batch rename
 * of a selection (with Undo), and "Last opened" naming the app from its desktop entry.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { TAG_COLOURS } from "./catalog";
import { entryId, openFiles, withHome, type FilesHarness } from "./harness";
import { seedMixed } from "./inspector-fixtures";
import { RENAME_FIELD_ID } from "./views/inspector/title-block";
import { TAG_ADD_ID } from "./views/inspector/tags-card";

const exists = (file: string) =>
  fs.stat(file).then(
    () => true,
    () => false,
  );
const modeOf = async (file: string) => (await fs.stat(file)).mode & 0o7777;

/** The control whose focus id ends with `suffix` (segmented controls prefix their own ids). */
function control(files: FilesHarness, suffix: string) {
  const found = files.hits().find((hit) => hit.focusId?.endsWith(suffix));
  assert.ok(found, `no control …${suffix}`);
  return { x: found.x + found.width / 2, y: found.y + found.height / 2 };
}

/** Scroll the pane until a control is in view (the pane's cards run below the window). */
async function reveal(files: FilesHarness, suffix: string) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const hit = files.hits().find((candidate) => candidate.focusId?.endsWith(suffix));
    const clip = hit?.pointerClip ?? hit;
    if (hit && clip && clip.height >= hit.height - 1 && hit.y + hit.height < 740) return;
    files.native.injectPointer({ type: "wheel", x: 900, y: 400, deltaY: 160, timeMs: Date.now() });
    await files.settle(4);
  }
}

async function undo(files: FilesHarness, message: string) {
  await files.until(() => files.texts().includes("Undo"), `${message}: Undo is offered`);
  files.press("Undo");
}

await withHome(async (home) => {
  const folder = await seedMixed(home);
  const at = (name: string) => path.join(folder, name);
  // Two applications for JPEGs, one of them the Image Viewer that recorded opening a photo.
  const applications = path.join(home, ".local", "share", "applications");
  await fs.mkdir(applications, { recursive: true });
  const desktop = (name: string, extra = "") =>
    `[Desktop Entry]\nType=Application\nName=${name}\nExec=true %U\nMimeType=image/jpeg;\n${extra}`;
  await fs.writeFile(
    path.join(applications, "moire-image-viewer.desktop"),
    desktop("Image Viewer", "StartupWMClass=org.moire.ImageViewer\n"),
  );
  await fs.writeFile(path.join(applications, "photo-tool.desktop"), desktop("Photo Tool"));
  const recent = path.join(home, ".local", "state", "moire", "recent");
  await fs.mkdir(recent, { recursive: true });
  await fs.writeFile(
    path.join(recent, "org.moire.ImageViewer.json"),
    JSON.stringify([at("lisbon-tram.jpg")]),
  );

  // Permissions: a segment and the executable toggle chmod the file; Undo restores it.
  {
    await fs.chmod(at("main.ts"), 0o644);
    const files = await openFiles({
      initialPath: folder,
      reveal: { path: at("main.ts"), properties: true },
      height: 900,
    });
    try {
      await files.until(() => files.texts().includes("Sharing & permissions"), "sharing shows");
      await reveal(files, ":group:write");
      files.click(control(files, ":group:write"));
      await files.until(async () => (await modeOf(at("main.ts"))) === 0o664, "group may write");
      await undo(files, "chmod");
      await files.until(async () => (await modeOf(at("main.ts"))) === 0o644, "Undo restores");
      await reveal(files, "inspector:executable");
      files.click(files.center("inspector:executable"));
      await files.until(
        async () => ((await modeOf(at("main.ts"))) & 0o111) === 0o111,
        "the executable toggle sets x for every reader",
      );
      await undo(files, "executable");
      await files.until(async () => (await modeOf(at("main.ts"))) === 0o644, "and Undo clears it");
    } finally {
      files.close();
    }
  }

  // Extract here: a folder beside the archive; Undo moves it to Trash.
  {
    const files = await openFiles({
      initialPath: folder,
      reveal: { path: at("bundle.zip"), properties: true },
    });
    try {
      await files.until(() => files.texts().includes("Extract here"), "the archive hero shows");
      files.click(files.center("inspector:extract"));
      const extracted = at("bundle");
      await files.until(() => exists(path.join(extracted, "readme.txt")), "it extracts beside");
      await files.until(
        () => files.texts().some((text) => text.startsWith("Extracted to")),
        "and says where",
      );
      await undo(files, "extract");
      await files.until(async () => !(await exists(extracted)), "Undo removes the folder");
    } finally {
      files.close();
    }
  }

  // Opens with, Last opened, tags and renaming in place, on a photo.
  {
    const files = await openFiles({
      initialPath: folder,
      reveal: { path: at("lisbon-tram.jpg"), properties: true },
      height: 900,
    });
    try {
      await files.until(
        () => files.texts().some((text) => text.startsWith("Image Viewer · ")),
        "History names the app it was last opened in",
      );
      // Open With ▾ › Always Open With › Photo Tool writes the default.
      files.click(files.center("inspector:open-with"));
      assert.ok(files.menu.title.startsWith("Open “lisbon-tram.jpg”"), "Open With lists apps");
      assert.ok(files.action("open-with:photo-tool.desktop"), "both apps are offered");
      await files.invoke("default:photo-tool.desktop");
      const mimeapps = await fs.readFile(path.join(home, ".config", "mimeapps.list"), "utf8");
      assert.match(mimeapps, /image\/jpeg=photo-tool\.desktop;/, "mimeapps.list has the default");
      await files.until(
        () => files.texts().some((text) => text.startsWith("Photo Tool now opens every .jpg")),
        "the change is confirmed",
      );
      await files.until(() => files.texts().includes("Photo Tool"), "Opens with shows it");

      // Tags: a suggestion adds on press, the add chip takes a typed tag, a chip's menu colours it.
      const tagsFile = path.join(home, ".config", "moire", "files-tags.json");
      const stored = async () =>
        JSON.parse(await fs.readFile(tagsFile, "utf8")) as {
          records: Array<{ path: string; tags: string[] }>;
          colours?: Record<string, number>;
        };
      await files.until(
        () => files.hits().some((hit) => hit.focusId === "inspector:suggest:2024"),
        "the year taken is suggested",
      );
      files.click(files.center("inspector:suggest:2024"));
      await files.until(
        async () =>
          (await exists(tagsFile)) && !!(await stored()).records[0]?.tags.includes("2024"),
        "a suggestion becomes a tag",
      );
      await files.until(
        () => !files.hits().some((hit) => hit.focusId === "inspector:suggest:2024"),
        "and is no longer suggested",
      );
      files.click(files.center(TAG_ADD_ID));
      await files.settle(5);
      files.type("Lisbon");
      files.key(28, "Enter");
      await files.until(
        async () => !!(await stored()).records[0]?.tags.includes("Lisbon"),
        "the add chip adds a typed tag",
      );
      assert.ok(!files.texts().includes("Best match"), "typing a tag starts no search");
      files.click(files.center("inspector:tag:2024"));
      assert.equal(files.menu.title, "2024", "a tag's chip opens its menu");
      await files.invoke("tag-colour:1");
      await files.until(
        async () => (await stored()).colours?.["2024"] === TAG_COLOURS[1],
        "the colour is saved",
      );
      files.click(files.center("inspector:tag:2024:remove"));
      await files.until(
        async () => !(await stored()).records[0]?.tags.includes("2024"),
        "× removes the tag",
      );

      // F2 renames in place, in the pane.
      files.click(files.center(entryId(at("lisbon-tram.jpg"))));
      files.key(60, "F2");
      await files.until(
        () => files.hits().some((hit) => hit.focusId === RENAME_FIELD_ID),
        "F2 opens the name field in the pane",
      );
      files.type("tram.jpg");
      files.key(28, "Enter");
      await files.until(() => exists(at("tram.jpg")), "Enter renames the file");
      assert.equal(await exists(at("lisbon-tram.jpg")), false, "the old name is gone");
    } finally {
      files.close();
    }
  }

  // Apply to all › Rename…: one pattern for the selection, undone as one.
  {
    const files = await openFiles({
      initialPath: folder,
      reveal: { path: at("garden-gate.jpg"), properties: true },
      height: 900,
    });
    try {
      await files.until(() => files.texts().includes("Properties"), "the pane opens");
      files.click(files.center(entryId(at("harbour.jpg"))), { ctrl: true });
      await files.until(() => files.texts().includes("Apply to all 2"), "bulk actions show");
      await reveal(files, "inspector:bulk:rename");
      files.click(files.center("inspector:bulk:rename"));
      await files.until(() => files.texts().includes("Rename 2 items"), "the dialog opens");
      await files.settle(5);
      files.type("Trip {n}");
      await files.until(
        () => files.texts().some((text) => text.includes("garden-gate.jpg → Trip 1.jpg")),
        "the dialog previews the new names",
      );
      files.key(28, "Enter");
      await files.until(
        async () => (await exists(at("Trip 1.jpg"))) && (await exists(at("Trip 2.jpg"))),
        "both are renamed",
      );
      await undo(files, "batch rename");
      await files.until(
        async () => (await exists(at("garden-gate.jpg"))) && (await exists(at("harbour.jpg"))),
        "Undo restores both names",
      );
    } finally {
      files.close();
    }
  }
  console.log(
    "[files/inspector-actions] chmod and executable with Undo, Extract here with Undo, default app written to mimeapps.list, last-opened app name, tag suggestion/add/colour/remove, F2 rename in place, batch rename with Undo passed",
  );
});

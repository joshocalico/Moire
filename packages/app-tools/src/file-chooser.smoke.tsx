/** The shared file chooser: browse by keyboard, filter by type, pick a folder, choose a save path. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { Window, installUiFonts, tickAllMotions } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { FileChooser, type FileChooserMode } from "./file-chooser";
import { windowControl, withFixture } from "./testing";

await installUiFonts();

async function chooser(
  mode: FileChooserMode,
  options: { accept?: string[]; name?: string; multiple?: boolean; directory?: string } = {},
) {
  const chosen: string[] = [];
  const chosenMany: string[][] = [];
  let cancelled = 0;
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({ title: "Chooser", width: 900, height: 620, decorated: false });
  window.setContent((size) => (
    <FileChooser
      {...size}
      mode={mode}
      appId="org.moire.ChooserSmoke"
      accept={options.accept}
      name={options.name}
      directory={options.directory}
      multiple={options.multiple}
      onChoose={(file) => chosen.push(file)}
      onChooseMany={(files) => chosenMany.push(files)}
      onCancel={() => cancelled++}
    />
  ));
  window.mount(backend);
  await Promise.resolve();
  const native = backend.getWindows()[0]!;
  const tick = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      tickAllMotions(1);
      window.tick();
    }
  };
  const key = async (code: number, name: string) => {
    for (const type of ["down", "up"] as const)
      native.injectKey({
        type,
        code,
        key: name,
        modifiers: { shift: false, ctrl: false, alt: false, meta: false },
        timeMs: 1,
      });
    await tick();
  };
  const press = async (match: { text: string } | { focusId: string }) => {
    const point = windowControl(window, match);
    for (const type of ["down", "up"] as const)
      native.injectPointer({ type, x: point.x, y: point.y, button: "left", timeMs: 1 });
    await tick();
  };
  await tick();
  return {
    chosen,
    chosenMany,
    cancelled: () => cancelled,
    key,
    press,
    texts: () => {
      const found: string[] = [];
      const walk = (node: { kind: string; text?: string; children: unknown[] }) => {
        if (node.kind === "text" && node.text) found.push(node.text);
        for (const child of node.children) walk(child as typeof node);
      };
      walk((window as unknown as { root: { container: never } }).root.container);
      return found;
    },
    close: () => window.destroy?.(),
  };
}

await withFixture(async (home) => {
  await fs.mkdir(path.join(home, "Pictures/Holiday"), { recursive: true });
  await fs.writeFile(path.join(home, "Pictures/sunset.png"), "png");
  await fs.writeFile(path.join(home, "Pictures/notes.txt"), "text");
  await fs.writeFile(path.join(home, "Pictures/Holiday/beach.png"), "png");

  // Open: starts in Pictures for image types, hides other files, folders first.
  const open = await chooser("open", { accept: ["png"] });
  assert.ok(open.texts().includes("Pictures"), "an image chooser starts in Pictures");
  assert.ok(open.texts().includes("sunset.png") && open.texts().includes("Holiday"));
  assert.ok(!open.texts().includes("notes.txt"), "files of other types are not offered");
  await open.key(108, "ArrowDown"); // Holiday (folders come first)
  await open.key(28, "Enter");
  assert.ok(open.texts().includes("beach.png"), "Enter on a folder opens it");
  await open.key(108, "ArrowDown");
  await open.key(28, "Enter");
  assert.deepEqual(open.chosen, [path.join(home, "Pictures/Holiday/beach.png")]);
  await open.key(1, "Escape");
  assert.equal(open.cancelled(), 1, "Escape cancels");
  open.close();

  // Folder: only folders are listed; the primary button takes the current folder.
  const folder = await chooser("folder");
  assert.ok(!folder.texts().includes("sunset.png"), "a folder chooser lists only folders");
  await folder.press({ text: "Choose this folder" });
  assert.equal(folder.chosen.length, 1);
  assert.ok((await fs.stat(folder.chosen[0]!)).isDirectory());
  folder.close();

  // Save: the suggested name is saved into the current folder.
  const save = await chooser("save", { name: "Screenshot.png" });
  await save.press({ text: "Save" });
  assert.equal(save.chosen.length, 1);
  assert.equal(path.basename(save.chosen[0]!), "Screenshot.png");
  save.close();

  // Save over an existing file asks first; Cancel keeps the chooser open, Replace confirms.
  const replace = await chooser("save", {
    name: "sunset.png",
    directory: path.join(home, "Pictures"),
  });
  await replace.press({ text: "Save" });
  assert.equal(replace.chosen.length, 0, "an existing file is not replaced silently");
  assert.ok(replace.texts().some((text) => text.startsWith("Replace “sunset.png”")));
  await replace.press({ text: "Replace" });
  assert.deepEqual(replace.chosen, [path.join(home, "Pictures/sunset.png")]);
  replace.close();

  // Several files: clicking files picks them; the primary action opens them all.
  await fs.writeFile(path.join(home, "Pictures/moon.png"), "png");
  const many = await chooser("open", { accept: ["png"], multiple: true });
  await many.press({ text: "moon.png" });
  await many.press({ text: "sunset.png" });
  await many.press({ text: "Open 2 files" });
  assert.deepEqual(many.chosenMany, [
    [path.join(home, "Pictures/moon.png"), path.join(home, "Pictures/sunset.png")],
  ]);
  many.close();

  // Each app reopens where it was last used.
  const again = await chooser("open", { accept: ["png"] });
  assert.ok(again.texts().includes("Pictures"), "the last folder is remembered per app");
  again.close();
});
console.log("[app-tools/file-chooser] browse, filter, folder and save choices passed");

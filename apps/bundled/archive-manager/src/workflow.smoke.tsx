/**
 * Archive Manager driven like a person would: open through the chooser, extract beside the
 * archive and elsewhere, show the result in Files, edit (new folder, remove, rename, add a file),
 * guard closing with unsaved changes, save, and create a new archive from a chooser-picked folder.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { setUiScaleFactor } from "@moire/ui";
import { runTool } from "@moire/app-tools";
import { mountWindow, withFixture } from "@moire/app-tools/testing";
import { ArchiveManagerApp } from "./main";
import { createArchive, listArchive } from "./backend";

const KEY = { down: 108, end: 107, home: 102, enter: 28, del: 111, a: 30 };

await withFixture(async (home) => {
  const documents = path.join(home, "Documents");
  const project = path.join(documents, "Project");
  await fs.mkdir(path.join(project, "assets"), { recursive: true });
  await fs.writeFile(path.join(project, "README.md"), "Read me");
  await fs.writeFile(path.join(project, "assets", "logo.png"), "PNG");
  await fs.mkdir(path.join(documents, "Out"));
  await fs.writeFile(path.join(documents, "zz-extra.txt"), "Extra");
  const archive = path.join(documents, "Project backup.tar.gz");
  await createArchive([project], archive);
  // Files is reached through the desktop opener; a stand-in records what it was asked to show.
  const bin = path.join(home, "bin");
  const shown = path.join(home, "shown.txt");
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "xdg-open"), `#!/bin/sh\nprintf '%s' "$1" > '${shown}'\n`, {
    mode: 0o755,
  });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  const contents = async (file: string) =>
    (await listArchive(file)).entries.map((entry) => entry.replace(/\/$/, "")).sort();
  const exists = (file: string) =>
    fs.stat(file).then(
      () => true,
      () => false,
    );

  try {
    for (const [width, height, scale] of [
      [1020, 700, 1],
      [640, 975, 1.5],
    ] as const) {
      setUiScaleFactor(scale);
      let closed = 0;
      const app = await mountWindow(
        (size, window) => (
          <ArchiveManagerApp
            {...size}
            window={window}
            onCloseGuard={(guard) => window.setCloseGuard(guard)}
          />
        ),
        { width, height },
      );
      app.window.onClose(() => closed++);
      try {
        // Open through the chooser: it starts in Documents; folders come first, then archives.
        app.press({ focusId: "open-file:browse" });
        await app.settle();
        assert.ok(app.texts().includes("Project backup.tar.gz"), "the chooser lists the archive");
        app.key(KEY.end, "End");
        app.key(KEY.enter, "Enter");
        await app.until(
          () => app.texts().includes("Contents"),
          "the archive opened from the chooser",
        );
        assert.ok(app.texts().includes("logo.png"));

        // Extract beside the archive, then again: the second gets a free name.
        const first = path.join(documents, "Project backup");
        const second = path.join(documents, "Project backup 2");
        if (scale === 1) {
          app.press({ focusId: "archive:extract" });
          await app.until(() => app.texts().includes("Show in Files"), "extraction finished");
          assert.equal(
            await fs.readFile(path.join(first, "Project", "README.md"), "utf8"),
            "Read me",
          );
          app.press({ focusId: "archive:show" });
          await app.until(() => existsSync(shown), "Files was asked to show the result");
          assert.equal(await fs.readFile(shown, "utf8"), pathToFileURL(first).href);
          app.press({ focusId: "archive:dismiss" });
          app.press({ focusId: "archive:extract" });
          await app.until(
            () => app.texts().includes("Show in Files"),
            "second extraction finished",
          );
          assert.ok(await exists(path.join(second, "Project", "assets", "logo.png")));
          app.press({ focusId: "archive:dismiss" });
        }

        // Extract to… a folder picked in the chooser (Out is the first folder in Documents).
        app.press({ focusId: "archive:extract-to" });
        await app.settle();
        app.key(KEY.down, "ArrowDown");
        app.press({ text: "Choose folder" });
        await app.until(() => app.texts().includes("Show in Files"), "Extract to… finished");
        // The first run already filled Out/Project backup (and then edited the archive), so the
        // second gets a free name.
        const outTarget = path.join(
          documents,
          "Out",
          scale === 1 ? "Project backup" : "Project backup 2",
        );
        assert.ok(
          await exists(
            path.join(
              outTarget,
              ...(scale === 1 ? ["Project", "README.md"] : ["Renamed", "zz-extra.txt"]),
            ),
          ),
        );
        app.press({ focusId: "archive:dismiss" });
        if (scale !== 1) continue;

        // Edit: select the top folder, add a folder inside it, remove the README, rename the top
        // folder and add a file from the chooser into it.
        app.press({ focusId: "archive:contents" });
        app.key(KEY.home, "Home");
        app.press({ focusId: "archive:new-folder" });
        await app.settle();
        app.key(KEY.a, "a", { ctrl: true });
        app.type("Fresh");
        app.key(KEY.enter, "Enter");
        await app.settle();
        assert.ok(app.texts().includes("Fresh"), "the new folder is listed");
        assert.ok(
          app.texts().some((text) => text.endsWith("— edited")),
          "unsaved changes show in the title",
        );
        app.press({ focusId: "archive:contents" });
        app.key(KEY.end, "End");
        app.key(KEY.del, "Delete");
        assert.ok(!app.texts().includes("README.md"), "Delete removes the selected entry");
        app.key(KEY.home, "Home");
        app.press({ focusId: "archive:rename" });
        await app.settle();
        app.key(KEY.a, "a", { ctrl: true });
        app.type("Renamed");
        app.key(KEY.enter, "Enter");
        await app.settle();
        assert.ok(app.texts().includes("Renamed"));
        app.press({ focusId: "archive:add-files" });
        await app.settle();
        app.key(KEY.end, "End");
        app.key(KEY.enter, "Enter");
        await app.settle();
        assert.ok(app.texts().includes("zz-extra.txt"));

        // Closing with unsaved changes asks first; Cancel keeps the window and the edits.
        app.native.requestClose();
        await app.settle();
        assert.equal(closed, 0, "close is held while changes are unsaved");
        assert.ok(app.texts().includes("Discard unsaved changes?"));
        app.press({ text: "Cancel" });
        await app.settle();

        // Save rewrites the archive; its new listing is the proof.
        app.press({ focusId: "archive:save" });
        await app.until(
          () => !app.texts().some((text) => text.endsWith("— edited")),
          "saved and re-read",
        );
        assert.deepEqual(await contents(archive), [
          "Renamed",
          "Renamed/Fresh",
          "Renamed/assets",
          "Renamed/assets/logo.png",
          "Renamed/zz-extra.txt",
        ]);
        app.native.requestClose();
        assert.equal(closed, 1, "a saved archive closes without asking");
      } finally {
        app.destroy();
      }
    }

    // A new archive: add a folder through the chooser, then Save as… with the suggested name.
    setUiScaleFactor(1);
    const fresh = await mountWindow((size) => <ArchiveManagerApp {...size} />, {
      width: 1020,
      height: 700,
    });
    try {
      fresh.press({ focusId: "archive:new" });
      fresh.press({ focusId: "archive:add-folder" });
      await fresh.settle();
      // Documents lists Out, then Project.
      fresh.key(KEY.down, "ArrowDown");
      fresh.key(KEY.down, "ArrowDown");
      fresh.press({ text: "Choose folder" });
      await fresh.settle();
      assert.ok(fresh.texts().includes("Project"), "the chosen folder is in the new archive");
      fresh.press({ focusId: "archive:save-as" });
      await fresh.settle();
      // The suggested name is filled in; Enter in the name field saves (the header has a Save too).
      fresh.press({ text: "Project.tar.gz" });
      fresh.key(KEY.enter, "Enter");
      await fresh.until(() => fresh.texts().includes("Show in Files"), "new archive saved");
      const created = path.join(documents, "Project.tar.gz");
      assert.ok((await contents(created)).includes("Project/README.md"));
    } finally {
      fresh.destroy();
    }

    // A format Save can't write says so, and its edit actions stay visible but unavailable.
    const xz = path.join(documents, "packed.tar.xz");
    await runTool("bsdtar", ["-cJf", xz, "-C", project, "README.md"]);
    const readOnly = await mountWindow((size) => <ArchiveManagerApp {...size} initialPath={xz} />, {
      width: 1020,
      height: 700,
    });
    try {
      await readOnly.until(() => readOnly.texts().includes("README.md"), "the .tar.xz opened");
      assert.ok(
        readOnly.texts().some((text) => text.startsWith("Editing isn't available for .tar.xz")),
      );
      assert.ok(readOnly.texts().includes("Add files…"), "edit actions are shown");
      assert.throws(
        () => readOnly.press({ focusId: "archive:add-files" }),
        /No visible control/,
        "but are disabled",
      );
    } finally {
      readOnly.destroy();
    }
  } finally {
    process.env.PATH = previousPath;
  }
});
setUiScaleFactor(1);
console.log(
  "[archive-manager/workflow] chooser open, extract beside/again/to…, Show in Files, edit + close guard + save, new archive, read-only format passed",
);

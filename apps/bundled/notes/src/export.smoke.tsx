/** Export a note through the real actions menu and the shared file chooser. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { windowControl, windowTexts, withFixture } from "@moire/app-tools/testing";
import { NotesApp } from "./main";
import { NotesStore, createNote } from "./store";
import { harness, noteAction } from "./testing";

await withFixture(async (home) => {
  fs.mkdirSync(path.join(home, "Documents"));
  const store = new NotesStore(path.join(home, "notes"));
  store.save({
    ...store.load(),
    notes: [{ ...createNote(), title: "Groceries: weekly", body: "eggs\ntea\n\n" }],
  });
  const app = await harness(
    (size, window) => <NotesApp {...size} store={store} windowActions={window} />,
    1180,
    760,
  );
  const pressText = async (label: string) => {
    const point = windowControl(app.window, { text: label });
    app.click(point.x, point.y);
    await app.settle();
  };
  const exportVia = async (finish: "save" | "cancel" | "keep" | "replace") => {
    await noteAction(app, "export");
    assert.ok(windowTexts(app.window).includes("Export note"), "Export opens the file chooser");
    if (finish === "cancel") app.key(1, "Escape");
    else {
      // The chooser opens on its file list; Tab reaches the suggested name, Enter saves it.
      assert.ok(windowTexts(app.window).includes("Groceries weekly.txt"), "colons are dropped");
      app.key(15, "Tab");
      app.key(28, "Enter");
      // Saving over an existing file asks first; Cancel returns to the chooser.
      if (finish === "keep" || finish === "replace") {
        await app.settle();
        assert.ok(windowTexts(app.window).some((text) => text.startsWith("Replace “")));
        await pressText(finish === "keep" ? "Cancel" : "Replace");
        if (finish === "keep") {
          assert.ok(windowTexts(app.window).includes("Export note"), "Cancel keeps the chooser");
          app.key(1, "Escape");
        }
      }
    }
    await app.settle();
    assert.ok(!windowTexts(app.window).includes("Export note"), "the chooser closes");
  };
  const target = path.join(home, "Documents", "Groceries weekly.txt");
  try {
    await exportVia("cancel");
    assert.equal(fs.existsSync(target), false, "cancelling writes nothing");
    await exportVia("save");
    assert.equal(fs.readFileSync(target, "utf8"), "Groceries: weekly\n\neggs\ntea\n");
    assert.ok(windowTexts(app.window).includes(`Exported to ${target}`));
    fs.writeFileSync(target, "kept");
    await exportVia("keep");
    assert.equal(fs.readFileSync(target, "utf8"), "kept", "declining the prompt keeps the file");
    await exportVia("replace");
    assert.equal(fs.readFileSync(target, "utf8"), "Groceries: weekly\n\neggs\ntea\n");
    assert.deepEqual(
      fs.readdirSync(path.dirname(target)).filter((name) => name.endsWith(".tmp")),
      [],
      "no temporary file is left behind",
    );
    // Blank space inside the chooser (below its places) belongs to the dialog: pressing it
    // must not dismiss the chooser through the modal barrier underneath.
    await noteAction(app, "export");
    app.click(348, 464);
    assert.ok(windowTexts(app.window).includes("Export note"), "a press inside the dialog kept it");
    app.key(1, "Escape");
    await app.settle();
    assert.ok(!windowTexts(app.window).includes("Export note"));
  } finally {
    app.destroy();
  }
});
console.log(
  "[notes/export] actions menu → chooser save, cancel, text format and confirmed replace passed",
);

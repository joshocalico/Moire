import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { readClipboardText } from "@moire/ui";
import { harness, noteAction } from "./testing";
const root = process.env.MOIRE_TEST_ROOT;
const { NotesApp }: typeof import("./main") = root
  ? await import(pathToFileURL(path.join(root, "apps/bundled/notes/src/main.tsx")).href)
  : await import("./main");
const { NotesStore, createNote }: typeof import("./store") = root
  ? await import(pathToFileURL(path.join(root, "apps/bundled/notes/src/store.ts")).href)
  : await import("./store");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-notes-selection-"));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
process.env.XDG_DATA_HOME = path.join(fixture, ".local/share");
try {
  const store = new NotesStore(path.join(fixture, "notes"));
  const local = { ...createNote(), title: "Local", body: "Local notebook body", updatedAt: 2 };
  const research = {
    ...createNote("research"),
    title: "Research",
    body: "Research notebook body",
    updatedAt: 1,
    pinned: true,
  };
  store.save({
    ...store.load(),
    notebooks: [
      { id: "local", title: "Notes" },
      { id: "research", title: "Research" },
    ],
    notes: [local, research],
  });
  const app = await harness(
    (size, window) => (
      <NotesApp
        {...size}
        windowActions={window}
        store={store}
        onCloseGuard={(guard) => window.setCloseGuard(guard)}
      />
    ),
    1180,
    760,
  );
  const body = async () => {
    app.click(540, 260);
    app.key(30, "a", { ctrl: true });
    app.key(46, "c", { ctrl: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    return await readClipboardText();
  };
  try {
    assert.equal(await body(), local.body);
    app.click(80, 285); // Actual second notebook row, after the two views and section header.
    assert.equal(
      await body(),
      research.body,
      "switching notebook selects its visible note before editing",
    );
    app.key(107, "End", { ctrl: true });
    app.text(" amended");
    app.key(31, "s", { ctrl: true });
    assert.equal(store.load().notes.find((note) => note.id === local.id)?.body, local.body);
    assert.equal(
      store.load().notes.find((note) => note.id === research.id)?.body,
      research.body + " amended",
    );
    app.click(80, 132); // All notes.
    app.click(269, 118);
    app.text("Local");
    assert.equal(
      await body(),
      local.body,
      "search selects its matching note, never an invisible prior note",
    );
    // Delete the sole search match; no global note may appear under the empty result.
    await noteAction(app, 4);
    app.key(28, "Enter");
    await app.settle();
    assert.equal(store.load().notes.length, 1);
    app.click(540, 260);
    app.text("must not edit a hidden note");
    app.key(31, "s", { ctrl: true });
    assert.equal(store.load().notes[0]?.title, "Research");
    app.click(80, 681);
    app.text("Empty notebook");
    app.key(28, "Enter");
    const empty = store.load().notebooks.find((item) => item.title === "Empty notebook");
    assert.ok(empty);
    app.click(540, 260);
    app.text("also not hidden");
    app.key(31, "s", { ctrl: true });
    assert.equal(
      store.load().notes[0]?.body,
      research.body + " amended",
      "new empty notebook has no editor selection",
    );
    app.key(1, "Escape");
    await app.settle();
    app.key(49, "n", { ctrl: true });
    app.text("New notebook draft");
    app.key(31, "s", { ctrl: true });
    assert.equal(
      store.load().notes.find((note) => note.notebookId === empty.id)?.body,
      "New notebook draft",
    );
  } finally {
    app.destroy();
  }
  // Moving an edited note against a competing revision keeps its unsaved draft and current view.
  const conflicted = await harness(
    (size, window) => (
      <NotesApp
        {...size}
        windowActions={window}
        store={store}
        onCloseGuard={(guard) => window.setCloseGuard(guard)}
      />
    ),
    1180,
    760,
  );
  try {
    conflicted.text(" retained");
    const external = store.load();
    store.save({
      ...external,
      notes: external.notes.map((note) => ({ ...note, title: "External revision" })),
    });
    await noteAction(conflicted, 2);
    conflicted.key(28, "Enter");
    await conflicted.settle();
    conflicted.native.requestClose();
    conflicted.window.tick();
    assert.equal(
      conflicted.window.isClosed(),
      false,
      "failed move cannot discard a conflicting draft",
    );
    assert.ok(store.load().notes.every((note) => note.title === "External revision"));
  } finally {
    conflicted.destroy();
  }
  console.log(
    "[notes/selection] public Window notebook/search selection, empty/deleted results, new notebook draft and conflicting move preservation passed",
  );
} finally {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}

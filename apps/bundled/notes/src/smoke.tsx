import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { NotesStore, createNote, filterNotes } from "./store";
import { NotesApp } from "./main";
import { harness, noteAction } from "./testing";
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-notes-smoke-"));
try {
  const store = new NotesStore(fixture);
  let book = store.load();
  const first = { ...createNote(), title: "First", body: "hello" };
  book = store.save({ ...book, notes: [first] });
  assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
  const stale = { ...book };
  fs.writeFileSync(path.join(fixture, ".write-lock"), "2147483647");
  book = store.save({ ...book, notes: [{ ...first, body: "updated" }] });
  assert.throws(() => store.save(stale), /another window/);
  assert.equal(store.load().notes[0]?.body, "updated");
  const app = await harness((size, window) => (
    <NotesApp
      {...size}
      store={store}
      windowActions={window}
      onCloseGuard={(guard) => window.setCloseGuard(guard)}
    />
  ));
  app.key(28, "Enter");
  app.text("world");
  app.key(31, "s", { ctrl: true });
  assert.equal(store.load().notes[0]?.body, "updated\nworld");
  app.key(49, "n", { ctrl: true });
  app.text("second draft");
  app.key(31, "s", { ctrl: true });
  assert.equal(store.load().notes.length, 2);
  assert.ok(store.load().notes.some((note) => note.body === "second draft"));
  assert.equal(filterNotes(store.load().notes, "WORLD").length, 1);
  app.text(" close");
  app.native.requestClose();
  assert.equal(app.window.isClosed(), true);
  assert.ok(store.load().notes.some((note) => note.body.endsWith(" close")));
  app.destroy();
  const conflicted = await harness((size, window) => (
    <NotesApp
      {...size}
      store={store}
      windowActions={window}
      onCloseGuard={(guard) => window.setCloseGuard(guard)}
    />
  ));
  conflicted.text(" retained draft");
  const external = store.load();
  store.save({
    ...external,
    notes: external.notes.map((note, index) =>
      index === 0 ? { ...note, body: "external revision" } : note,
    ),
  });
  conflicted.native.requestClose();
  conflicted.window.tick();
  assert.equal(conflicted.window.isClosed(), false, "save conflict discarded an unsaved draft");
  assert.equal(store.load().notes[0]?.body, "external revision");
  // Explicitly discard the retained draft through the real Reload confirmation.
  await noteAction(conflicted, 3);
  conflicted.key(28, "Enter");
  await conflicted.settle();
  const count = store.load().notes.length;
  await noteAction(conflicted, 4);
  conflicted.key(28, "Enter");
  await conflicted.settle();
  assert.equal(
    store.load().notes.length,
    count - 1,
    "confirmed native note deletion did not persist",
  );
  conflicted.destroy();
  const before = fs.readFileSync(store.file, "utf8");
  fs.writeFileSync(store.file, "{ broken");
  assert.throws(() => store.load());
  assert.throws(() => store.save(book));
  assert.equal(fs.readFileSync(store.file, "utf8"), "{ broken");
  fs.writeFileSync(store.file, before);
  book = store.load();
  assert.equal(store.load().notes.length, 1);
  console.log(
    "Notes actual Window create/edit/save/native-close, persistence, search, deletion and revision conflicts passed",
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

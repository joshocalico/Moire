import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { NotesApp } from "./main";
import { readClipboardText } from "@moire/ui";
import { NotesStore } from "./store";
import { harness, noteAction } from "./testing";
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-rich-notes-"));
try {
  const store = new NotesStore(fixture);
  const v1 = JSON.stringify({
    version: 1,
    notes: [
      {
        id: "legacy",
        title: "Legacy thought",
        body: "quiet ideas\nKeep a 😀 close.",
        updatedAt: Date.now(),
      },
    ],
  });
  fs.writeFileSync(store.file, v1);
  const migrated = store.load();
  assert.equal(fs.readFileSync(store.file, "utf8"), v1, "reading v1 must preserve original bytes");
  assert.deepEqual(migrated.notes[0]?.runs, []);
  assert.equal(migrated.notes[0]?.notebookId, "local");
  const app = await harness(
    (size, window) => (
      <NotesApp
        {...size}
        store={store}
        windowActions={window}
        onCloseGuard={(guard) => window.setCloseGuard(guard)}
      />
    ),
    1180,
    760,
  );
  app.key(102, "Home", { ctrl: true });
  for (let i = 0; i < 5; i++) app.key(106, "ArrowRight", { shift: true });
  app.key(48, "b", { ctrl: true });
  app.key(22, "u", { ctrl: true });
  app.key(35, "h", { ctrl: true, shift: true });
  app.key(31, "s", { ctrl: true });
  assert.deepEqual(store.load().notes[0]?.runs, [
    { from: 0, to: 5, marks: { bold: true, underline: true, highlight: true } },
  ]);
  const serialized: unknown = JSON.parse(fs.readFileSync(store.file, "utf8"));
  assert.ok(
    typeof serialized === "object" &&
      serialized !== null &&
      "version" in serialized &&
      serialized.version === 2,
  );
  app.key(44, "z", { ctrl: true });
  app.key(31, "s", { ctrl: true });
  assert.equal(store.load().notes[0]?.runs[0]?.marks.highlight, false);
  app.key(44, "z", { ctrl: true, shift: true });
  app.text("useful");
  app.key(31, "s", { ctrl: true });
  assert.equal(store.load().notes[0]?.body, "useful ideas\nKeep a 😀 close.");
  assert.equal(store.load().notes[0]?.runs[0]?.to, 6);
  app.click(1157, 22); // Actual WindowFrame Close delegates through the native close guard.
  assert.equal(app.window.isClosed(), true);
  app.destroy();
  const reopened = await harness(
    (size, window) => (
      <NotesApp
        {...size}
        store={store}
        windowActions={window}
        onCloseGuard={(guard) => window.setCloseGuard(guard)}
      />
    ),
    1180,
    760,
  );
  assert.ok(reopened.native.lastFrame);
  const persistedFrame = Buffer.from(reopened.native.lastFrame);
  const plainStore = new NotesStore(path.join(fixture, "plain-pixel-oracle"));
  const persistedBook = store.load();
  plainStore.save({
    ...persistedBook,
    revision: null,
    notes: persistedBook.notes.map((item) => ({ ...item, runs: [] })),
  });
  const plainApp = await harness(
    (size, window) => <NotesApp {...size} store={plainStore} windowActions={window} />,
    1180,
    760,
  );
  assert.ok(plainApp.native.lastFrame);
  let styledPixels = 0;
  for (let y = 254; y < 282; y++)
    for (let x = 526; x < 640; x++) {
      const offset = (y * 1180 + x) * 4;
      if (
        persistedFrame
          .slice(offset, offset + 4)
          .compare(Buffer.from(plainApp.native.lastFrame.slice(offset, offset + 4))) !== 0
      )
        styledPixels++;
    }
  assert.ok(
    styledPixels > 100,
    `reopened actual Notes glyph region must paint saved bold/underline/highlight runs (${styledPixels} changed pixels)`,
  );
  console.log(
    `[notes/rich] saved styles changed ${styledPixels} actual reopened glyph-region pixels against independent plain Notes Window`,
  );
  plainApp.destroy();
  reopened.click(100, 22);
  assert.equal(reopened.native.moveRequests, 1);
  reopened.click(1097, 22);
  assert.equal(reopened.native.minimizeRequests, 1);
  reopened.click(1127, 22);
  assert.equal(reopened.window.isMaximized(), true);
  reopened.click(1127, 22);
  assert.equal(reopened.window.isMaximized(), false);
  reopened.click(540, 260);
  reopened.key(102, "Home", { ctrl: true });
  for (let i = 0; i < 6; i++) reopened.key(106, "ArrowRight", { shift: true });
  reopened.click(546, 220); // B in the floating toolbar anchored above the measured first-line selection.
  reopened.key(31, "s", { ctrl: true });
  assert.equal(
    store.load().notes[0]?.runs[0]?.marks.bold,
    false,
    "actual floating toolbar uses reopened persisted run state",
  );
  reopened.key(44, "z", { ctrl: true });
  reopened.key(31, "s", { ctrl: true });
  // Notebook creation, rename, pin and move all use the actual controls and persist real metadata.
  reopened.click(80, 681);
  reopened.text("Research");
  reopened.key(28, "Enter");
  assert.equal(store.load().notebooks.length, 2);
  const research = store.load().notebooks.find((item) => item.title === "Research");
  assert.ok(research);
  reopened.key(49, "n", { ctrl: true });
  assert.equal(store.load().notes[0]?.notebookId, research.id);
  await noteAction(reopened, 0);
  reopened.text("Lab plan");
  reopened.key(28, "Enter");
  reopened.click(532, 260);
  reopened.text("Experiment with a useful hypothesis.");
  await noteAction(reopened, 1);
  reopened.key(31, "s", { ctrl: true });
  let saved = store.load().notes[0];
  assert.ok(saved);
  assert.equal(saved.title, "Lab plan");
  assert.equal(saved.pinned, true);
  assert.equal(saved.body, "Experiment with a useful hypothesis.");
  await noteAction(reopened, 2);
  reopened.key(28, "Enter");
  await reopened.settle();
  saved = store.load().notes[0];
  assert.equal(saved?.notebookId, "local", "Move menu updates real notebook membership");
  // Search selects the real note; pin filtering and compact overlays retain this document while resizing.
  reopened.click(290, 312);
  reopened.click(540, 260);
  reopened.key(30, "a", { ctrl: true });
  reopened.key(46, "c", { ctrl: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    await readClipboardText(),
    "useful ideas\nKeep a 😀 close.",
    "collection selects the second persisted note",
  );
  reopened.click(80, 173);
  reopened.click(269, 118);
  reopened.text("hypothesis");
  reopened.click(290, 222);
  reopened.click(540, 260);
  reopened.key(30, "a", { ctrl: true });
  reopened.key(46, "c", { ctrl: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    await readClipboardText(),
    "Experiment with a useful hypothesis.",
    "pinned search selects the matching note rather than retaining the prior editor",
  );
  reopened.native.setSize(440, 640);
  reopened.window.tick();
  reopened.click(300, 66); // Editor pane button when navigation and collection collapse.
  reopened.click(45, 305);
  reopened.key(107, "End", { ctrl: true });
  reopened.text(" Retained after resize.");
  reopened.key(31, "s", { ctrl: true });
  assert.ok(
    store
      .load()
      .notes.some((item) => item.id === saved?.id && item.body.endsWith("Retained after resize.")),
  );
  // A competing revision blocks native close and leaves the formatted draft alive.
  reopened.text(" unsaved");
  const external = store.load();
  store.save({
    ...external,
    notes: external.notes.map((item) =>
      item.id === saved?.id ? { ...item, title: "External title" } : item,
    ),
  });
  reopened.click(417, 22);
  assert.equal(reopened.window.isClosed(), false, "WindowFrame close retains a conflicting draft");
  reopened.native.requestClose();
  reopened.window.tick();
  assert.equal(reopened.window.isClosed(), false);
  assert.equal(store.load().notes.find((item) => item.id === saved?.id)?.title, "External title");
  reopened.destroy();
  const good = fs.readFileSync(store.file, "utf8");
  const invalid = {
    version: 2,
    notebooks: store.load().notebooks,
    notes: [
      {
        ...store.load().notes[0],
        runs: [
          {
            from: 0,
            to: 2,
            marks: { bold: true, underline: false, highlight: false, italic: true },
          },
        ],
      },
    ],
  };
  fs.writeFileSync(store.file, JSON.stringify(invalid));
  assert.throws(() => store.load(), /marks|unsupported|format/i);
  assert.equal(fs.readFileSync(store.file, "utf8"), JSON.stringify(invalid));
  fs.writeFileSync(store.file, good);
  const oversized = store.load();
  assert.throws(
    () =>
      store.save({
        ...oversized,
        notes: oversized.notes.map((item, index) =>
          index === 0 ? { ...item, body: "x".repeat(10 * 1024 * 1024), runs: [] } : item,
        ),
      }),
    /10 MiB/,
  );
  assert.equal(
    fs.readFileSync(store.file, "utf8"),
    good,
    "oversized save preserves the prior valid storage",
  );
  assert.equal(
    fs.readdirSync(fixture).filter((name) => name.startsWith(".notes-") || name === ".write-lock")
      .length,
    0,
  );
  console.log(
    "Notes real Window rich save/reopen/range undo, v1 migration, notebook create/move/pin/search, compact resize and native conflict close guard passed",
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

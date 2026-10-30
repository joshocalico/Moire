/**
 * Text Editor: atomic, conflict-checked file I/O, then real Window workflows — save, Save As and
 * Open through the shared chooser, the close guard, per-document Undo, find/replace, go to line,
 * line wrapping and recent files.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { EditorApp } from "./main";
import { blankDocument, openDocument, saveDocument, MAX_DOCUMENT_BYTES } from "./backend";
import { harness } from "./testing";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-editor-smoke-"));
const previous = Object.fromEntries(
  ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "TMPDIR"].map((name) => [
    name,
    process.env[name],
  ]),
);
for (const [name, value] of Object.entries({
  HOME: fixture,
  XDG_CONFIG_HOME: path.join(fixture, "config"),
  XDG_DATA_HOME: path.join(fixture, "data"),
  XDG_STATE_HOME: path.join(fixture, "state"),
  TMPDIR: path.join(fixture, "tmp"),
})) {
  fs.mkdirSync(value, { recursive: true });
  process.env[name] = value;
}
const KEY = { a: 30, f: 33, g: 34, h: 35, n: 49, o: 24, s: 31, z: 44 } as const;
const ENTER = 28,
  ESCAPE = 1,
  BACKSPACE = 14;

/** Mount the editor on a document; `title` follows the window title. */
async function editorWindow(initial: string, width = 800) {
  let title = "";
  const app = await harness(
    (size, window) => (
      <EditorApp
        {...size}
        initialDocument={openDocument(initial)}
        onClose={() => window.destroy()}
        onTitleChange={(next) => {
          title = next;
          window.setTitle(next);
        }}
        onCloseGuard={(guard) => window.setCloseGuard(guard)}
      />
    ),
    width,
  );
  await app.settle();
  /** Click into the document so keys reach the text area. */
  const focusDocument = () => app.click(160, 200);
  /** Open through the chooser: Ctrl+O, Edit the location, type the file, Enter. */
  const open = async (file: string) => {
    app.key(KEY.o, "o", { ctrl: true });
    await app.settle();
    await app.press({ text: "Edit" });
    app.key(KEY.a, "a", { ctrl: true });
    app.text(file);
    app.key(ENTER, "Enter");
    await app.settle();
  };
  /** Save As through the chooser: an absolute path typed as the name is used as is. */
  const saveAs = async (file: string) => {
    app.key(KEY.s, "s", { ctrl: true, shift: true });
    await app.settle();
    assert.ok(app.texts().includes("Save document as"), "Save As opens the shared chooser");
    await app.press({ focusId: "file-chooser:name" });
    app.key(KEY.a, "a", { ctrl: true });
    app.text(file);
    app.key(ENTER, "Enter");
    await app.settle();
  };
  return { ...app, title: () => title, focusDocument, open, saveAs };
}

try {
  // Backend: atomic save keeps permissions, refuses outside changes, binary and oversize files.
  const file = path.join(fixture, "first document.txt");
  fs.writeFileSync(file, "hello", { mode: 0o640 });
  // Creation modes are filtered by the host umask; establish the actual source mode.
  fs.chmodSync(file, 0o640);
  const opened = openDocument(pathToFileURL(file).href);
  assert.equal(opened.text, "hello");
  const previousUmask = process.umask(0o077);
  try {
    assert.equal(saveDocument({ ...opened, text: "saved" }).text, "saved");
  } finally {
    process.umask(previousUmask);
  }
  assert.equal(fs.readFileSync(file, "utf8"), "saved");
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  fs.writeFileSync(file, "outside change");
  assert.throws(() => saveDocument({ ...opened, text: "unsafe" }), /changed outside/);
  assert.equal(fs.readFileSync(file, "utf8"), "outside change");
  const invalid = path.join(fixture, "invalid.txt");
  fs.writeFileSync(invalid, Buffer.from([255, 0]));
  assert.throws(() => openDocument(invalid));
  assert.throws(
    () => saveDocument({ ...blankDocument(), text: "replace" }, file),
    /already exists/,
  );

  // Save, Save As through the chooser, and the unsaved-changes guard on close.
  {
    const app = await editorWindow(file);
    app.focusDocument();
    app.key(107, "End", { ctrl: true });
    app.key(ENTER, "Enter");
    app.text("second line");
    app.key(KEY.s, "s", { ctrl: true });
    assert.equal(fs.readFileSync(file, "utf8"), "outside change\nsecond line");
    const copy = path.join(fixture, "saved as.txt");
    await app.saveAs(copy);
    assert.equal(fs.readFileSync(copy, "utf8"), "outside change\nsecond line");
    assert.match(app.title(), /saved as\.txt/, "the window follows the saved-as file");
    app.focusDocument();
    app.key(107, "End", { ctrl: true });
    app.text(" draft");
    app.native.requestClose();
    app.window.tick();
    await app.settle();
    assert.equal(app.window.isClosed(), false, "native close kept unsaved text");
    assert.ok(app.texts().includes("Save changes before leaving?"));
    app.key(ESCAPE, "Escape");
    await app.settle();
    assert.equal(app.window.isClosed(), false);
    app.key(KEY.s, "s", { ctrl: true });
    assert.match(fs.readFileSync(copy, "utf8"), /draft$/);
    app.native.requestClose();
    assert.equal(app.window.isClosed(), true, "a saved document closes normally");
    app.destroy();
  }

  // Each opened document has its own Undo; a failed open keeps the current one intact.
  {
    const first = path.join(fixture, "buffer-first.txt"),
      second = path.join(fixture, "buffer-second.txt");
    fs.writeFileSync(first, "A");
    fs.writeFileSync(second, "B");
    const editor = await editorWindow(first);
    try {
      editor.focusDocument();
      editor.key(KEY.a, "a", { ctrl: true });
      editor.text("B");
      editor.key(KEY.s, "s", { ctrl: true });
      await editor.open(second);
      assert.match(editor.title(), /buffer-second/);
      editor.focusDocument();
      editor.key(KEY.z, "z", { ctrl: true });
      editor.key(KEY.s, "s", { ctrl: true });
      assert.equal(
        fs.readFileSync(second, "utf8"),
        "B",
        "Open with equal content must not carry another document's Undo",
      );
      editor.key(KEY.a, "a", { ctrl: true });
      editor.text("C");
      editor.key(KEY.s, "s", { ctrl: true });
      await editor.open(invalid);
      assert.ok(
        editor.texts().some((text) => text.startsWith("Couldn't open invalid.txt")),
        "a failed open says why in the status line",
      );
      editor.focusDocument();
      editor.key(KEY.z, "z", { ctrl: true });
      editor.key(KEY.s, "s", { ctrl: true });
      assert.equal(fs.readFileSync(second, "utf8"), "B", "failed Open preserves the buffer's Undo");
      editor.key(KEY.a, "a", { ctrl: true });
      editor.text("C");
      const savedAs = path.join(fixture, "same-buffer-save-as.txt");
      await editor.saveAs(savedAs);
      editor.focusDocument();
      editor.key(KEY.z, "z", { ctrl: true });
      editor.key(KEY.s, "s", { ctrl: true });
      assert.equal(fs.readFileSync(savedAs, "utf8"), "B", "Save As preserves this buffer's Undo");
      editor.key(KEY.a, "a", { ctrl: true });
      editor.key(BACKSPACE, "Backspace");
      editor.key(KEY.s, "s", { ctrl: true });
      assert.equal(fs.readFileSync(savedAs, "utf8"), "");
      editor.key(KEY.n, "n", { ctrl: true });
      await editor.settle();
      editor.focusDocument();
      editor.key(KEY.z, "z", { ctrl: true });
      editor.text("new buffer");
      // Saving an untitled document asks where, through the chooser.
      const fresh = path.join(fixture, "new-buffer.txt");
      editor.key(KEY.s, "s", { ctrl: true });
      await editor.settle();
      await editor.press({ focusId: "file-chooser:name" });
      editor.key(KEY.a, "a", { ctrl: true });
      editor.text(fresh);
      editor.key(ENTER, "Enter");
      await editor.settle();
      assert.equal(
        fs.readFileSync(fresh, "utf8"),
        "new buffer",
        "New starts a separate empty history",
      );
      // Recent files: the More menu reopens an earlier document.
      await editor.press({ focusId: "editor:more" });
      await editor.press({ text: "Open Recent" });
      assert.ok(editor.texts().includes("buffer-second.txt"), "recent files are listed");
      await editor.press({ text: "buffer-second.txt" });
      assert.match(editor.title(), /buffer-second/, "a recent file opens from the menu");
    } finally {
      editor.destroy();
    }
  }

  // Find, next/previous with a match count, replace one, replace all (one Undo step).
  {
    const prose = path.join(fixture, "prose.txt");
    fs.writeFileSync(prose, "alpha beta Alpha gamma alpha\ndelta alpha");
    const app = await editorWindow(prose);
    app.key(KEY.f, "f", { ctrl: true });
    await app.settle();
    for (const character of "alpha") app.text(character);
    await app.settle();
    assert.ok(app.texts().includes("1 of 4"), "typing finds the first match and counts them");
    app.key(ENTER, "Enter");
    await app.settle();
    assert.ok(app.texts().includes("2 of 4"), "Enter moves to the next match");
    app.key(ENTER, "Enter", { shift: true });
    await app.settle();
    assert.ok(app.texts().includes("1 of 4"), "Shift+Enter moves back");
    await app.press({ focusId: "editor:find-previous" });
    assert.ok(app.texts().includes("4 of 4"), "previous wraps to the last match");
    await app.press({ focusId: "editor:find-case" });
    assert.ok(
      app.texts().some((text) => text.endsWith("of 3")),
      "match case narrows the count",
    );
    await app.press({ focusId: "editor:find-case" });
    app.key(KEY.h, "h", { ctrl: true });
    await app.settle();
    await app.press({ focusId: "editor:replace" });
    app.text("omega");
    await app.press({ focusId: "editor:find-next" });
    const before = app.texts().find((text) => text.endsWith(" of 4"));
    await app.press({ focusId: "editor:replace-one" });
    app.key(KEY.s, "s", { ctrl: true });
    assert.equal(
      fs.readFileSync(prose, "utf8").split("omega").length,
      2,
      `Replace changes only the selected match (${before})`,
    );
    assert.ok(app.texts().includes("1 of 3") || app.texts().some((text) => text.endsWith(" of 3")));
    await app.press({ focusId: "editor:replace-all" });
    assert.ok(app.texts().includes("Replaced 3 matches"));
    assert.ok(app.texts().includes("No results"), "the count follows the edited text");
    app.key(KEY.s, "s", { ctrl: true });
    assert.equal(fs.readFileSync(prose, "utf8"), "omega beta omega gamma omega\ndelta omega");
    app.key(ESCAPE, "Escape");
    await app.settle();
    assert.ok(!app.texts().includes("No results"), "Escape closes the find row");
    app.key(KEY.z, "z", { ctrl: true });
    app.key(KEY.s, "s", { ctrl: true });
    assert.equal(
      fs.readFileSync(prose, "utf8").split("omega").length,
      2,
      "Replace All is one Undo step, and focus is back in the document",
    );
    app.destroy();
  }

  // Go to line (with a bounded error), and wrapping long lines from the menu.
  {
    const long = path.join(fixture, "long.txt");
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
    fs.writeFileSync(
      long,
      [words, ...Array.from({ length: 79 }, (_, index) => `line ${index + 2}`)].join("\n"),
    );
    const app = await editorWindow(long);
    assert.ok(app.texts().includes("Ln 1, Col 1 · 80 lines"), "a file opens at its first line");
    app.key(KEY.g, "g", { ctrl: true });
    await app.settle();
    app.text("200");
    app.key(ENTER, "Enter");
    await app.settle();
    assert.ok(app.texts().includes("Enter a line number from 1 to 80."));
    app.key(KEY.a, "a", { ctrl: true });
    app.text("70");
    app.key(ENTER, "Enter");
    await app.settle();
    assert.ok(app.texts().includes("Ln 70, Col 1 · 80 lines"), "Go to Line moves the caret");
    assert.ok(app.texts().includes("line 70"), "and scrolls the line into view");
    app.text("X");
    app.key(KEY.s, "s", { ctrl: true });
    assert.match(fs.readFileSync(long, "utf8"), /\nXline 70\n/, "typing continues at that line");
    app.key(KEY.g, "g", { ctrl: true });
    await app.settle();
    app.text("1");
    app.key(ENTER, "Enter");
    await app.settle();
    const rows = () => app.texts().filter((text) => text.includes("word")).length;
    assert.ok(rows() > 1, "long lines wrap by default");
    await app.press({ focusId: "editor:more" });
    await app.press({ text: "Wrap Lines" });
    assert.equal(rows(), 1, "turning wrapping off keeps a line on one row");
    app.destroy();
    const reopened = await editorWindow(long);
    assert.equal(
      reopened.texts().filter((text) => text.includes("word")).length,
      1,
      "the wrapping choice is remembered",
    );
    reopened.destroy();
  }

  const limitFile = path.join(fixture, "limit.txt");
  const exact = "é".repeat(MAX_DOCUMENT_BYTES / 2);
  saveDocument({ ...blankDocument(), text: exact }, limitFile);
  assert.equal(openDocument(limitFile).text, exact, "every saved limit-sized file reopens");
  const openedLimit = openDocument(limitFile);
  assert.throws(() => saveDocument({ ...openedLimit, text: exact + "é" }), /5 MiB/);
  assert.equal(
    fs.readFileSync(limitFile, "utf8"),
    exact,
    "oversized UTF-8 save preserves existing bytes",
  );
  const tooLarge = path.join(fixture, "too-large.txt");
  assert.throws(
    () => saveDocument({ ...blankDocument(), text: "x".repeat(MAX_DOCUMENT_BYTES + 1) }, tooLarge),
    /5 MiB/,
  );
  assert.equal(fs.existsSync(tooLarge), false);
  assert.deepEqual(
    fs.readdirSync(fixture).filter((name) => name.endsWith(".tmp")),
    [],
  );
  console.log(
    "[editor] atomic I/O, chooser Save As/Open, close guard, per-document Undo, find/replace, go to line, wrap and recent files passed",
  );
} finally {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}

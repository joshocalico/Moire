import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { EditorApp } from "./main";
import { blankDocument, openDocument, saveDocument, MAX_DOCUMENT_BYTES } from "./documents";
import { harness } from "./testing";
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-editor-smoke-"));
const previous = Object.fromEntries(
  ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "TMPDIR"].map((name) => [name, process.env[name]]),
);
for (const [name, value] of Object.entries({
  HOME: fixture,
  XDG_CONFIG_HOME: path.join(fixture, "config"),
  XDG_DATA_HOME: path.join(fixture, "data"),
  TMPDIR: path.join(fixture, "tmp"),
})) {
  fs.mkdirSync(value, { recursive: true });
  process.env[name] = value;
}
try {
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
  const invalid = path.join(fixture, "invalid");
  fs.writeFileSync(invalid, Buffer.from([255, 0]));
  assert.throws(() => openDocument(invalid));
  assert.throws(
    () => saveDocument({ ...blankDocument(), text: "replace" }, file),
    /already exists/,
  );
  const app = await harness((size, window) => (
    <EditorApp
      {...size}
      initialDocument={openDocument(file)}
      onClose={() => window.destroy()}
      onTitleChange={(title) => window.setTitle(title)}
      onCloseGuard={(guard) => window.setCloseGuard(guard)}
    />
  ));
  app.key(28, "Enter");
  app.text("second line");
  app.key(31, "s", { ctrl: true });
  assert.equal(fs.readFileSync(file, "utf8"), "outside change\nsecond line");
  const copy = path.join(fixture, "saved as.txt");
  app.key(31, "s", { ctrl: true, shift: true });
  await app.settle();
  app.key(30, "a", { ctrl: true });
  app.text(copy);
  app.key(28, "Enter");
  await app.settle();
  assert.equal(fs.readFileSync(copy, "utf8"), "outside change\nsecond line");
  app.text(" draft");
  app.native.requestClose();
  app.window.tick();
  await app.settle();
  assert.equal(app.window.isClosed(), false, "native close discarded unsaved text");
  app.key(1, "Escape");
  await app.settle();
  assert.equal(app.window.isClosed(), false);
  app.key(31, "s", { ctrl: true });
  assert.match(fs.readFileSync(copy, "utf8"), /draft$/);
  app.native.requestClose();
  assert.equal(app.window.isClosed(), true, "saved document prevented normal close");
  app.destroy();
  const first = path.join(fixture, "buffer-first.txt"),
    second = path.join(fixture, "buffer-second.txt");
  fs.writeFileSync(first, "A");
  fs.writeFileSync(second, "B");
  let documentTitle = "";
  const editor = await harness((size, window) => (
    <EditorApp
      {...size}
      initialDocument={openDocument(first)}
      onClose={() => window.destroy()}
      onTitleChange={(title) => {
        documentTitle = title;
        window.setTitle(title);
      }}
    />
  ));
  try {
    await editor.settle();
    editor.key(30, "a", { ctrl: true });
    editor.text("B");
    editor.key(31, "s", { ctrl: true });
    const open = async (target: string) => {
      editor.key(24, "o", { ctrl: true });
      await editor.settle();
      editor.key(30, "a", { ctrl: true });
      editor.text(target);
      editor.key(28, "Enter");
      await editor.settle();
    };
    await open(second);
    assert.match(documentTitle, /buffer-second/);
    editor.click(160, 160);
    editor.key(44, "z", { ctrl: true });
    editor.key(31, "s", { ctrl: true });
    assert.equal(
      fs.readFileSync(second, "utf8"),
      "B",
      "Open with equal content must not carry another document's Undo",
    );
    editor.key(30, "a", { ctrl: true });
    editor.text("C");
    editor.key(31, "s", { ctrl: true });
    await open(path.join(fixture, "missing.txt"));
    editor.key(1, "Escape");
    await editor.settle();
    editor.click(160, 160);
    editor.key(44, "z", { ctrl: true });
    editor.key(31, "s", { ctrl: true });
    assert.equal(fs.readFileSync(second, "utf8"), "B", "failed Open preserves the buffer's Undo");
    editor.key(30, "a", { ctrl: true });
    editor.text("C");
    const savedAs = path.join(fixture, "same-buffer-save-as.txt");
    editor.key(31, "s", { ctrl: true, shift: true });
    await editor.settle();
    editor.key(30, "a", { ctrl: true });
    editor.text(savedAs);
    editor.key(28, "Enter");
    await editor.settle();
    editor.click(160, 160);
    editor.key(44, "z", { ctrl: true });
    editor.key(31, "s", { ctrl: true });
    assert.equal(fs.readFileSync(savedAs, "utf8"), "B", "Save As preserves this buffer's Undo");
    editor.key(30, "a", { ctrl: true });
    editor.key(14, "Backspace");
    editor.key(31, "s", { ctrl: true });
    assert.equal(fs.readFileSync(savedAs, "utf8"), "");
    editor.key(49, "n", { ctrl: true });
    await editor.settle();
    editor.click(160, 160);
    editor.key(44, "z", { ctrl: true });
    editor.text("new buffer");
    editor.key(31, "s", { ctrl: true });
    await editor.settle();
    const fresh = path.join(fixture, "new-buffer.txt");
    editor.text(fresh);
    editor.key(28, "Enter");
    await editor.settle();
    assert.equal(
      fs.readFileSync(fresh, "utf8"),
      "new buffer",
      "New starts a separate empty history",
    );
  } finally {
    editor.destroy();
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
    "Editor actual Window multiline/save/save-as/close guard and atomic conflict checks passed",
  );
} finally {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}

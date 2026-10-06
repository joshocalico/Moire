import assert from "node:assert/strict";
import React, { useState } from "react";
import {
  DocumentEditor,
  plainDocument,
  Window,
  installUiFonts,
  writeClipboardText,
  readClipboardText,
  type DocumentValue,
  type DocumentSelectionGeometry,
  setUiScaleFactor,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";
import { placeSelectionToolbar } from "./widgets/selection-toolbar";

await installUiFonts();
for (const ui of [1, 1.5]) {
  setUiScaleFactor(ui);
  const backend = new HeadlessPlatform();
  await backend.connect();
  let value: DocumentValue = plainDocument(
    "quiet notes\nA 😀 idea\n" + "A measured line for scrolling and wrapping.\n".repeat(15),
  );
  const observed: { current: DocumentSelectionGeometry | null } = { current: null };
  let toolbar = false;
  function Fixture({ width, height }: { width: number; height: number }) {
    const [document, setDocument] = useState(value);
    return (
      <DocumentEditor
        width={width}
        height={height}
        value={document}
        autoFocus
        selectionToolbar={toolbar}
        onSelectionChange={(next) => {
          observed.current = next;
        }}
        onChange={(next) => {
          value = next;
          setDocument(next);
        }}
      />
    );
  }
  const window = new Window({
    title: "Document selection",
    width: 500 * ui,
    height: 220 * ui,
    decorated: false,
  });
  window.setContent((size) => <Fixture {...size} />);
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0]!;
  const key = (
    code: number,
    name: string,
    options: { ctrl?: boolean; shift?: boolean; text?: string } = {},
  ) => {
    native.injectKey({
      type: "down",
      code,
      key: name,
      text: options.text,
      timeMs: 1,
      modifiers: {
        ctrl: options.ctrl ?? false,
        shift: options.shift ?? false,
        alt: false,
        meta: false,
      },
    });
    window.tick();
  };
  const frame = () => {
    assert.ok(native.lastFrame);
    return Buffer.from(native.lastFrame);
  };
  const selectQuiet = () => {
    key(102, "Home", { ctrl: true });
    for (let i = 0; i < 5; i++) key(106, "ArrowRight", { shift: true });
  };
  selectQuiet();
  const plainFrame = frame();
  key(48, "b", { ctrl: true });
  assert.deepEqual(
    value.runs.map((run) => [run.from, run.to, run.marks.bold]),
    [[0, 5, true]],
  );
  assert.notDeepEqual(frame(), plainFrame, "persisted bold run must change actual painted pixels");
  key(44, "z", { ctrl: true });
  assert.equal(value.runs.length, 0);
  assert.deepEqual(frame(), plainFrame, "undo restores actual glyphs, selection and layout");
  key(44, "z", { ctrl: true, shift: true });
  assert.equal(value.runs[0]?.marks.bold, true);
  key(22, "u", { ctrl: true });
  assert.equal(value.runs[0]?.marks.underline, true);
  key(35, "h", { ctrl: true, shift: true });
  assert.equal(value.runs[0]?.marks.highlight, true);
  key(46, "c", { ctrl: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await readClipboardText(), "quiet");
  await writeClipboardText("calm 😀");
  key(47, "v", { ctrl: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  window.tick();
  assert.ok(value.text.startsWith("calm 😀 notes"));
  assert.equal(value.runs[0]?.to, 7, "pasted text inherits actual selected style");
  key(14, "Backspace");
  assert.ok(
    value.text.startsWith("calm  notes"),
    "backspace removes the emoji code point together",
  );
  key(44, "z", { ctrl: true });
  assert.ok(value.text.startsWith("calm 😀 notes"));
  // Pointer selection uses the same measured layout as painting, and the floating control preserves keyboard focus.
  toolbar = true;
  window.requestRedraw();
  window.tick();
  key(102, "Home", { ctrl: true });
  assert.ok(observed.current);
  const firstLineY = observed.current.caret.y + 2 * ui;
  native.injectPointer({ type: "down", x: 14 * ui, y: firstLineY, button: "left", timeMs: 1 });
  native.injectPointer({ type: "move", x: 48 * ui, y: firstLineY, timeMs: 2 });
  native.injectPointer({ type: "up", x: 48 * ui, y: firstLineY, button: "left", timeMs: 3 });
  window.tick();
  assert.ok(observed.current);
  const pointerGeometry: DocumentSelectionGeometry = observed.current;
  assert.ok(pointerGeometry.selection.focus > pointerGeometry.selection.anchor);
  assert.ok(pointerGeometry.rects.length > 0);
  assert.ok(pointerGeometry.toolbar);
  const position = pointerGeometry.toolbar;
  const assertGlyphClearance = () => {
    assert.ok(observed.current);
    const selected: DocumentSelectionGeometry = observed.current;
    assert.ok(selected.toolbar && selected.rects[0]);
    assert.ok(
      selected.toolbar.y + selected.toolbar.height < selected.rects[0].y,
      "toolbar must fit above the first visible selected glyph row",
    );
    const painted = frame(),
      top = Math.floor(selected.rects[0].y),
      width = window.getWidth();
    const rows = Math.floor(Math.min(120 * ui, window.getHeight() - top - 14 * ui));
    toolbar = false;
    window.requestRedraw();
    window.tick();
    assert.ok(observed.current);
    const without: DocumentSelectionGeometry = observed.current;
    const unoccluded = frame(),
      oracleTop = Math.floor(without.rects[0]!.y);
    for (let y = 0; y < rows; y++) {
      const start = ((top + y) * width + Math.floor(14 * ui)) * 4;
      const oracle = ((oracleTop + y) * width + Math.floor(14 * ui)) * 4;
      const bytes = Math.floor(width - 28 * ui) * 4;
      assert.deepEqual(
        painted.subarray(start, start + bytes),
        unoccluded.subarray(oracle, oracle + bytes),
        "actual selected and following glyph regions must match an independently unoccluded toolbar-free frame",
      );
    }
    toolbar = true;
    window.requestRedraw();
    window.tick();
  };
  assertGlyphClearance();
  native.injectPointer({
    type: "down",
    x: position.x + 20 * ui,
    y: position.y + 18 * ui,
    button: "left",
    timeMs: 4,
  });
  native.injectPointer({
    type: "up",
    x: position.x + 20 * ui,
    y: position.y + 18 * ui,
    button: "left",
    timeMs: 5,
  });
  window.tick();
  const selectionEnd = pointerGeometry.selection.focus;
  const oldLength = value.text.length;
  key(0, "X", { text: "X" });
  assert.equal(
    value.text.length,
    oldLength - selectionEnd + 1,
    "toolbar click keeps editor selection and typing focus",
  );
  assert.ok(value.text.startsWith("X"));
  native.setSize(190 * ui, 260 * ui);
  window.tick();
  key(102, "Home", { ctrl: true });
  for (let i = 0; i < 40; i++) key(106, "ArrowRight", { shift: true });
  assert.ok(observed.current);
  assert.ok(
    observed.current.rects.length > 1,
    "compact fixture must select actual wrapped glyph rows",
  );
  assertGlyphClearance();
  // Caret, visible selection and toolbar anchor are recomputed after scrolling and native configure.
  key(107, "End", { ctrl: true });
  key(103, "ArrowUp", { shift: true });
  assert.ok(observed.current);
  const scrolled: DocumentSelectionGeometry = observed.current;
  assert.ok(scrolled.scrollY > 0);
  assert.ok(scrolled.rects.length > 0, "scroll fixture must contain a visible actual selection");
  native.injectPointer({ type: "wheel", x: 120 * ui, y: 120 * ui, deltaY: -12 * ui, timeMs: 6 });
  window.tick();
  assert.ok(observed.current);
  const wheeled: DocumentSelectionGeometry = observed.current;
  assert.equal(wheeled.selection.focus, scrolled.selection.focus);
  assert.ok(wheeled.scrollY < scrolled.scrollY);
  assert.ok(
    wheeled.rects[0]!.y > scrolled.rects[0]!.y,
    "wheel scrolling moves the actual rendered selection anchor",
  );
  native.setSize(230 * ui, 170 * ui);
  window.tick();
  assert.ok(observed.current);
  const resized: DocumentSelectionGeometry = observed.current;
  assert.ok(resized.rects.length > 0);
  assert.ok(resized.caret.y <= 170 * ui && resized.caret.y >= 0);
  for (const rect of resized.rects) {
    assert.ok(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= 230 * ui &&
        rect.y + rect.height <= 170 * ui,
    );
  }
  const narrow = placeSelectionToolbar(
    { x: 3, y: 10, width: 10, height: 20 },
    { width: 80, height: 160 },
    { width: 64, height: 94 },
  );
  assert.ok(narrow.x >= 0 && narrow.x + 64 <= 80 && narrow.y >= 0 && narrow.y + 94 <= 160);
  window.destroy();
  backend.disconnect();
  console.log(`[document-editor] actual Window scale ${ui} passed`);
}
setUiScaleFactor(1);
console.log(
  "DocumentEditor actual Window styled pixels, range undo/redo, pointer toolbar focus, clipboard, Unicode, scroll and native resize passed",
);

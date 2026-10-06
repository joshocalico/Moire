/* eslint-disable import/no-relative-parent-imports -- Integration captures own disposable fixtures, not app dependencies. */
/** Real headless Window captures; all note storage is a disposable fixture. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import React from "react";
import { PNG } from "pngjs";
import { setUiScaleFactor } from "@moire/ui";
import { NotesApp } from "../../../apps/bundled/notes/src/main";
import { NotesStore, createNote } from "../../../apps/bundled/notes/src/store";
import { harness } from "../../../apps/bundled/notes/src/testing";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-notes-gallery-"));
const output =
  process.env.MOIRE_NOTES_GALLERY ?? path.join(os.tmpdir(), "moire-notes-document-gallery");
fs.mkdirSync(output, { recursive: true });
const sizes: ReadonlyArray<readonly [string, number, number]> = [
  ["wide", 1180, 760],
  ["compact", 440, 640],
];
try {
  for (const scale of [1, 1.5])
    for (const [name, logicalWidth, logicalHeight] of sizes) {
      setUiScaleFactor(scale);
      const store = new NotesStore(path.join(directory, `${name}-${scale}`));
      store.save({
        ...store.load(),
        notes: [
          {
            ...createNote(),
            title: "A quiet place for good ideas",
            body: "A notebook can hold a thought before it has become a plan.\n\nKeep the useful details close. Select these words to give an idea a little emphasis, then keep writing.\n\nTomorrow\nTake a walk, return to this page, and see what still matters.",
          },
          {
            ...createNote(),
            title: "Weekend reading",
            body: "Small essays, useful questions, and a few things worth coming back to.",
          },
        ],
      });
      const width = logicalWidth * scale,
        height = logicalHeight * scale;
      const app = await harness(
        (size, window) => <NotesApp {...size} store={store} windowActions={window} />,
        width,
        height,
      );
      const saveFrame = (suffix: string) => {
        assert.ok(app.native.lastFrame);
        const png = new PNG({ width, height });
        for (let i = 0; i < app.native.lastFrame.length; i += 4) {
          png.data[i] = app.native.lastFrame[i + 2]!;
          png.data[i + 1] = app.native.lastFrame[i + 1]!;
          png.data[i + 2] = app.native.lastFrame[i]!;
          png.data[i + 3] = app.native.lastFrame[i + 3]!;
        }
        fs.writeFileSync(
          path.join(output, `${name}-scale${scale}${suffix}.png`),
          PNG.sync.write(png),
        );
      };
      await app.settle();
      saveFrame("");
      app.key(102, "Home", { ctrl: true });
      for (let i = 0; i < 10; i++) app.key(106, "ArrowRight", { shift: true });
      app.key(48, "b", { ctrl: true });
      app.key(22, "u", { ctrl: true });
      app.key(35, "h", { ctrl: true, shift: true });
      app.key(31, "s", { ctrl: true });
      assert.equal(store.load().notes[0]?.runs[0]?.to, 10);
      saveFrame("-selection");
      // Styled wrap after native resize uses retained document state and selection, rather than a rebuilt fixture.
      app.native.setSize(360 * scale, 600 * scale);
      app.window.tick();
      saveFrame("-resized-selection");
      app.destroy();
    }
  console.log(
    `Actual Notes Window wide/compact/selection/resize at scales 1 and 1.5 written to ${output}`,
  );
} finally {
  setUiScaleFactor(1);
  fs.rmSync(directory, { recursive: true, force: true });
}

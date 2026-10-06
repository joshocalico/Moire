import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import {
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  setUiScaleFactor,
} from "@moire/ui";
import { NotesStore, createNote } from "./store";
import { harness } from "./testing";
const source = process.env.MOIRE_TEST_ROOT;
const { NotesApp }: typeof import("./main") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/notes/src/main.tsx")).href)
  : await import("./main");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-notes-empty-"));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
process.env.XDG_DATA_HOME = path.join(fixture, ".local/share");
const output =
  process.env.MOIRE_CAPTURE_DIR ??
  fs.mkdtempSync(path.join(os.tmpdir(), "moire-notes-empty-captures-"));
try {
  for (const scheme of ["dark", "light"] as const)
    for (const scale of [1, 1.5]) {
      setUiScaleFactor(scale);
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", {
          themeFamily: "moire",
          colorScheme: scheme,
          reducedMotion: true,
        }),
      );
      const width = 880 * scale,
        height = 640 * scale;
      const empty = new NotesStore(path.join(fixture, `empty-${scheme}-${scale}`));
      const populated = new NotesStore(path.join(fixture, `populated-${scheme}-${scale}`));
      populated.save({
        ...populated.load(),
        notes: [{ ...createNote(), title: "Title slot", body: "Normal document content" }],
      });
      const launch = (store: NotesStore) =>
        harness(
          (size, window) => (
            <WidgetThemeProvider theme={theme}>
              <NotesApp {...size} store={store} windowActions={window} />
            </WidgetThemeProvider>
          ),
          width,
          height,
        );
      const app = await launch(empty);
      const comparison = await launch(populated);
      try {
        await app.settle();
        await comparison.settle();
        await app.capture(path.join(output, `notes-empty-${scheme}-scale${scale}.png`));
        const crop = (frame: Uint8Array) => {
          const pixels: number[] = [];
          // The real Save/More allocation is identical for empty and populated documents.
          // Empty prose must not paint into those controls; no private React scene is read.
          for (let y = 56 * scale; y < 88 * scale; y++)
            for (let x = width - 90 * scale; x < width - 10 * scale; x++) {
              const at = (y * width + x) * 4;
              pixels.push(...frame.slice(at, at + 4));
            }
          return Buffer.from(pixels);
        };
        assert.equal(
          Buffer.compare(crop(app.native.lastFrame!), crop(comparison.native.lastFrame!)),
          0,
          "actual empty Notes text must leave Save/More pixels unchanged against the independent populated Window header",
        );
        assert.equal(
          empty.load().notes.length,
          0,
          "empty layout check must not create a placeholder note",
        );
        app.key(49, "n", { ctrl: true });
        app.text("A real first note");
        app.key(31, "s", { ctrl: true });
        assert.equal(empty.load().notes[0]?.body, "A real first note");
      } finally {
        app.destroy();
        comparison.destroy();
      }
    }
  console.log(
    JSON.stringify({
      kind: "notes-empty-state",
      source: source ?? "workspace",
      output,
      cases: 4,
      scope:
        "actual public Window pixel/control and first-note persistence; native capture remains Root-owned",
    }),
  );
} finally {
  setUiScaleFactor(1);
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}

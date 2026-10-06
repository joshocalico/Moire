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
} from "@moire/ui";
import { harness } from "./testing";
const source = process.env.MOIRE_TEST_ROOT;
const { NotesApp }: typeof import("./main") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/notes/src/main.tsx")).href)
  : await import("./main");
const { NotesStore, createNote }: typeof import("./store") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/notes/src/store.ts")).href)
  : await import("./store");
const width = Number(process.env.MOIRE_CAPTURE_WIDTH ?? 1280),
  height = Number(process.env.MOIRE_CAPTURE_HEIGHT ?? 800);
assert.ok(
  Number.isInteger(width) &&
    width >= 440 &&
    width <= 1600 &&
    Number.isInteger(height) &&
    height >= 480 &&
    height <= 1000,
);
const scheme = process.env.MOIRE_CAPTURE_SCHEME === "light" ? "light" : "dark";
const output =
  process.env.MOIRE_CAPTURE_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "moire-notes-captures-"));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-notes-visual-"));
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
  const body =
    "Design that feels human.\n\nMoire brings calm and clarity to everyday computing. Make the next action easy to see, keep real content readable, and let useful work stay in focus.\n\nLess, but better.\n\nEvery control should earn its place. Give a note room to breathe, and keep its notebook and saved state close by.\n\nMotion with meaning.\n\nTransitions explain a change. A quiet interface also respects reduced motion.";
  const heading = body.indexOf("Less, but better."),
    second = body.indexOf("Motion with meaning.");
  store.save({
    ...store.load(),
    notebooks: [
      { id: "local", title: "Notes" },
      { id: "moire", title: "Moire" },
    ],
    notes: [
      {
        ...createNote("moire"),
        title: "Design principles",
        body,
        pinned: true,
        updatedAt: 1790989200000,
        runs: [
          { from: 0, to: 24, marks: { bold: true, underline: false, highlight: false } },
          {
            from: heading,
            to: heading + 17,
            marks: { bold: true, underline: false, highlight: false },
          },
          {
            from: second,
            to: second + 20,
            marks: { bold: true, underline: false, highlight: false },
          },
        ],
      },
      {
        ...createNote("moire"),
        title: "Keyboard workflows",
        body: "Browse collections without leaving the keyboard. Keep selection and focus attached to the actual note.",
        updatedAt: 1790989100000,
      },
      {
        ...createNote(),
        title: "A useful idea",
        body: "A place for an ordinary local thought.",
        updatedAt: 1790989000000,
      },
    ],
  });
  const theme = createPersonalizedWidgetTheme(
    discoverPersonalization("linux", {
      themeFamily: "moire",
      colorScheme: scheme,
      reducedMotion: true,
    }),
  );
  const app = await harness(
    (size, window) => (
      <WidgetThemeProvider theme={theme}>
        <NotesApp
          {...size}
          store={store}
          windowActions={window}
          onCloseGuard={(guard) => window.setCloseGuard(guard)}
        />
      </WidgetThemeProvider>
    ),
    width,
    height,
  );
  try {
    await app.settle();
    await app.capture(path.join(output, "notes-document.png"));
    // Selection uses the actual focused editor; its measured floating toolbar paints normally.
    app.key(102, "Home", { ctrl: true });
    for (let i = 0; i < 24; i++) app.key(106, "ArrowRight", { shift: true });
    await app.settle();
    await app.capture(path.join(output, "notes-selection-toolbar.png"));
    assert.equal(app.native.lastFrame?.length, width * height * 4);
    console.log(
      JSON.stringify({
        kind: "notes-reference-captures",
        source: source ?? "workspace",
        width,
        height,
        scheme,
        output,
        scope:
          "actual public Window + headless software pixels; native/reference acceptance remains open",
      }),
    );
  } finally {
    app.destroy();
  }
} finally {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}

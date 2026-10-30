/**
 * Opening a font through the chooser and installing it: the copy lands in the fonts folder,
 * fc-cache is run on it, the header says Installed, and failures are explained. A stand-in
 * fc-cache records its call; a missing one is reported, not fatal.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { loadRecentFiles } from "@moire/app-tools";
import { mountWindow, withFixture, type MountedWindow } from "@moire/app-tools/testing";
import { installFont } from "./install";
import { FontViewerApp } from "./main";

const PLEX = fileURLToPath(
  new URL("../../../../packages/ui/fonts/IBMPlexSans-Regular.ttf", import.meta.url),
);
const previousPath = process.env.PATH;

/** Press Install once the installed check has enabled it. */
async function pressInstall(app: MountedWindow): Promise<void> {
  await app.until(() => {
    try {
      app.press({ focusId: "font:install" });
      return true;
    } catch {
      return false;
    }
  }, "Install becomes available");
}

await withFixture(async (home) => {
  const downloads = path.join(home, "Documents");
  await fs.mkdir(downloads, { recursive: true });
  const font = path.join(downloads, "Plex.ttf");
  await fs.copyFile(PLEX, font);
  await fs.writeFile(path.join(downloads, "readme.txt"), "not a font");
  const bin = path.join(home, "bin");
  const calls = path.join(home, "fc-cache.log");
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "fc-cache"), `#!/bin/sh\necho "$@" >> '${calls}'\n`, {
    mode: 0o755,
  });
  // fc-scan (used to name the face) stays on the real PATH after the stand-in.
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
  const fonts = path.join(home, "data", "fonts");

  const app = await mountWindow((size) => <FontViewerApp {...size} />, { width: 860 });
  try {
    app.press({ text: "Open…" });
    await app.settle();
    assert.ok(app.texts().includes("Plex.ttf"), "the chooser lists fonts");
    assert.ok(!app.texts().includes("readme.txt"), "and only fonts");
    app.key(108, "ArrowDown");
    app.key(28, "Enter");
    await app.until(() => app.texts().includes("Sizes"), "the specimen renders", 8000);
    assert.deepEqual(loadRecentFiles("org.moire.FontViewer"), [font]);
    await pressInstall(app);
    await app.until(() => app.texts().includes("Installed"), "the header says Installed", 8000);
    assert.ok(
      app.texts().includes("Installed in ~/data/fonts/Plex.ttf · font cache refreshed"),
      app.texts().join(" | "),
    );
    assert.ok((await fs.readFile(path.join(fonts, "Plex.ttf"))).equals(await fs.readFile(font)));
    assert.equal((await fs.readFile(calls, "utf8")).trim(), `-f ${fonts}`);
  } finally {
    app.destroy();
  }

  // Reopened later, an installed font says so straight away.
  const again = await mountWindow((size) => <FontViewerApp {...size} initialPath={font} />);
  try {
    await again.until(() => again.texts().includes("Installed"), "already installed");
  } finally {
    again.destroy();
  }

  // A different font under the same name is not overwritten.
  const other = path.join(home, "other", "Plex.ttf");
  await fs.mkdir(path.dirname(other));
  await fs.copyFile(
    fileURLToPath(
      new URL("../../../../packages/ui/fonts/IBMPlexMono-Regular.ttf", import.meta.url),
    ),
    other,
  );
  const clash = await mountWindow((size) => <FontViewerApp {...size} initialPath={other} />);
  try {
    await pressInstall(clash);
    await clash.until(
      () => clash.texts().some((text) => text.startsWith("Couldn't install: A different font")),
      "a name clash is explained",
    );
    assert.ok(clash.texts().includes("Install"), "Install can be tried again after a failure");
  } finally {
    clash.destroy();
  }

  // Without fc-cache the font still installs, and the person is told what that means.
  await fs.rm(path.join(bin, "fc-cache"));
  process.env.PATH = bin;
  await fs.rm(fonts, { recursive: true });
  const result = await installFont(font);
  assert.deepEqual(result.cache, { kind: "unavailable" });
  assert.equal(result.copied, true);
}).finally(() => {
  process.env.PATH = previousPath;
});
console.log(
  "[font-viewer/install] chooser open, recent, Install with fc-cache, Installed on reopen, name clash and missing fc-cache passed",
);

/**
 * Disk Usage driven by keyboard and pointer: a quick pick and the folder chooser start scans,
 * cancelling one, drilling in and out, largest files, sorting, and Show in Files.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { mountWindow, withFixture } from "@moire/app-tools/testing";
import { DiskUsageApp } from "./main";

const KEY = { home: 102, enter: 28, down: 108 };

await withFixture(async (home) => {
  const tree = path.join(home, "tree");
  await fs.mkdir(path.join(tree, "photos"), { recursive: true });
  await fs.writeFile(path.join(tree, "photos", "huge.raw"), Buffer.alloc(512 * 1024, 1));
  await fs.writeFile(path.join(tree, "aaa-small.txt"), "small");
  // Enough entries that the cancel lands while the scan is still running.
  const many = path.join(home, "many");
  for (let folder = 0; folder < 40; folder++) {
    await fs.mkdir(path.join(many, `f${folder}`), { recursive: true });
    for (let item = 0; item < 50; item++)
      await fs.writeFile(path.join(many, `f${folder}`, `${item}`), "");
  }
  const bin = path.join(home, "bin");
  const shown = path.join(home, "shown.txt");
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "xdg-open"), `#!/bin/sh\nprintf '%s' "$1" > '${shown}'\n`, {
    mode: 0o755,
  });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  const app = await mountWindow((size, window) => <DiskUsageApp {...size} window={window} />, {
    width: 1020,
    height: 700,
  });
  try {
    await app.settle();
    assert.ok(app.texts().includes("Scan Home"), "Home is offered as a quick pick");

    // Start a long scan from the chooser and cancel it.
    app.press({ focusId: "usage:choose" });
    await app.settle();
    assert.ok(app.texts().includes("Choose a folder to scan"));
    // Home lists bin, many, … in the chooser; pick "many".
    app.key(KEY.down, "ArrowDown");
    app.key(KEY.down, "ArrowDown");
    app.press({ text: "Choose folder" });
    assert.ok(
      app.texts().some((text) => text.startsWith("Measuring ~/many")),
      "the chosen folder is being measured",
    );
    app.press({ focusId: "usage:cancel-scan" });
    await app.settle(20);
    assert.ok(app.texts().includes("Scan cancelled"), "cancel stops the scan and says so");

    // Scan Home from its quick pick and drill into the largest folder by keyboard.
    app.press({ focusId: "usage:pick:home" });
    await app.until(() => app.texts().some((text) => text.includes("entries ·")), "home scanned");
    app.press({ focusId: "usage:list" });
    app.key(KEY.home, "Home");
    app.key(KEY.enter, "Enter");
    assert.ok(app.texts().includes("photos"), "Enter opens the selected folder");
    assert.ok(app.texts().includes("tree"), "the breadcrumbs show where you are");

    // Sort by name, then by size.
    app.press({ text: "Name" });
    const order = () => app.texts().filter((text) => text === "photos" || text === "aaa-small.txt");
    assert.deepEqual(order(), ["aaa-small.txt", "photos"]);
    app.press({ text: "Size" });
    assert.deepEqual(order(), ["photos", "aaa-small.txt"]);

    // Largest files lists files from every folder below, with where they are.
    app.press({ text: "Largest files" });
    assert.ok(app.texts().includes("huge.raw  ·  photos"));
    app.press({ focusId: "usage:list" });
    app.key(KEY.home, "Home");
    app.press({ focusId: "usage:show" });
    await app.until(() => existsSync(shown), "Files was asked to show the file's folder");
    assert.equal(
      await fs.readFile(shown, "utf8"),
      pathToFileURL(path.join(await fs.realpath(tree), "photos")).href,
    );

    // Up returns to Home, selecting the folder you came from.
    app.press({ focusId: "usage:up" });
    assert.ok(app.texts().includes("many"), "back at the scanned folder");
  } finally {
    app.destroy();
    process.env.PATH = previousPath;
  }
});
console.log(
  "[disk-usage/workflow] chooser scan + cancel, quick pick, keyboard drill-in, sort, largest files, Show in Files, up passed",
);
